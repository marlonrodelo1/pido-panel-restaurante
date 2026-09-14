// Lógica pura del informe de ventas del restaurante (Finanzas).
//
// Criterio: EL MISMO con el que Pidoo liquida los lunes, para que los números
// del panel no contradigan a la factura (`calcular_liquidacion_restaurante`):
//   · Solo cuentan los pedidos 'entregado' o 'recogido'.
//   · La fecha con la que un pedido entra en el periodo es
//     entregado_at → recogido_at → created_at.
//   · Comisión = % sobre los subtotales que no son de teléfono, mostrador ni mesa
//                (el % congelado del pedido si lo tiene; si no, el global)
//                + tarifa fija por cada pedido telefónico.
//   · Local exento (`establecimientos.exento_comision`): 0 por todo.
//   · El % se aplica al subtotal BRUTO (antes de descuentos), igual que en BD.
// Si cambia esa función en Supabase, hay que revisar este archivo.

import { METODOS } from './metodoPago.js'

export const ESTADOS_VENTA = ['entregado', 'recogido']
export const ESTADOS_NO_VENTA = ['cancelado', 'fallido']

// Las etiquetas viven en lib/metodoPago.js, que es quien decide además qué
// cuenta como cobrado. Aquí solo se re-exporta el mapa para no duplicarlo.
export const LABEL_PAGO = Object.fromEntries(
  Object.entries(METODOS).map(([k, v]) => [k, v.etiqueta])
)

export const LABEL_ORIGEN = {
  pido: 'App Pidoo',
  tienda_publica: 'Tu tienda (enlace propio)',
  telefonico: 'Teléfono',
  tpv: 'Mostrador (TPV)',
  mesa: 'Mesa (QR)',
}

// ─── Fechas (hora LOCAL del navegador = hora del restaurante) ──────────────
export function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
export function hoyStr() { return ymd(new Date()) }
export function ayerStr() { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d) }
export function lunesEstaSemana() {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  d.setDate(d.getDate() - dow)
  return ymd(d)
}
export function primerDiaMes() { const d = new Date(); d.setDate(1); return ymd(d) }

export function inicioDe(fechaStr) { return new Date(`${fechaStr}T00:00:00`) }
export function finDe(fechaStr) { return new Date(`${fechaStr}T23:59:59.999`) }

export function fechaEfectiva(p) {
  return new Date(p.entregado_at || p.recogido_at || p.created_at)
}

export function tituloPeriodo(desde, hasta) {
  const f = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
  return desde === hasta ? f(desde) : `${f(desde)} — ${f(hasta)}`
}

// ─── Formato ───────────────────────────────────────────────────────────────
export const fmt = (n) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €'
export const fmtPlano = (n) => (Number(n) || 0).toFixed(2).replace('.', ',')

export function slugify(txt, fallback = 'restaurante') {
  const base = (txt || fallback)
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || fallback
}

// ─── Cálculo ───────────────────────────────────────────────────────────────
export function calcularResumen(pedidos, config = { pct: 10, feeTelefonico: 1, exento: false }) {
  // Ordenados por hora de ENTREGA, que es con la que entran en el periodo: si
  // un pedido cruza la medianoche, por created_at saldría descolocado.
  const porEntrega = (a, b) => fechaEfectiva(a) - fechaEfectiva(b)
  const ventas = pedidos.filter(p => ESTADOS_VENTA.includes(p.estado)).sort(porEntrega)
  const perdidos = pedidos.filter(p => ESTADOS_NO_VENTA.includes(p.estado)).sort(porEntrega)

  const suma = (arr, f) => arr.reduce((a, p) => a + (Number(f(p)) || 0), 0)

  const comida = suma(ventas, p => p.subtotal)
  const envios = suma(ventas, p => p.modo_entrega === 'delivery' ? p.coste_envio : 0)
  const propinas = suma(ventas, p => p.propina)
  const descuentos = suma(ventas, p => p.descuento)
  const facturado = suma(ventas, p => p.total)

  // Mismo criterio que `calcular_liquidacion_restaurante` y que Contabilidad.
  const sinPct = (p) => ['telefonico', 'tpv', 'mesa'].includes(p.origen_pedido)
  const pctDe = (p) => (p.comision_pidoo_pct_override != null
    ? Number(p.comision_pidoo_pct_override) : (Number(config.pct) || 0))
  const baseComisionable = config.exento ? 0 : suma(ventas, p => sinPct(p) ? 0 : p.subtotal)
  const nTelefonicos = ventas.filter(p => p.origen_pedido === 'telefonico').length
  const comisionPct = config.exento ? 0
    : ventas.reduce((a, p) => a + (sinPct(p) ? 0 : (Number(p.subtotal) || 0) * pctDe(p) / 100), 0)
  const comisionTel = config.exento ? 0 : nTelefonicos * (Number(config.feeTelefonico) || 0)
  const comision = comisionPct + comisionTel

  const agrupar = (campo, porDefecto) => {
    const out = {}
    for (const p of ventas) {
      const k = p[campo] || porDefecto
      out[k] = out[k] || { n: 0, importe: 0 }
      out[k].n += 1
      out[k].importe += Number(p.total) || 0
    }
    return out
  }

  // Lo cobrado por tarjeta lo tiene Pidoo y lo devuelve el lunes; el resto
  // (efectivo, datáfono, pagado en el local) ya está en manos del restaurante
  // o del repartidor, y su comisión queda a deber.
  const cobradoTarjeta = suma(ventas.filter(p => p.metodo_pago === 'tarjeta'), p => p.total)

  return {
    ventas, perdidos,
    nPedidos: ventas.length,
    comida, envios, propinas, descuentos, facturado,
    ticketMedio: ventas.length ? facturado / ventas.length : 0,
    baseComisionable, nTelefonicos, comisionPct, comisionTel, comision,
    neto: comida - comision,
    porPago: agrupar('metodo_pago', 'otro'),
    porOrigen: agrupar('origen_pedido', 'pido'),
    nDelivery: ventas.filter(p => p.modo_entrega === 'delivery').length,
    nRecogida: ventas.filter(p => p.modo_entrega !== 'delivery').length,
    cobradoTarjeta,
    cobradoEnMano: facturado - cobradoTarjeta,
  }
}

export function agruparProductos(items) {
  const map = new Map()
  for (const it of items) {
    const nombre = it.tamano
      ? `${it.nombre_producto} (${it.tamano})`
      : (it.nombre_producto || 'Sin nombre')
    const cur = map.get(nombre) || { nombre, uds: 0, importe: 0 }
    cur.uds += Number(it.cantidad) || 0
    cur.importe += (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0)
    map.set(nombre, cur)
  }
  return [...map.values()].sort((a, b) => b.uds - a.uds || b.importe - a.importe)
}

export function contarUdsPorPedido(items) {
  const map = new Map()
  for (const it of items) {
    map.set(it.pedido_id, (map.get(it.pedido_id) || 0) + (Number(it.cantidad) || 0))
  }
  return map
}
