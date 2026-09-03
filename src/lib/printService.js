/**
 * Print Service for thermal printer (80mm, LAN/TCP)
 *
 * - On Android (Capacitor): sends ESC/POS via raw TCP socket to printer IP:9100
 * - On Web: fallback using window.print() with formatted receipt
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { generarComandaCocina, generarTicketCliente, generarTicketTpv, generarComandaTpv, generarInformeDiaTpv, generarReporteCaja, abrirCajon, textToBytes as escTextToBytes } from './escpos'
import { bytesDelLogo } from './logoTicket'

// EL PUENTE CON LA IMPRESORA. Hay DOS implementaciones y el resto del fichero no
// necesita saber en cual esta:
//   - Android: el plugin nativo `ThermalPrinter` (java, socket TCP).
//   - Windows: `window.pidooDesktop`, que expone el preload de Electron.
// Las dos ofrecen los MISMOS tres metodos con los MISMOS argumentos —print,
// checkConnection, scanNetwork— a proposito: si algun dia divergen, este fichero se
// llena de condicionales y la impresion es justo donde no se quieren condicionales.
//
// Un navegador normal no tiene ninguno de los dos: no puede abrir un socket crudo al
// puerto 9100, no hay API para eso. Ahi `puente` es null y se cae al `window.print()`.
let ThermalPrinter = null
if (Capacitor.isNativePlatform()) {
  ThermalPrinter = registerPlugin('ThermalPrinter')
}

const escritorio = (typeof window !== 'undefined' && window.pidooDesktop) || null
const puente = ThermalPrinter || escritorio

// Para que la interfaz pueda decir "esto solo va en la app" con propiedad.
export const hayImpresoraNativa = !!puente
export const esEscritorio = !!escritorio

// Escape HTML to prevent XSS when interpolating user data into ticket HTML
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// localStorage keys
const PRINTER_CONFIG_KEY = 'pido_printer_config'

// `modo`: 'red' (socket TCP al 9100) o 'usb' (impresora enchufada a este ordenador).
//
// Las configuraciones VIEJAS no tienen `modo`, y hay que seguir tratándolas como de
// red: si esto devolviera 'usb' por defecto, todos los restaurantes que hoy imprimen
// por IP dejarían de imprimir de golpe al actualizar.
export function getPrinterConfig() {
  try {
    const saved = localStorage.getItem(PRINTER_CONFIG_KEY)
    if (saved) {
      const cfg = JSON.parse(saved)
      return { modo: 'red', impresoraUsb: '', ...cfg }
    }
  } catch {}
  return { ip: '', port: 9100, enabled: false, tickets: 2, modo: 'red', impresoraUsb: '' }
}

// ¿Hay algo configurado por donde pueda salir un ticket? Cada modo mira lo suyo:
// preguntar por la IP en modo USB diría "sin configurar" con la impresora enchufada.
export function impresoraConfigurada(config = getPrinterConfig()) {
  if (!config.enabled) return false
  return config.modo === 'usb' ? !!config.impresoraUsb : !!config.ip
}

// Las impresoras que Windows tiene instaladas en ESTE ordenador.
export async function listarImpresorasUsb() {
  if (!escritorio?.listPrinters) {
    return { impresoras: [], error: 'Solo en la app de Windows' }
  }
  try {
    return await escritorio.listPrinters()
  } catch (err) {
    return { impresoras: [], error: err.message || 'No se pudieron leer las impresoras' }
  }
}

// El equivalente al "¿responde la IP?" pero para USB: que Windows siga viendo esa
// impresora y no la dé por desconectada. Sirve para avisar ANTES de cobrar.
export async function comprobarImpresora(config = getPrinterConfig()) {
  if (!puente) return { ok: false, error: 'Solo disponible en la app (Android o Windows)' }
  if (config.modo === 'usb') {
    if (!escritorio?.checkUsb) return { ok: false, error: 'Solo en la app de Windows' }
    try {
      return await escritorio.checkUsb({ printerName: config.impresoraUsb })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
  return checkPrinterConnection(config.ip, config.port)
}

export function savePrinterConfig(config) {
  localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(config))
}

function uint8ToBase64(uint8Array) {
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary)
}

/**
 * Send raw bytes to a specific printer IP (overrides config)
 */
