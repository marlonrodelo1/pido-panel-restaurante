// Lógica pura del informe de ventas del restaurante (Finanzas).
//
// Criterio: EL MISMO con el que Pidoo liquida los lunes, para que los números
// del panel no contradigan a la factura (`calcular_liquidacion_restaurante`):
//   · Solo cuentan los pedidos 'entregado' o 'recogido'.
//   · La fecha con la que un pedido entra en el periodo es
//     entregado_at → recogido_at → created_at.
//   · Comisión = % sobre el subtotal de cada pedido que no sea de mostrador ni
//                mesa (el % congelado del pedido si lo tiene; si no, el global).
//                Desde el corte (clave `comision_telefonico_pct_desde`) el
//                TELEFÓNICO cuenta igual que la app: nace con el % de la app
//                congelado. Los telefónicos ANTERIORES al corte que nacieron con 0 %
//                siguen pagando la tarifa fija de siempre. SIN clave (antes de
//                aplicar el cambio, o tras la vuelta atrás) todo telefónico paga la
//                tarifa fija, igual que la base de datos de hoy.
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

// ─── Comisión de Pidoo por pedido ──────────────────────────────────────────
// Réplica de `calcular_liquidacion_restaurante` (y de `_stock_comision_pedido`)
// pedido a pedido. Si cambia allí, hay que cambiarla aquí.

// La clave `comision_telefonico_pct_desde` viene en UTC ("2026-09-28T21:00:00Z").
// Sin clave o ilegible → null, que se trata como "todavía no ha llegado el
// cambio": igual que la base de datos, que en ese caso sigue cobrando el fijo.
// Se exige EL MISMO formato que `_comision_telefonico_corte()` en la BD (UTC con Z
// o +00): lo que la BD no acepta, aquí tampoco, para que nunca discrepen.
const RE_CORTE_UTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|\+00(:?00)?)$/
export function parseCorteTelefonico(valor) {
  const s = String(valor ?? '').trim()
  if (!s || !RE_CORTE_UTC.test(s)) return null
  const iso = s.replace(' ', 'T').replace(/\+00(:?00)?$/, 'Z')
  const d = new Date(iso)
  // Una fecha imposible (30 de febrero) la BD la toma como "sin clave"; JS la pasaría
  // al 2 de marzo. Si el día se mueve, tampoco vale aquí.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso.slice(0, 10)) return null
  return d
}

// ¿El teléfono ya paga como la app? Solo con corte y cuando ya ha llegado.
// Sirve para los TEXTOS: el dinero de cada pedido se decide pedido a pedido.
export function telefonicoComoApp(corteTelefonico, ahora = new Date()) {
  return !!corteTelefonico && ahora.getTime() >= corteTelefonico.getTime()
}

