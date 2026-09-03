/**
 * ESC/POS command builder for 80mm thermal printers
 * Generates byte arrays that can be sent via TCP to port 9100
 */
import { textoTicket } from './metodoPago.js'

const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A

// Encoder for text → bytes (CP858 for Spanish chars + € symbol)
//
// 🔴 El € vive en 0xD5 SOLO en CP858 (ESC t 19). Con CP850 (ESC t 2) ese byte es
// una "ı" y todos los extras de pago salían "Queso (+0.50ı)". CP858 ES CP850 con
// ese único byte cambiado, así que el resto del mapa vale igual en las dos.
export function textToBytes(text) {
  const map = {
    'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4,
    'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'Ñ': 0xA5,
    'ü': 0x81, 'Ü': 0x9A, '¿': 0xA8, '¡': 0xAD, '€': 0xD5,
    'à': 0x85, 'è': 0x8A, 'ì': 0x8D, 'ò': 0x95, 'ù': 0x97,
    'â': 0x83, 'ê': 0x88, 'î': 0x8C, 'ô': 0x93, 'û': 0x96,
    'ä': 0x84, 'ë': 0x89, 'ï': 0x8B, 'ö': 0x94, 'ç': 0x87, 'Ç': 0x80,
    'º': 0xA7, 'ª': 0xA6, '°': 0xF8, '·': 0xFA,
    // Tipográficos que llegan al pegar el pie del ticket desde Word/WhatsApp:
    // se bajan a su versión de máquina de escribir en vez de imprimir "?".
    '’': 0x27, '‘': 0x27, '´': 0x27, '“': 0x22, '”': 0x22,
    '–': 0x2D, '—': 0x2D, ' ': 0x20,
  }
  const bytes = []
  for (const ch of text) {
    if (map[ch]) bytes.push(map[ch])
    else if (ch === '…') bytes.push(0x2E, 0x2E, 0x2E)
    else if (ch.charCodeAt(0) < 128) bytes.push(ch.charCodeAt(0))
    else bytes.push(0x3F) // '?' for unknown
  }
  return bytes
}

function cmd(...args) { return args }
function init() { return [ESC, 0x40] } // Initialize printer
// CP858 (página 19), no CP850 (página 2): es la única con el € en 0xD5. Si una
// impresora vieja no la tuviera, ignora el comando y los acentos base coinciden.
function codepage850() { return [ESC, 0x74, 0x13] } // Set CP858
function center() { return [ESC, 0x61, 0x01] }
function left() { return [ESC, 0x61, 0x00] }
function right() { return [ESC, 0x61, 0x02] }
function boldOn() { return [ESC, 0x45, 0x01] }
function boldOff() { return [ESC, 0x45, 0x00] }
function doubleSize() { return [GS, 0x21, 0x11] } // Double width + height
function normalSize() { return [GS, 0x21, 0x00] }
function wideSize() { return [GS, 0x21, 0x10] } // Double width only
function tallSize() { return [GS, 0x21, 0x01] } // Double height only
function feed(n = 1) { return Array(n).fill(LF) }
function cut() { return [GS, 0x56, 0x00] } // Full cut
function partialCut() { return [GS, 0x56, 0x01] }
function text(str) { return textToBytes(str) }
function line(str) { return [...textToBytes(str), LF] }

function qrCode(data, size = 6) {
  const bytes = []
  // Model 2
  bytes.push(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
  // Size (1-16)
  bytes.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size)
  // Error correction L
  bytes.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30)
  // Store data
  const dataBytes = []
  for (const ch of data) dataBytes.push(ch.charCodeAt(0) & 0xFF)
  const storeLen = dataBytes.length + 3
  bytes.push(GS, 0x28, 0x6B, storeLen & 0xFF, (storeLen >> 8) & 0xFF, 0x31, 0x50, 0x30, ...dataBytes)
  // Print QR
  bytes.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30)
  return bytes
}

function separator(char = '-', width = 48) {
  return line(char.repeat(width))
}

function twoColumns(left, right, width = 48) {
  const space = width - left.length - right.length
  if (space < 1) return line(left + ' ' + right)
  return line(left + ' '.repeat(space) + right)
}

function padCenter(str, width = 48) {
  const pad = Math.max(0, Math.floor((width - str.length) / 2))
  return ' '.repeat(pad) + str
}