export async function sendRawToIp(ip, port, data) {
  if (!puente) return false
  try {
    const base64 = uint8ToBase64(data)
    await puente.print({ ip, port: port || 9100, data: base64 })
    return true
  } catch (err) {
    console.error('[Print] Error:', err)
    return false
  }
}

/**
 * Send raw bytes to configured thermal printer via TCP
 */
async function sendToThermalPrinter(data) {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return false

  // USB: la impresora está enchufada a este mismo ordenador. Es el caso del
  // mostrador de Duende Burger, donde el 9100 está cerrado porque la térmica no
  // cuelga del router, cuelga del PC.
  if (config.modo === 'usb') {
    if (!escritorio?.printUsb) return false
    try {
      await escritorio.printUsb({
        printerName: config.impresoraUsb,
        data: uint8ToBase64(data),
      })
      return true
    } catch (err) {
      console.error('[Print USB]', err)
      return false
    }
  }

  return sendRawToIp(config.ip, config.port, data)
}

// ── Segunda impresora: LA DE COCINA (opcional) ───────────────────────────────
//
// `config.cocina = { activa, modo: 'red'|'usb', ip, port, impresoraUsb }`.
// Solo las COMANDAS van por aquí; tickets de cliente, informes, X/Z y el cajón
// siguen en la principal (el cajón cuelga de la de barra). Sin `cocina.activa`
// todo funciona EXACTAMENTE como con una sola impresora — ningún restaurante
// existente cambia de comportamiento al actualizar.
export function impresoraCocinaConfigurada(config = getPrinterConfig()) {
  const c = config.cocina
  if (!c?.activa) return false
  return c.modo === 'usb' ? !!c.impresoraUsb : !!c.ip
}

// Manda una comanda al destino que toque. Si la de cocina FALLA, cae a la
// principal: una comanda en la barra es molesta; una comanda que no sale es un
// cliente sin su comida.
async function sendComanda(data) {
  const config = getPrinterConfig()
  if (impresoraCocinaConfigurada(config)) {
    const c = config.cocina
    let ok = false
    if (c.modo === 'usb') {
      if (escritorio?.printUsb) {
        try {
          await escritorio.printUsb({ printerName: c.impresoraUsb, data: uint8ToBase64(data) })
          ok = true
        } catch (err) {
          console.error('[Print cocina USB]', err)
        }
      }
    } else {
      ok = await sendRawToIp(c.ip, c.port || 9100, data)
    }
    if (ok) return true
    console.warn('[Print] La impresora de cocina no responde: la comanda sale por la principal')
  }
  return sendToThermalPrinter(data)
}

// INTERCAMBIA los papeles de las dos impresoras: la de CAJA pasa a ser la de
// COCINA y al revés, conservando cada conexión (red o USB) tal cual. Existe
// porque montar el local al revés es un clásico — y re-teclear IPs para
// arreglarlo, una tortura. Devuelve la configuración ya cruzada.
export function intercambiarImpresoras() {
  const cfg = getPrinterConfig()
  const caja = { modo: cfg.modo || 'red', ip: cfg.ip || '', port: cfg.port || 9100, impresoraUsb: cfg.impresoraUsb || '' }
  const cocina = cfg.cocina || {}
  savePrinterConfig({
    ...cfg,
    modo: cocina.modo || 'red',
    ip: cocina.ip || '',
    port: cocina.port || 9100,
    impresoraUsb: cocina.impresoraUsb || '',
    enabled: true,
    cocina: { ...cocina, activa: true, ...caja },
  })
  return getPrinterConfig()
}

