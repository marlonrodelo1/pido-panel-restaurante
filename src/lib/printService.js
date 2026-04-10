/**
 * Print Service for thermal printer (80mm, LAN/TCP)
 *
 * - On Android (Capacitor): sends ESC/POS via raw TCP socket to printer IP:9100
 * - On Web: fallback using window.print() with formatted receipt
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { generarComandaCocina, generarTicketCliente, textToBytes as escTextToBytes } from './escpos'

// Capacitor plugin bridge (registered in Android native code)
let ThermalPrinter = null
if (Capacitor.isNativePlatform()) {
  ThermalPrinter = registerPlugin('ThermalPrinter')
}

// localStorage keys
const PRINTER_CONFIG_KEY = 'pido_printer_config'

export function getPrinterConfig() {
  try {
    const saved = localStorage.getItem(PRINTER_CONFIG_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { ip: '', port: 9100, enabled: false, tickets: 2 }
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
async function sendRawToIp(ip, port, data) {
  if (!Capacitor.isNativePlatform() || !ThermalPrinter) return false
  try {
    const base64 = uint8ToBase64(data)
    await ThermalPrinter.print({ ip, port: port || 9100, data: base64 })
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
  if (!config.ip || !config.enabled) {
    console.log('[Print] Impresora no configurada o desactivada')
    return false
  }
  return sendRawToIp(config.ip, config.port, data)
}

/**
 * Scan the local network for thermal printers (port 9100)
 * Only works on Capacitor/Android
 * Returns: { printers: [{ ip, port, hostname? }], subnet, scanned }
 */
export async function scanPrinters() {
  if (!Capacitor.isNativePlatform() || !ThermalPrinter) {
    return { printers: [], error: 'Solo disponible en la app Android' }
  }
  try {
    const result = await ThermalPrinter.scanNetwork({ port: 9100 })
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
  if (!Capacitor.isNativePlatform() || !ThermalPrinter) {
    return { ok: false, error: 'Solo disponible en la app Android' }
  }
  try {
    await ThermalPrinter.checkConnection({ ip, port })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Connect to a printer: save config + send test ticket
 * Returns { ok: boolean }
 */
export async function connectAndTestPrinter(ip, port = 9100) {
  // Save config
  savePrinterConfig({ ip, port, enabled: true })

  // Send test ticket (using CP850 for proper Spanish characters)
  const ESC = 0x1B, GS = 0x1D, LF = 0x0A
  const t = (str) => escTextToBytes(str)

  const data = new Uint8Array([
    ESC, 0x40, // Init
    ESC, 0x74, 0x02, // CP850
    ESC, 0x61, 0x01, // Center

    // Logo PIDO grande
    GS, 0x21, 0x11, // Double size
    ESC, 0x45, 0x01, // Bold
    ...t('PIDOO'), LF,
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

  const ok = await sendRawToIp(ip, port, data)
  if (!ok) {
    // Revert if failed
    savePrinterConfig({ ip: '', port: 9100, enabled: false })
  }
  return { ok }
}

/**
 * Disconnect printer: clear config
 */
export function disconnectPrinter() {
  savePrinterConfig({ ip: '', port: 9100, enabled: false })
}

/**
 * Print both receipts: kitchen command + customer ticket
 * Called automatically when an order is accepted
 */
export async function imprimirPedido(pedido, items, restaurante) {
  const config = getPrinterConfig()
  if (!config.enabled || !config.ip) return { ok: false, reason: 'not_configured' }

  const cocina = generarComandaCocina(pedido, items, restaurante)
  const r1 = await sendToThermalPrinter(cocina)

  let r2 = true
  if (config.tickets !== 1) {
    await new Promise(r => setTimeout(r, 500))
    const cliente = generarTicketCliente(pedido, items, restaurante)
    r2 = await sendToThermalPrinter(cliente)
  }

  return { ok: r1 && r2, cocina: r1, cliente: r2 }
}

/**
 * Test print - sends a small test ticket to configured printer
 */
export async function testPrint() {
  const config = getPrinterConfig()
  if (!config.ip) return { ok: false, reason: 'no_ip' }
  return connectAndTestPrinter(config.ip, config.port)
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
      html += `<h2 style="text-align:center;font-size:24px;margin:8px 0;">${pedido.codigo || '---'}</h2>`
      html += `<p style="text-align:center;">${pedido.canal === 'pidogo' ? 'PIDOGO' : 'PIDO'} | Prep: ${pedido.minutos_preparacion || '?'} min</p>`
      const cl = pedido.usuarios
      if (cl) {
        const nom = [cl.nombre, cl.apellido].filter(Boolean).join(' ')
        if (nom) html += `<p style="font-weight:bold;">Cliente: ${nom}</p>`
        if (cl.telefono) html += `<p>Tel: ${cl.telefono}</p>`
      }
      if (pedido.direccion_entrega) html += `<p>Dir: ${pedido.direccion_entrega}</p>`
      html += `<hr style="border:2px dashed #000;">`
      for (const item of items || []) {
        html += `<p style="font-size:16px;font-weight:bold;margin:4px 0;">${item.cantidad}x ${item.nombre_producto}</p>`
      }
      if (pedido.notas) {
        html += `<hr style="border:1px solid #000;"><p style="font-weight:bold;">NOTAS: ${pedido.notas}</p><hr style="border:1px solid #000;">`
      }
      html += `<p style="text-align:center;font-weight:bold;">Pago: ${pedido.metodo_pago === 'efectivo' ? 'EFECTIVO' : 'TARJETA'}</p>`
    } else {
      html += `<h1 style="text-align:center;font-size:18px;margin:0;">${restaurante?.nombre || 'PIDO'}</h1>`
      if (restaurante?.direccion) html += `<p style="text-align:center;margin:2px 0;">${restaurante.direccion}</p>`
      if (restaurante?.telefono) html += `<p style="text-align:center;margin:2px 0;">Tel: ${restaurante.telefono}</p>`
      html += `<hr style="border:2px solid #000;">`
      html += `<h3 style="text-align:center;">TICKET DE PEDIDO</h3>`
      html += `<hr>`
      html += `<p>Pedido: ${pedido.codigo}</p>`
      html += `<p>Fecha: ${new Date(pedido.created_at).toLocaleString('es-ES')}</p>`
      html += `<p>Pago: ${pedido.metodo_pago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}</p>`
      html += `<hr>`
      const cl2 = pedido.usuarios
      if (cl2) {
        const nom2 = [cl2.nombre, cl2.apellido].filter(Boolean).join(' ')
        if (nom2) html += `<p><strong>Cliente:</strong> ${nom2}</p>`
        if (cl2.telefono) html += `<p><strong>Tel:</strong> ${cl2.telefono}</p>`
      }
      if (pedido.direccion_entrega) html += `<p><strong>Entrega:</strong> ${pedido.direccion_entrega}</p>`
      html += `<hr>`
      for (const item of items || []) {
        const imp = (item.precio_unitario * item.cantidad).toFixed(2)
        html += `<p style="margin:2px 0;">${item.cantidad}x ${item.nombre_producto}<span style="float:right;">${imp} EUR</span></p>`
      }
      html += `<hr style="border:2px solid #000;">`
      html += `<p style="font-size:16px;font-weight:bold;text-align:center;">TOTAL: ${(pedido.total || 0).toFixed(2)} EUR</p>`
      html += `<hr style="border:2px solid #000;">`
      if (pedido.notas) html += `<p>Nota: ${pedido.notas}</p>`
      html += `<p style="text-align:center;">Tiempo: ~${pedido.minutos_preparacion || '?'} min</p>`
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
