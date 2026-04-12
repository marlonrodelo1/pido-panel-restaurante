/**
 * ESC/POS command builder for 80mm thermal printers
 * Generates byte arrays that can be sent via TCP to port 9100
 */

const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A

// Encoder for text → bytes (Latin-1 / CP850 for Spanish chars)
export function textToBytes(text) {
  const map = { 'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A, '¿': 0xA8, '¡': 0xAD, '€': 0xD5 }
  const bytes = []
  for (const ch of text) {
    if (map[ch]) bytes.push(map[ch])
    else if (ch.charCodeAt(0) < 128) bytes.push(ch.charCodeAt(0))
    else bytes.push(0x3F) // '?' for unknown
  }
  return bytes
}

function cmd(...args) { return args }
function init() { return [ESC, 0x40] } // Initialize printer
function codepage850() { return [ESC, 0x74, 0x02] } // Set CP850
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

  // Cliente info
  const cliente = pedido.usuarios
  if (cliente) {
    const nombreCliente = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
    if (nombreCliente) bytes.push(...boldOn(), ...line('Cliente: ' + nombreCliente), ...boldOff())
    if (cliente.telefono) bytes.push(...line('Tel: ' + cliente.telefono))
  }
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
    bytes.push(
      ...tallSize(),
      ...boldOn(),
      ...line(item.cantidad + 'x ' + item.nombre_producto),
      ...normalSize(),
      ...boldOff(),
    )
    // Extras if present
    if (item.extras) {
      bytes.push(...line('   + ' + item.extras))
    }
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
    ...line('Pago: ' + (pedido.metodo_pago === 'efectivo' ? 'EFECTIVO' : 'TARJETA')),
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
export function generarTicketCliente(pedido, items, restaurante) {
  const bytes = [
    ...init(),
    ...codepage850(),

    // Restaurant header
    ...center(),
    ...doubleSize(),
    ...boldOn(),
    ...line(restaurante?.nombre || 'PIDO'),
    ...normalSize(),
    ...boldOff(),
  ]

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
    ...twoColumns('Pago:', pedido.metodo_pago === 'efectivo' ? 'Efectivo' : 'Tarjeta'),
    ...separator('-'),
  )

  // Cliente info
  const cliente = pedido.usuarios
  if (cliente) {
    const nombreCliente = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
    if (nombreCliente) bytes.push(...twoColumns('Cliente:', nombreCliente))
    if (cliente.telefono) bytes.push(...twoColumns('Tel:', cliente.telefono))
  }
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
    const importe = (item.precio_unitario * item.cantidad).toFixed(2)
    subtotal += item.precio_unitario * item.cantidad
    bytes.push(
      ...line(item.cantidad + 'x ' + item.nombre_producto),
      ...twoColumns('   @' + item.precio_unitario.toFixed(2) + ' EUR', importe + ' EUR'),
    )
    if (item.extras) {
      bytes.push(...line('   + ' + item.extras))
    }
  }

  bytes.push(
    ...separator('-'),
  )

  // Totals
  const envio = pedido.coste_envio || 0
  const descuento = pedido.descuento || 0
  const total = pedido.total || subtotal + envio - descuento

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
    ...line('pidoo.es'),
    ...feed(3),
    ...cut(),
  )

  return new Uint8Array(bytes)
}