// Prueba la impresora de cocina imprimiendo una comanda de verdad EN ELLA
// (sin fallback: probar es ver si responde ESA, no otra).
export async function probarImpresoraCocina(c) {
  if (!c) return { ok: false, error: 'Sin configuración' }
  const data = generarComandaTpv(
    [{ cantidad: 1, nombre: 'PRUEBA DE COCINA', tamano: null, extrasTexto: '', notas: 'Si lees esto, la impresora de cocina funciona' }],
    { nombre: 'Pidoo' },
    { numero: 0 },
  )
  try {
    if (c.modo === 'usb') {
      if (!escritorio?.printUsb) return { ok: false, error: 'El USB solo funciona en la app de Windows' }
      await escritorio.printUsb({ printerName: c.impresoraUsb, data: uint8ToBase64(data) })
      return { ok: true }
    }
    const ok = await sendRawToIp(c.ip, c.port || 9100, data)
    return { ok }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Scan the local network for thermal printers (port 9100)
 * Only works on Capacitor/Android
 * Returns: { printers: [{ ip, port, hostname? }], subnet, scanned }
 */
export async function scanPrinters() {
  if (!puente) {
    return { printers: [], error: 'Solo disponible en la app (Android o Windows)' }
  }
  try {
    const result = await puente.scanNetwork({ port: 9100 })
    return { printers: result.printers || [], subnet: result.subnet, scanned: result.scanned }
  } catch (err) {
    console.error('[Print] Error al escanear:', err)
    return { printers: [], error: err.message || 'Error al escanear la red' }
  }
}

/**
 * Check if a printer is reachable at the given IP
 */
export async function checkPrinterConnection(ip, port = 9100) {
  if (!puente) {
    return { ok: false, error: 'Solo disponible en la app (Android o Windows)' }
  }
  try {
    await puente.checkConnection({ ip, port })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Connect to a printer: save config + send test ticket
 * Returns { ok: boolean }
 */
export async function connectAndTestPrinter(ip, port = 9100, logoBytes = null) {
  // 🔴 Se conserva TODO lo demás de la configuración (tickets, impresoraUsb…).
  // Antes esto guardaba `{ip, port, enabled}` a secas: probar una IP borraba la
  // impresora USB configurada y el ajuste de "solo comanda", y si la prueba
  // fallaba se revertía a vacío — un mostrador funcionando por USB se quedaba
  // sin imprimir NADA por curiosear la pestaña de red. `probarImpresoraUsb`
  // siempre lo hizo bien (guarda `anterior` y lo restaura); ahora este igual.
  const anterior = getPrinterConfig()
  savePrinterConfig({ ...anterior, ip, port, modo: 'red', enabled: true })

  // Send test ticket (using CP850 for proper Spanish characters)
  const ESC = 0x1B, GS = 0x1D, LF = 0x0A
  const t = (str) => escTextToBytes(str)

  const data = new Uint8Array([
    ESC, 0x40, // Init
    ESC, 0x74, 0x13, // CP858 (la página con el €; ver escpos.js)
    ESC, 0x61, 0x01, // Center
  ])

  // EL LOGO DEL RESTAURANTE, si se ha podido preparar.
  //
  // No es adorno en una prueba: es la unica forma de comprobar de un CLIC que el mapa
  // de bits llega entero a la impresora y sale bien. Antes habia que crear un pedido de
  // prueba, aceptarlo y mirar el papel — y si no salia, no sabias si el fallo estaba en
  // la conversion, en el envio o en la impresora. Estos son EXACTAMENTE los mismos
  // bytes que se ven en la vista previa de arriba.
  const conLogo = logoBytes && logoBytes.length
    ? [...data, ...logoBytes, LF]
    : [...data]

  const resto = new Uint8Array([
    // Cabecera de la prueba
    GS, 0x21, 0x11, // Double size
    ESC, 0x45, 0x01, // Bold
    ...t('PRUEBA'), LF,
    GS, 0x21, 0x00, // Normal
    ESC, 0x45, 0x00,
    LF,

    ...t('================================'), LF,
    ESC, 0x45, 0x01,
    ...t('¡Impresora conectada!'), LF,
    ESC, 0x45, 0x00,
    ...t('================================'), LF,
    LF,
    ...t('IP: ' + ip + ':' + port), LF,
    ...t(new Date().toLocaleString('es-ES')), LF,
    LF,
    ...t('Esta impresora está lista'), LF,
    ...t('para recibir pedidos.'), LF,
    LF,
    ...t('Al aceptar un pedido se'), LF,
    ...t('imprimirán 2 tickets:'), LF,
    ...t('  - Comanda para cocina'), LF,
    ...t('  - Ticket para cliente'), LF,
    ...t('================================'), LF,
    LF, LF, LF,
    GS, 0x56, 0x01, // Partial cut
  ])

  // Cabecera + logo + resto, en un solo envio. En dos envios la impresora puede cortar
  // en medio o reordenar, y el logo saldria suelto en su propio trozo de papel.
  const todo = new Uint8Array(conLogo.length + resto.length)
  todo.set(conLogo, 0)
  todo.set(resto, conLogo.length)

  const ok = await sendRawToIp(ip, port, todo)
  if (!ok) {
    // La prueba no salió: se deja la configuración EXACTAMENTE como estaba,
    // sin dar por buena una impresora muda ni borrar la que sí funcionaba.
    savePrinterConfig(anterior)
  }
  return { ok }
}

/**
 * Disconnect printer: deja de imprimir, pero CONSERVA el resto de la
 * configuración (tickets, impresora USB elegida) para que reconectar sea un clic.
 */
export function disconnectPrinter() {
  savePrinterConfig({ ...getPrinterConfig(), enabled: false })
}

/**
 * Print both receipts: kitchen command + customer ticket
 * Called automatically when an order is accepted
 */
export async function imprimirPedido(pedido, items, restaurante, destinoDe = null) {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return { ok: false, reason: 'not_configured' }

  // La COMANDA DE COCINA va SIN logo, a proposito. Ese papel lo lee el de la plancha y
  // lo tira: un logo son ~30 mm de papel y unos segundos de impresion en CADA pedido,
  // a cambio de nada. Ahi lo que importa es el codigo grande y las notas.
  // Sale por la impresora DE COCINA si hay una configurada (con la principal de
  // respaldo); si no, por la de siempre. Con un mapa de destinos, la comanda se
  // PARTE en dos papeles: cocina y barra, cada uno a su impresora.
  let r1 = true
  if (destinoDe && impresoraCocinaConfigurada(config)) {
    const paraCocina = []
    const paraBarra = []
    for (const it of items || []) {
      (destinoDe(it.producto_id) === 'barra' ? paraBarra : paraCocina).push(it)
    }
    if (paraCocina.length) {
      r1 = (await sendComanda(generarComandaCocina(pedido, paraCocina, restaurante))) && r1
    }
    if (paraBarra.length) {
      r1 = (await sendToThermalPrinter(generarComandaCocina(pedido, paraBarra, restaurante, '** BARRA **'))) && r1
    }
  } else {
    const cocina = generarComandaCocina(pedido, items, restaurante)
    r1 = await sendComanda(cocina)
  }

  let r2 = true
  if (config.tickets !== 1) {
    await new Promise(r => setTimeout(r, 500))
    // El TICKET DEL CLIENTE si: es el que va en la bolsa y el que lee el cliente.
    // Se pide DESPUES de mandar la comanda para no retrasar a cocina si el logo
    // hubiera que descargarlo (solo pasa la primera vez; luego va guardado).
    const logo = await bytesDelLogo(restaurante?.logo_url).catch(() => null)
    const cliente = generarTicketCliente(pedido, items, restaurante, logo)
    r2 = await sendToThermalPrinter(cliente)
  }

  return { ok: r1 && r2, cocina: r1, cliente: r2 }
}

/**
 * Test print - sends a small test ticket to configured printer
 */
export async function testPrint() {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return { ok: false, reason: 'no_ip' }
  if (config.modo === 'usb') return probarImpresoraUsb(config.impresoraUsb)
  return connectAndTestPrinter(config.ip, config.port)
}

/**
 * Guarda la impresora USB elegida y le manda un ticket de prueba.
 *
 * Es el equivalente de `connectAndTestPrinter` para el USB: elegir una impresora en
 * una lista no demuestra nada — lo que hay que ver es el papel saliendo. Si no sale,
 * se deja la configuración como estaba en vez de dar por buena una impresora muda.
 */
export async function probarImpresoraUsb(nombreImpresora, logoBytes = null) {
  if (!nombreImpresora) return { ok: false, error: 'No has elegido ninguna impresora' }
  const anterior = getPrinterConfig()
  savePrinterConfig({ ...anterior, modo: 'usb', impresoraUsb: nombreImpresora, enabled: true })

  const ESC = 0x1B, GS = 0x1D, LF = 0x0A
  const t = (str) => escTextToBytes(str)

  const cabecera = [ESC, 0x40, ESC, 0x74, 0x13, ESC, 0x61, 0x01] // init + CP858 + center
  const conLogo = logoBytes && logoBytes.length ? [...cabecera, ...logoBytes, LF] : [...cabecera]

  const resto = new Uint8Array([
    GS, 0x21, 0x11, ESC, 0x45, 0x01,
    ...t('PRUEBA'), LF,
    GS, 0x21, 0x00, ESC, 0x45, 0x00, LF,
    ...t('================================'), LF,
    ESC, 0x45, 0x01,
    ...t('¡Impresora conectada por USB!'), LF,
    ESC, 0x45, 0x00,
    ...t('================================'), LF, LF,
    ...t(nombreImpresora), LF,
    ...t(new Date().toLocaleString('es-ES')), LF, LF,
    ...t('Esta impresora está lista'), LF,
    ...t('para recibir pedidos.'), LF,
    LF, LF, LF,
    GS, 0x56, 0x01,
  ])

  const todo = new Uint8Array(conLogo.length + resto.length)
  todo.set(conLogo, 0)
  todo.set(resto, conLogo.length)

  const ok = await sendToThermalPrinter(todo)
  if (!ok) savePrinterConfig(anterior)
  return { ok }
}

/**
 * Web fallback: open a printable receipt in a new window
 */
export function imprimirPedidoWeb(pedido, items, restaurante, tipo = 'ambos') {
  const win = window.open('', '_blank', 'width=350,height=600')
  if (!win) return

  const generarHTML = (esCocina) => {
    let html = `<div style="font-family:monospace;width:280px;margin:0 auto;font-size:12px;">`

    if (esCocina) {
      html += `<h1 style="text-align:center;font-size:20px;margin:0;">** COCINA **</h1>`
      html += `<h2 style="text-align:center;font-size:24px;margin:8px 0;">${esc(pedido.codigo) || '---'}</h2>`
      html += `<p style="text-align:center;">PIDO | Prep: ${esc(pedido.minutos_preparacion) || '?'} min</p>`
      const cl = pedido.usuarios
      if (cl) {
        const nom = [cl.nombre, cl.apellido].filter(Boolean).map(esc).join(' ')
        if (nom) html += `<p style="font-weight:bold;">Cliente: ${nom}</p>`
        if (cl.telefono) html += `<p>Tel: ${esc(cl.telefono)}</p>`
      }
      if (pedido.direccion_entrega) html += `<p>Dir: ${esc(pedido.direccion_entrega)}</p>`
      html += `<hr style="border:2px dashed #000;">`
      for (const item of items || []) {
        html += `<p style="font-size:16px;font-weight:bold;margin:4px 0;">${esc(item.cantidad)}x ${esc(item.nombre_producto)}</p>`
      }
      if (pedido.notas) {
        html += `<hr style="border:1px solid #000;"><p style="font-weight:bold;">NOTAS: ${esc(pedido.notas)}</p><hr style="border:1px solid #000;">`
      }
      html += `<p style="text-align:center;font-weight:bold;">Pago: ${pedido.metodo_pago === 'efectivo' ? 'EFECTIVO' : 'TARJETA'}</p>`
    } else {
      html += `<h1 style="text-align:center;font-size:18px;margin:0;">${esc(restaurante?.nombre) || 'PIDO'}</h1>`
      if (restaurante?.direccion) html += `<p style="text-align:center;margin:2px 0;">${esc(restaurante.direccion)}</p>`
      if (restaurante?.telefono) html += `<p style="text-align:center;margin:2px 0;">Tel: ${esc(restaurante.telefono)}</p>`
      html += `<hr style="border:2px solid #000;">`
      html += `<h3 style="text-align:center;">TICKET DE PEDIDO</h3>`
      html += `<hr>`
      html += `<p>Pedido: ${esc(pedido.codigo)}</p>`
      html += `<p>Fecha: ${esc(new Date(pedido.created_at).toLocaleString('es-ES'))}</p>`
      html += `<p>Pago: ${pedido.metodo_pago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}</p>`
      html += `<hr>`
      const cl2 = pedido.usuarios
      if (cl2) {
        const nom2 = [cl2.nombre, cl2.apellido].filter(Boolean).map(esc).join(' ')
        if (nom2) html += `<p><strong>Cliente:</strong> ${nom2}</p>`
        if (cl2.telefono) html += `<p><strong>Tel:</strong> ${esc(cl2.telefono)}</p>`
      }
      if (pedido.direccion_entrega) html += `<p><strong>Entrega:</strong> ${esc(pedido.direccion_entrega)}</p>`
      html += `<hr>`
      for (const item of items || []) {
        const imp = (item.precio_unitario * item.cantidad).toFixed(2)
        html += `<p style="margin:2px 0;">${esc(item.cantidad)}x ${esc(item.nombre_producto)}<span style="float:right;">${esc(imp)} EUR</span></p>`
      }
      html += `<hr style="border:2px solid #000;">`
      html += `<p style="font-size:16px;font-weight:bold;text-align:center;">TOTAL: ${esc((pedido.total || 0).toFixed(2))} EUR</p>`
      html += `<hr style="border:2px solid #000;">`
      if (pedido.notas) html += `<p>Nota: ${esc(pedido.notas)}</p>`
      html += `<p style="text-align:center;">Tiempo: ~${esc(pedido.minutos_preparacion) || '?'} min</p>`
      html += `<p style="text-align:center;font-weight:bold;">Gracias por tu pedido!</p>`
      html += `<p style="text-align:center;">pidoo.es</p>`
    }

    html += `</div>`
    return html
  }

  let body = ''
  if (tipo === 'cocina' || tipo === 'ambos') {
    body += generarHTML(true)
    if (tipo === 'ambos') body += `<div style="page-break-after:always;"></div>`
  }
  if (tipo === 'cliente' || tipo === 'ambos') {
    body += generarHTML(false)
  }

  win.document.write(`<!DOCTYPE html><html><head><title>Ticket</title><style>@media print{@page{margin:0;size:80mm auto;}body{margin:0;}}</style></head><body>${body}</body></html>`)
  win.document.close()
  setTimeout(() => { win.print(); win.close() }, 300)
}

// ── MODULO TPV ───────────────────────────────────────────────────────────────

/**
 * Imprime el ticket de una venta de mostrador y, si toca, abre el cajon.
 *
 * REGLA: esto se llama DESPUES de que la venta este grabada en el servidor, y
 * nunca se espera a que termine para dar la venta por buena. Que la impresora
 * este apagada no puede costar una venta.
 *
 * Devuelve { ticket: bool, cajon: bool } para poder avisar de lo que fallo sin
 * bloquear al que esta cobrando.
 */
export async function imprimirTicketTpv(ticket, pedido, items, restaurante, opciones = {}) {
  const { pieTicket = null, abrirCajonTambien = false, anula = null } = opciones
  const resultado = { ticket: false, cajon: false }
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return resultado

  try {
    // El pulso del cajon viaja dentro del propio ticket: mas fiable que abrir una
    // segunda conexion justo cuando la impresora esta cortando el papel.
    // El logo se prepara aparte y se guarda: la primera vez cuesta una descarga, las
    // siguientes es instantaneo. Si falla devuelve null y el ticket sale sin el.
    const logo = await bytesDelLogo(restaurante?.logo_url).catch(() => null)
    const data = generarTicketTpv(ticket, pedido, items, restaurante, pieTicket, abrirCajonTambien, logo, anula)
    resultado.ticket = await sendToThermalPrinter(data)
    resultado.cajon = resultado.ticket && abrirCajonTambien
  } catch (err) {
    console.error('[TPV] Error imprimiendo el ticket:', err)
  }

  // Si el ticket no llego a salir, el cajon tampoco se abrio: se intenta suelto.
  if (abrirCajonTambien && !resultado.ticket) {
    resultado.cajon = await pulsoCajon()
  }
  return resultado
}

/**
 * Abre el cajon portamonedas sin imprimir nada.
 *
 * Hace falta suelto (boton "Abrir cajon") para dar cambio, cuadrar caja o sacar
 * dinero, no solo al cobrar.
 */
export async function pulsoCajon() {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return false
  try {
    return await sendToThermalPrinter(abrirCajon())
  } catch (err) {
    console.error('[TPV] Error abriendo el cajon:', err)
    return false
  }
}

/**
 * Manda a cocina lo que hay en el mostrador, sin cobrar todavia.
 */
export async function imprimirComandaTpv(lineas, restaurante, opciones = {}, destinoDe = null) {
  const config = getPrinterConfig()
  // Basta con que haya CUALQUIERA de las dos: la comanda encuentra su camino.
  if (!impresoraConfigurada(config) && !impresoraCocinaConfigurada(config)) return false
  try {
    // Con DOS impresoras y un mapa de destinos, la comanda se PARTE: lo de
    // cocina a la de cocina y lo de barra (bebidas) a la principal, cada papel
    // con su título. Sin mapa o con una sola impresora, un único papel como
    // siempre.
    if (destinoDe && impresoraCocinaConfigurada(config)) {
      const cocina = []
      const barra = []
      for (const l of lineas) {
        (destinoDe(l.producto_id) === 'barra' ? barra : cocina).push(l)
      }
      let ok = true
      if (cocina.length) {
        ok = (await sendComanda(generarComandaTpv(cocina, restaurante, opciones))) && ok
      }
      if (barra.length) {
        ok = (await sendToThermalPrinter(generarComandaTpv(barra, restaurante, { ...opciones, titulo: '** BARRA **' }))) && ok
      }
      return ok
    }
    return await sendComanda(generarComandaTpv(lineas, restaurante, opciones))
  } catch (err) {
    console.error('[TPV] Error imprimiendo la comanda:', err)
    return false
  }
}

/**
 * Imprime el resumen de lo vendido hoy por el mostrador.
 */
export async function imprimirInformeDiaTpv(resumen, restaurante) {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return false
  try {
    return await sendToThermalPrinter(generarInformeDiaTpv(resumen, restaurante))
  } catch (err) {
    console.error('[TPV] Error imprimiendo el informe:', err)
    return false
  }
}

/**
 * Imprime el informe X (turno en marcha) o el cierre Z de la caja.
 */
export async function imprimirReporteCaja(datos, restaurante, tipo = 'X') {
  const config = getPrinterConfig()
  if (!impresoraConfigurada(config)) return false
  try {
    return await sendToThermalPrinter(generarReporteCaja(datos, restaurante, tipo))
  } catch (err) {
    console.error('[TPV] Error imprimiendo el informe de caja:', err)
    return false
  }
}