function formatDate(isoStr) {
  const d = isoStr ? new Date(isoStr) : new Date()
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/**
 * COMANDA COCINA - For the kitchen
 * Big text, no prices, focus on items and notes
 */
export function generarComandaCocina(pedido, items, restaurante) {
  const bytes = [
    ...init(),
    ...codepage850(),

    // Header
    ...center(),
    ...doubleSize(),
    ...boldOn(),
    ...line('** COCINA **'),
    ...normalSize(),
    ...boldOff(),
    ...feed(1),

    // Order code - BIG
    ...doubleSize(),
    ...line(pedido.codigo || '---'),
    ...normalSize(),
    ...feed(1),

    // Canal
    ...boldOn(),
    ...line('PIDO'),
    ...boldOff(),

    // Time
    ...line(formatDate(pedido.created_at)),
    ...line('Prep: ' + (pedido.minutos_preparacion || '?') + ' min'),
    ...separator('-'),
  ]

  // Cliente info — pedidos telefónicos no tienen `usuarios` anidado (usuario_id
  // null): caer a guest_nombre / cliente_telefono / guest_telefono.
  const cliente = pedido.usuarios
  const nombreCliente = cliente
    ? [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
    : (pedido.guest_nombre || '')
  const telCliente = cliente?.telefono || pedido.cliente_telefono || pedido.guest_telefono
  if (nombreCliente) bytes.push(...boldOn(), ...line('Cliente: ' + nombreCliente), ...boldOff())
  if (telCliente) bytes.push(...line('Tel: ' + telCliente))
  if (pedido.direccion_entrega) {
    bytes.push(...line('Dir: ' + pedido.direccion_entrega))
  }
  // QR code con ubicación del cliente (Google Maps)
  if (pedido.lat_entrega && pedido.lng_entrega) {
    bytes.push(...feed(1), ...center(), ...qrCode(`https://maps.google.com/?q=${pedido.lat_entrega},${pedido.lng_entrega}`, 5), ...feed(1), ...left())
  }

  bytes.push(
    ...separator('='),

    // Left align for items
    ...left(),
    ...feed(1),
  )

  // Items - BIG for kitchen readability
  for (const item of items || []) {
    // El TAMAÑO va en la línea grande: "1x Pizza" a secas cuando el cliente
    // pidió la Familiar era la plancha adivinando.
    const nombreLinea = item.cantidad + 'x ' + item.nombre_producto + (item.tamano ? ' (' + item.tamano + ')' : '')
    bytes.push(
      ...tallSize(),
      ...boldOn(),
      ...line(nombreLinea),
      ...normalSize(),
      ...boldOff(),
    )
    // Extras if present
    // `extras` es text[]: concatenarlo a pelo imprime "Queso,Bacon" sin espacios
    if (Array.isArray(item.extras) ? item.extras.length : item.extras) {
      bytes.push(...line('   + ' + (Array.isArray(item.extras) ? item.extras.join(', ') : item.extras)))
    }
    // La nota DE LA LÍNEA ("sin cebolla") existe en la BD y no se imprimía: a
    // cocina solo le llegaba la nota general del pedido.
    if (item.notas) bytes.push(...line('   ! ' + item.notas))
  }

  // Pedido telefónico: sin items detallados — el pedido va en las notas y el
  // importe acordado por teléfono debe quedar visible para cocina/rider.
  if (pedido.origen_pedido === 'telefonico') {
    bytes.push(
      ...tallSize(), ...boldOn(),
      ...line('PEDIDO TELEFONICO'),
      ...line('IMPORTE ACORDADO: ' + Number(pedido.subtotal || 0).toFixed(2) + ' EUR'),
      ...normalSize(), ...boldOff(),
    )
  }

  bytes.push(...feed(1))

  // Notes - important for kitchen
  if (pedido.notas) {
    bytes.push(
      ...separator('*'),
      ...boldOn(),
      ...line('NOTAS:'),
      ...boldOff(),
      ...tallSize(),
      ...line(pedido.notas),
      ...normalSize(),
      ...separator('*'),
    )
  }

  // Promo applied
  if (pedido.promo_titulo) {
    bytes.push(
      ...center(),
      ...boldOn(),
      ...line('PROMO: ' + pedido.promo_titulo),
      ...boldOff(),
    )
  }

  // Payment method reminder
  bytes.push(
    ...feed(1),
    ...center(),
    ...boldOn(),
    ...line('Pago: ' + textoTicket(pedido.metodo_pago)),
    ...boldOff(),
    ...separator('='),
    ...feed(3),
    ...partialCut(),
  )

  return new Uint8Array(bytes)
}

/**
 * TICKET CLIENTE - Customer receipt
 * Full info with prices, restaurant branding
 */
// Que puertas de entrada son de PIDOO. Solo en esas se menciona a Pidoo al pie: si el
// restaurante cogio el pedido por telefono o el cliente lo pidio desde el QR de la mesa,
// Pidoo no le trajo a nadie y no pinta nada en ese papel.
const ORIGENES_DE_PIDOO = ['pido', 'tienda_publica', 'marketplace_socio']

export function generarTicketCliente(pedido, items, restaurante, logoBytes = null) {
  const bytes = [
    ...init(),
    ...codepage850(),
    ...center(),
  ]

  // EL LOGO ES EL DEL RESTAURANTE, NUNCA EL DE PIDOO.
  //
  // Este papel es una factura simplificada que emite el RESTAURANTE: lleva su nombre,
  // su direccion y su telefono. Poner encima el logo de Pidoo daria a entender que el
  // vendedor es Pidoo, que no lo es — Pidoo cobra una comision por traerle el pedido.
  //
  // Y comercialmente seria el peor sitio: quedarse con el recibo del restaurante es
  // exactamente lo que hace Glovo y por lo que los hosteleros lo odian. Pidoo va al
  // PIE, en texto, y con un enlace que devuelve el cliente AL RESTAURANTE.
  //
  // Va despues de `center()` porque la alineacion tambien manda sobre los mapas de
  // bits. Si no hay logo, el ticket sale igual: nunca puede costar una factura.
  if (logoBytes && logoBytes.length) {
    bytes.push(...logoBytes)
    bytes.push(...feed(1))
  }

  bytes.push(
    // Restaurant header
    ...doubleSize(),
    ...boldOn(),
    ...line(restaurante?.nombre || 'PIDO'),
    ...normalSize(),
    ...boldOff(),
  )

  if (restaurante?.direccion) {
    bytes.push(...line(restaurante.direccion))
  }
  if (restaurante?.telefono) {
    bytes.push(...line('Tel: ' + restaurante.telefono))
  }

  bytes.push(
    ...separator('='),
    ...boldOn(),
    ...line('TICKET DE PEDIDO'),
    ...boldOff(),
    ...separator('-'),
    ...left(),
  )

  // Order info
  bytes.push(
    ...twoColumns('Pedido:', pedido.codigo || '---'),
    ...twoColumns('Fecha:', formatDate(pedido.created_at)),
    ...twoColumns('Canal:', 'PIDO'),
    ...twoColumns('Pago:', textoTicket(pedido.metodo_pago)),
    ...separator('-'),
  )

  // Cliente info (con fallback guest para pedidos telefónicos)
  const cliente = pedido.usuarios
  const nombreCliente = cliente
    ? [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
    : (pedido.guest_nombre || '')
  const telCliente = cliente?.telefono || pedido.cliente_telefono || pedido.guest_telefono
  if (nombreCliente) bytes.push(...twoColumns('Cliente:', nombreCliente))
  if (telCliente) bytes.push(...twoColumns('Tel:', telCliente))
  if (pedido.direccion_entrega) {
    bytes.push(...line('Entrega: ' + pedido.direccion_entrega))
  }
  // QR code con ubicación del cliente (Google Maps)
  if (pedido.lat_entrega && pedido.lng_entrega) {
    bytes.push(...feed(1), ...center(), ...qrCode(`https://maps.google.com/?q=${pedido.lat_entrega},${pedido.lng_entrega}`, 4), ...feed(1), ...left())
  }

  bytes.push(
    ...separator('-'),
    ...feed(1),
  )

  // Items with prices
  bytes.push(
    ...boldOn(),
    ...twoColumns('PRODUCTO', 'IMPORTE'),
    ...boldOff(),
    ...separator('-'),
  )

  let subtotal = 0
  for (const item of items || []) {
    // `|| 0`: un precio_unitario nulo reventaba la GENERACIÓN entera del ticket
    // — y como la comanda ya había salido, el reintento la duplicaba en cocina.
    const unitario = Number(item.precio_unitario || 0)
    const importe = (unitario * item.cantidad).toFixed(2)
    subtotal += unitario * item.cantidad
    bytes.push(
      ...line(item.cantidad + 'x ' + item.nombre_producto + (item.tamano ? ' (' + item.tamano + ')' : '')),
      ...twoColumns('   @' + unitario.toFixed(2) + ' EUR', importe + ' EUR'),
    )
    // `extras` es text[]: concatenarlo a pelo imprime "Queso,Bacon" sin espacios
    if (Array.isArray(item.extras) ? item.extras.length : item.extras) {
      bytes.push(...line('   + ' + (Array.isArray(item.extras) ? item.extras.join(', ') : item.extras)))
    }
  }

  bytes.push(
    ...separator('-'),
  )

  // Totals
  // La PROPINA va sumada dentro de pedido.total (lo calcula enforce_pedido_total
  // en BD), pero antes no se imprimía en ninguna línea: el papel sumaba menos
  // que el TOTAL. Como el 100% de las propinas son en efectivo y este ticket es
  // con el que el rider cobra en la puerta, el cliente pagaba lo que sumaban las
  // líneas y ese euro lo acababa poniendo el socio.
  const envio = pedido.coste_envio || 0
  const descuento = pedido.descuento || 0
  const propina = pedido.propina || 0
  const total = pedido.total || (subtotal + envio + propina - descuento)

  bytes.push(
    ...twoColumns('Subtotal:', subtotal.toFixed(2) + ' EUR'),
  )
  if (descuento > 0) {
    bytes.push(
      ...twoColumns('Descuento (' + (pedido.promo_titulo || 'Promo') + '):', '-' + descuento.toFixed(2) + ' EUR'),
    )
  }
  if (envio > 0) {
    bytes.push(
      ...twoColumns('Envio:', envio.toFixed(2) + ' EUR'),
    )
  }
  if (propina > 0) {
    bytes.push(
      ...twoColumns('Propina:', propina.toFixed(2) + ' EUR'),
    )
  }

  bytes.push(
    ...separator('='),
    ...boldOn(),
    ...doubleSize(),
    ...center(),
    ...line('TOTAL: ' + total.toFixed(2) + ' EUR'),
    ...normalSize(),
    ...boldOff(),
    ...separator('='),
  )

  // Notes
  if (pedido.notas) {
    bytes.push(
      ...left(),
      ...line('Nota: ' + pedido.notas),
      ...separator('-'),
    )
  }

  // Prep time
  bytes.push(
    ...center(),
    ...line('Tiempo estimado: ~' + (pedido.minutos_preparacion || '?') + ' min'),
    ...feed(1),
    ...boldOn(),
    ...line('Gracias por tu pedido!'),
    ...boldOff(),
  )

  // Pidoo al PIE y en texto, no como logo, y solo si el pedido entro por Pidoo. El
  // enlace lleva a la tienda DEL RESTAURANTE: al cliente le da el camino de vuelta y
  // al restaurante no le molesta, porque se lo devuelve a el.
  if (ORIGENES_DE_PIDOO.includes(pedido?.origen_pedido)) {
    bytes.push(...line('Pedido recibido por pidoo.es'))
    if (restaurante?.slug) bytes.push(...line('Repite en pidoo.es/' + restaurante.slug))
  }

  bytes.push(
    ...feed(3),
    ...cut(),
  )

  return new Uint8Array(bytes)
}

/**
 * Pulso para abrir el CAJON PORTAMONEDAS.
 *
 * El cajon no se conecta al ordenador: cuelga de la impresora por un RJ11 y se
 * abre porque la impresora recibe este pulso ESC/POS. Por eso, impresora apagada
 * = cajon cerrado, y hace falta la llave fisica.
 *
 * ESC p m t1 t2 → m=0 (pin 2, el habitual), t1/t2 en unidades de 2 ms.
 * 25 y 250 son los valores de fabrica de casi todos los cajones: 50 ms de pulso
 * y 500 ms de espera. Subirlos no abre "mejor"; solo calienta la bobina.
 */
export function abrirCajon() {
  return new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA])
}

/**
 * Ticket de una venta de MOSTRADOR (modulo TPV).
 *
 * Es una factura simplificada: lleva los datos fiscales del emisor, su numero de
 * serie correlativo y el IGIC desglosado. Los precios de la carta ya llevan el
 * impuesto incluido, asi que la base se calcula hacia atras — pero aqui NO se
 * recalcula nada: se imprimen los importes que congelo el servidor al emitir el
 * ticket, que son los que constan en `tpv_tickets`.
 */
export function generarTicketTpv(ticket, pedido, items, restaurante, pieTicket, abrirElCajon = false, logoBytes = null, anula = null) {
  const bytes = []
  const eur = (n) => Number(n || 0).toFixed(2) + ' EUR'

  bytes.push(...init(), ...codepage850(), ...center())

  // El logo del restaurante, si se ha podido preparar (ver `lib/logoTicket.js`).
  // Va DESPUES de `center()` porque la alineacion tambien manda sobre los mapas de
  // bits. Si no hay, el ticket sale igual: un logo nunca puede costar una factura.
  if (logoBytes && logoBytes.length) {
    bytes.push(...logoBytes)
    bytes.push(...feed(1))
  }

  // Emisor: la razon social manda sobre el nombre comercial en un documento fiscal
  bytes.push(...boldOn(), ...wideSize())
  bytes.push(...line(restaurante?.razon_social || restaurante?.nombre || ''))
  bytes.push(...normalSize(), ...boldOff())
  if (restaurante?.nif) bytes.push(...line('NIF: ' + restaurante.nif))
  const dir = restaurante?.direccion_fiscal || restaurante?.direccion
  if (dir) bytes.push(...line(dir))
  if (restaurante?.ciudad_fiscal) bytes.push(...line(restaurante.ciudad_fiscal))
  if (restaurante?.telefono) bytes.push(...line('Tel: ' + restaurante.telefono))

  bytes.push(...feed(1), ...separator('-'), ...left())
  bytes.push(...boldOn(), ...line('FACTURA SIMPLIFICADA'), ...boldOff())
  // Un ticket con `rectifica_ticket_id` es una ANULACION: importes en negativo
  // y serie propia (la original + R). Tiene que decirlo bien grande, y decir a
  // cual anula — `anula` llega como "A-000012" desde quien imprime.
  if (ticket.rectifica_ticket_id) {
    bytes.push(...boldOn(), ...line('RECTIFICATIVA' + (anula ? ' — anula ' + anula : '')), ...boldOff())
  }
  bytes.push(...twoColumns(
    'Serie ' + ticket.serie + '  Num. ' + String(ticket.numero ?? '').padStart(6, '0'),
    formatDate(ticket.emitido_at)
  ))
  bytes.push(...separator('-'))

  // Lineas
  for (const it of items || []) {
    const cant = it.cantidad || 1
    const importe = (it.precio_unitario || 0) * cant
    let nombre = cant + ' x ' + (it.nombre_producto || '')
    if (it.tamano) nombre += ' (' + it.tamano + ')'
    // `extras` es text[] en la BD: si se concatena a pelo sale "Queso,Bacon"
    const extras = Array.isArray(it.extras) ? it.extras : []
    bytes.push(...twoColumns(nombre.slice(0, 34), importe.toFixed(2)))
    if (extras.length) bytes.push(...line('   + ' + extras.join(', ')))
    if (it.notas) bytes.push(...line('   ' + it.notas))
  }

  bytes.push(...separator('='))
  bytes.push(...center(), ...boldOn(), ...doubleSize())
  bytes.push(...line('TOTAL: ' + eur(ticket.total)))
  bytes.push(...normalSize(), ...boldOff(), ...left(), ...separator('='))

  // Desglose impositivo, con los importes tal como se guardaron. `|| 0` porque
  // `Number(undefined).toFixed(2)` imprime literalmente "NaN" en una factura.
  bytes.push(...twoColumns('Base imponible', Number(ticket.base_imponible || 0).toFixed(2)))
  bytes.push(...twoColumns('IGIC ' + Number(ticket.igic_pct || 0).toFixed(0) + '%', Number(ticket.cuota_igic || 0).toFixed(2)))
  bytes.push(...separator('-'))

  bytes.push(...line('Forma de pago: ' + (ticket.metodo_pago === 'datafono' ? 'TARJETA' : 'EFECTIVO')))
  if (ticket.entregado_efectivo != null) {
    bytes.push(...twoColumns('Entregado', Number(ticket.entregado_efectivo).toFixed(2)))
    bytes.push(...boldOn(), ...twoColumns('CAMBIO', Number(ticket.cambio || 0).toFixed(2)), ...boldOff())
  }

  bytes.push(...feed(1), ...center())
  if (pieTicket) bytes.push(...line(pieTicket))
  if (pedido?.codigo) bytes.push(...line(pedido.codigo))
  bytes.push(...feed(3), ...cut())

  // El pulso del cajon va DENTRO del mismo envio, detras del corte, y no en una
  // segunda conexion: el plugin abre un socket nuevo por llamada, y varias
  // termicas se comen la segunda orden si llega mientras todavia estan cortando.
  // Los bytes salen de `abrirCajon()`: antes estaban repetidos aqui en literal y
  // un cambio de pin o de tiempos habria dejado dos cajones distintos.
  if (abrirElCajon) bytes.push(...abrirCajon())

  return new Uint8Array(bytes)
}

/**
 * COMANDA DE COCINA del TPV (lo que en Last es "Comandar").
 *
 * Se imprime ANTES de cobrar y sin grabar nada: en un mostrador con cocina, lo
 * primero es que empiecen a hacer la comida; el dinero llega cuando el cliente
 * paga. Por eso no lleva precios — a cocina no le importan y solo estorban.
 */
export function generarComandaTpv(lineas, restaurante, opciones = {}) {
  const { nota = null, numero = null } = opciones
  const bytes = []

  bytes.push(...init(), ...codepage850(), ...center())
  bytes.push(...boldOn(), ...doubleSize())
  bytes.push(...line('** COCINA **'))
  bytes.push(...normalSize(), ...boldOff())
  if (restaurante?.nombre) bytes.push(...line(restaurante.nombre))
  bytes.push(...line('MOSTRADOR' + (numero ? ' #' + numero : '')))
  bytes.push(...line(formatDate()))
  bytes.push(...separator('='), ...left())

  for (const l of lineas) {
    bytes.push(...boldOn(), ...tallSize())
    bytes.push(...line(`${l.cantidad} x ${l.nombre}${l.tamano ? ' (' + l.tamano + ')' : ''}`))
    bytes.push(...normalSize(), ...boldOff())
    if (l.extrasTexto) bytes.push(...line('   + ' + l.extrasTexto))
    if (l.notas) bytes.push(...line('   ! ' + l.notas))
  }

  bytes.push(...separator('='))
  if (nota) { bytes.push(...line('Nota: ' + nota), ...separator('-')) }
  bytes.push(...feed(3), ...cut())
  return new Uint8Array(bytes)
}

/**
 * INFORME DEL DIA: lo que se ha vendido hoy por el mostrador.
 *
 * No es un arqueo de caja — eso exige saber con cuanto se abrio y cuanto hay
 * fisicamente en el cajon, y eso todavia no existe. Esto es solo el resumen de
 * lo vendido, que es la mitad util y se puede dar hoy.
 */
export function generarInformeDiaTpv(resumen, restaurante) {
  const bytes = []
  const eur = (n) => Number(n || 0).toFixed(2) + ' EUR'

  bytes.push(...init(), ...codepage850(), ...center())
  bytes.push(...boldOn(), ...wideSize())
  bytes.push(...line('INFORME DEL DIA'))
  bytes.push(...normalSize(), ...boldOff())
  if (restaurante?.nombre) bytes.push(...line(restaurante.nombre))
  bytes.push(...line(formatDate()))
  bytes.push(...separator('='), ...left())

  bytes.push(...twoColumns('Tickets', String(resumen.tickets || 0)))
  bytes.push(...twoColumns('Articulos', String(resumen.articulos || 0)))
  bytes.push(...separator('-'))
  bytes.push(...twoColumns('Efectivo', eur(resumen.efectivo)))
  bytes.push(...twoColumns('Datafono', eur(resumen.datafono)))
  bytes.push(...separator('='))
  bytes.push(...boldOn(), ...tallSize())
  bytes.push(...twoColumns('TOTAL', eur(resumen.total)))
  bytes.push(...normalSize(), ...boldOff())

  if (resumen.base != null) {
    bytes.push(...separator('-'))
    bytes.push(...twoColumns('Base imponible', eur(resumen.base)))
    bytes.push(...twoColumns('IGIC', eur(resumen.igic)))
  }

  if (resumen.primero && resumen.ultimo) {
    bytes.push(...separator('-'))
    bytes.push(...line('Del ticket ' + resumen.primero + ' al ' + resumen.ultimo))
  }

  bytes.push(...feed(1), ...center())
  bytes.push(...line('No es un arqueo de caja'))
  bytes.push(...feed(3), ...cut())
  return new Uint8Array(bytes)
}

/**
 * INFORME DE CAJA. Dos tipos, y la diferencia importa:
 *
 *   X — foto del turno SIN cerrar nada. Se puede sacar las veces que haga falta
 *       (al cambiar de turno, a media tarde, cuando alguien quiera mirar).
 *   Z — el CIERRE. Se saca una vez, cuando la caja se cierra, y ya lleva el
 *       dinero contado y el descuadre.
 *
 * Los dos desglosan efectivo y tarjeta, porque solo el efectivo esta en el cajon.
 */
export function generarReporteCaja(d, restaurante, tipo = 'X') {
  const bytes = []
  const eur = (n) => Number(n || 0).toFixed(2) + ' EUR'
  const esZ = tipo === 'Z'

  bytes.push(...init(), ...codepage850(), ...center())
  bytes.push(...boldOn(), ...doubleSize())
  bytes.push(...line(esZ ? 'CIERRE Z' : 'INFORME X'))
  bytes.push(...normalSize(), ...boldOff())
  if (restaurante?.nombre) bytes.push(...line(restaurante.nombre))
  if (esZ && restaurante?.nif) bytes.push(...line('NIF: ' + restaurante.nif))
  bytes.push(...line(formatDate()))
  if (d.abierta_at) bytes.push(...line('Caja abierta: ' + formatDate(d.abierta_at)))
  bytes.push(...separator('='), ...left())

  bytes.push(...boldOn(), ...line('VENTAS'), ...boldOff())
  bytes.push(...twoColumns('Tickets', String(d.tickets || 0)))
  bytes.push(...twoColumns('Efectivo', eur(d.ventas_efectivo)))
  bytes.push(...twoColumns('Tarjeta', eur(d.ventas_datafono)))
  bytes.push(...boldOn())
  bytes.push(...twoColumns('Total vendido', eur(Number(d.ventas_efectivo || 0) + Number(d.ventas_datafono || 0))))
  bytes.push(...boldOff())

  if (d.base != null) {
    bytes.push(...separator('-'))
    bytes.push(...twoColumns('Base imponible', eur(d.base)))
    bytes.push(...twoColumns('IGIC', eur(d.igic)))
  }

  bytes.push(...separator('-'))
  bytes.push(...boldOn(), ...line('CAJON'), ...boldOff())
  bytes.push(...twoColumns('Fondo inicial', eur(d.fondo_inicial)))
  bytes.push(...twoColumns('+ Ventas en efectivo', eur(d.ventas_efectivo)))
  bytes.push(...twoColumns('+ Entradas', eur(d.entradas)))
  bytes.push(...twoColumns('- Salidas', eur(d.salidas)))
  bytes.push(...separator('='))
  bytes.push(...boldOn(), ...tallSize())
  bytes.push(...twoColumns('DEBE HABER', eur(d.esperado)))
  bytes.push(...normalSize(), ...boldOff())

  if (esZ && d.contado_final != null) {
    bytes.push(...twoColumns('Contado', eur(d.contado_final)))
    bytes.push(...separator('='))
    const desc = Number(d.descuadre || 0)
    bytes.push(...boldOn(), ...tallSize())
    bytes.push(...twoColumns(desc === 0 ? 'CUADRA' : (desc > 0 ? 'SOBRA' : 'FALTA'), eur(Math.abs(desc))))
    bytes.push(...normalSize(), ...boldOff())
  }

  if (d.notas) { bytes.push(...separator('-'), ...line('Nota: ' + d.notas)) }

  bytes.push(...feed(1), ...center())
  bytes.push(...line(esZ ? 'Caja cerrada' : 'La caja sigue abierta'))
  bytes.push(...feed(3), ...cut())
  return new Uint8Array(bytes)
}