// El corte en hora de Canarias, para ponerlo en los textos ("28 sept 2026, 22:00").
export function fmtCorteTelefonico(corteTelefonico) {
  if (!corteTelefonico) return ''
  return corteTelefonico.toLocaleString('es-ES', {
    timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Comisión vigente de la plataforma (tabla de lectura pública). Se le pasa el
// cliente de Supabase para no atar este archivo de lógica pura a la red.
export async function leerConfigComision(supabase) {
  const { data, error } = await supabase
    .from('configuracion_plataforma')
    .select('clave, valor')
    .in('clave', ['comision_pidoo_pct', 'comision_pedido_telefonico_eur', 'comision_telefonico_pct_desde'])
  if (error || !data) return null
  const m = Object.fromEntries(data.map(r => [r.clave, r.valor]))
  return {
    pct: Number(m.comision_pidoo_pct ?? 10) || 0,
    feeTelefonico: Number(m.comision_pedido_telefonico_eur ?? 1) || 0,
    corteTelefonico: parseCorteTelefonico(m.comision_telefonico_pct_desde),
  }
}

// Telefónico del tramo antiguo: paga la tarifa fija.
//   · Sin corte (clave sin poner, o borrada en la vuelta atrás): TODO telefónico,
//     tenga el % que tenga congelado. Es lo que hace la liquidación antigua, que
//     decide por el ORIGEN; por eso se mira ANTES que el %.
//   · Con corte: solo el que nació con 0 % y antes del corte.
export function esTelefonicoTarifaFija(p, corteTelefonico) {
  if (p?.origen_pedido !== 'telefonico') return false
  if (!corteTelefonico) return true
  if ((Number(p.comision_pidoo_pct_override) || 0) !== 0) return false
  const creado = p.created_at ? new Date(p.created_at) : null
  return !creado || creado < corteTelefonico
}

// Comisión de Pidoo de UN pedido. config = { pct, feeTelefonico, exento, corteTelefonico }.
export function comisionPidooDePedido(p, config = {}) {
  if (config.exento) return 0
  if (['tpv', 'mesa'].includes(p?.origen_pedido)) return 0
  if (esTelefonicoTarifaFija(p, config.corteTelefonico)) return Number(config.feeTelefonico) || 0
  const pct = p?.comision_pidoo_pct_override != null
    ? Number(p.comision_pidoo_pct_override) : (Number(config.pct) || 0)
  return (Number(p?.subtotal) || 0) * pct / 100
}

// ─── Lo que se lleva el socio de un pedido ─────────────────────────────────
// Lo congelado al entregarse (`socio_liq_*`) si existe; si no, lo que dice el
// pacto con el restaurante, con la misma regla que `calc_ganancia_socio`:
// envío (o la tarifa fija pactada) + comisión pactada + propina. Con tarifa fija
// en un reparto no hay comisión. Con el corte puesto, el telefónico cobra igual
// que la app; SIN corte (antes del cambio o tras la vuelta atrás) la BD le da
// solo envío + propina, y aquí igual.
export function gananciaSocioDePedido(p, pacto = {}, corteTelefonico = null) {
  if (p?.socio_liq_total != null) {
    return {
      envio: Number(p.socio_liq_envio) || 0,
      comision: Number(p.socio_liq_comision) || 0,
      propina: Number(p.socio_liq_propina) || 0,
      total: Number(p.socio_liq_total) || 0,
      congelado: true,
    }
  }
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  const delivery = p?.modo_entrega === 'delivery'
  const fija = pacto.tarifa_modo === 'fija'
  const pct = pacto.comision_pct != null ? Number(pacto.comision_pct) : 10
  const envio = delivery ? r2(fija ? pacto.tarifa_fija : p?.coste_envio) : 0
  const telSinComision = p?.origen_pedido === 'telefonico' && !corteTelefonico
  const comision = (telSinComision || (delivery && fija)) ? 0 : r2((Number(p?.subtotal) || 0) * pct / 100)
  const propina = delivery ? r2(p?.propina) : 0
  return { envio, comision, propina, total: r2(envio + comision + propina), congelado: false }
}

// ─── Cálculo ───────────────────────────────────────────────────────────────
export function calcularResumen(pedidos, config = { pct: 10, feeTelefonico: 1, exento: false, corteTelefonico: null }) {
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

  // Mismo criterio que `calcular_liquidacion_restaurante` y que Contabilidad:
  // mostrador y mesa no pagan; el telefónico antiguo paga su tarifa fija; todo lo
  // demás (también el telefónico nuevo) paga el % congelado sobre la comida.
  const telFijo = (p) => esTelefonicoTarifaFija(p, config.corteTelefonico)
  const sinPct = (p) => ['tpv', 'mesa'].includes(p.origen_pedido) || telFijo(p)
  const baseComisionable = config.exento ? 0 : suma(ventas, p => sinPct(p) ? 0 : p.subtotal)
  // Solo los telefónicos con tarifa fija (anteriores al cambio): los nuevos van en el %.
  const nTelefonicos = ventas.filter(telFijo).length
  const comisionPct = config.exento ? 0
    : ventas.reduce((a, p) => a + (sinPct(p) ? 0 : comisionPidooDePedido(p, config)), 0)
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
