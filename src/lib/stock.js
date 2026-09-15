// Capa de datos del módulo Almacén (stock + escandallos).
//
// Todo lo que ESCRIBE va por RPC. Las tablas `stock_movimientos` y `stock_articulos`
// tienen la existencia y el coste congelados por un guard (PD233): no se escriben a
// mano ni desde aquí ni desde ningún sitio. Se mueven apuntando una compra, una merma
// o un recuento, que es lo que hacen las funciones de abajo.
import { supabase } from './supabase'

/* ── Formato ──────────────────────────────────────────────────────────────── */

export const UNIDADES = [
  { id: 'ud', label: 'unidades', corto: 'ud', ayuda: 'Latas, panes, botellas… cosas que se cuentan' },
  { id: 'kg', label: 'kilos', corto: 'kg', ayuda: 'Carne, queso, verdura… cosas que se pesan' },
  { id: 'l', label: 'litros', corto: 'l', ayuda: 'Aceite, leche, refresco a granel' },
]

export const FAMILIAS = ['Bebidas', 'Carne', 'Pescado', 'Pan', 'Lácteos', 'Congelados', 'Verdura', 'Otros']

// Sugerencias para la caja de gastos de la pestaña Negocio. La columna es texto
// libre (igual que `familia`): el dueño puede escribir la suya.
export const CATEGORIAS_GASTO = [
  'Alquiler', 'Luz', 'Agua', 'Internet', 'Gestoría', 'Sueldos',
  'Autónomo', 'Seguros', 'Reparaciones', 'Limpieza', 'Marketing', 'Otros',
]

// Las unidades se enseñan sin ceros de relleno: "2 ud", "1,5 kg", "0,25 l".
export function cantidad(n, unidad = 'ud') {
  const v = Number(n || 0)
  if (unidad === 'ud') {
    const ent = Math.round(v * 1000) / 1000
    return `${Number.isInteger(ent) ? ent : ent.toFixed(3).replace(/0+$/, '').replace(/[.,]$/, '')} ud`
  }
  const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `${s.replace('.', ',')} ${unidad}`
}

// En las RECETAS los pesos y los volúmenes se escriben como se cocinan: 7 g, 150 g, 30 ml
// (Marlon, 15 sep 2026: «que se vea 7 g, no 0,007»). En base de datos todo sigue en la
// unidad del artículo (kg, l, ud): el coste medio y el almacén van por kilo y por litro,
// así que la conversión vive SOLO en la pantalla, al cargar y al guardar la receta.
const UNIDAD_RECETA = { kg: { corto: 'g', factor: 1000 }, l: { corto: 'ml', factor: 1000 } }

export const unidadReceta = (unidad) => UNIDAD_RECETA[unidad]?.corto || unidad || ''

// Números como se escriben en España: la coma es el decimal y el punto separa miles
// («1.303,5 g»). En gramos y mililitros, un «1.500» sin coma también es de miles (1500 g):
// leerlo como 1,5 guardaría mil veces menos. En unidades («0.5 ud») el punto es decimal.
function leerNumeroEs(texto, unidad) {
  let s = String(texto ?? '').trim()
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (UNIDAD_RECETA[unidad] && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

// De la base de datos al campo: 0.007 kg → "7" · 1.3035 kg → "1303,5" · 0.0625 ud → "0,0625".
// toPrecision quita el ruido de coma flotante (7.000000000000001) sin perder decimales reales.
export function recetaATexto(cant, unidad) {
  if (cant == null || cant === '') return ''
  const f = UNIDAD_RECETA[unidad]?.factor || 1
  const v = Number((Number(cant) * f).toPrecision(12))
  return String(v).replace('.', ',')
}

// Del campo a la base de datos: "7" g → 0.007 kg · "1.303,5" g → 1.3035 kg · "2" ud → 2.
export function textoAReceta(texto, unidad) {
  const f = UNIDAD_RECETA[unidad]?.factor || 1
  return Math.round((leerNumeroEs(texto, unidad) / f) * 1e6) / 1e6
}

// Menos de 1 g o 1 ml casi siempre es la costumbre de escribir en kilos («0,15» pensando
// en 150 g): las pantallas de receta lo preguntan antes de guardar.
export function recetaSospechosa(texto, unidad) {
  const v = leerNumeroEs(texto, unidad)
  return !!UNIDAD_RECETA[unidad] && v > 0 && v < 1
}

export function eur(n) {
  return `${Number(n || 0).toFixed(2).replace('.', ',')} €`
}

// El coste unitario lleva 4 decimales en base de datos porque 0,0125 €/g es un
// número real; enseñar 0,01 € haría que el escandallo pareciera mal calculado.
export function eurCoste(n) {
  const v = Number(n || 0)
  const dec = v > 0 && v < 0.1 ? 4 : 2
  return `${v.toFixed(dec).replace('.', ',')} €`
}

export const TIPOS_MOV = {
  compra:     { label: 'Compra',     tono: 'sage' },
  venta:      { label: 'Venta',      tono: 'ink' },
  merma:      { label: 'Merma',      tono: 'danger' },
  recuento:   { label: 'Recuento',   tono: 'info' },
  traspaso:   { label: 'Traspaso',   tono: 'info' },
  elaboracion: { label: 'Preparación', tono: 'info' },
  devolucion: { label: 'Devolución', tono: 'warning' },
  ajuste_coste: { label: 'Coste', tono: 'info' },
}

export const MOTIVOS_MERMA = ['Se ha roto', 'Caducado', 'Se cayó', 'Prueba de cocina', 'Mal estado']

/* ── Lectura ──────────────────────────────────────────────────────────────── */

export async function cargarArticulos(estId) {
  const { data, error } = await supabase
    .from('stock_articulos')
    .select('*')
    .eq('establecimiento_id', estId)
    .order('nombre')
  if (error) throw new Error(error.message)
  return data || []
}

export async function cargarResumen(estId) {
  const mes = new Date()
  mes.setDate(1); mes.setHours(0, 0, 0, 0)
  const [valor, ciegos, mermas] = await Promise.all([
    supabase.from('v_stock_valor_inventario').select('*').eq('establecimiento_id', estId).maybeSingle(),
    supabase.from('v_stock_puntos_ciegos').select('*').eq('establecimiento_id', estId).maybeSingle(),
    cargarMermas(estId, mes.toISOString()).catch(() => null),
  ])
  return {
    valor: valor.data || { articulos: 0, valor: 0, en_negativo: 0, bajo_minimo: 0, sin_coste: 0 },
    ciegos: ciegos.data || null,
    mermas,
    desdeMes: mes,
  }
}

// Lo que se ha perdido en un periodo, agrupado por artículo. Cada merma es un apunte
// suelto en el libro (hoy un pan, mañana otro) y eso está bien: el libro cuenta lo que
// pasó. Pero nadie va a sumar 30 líneas a mano, así que aquí se agrega.
export async function cargarMermas(estId, desde) {
  const { data, error } = await supabase
    .from('stock_movimientos')
    .select('cantidad, coste_unitario, motivo, created_at, stock_articulos(nombre, unidad)')
    .eq('establecimiento_id', estId)
    .eq('tipo', 'merma')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)

  const porArticulo = {}
  let totalEur = 0
  for (const m of (data || [])) {
    const nombre = m.stock_articulos?.nombre || '—'
    const perdido = -Number(m.cantidad)
    const euros = perdido * Number(m.coste_unitario || 0)
    totalEur += euros
    porArticulo[nombre] = porArticulo[nombre] || {
      nombre, unidad: m.stock_articulos?.unidad || 'ud', cantidad: 0, euros: 0, veces: 0,
    }
    porArticulo[nombre].cantidad += perdido
    porArticulo[nombre].euros += euros
    porArticulo[nombre].veces += 1
  }
  return {
    total: totalEur,
    apuntes: (data || []).length,
    articulos: Object.values(porArticulo).sort((a, b) => b.euros - a.euros),
  }
}

// El "entró − salió = te quedó" de la pestaña Negocio, en una sola llamada.
// Los criterios (qué pedido cuenta, cómo se calcula la comisión, por qué la merma
// no se suma al "salió") viven COMENTADOS en la función de base de datos, que es
// la única fuente; aquí solo se pide y se pinta.
export const resumenNegocio = (estId, desde, hasta) =>
  rpc('stock_resumen_negocio', { p_establecimiento_id: estId, p_desde: desde, p_hasta: hasta })

export async function cargarGastos(estId, desde, hasta) {
  const { data, error } = await supabase
    .from('stock_gastos')
    .select('*')
    .eq('establecimiento_id', estId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(traducir(error))
  return data || []
}

export async function crearGasto(estId, { fecha, categoria, concepto, importe }) {
  const { error } = await supabase.from('stock_gastos').insert({
    establecimiento_id: estId,
    fecha,
    categoria: categoria.trim(),
    concepto: concepto?.trim() || null,
    importe,
  })
  if (error) throw new Error(traducir(error))
}

export async function borrarGasto(id) {
  const { error } = await supabase.from('stock_gastos').delete().eq('id', id)
  if (error) throw new Error(traducir(error))
}

/* ── Gastos fijos ─────────────────────────────────────────────────────────── */
// La plantilla del mes: alquiler, sueldos, luz… Cada fijo se apunta al libro CUANDO
// SE PAGA (botón por fijo, o "apuntar todos"), nunca en silencio: quien sabe si el
// recibo salió es el dueño. Un índice único garantiza un apunte por fijo y mes.

export async function cargarFijos(estId) {
  const { data, error } = await supabase
    .from('stock_gastos_fijos')
    .select('*')
    .eq('establecimiento_id', estId)
    .order('importe', { ascending: false })
  if (error) throw new Error(traducir(error))
  return data || []
}

export async function crearFijo(estId, { categoria, concepto, importe }) {
  const { error } = await supabase.from('stock_gastos_fijos').insert({
    establecimiento_id: estId,
    categoria: categoria.trim(),
    concepto: concepto?.trim() || null,
    importe,
  })
  if (error) throw new Error(traducir(error))
}

export async function borrarFijo(id) {
  const { error } = await supabase.from('stock_gastos_fijos').delete().eq('id', id)
  if (error) throw new Error(traducir(error))
}

export async function activarFijo(id, activo) {
  const { error } = await supabase.from('stock_gastos_fijos').update({ activo }).eq('id', id)
  if (error) throw new Error(traducir(error))
}

export const apuntarFijo = (fijoId) =>
  rpc('stock_apuntar_fijo', { p_fijo_id: fijoId })

export const apuntarFijosMes = (estId) =>
  rpc('stock_apuntar_fijos_mes', { p_establecimiento_id: estId })

/* ── El panorama: equilibrio, rentabilidad, informe ───────────────────────── */

// Los INGREDIENTES del punto de equilibrio (fijos, margen real del mes si el stock
// ya valoró ventas, margen teórico de la carta si no). La división la hace la
// pantalla, que además dice con cuántos platos sin receta está hecho el cálculo.
export const puntoEquilibrio = (estId) =>
  rpc('stock_punto_equilibrio', { p_establecimiento_id: estId })

export const rentabilidadPlatos = (estId, desde, hasta) =>
  rpc('stock_rentabilidad_platos', { p_establecimiento_id: estId, p_desde: desde, p_hasta: hasta })

export const informeMes = (estId, mes) =>
  rpc('stock_informe_mes', { p_establecimiento_id: estId, p_mes: mes })

export async function cargarMovimientos(estId, { articuloId, tipo, limite = 100 } = {}) {
  let q = supabase
    .from('stock_movimientos')
    .select('*, stock_articulos(nombre, unidad)')
    .eq('establecimiento_id', estId)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (articuloId) q = q.eq('articulo_id', articuloId)
  if (tipo) q = q.eq('tipo', tipo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

/* ── Escritura (siempre por RPC) ──────────────────────────────────────────── */

// supabase-js NO lanza: devuelve `{ error }`. Estas envolturas sí lanzan, para que
// la pantalla pueda usar un try/catch normal sin repetir el chequeo en cada sitio.
async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(traducir(error))
  return data
}

export const apuntarMerma = (articuloId, cant, motivo) =>
  rpc('stock_apuntar_merma', { p_articulo_id: articuloId, p_cantidad: cant, p_motivo: motivo || null })

export const recuento = (articuloId, contado, coste) =>
  rpc('stock_recuento', { p_articulo_id: articuloId, p_contado: contado, p_coste: coste ?? null })

export const recuentoLote = (lineas) =>
  rpc('stock_recuento_lote', { p_lineas: lineas })

/* ── Preparaciones ────────────────────────────────────────────────────────── */
// Un artículo elaborado (la mezcla de pollo) se HACE, no se compra. Su receta dice
// qué lleva CADA unidad de almacén (1 kg de mezcla = 0,8 kg de pollo + 0,2 l de
// mayonesa) y se guarda ENTERA por RPC — misma lección que la escalera de Creadores:
// nunca fila a fila desde el frontend. Apuntar una tanda (`preparar`) descuenta los
// ingredientes y mete el elaborado con su coste real. Si un día se hace la tanda y
// no se apunta, el elaborado queda en negativo: la venta nunca se frena, el
// inventario avisa.

export async function cargarElaboracion(elaboradoId) {
  const { data, error } = await supabase
    .from('stock_elaboracion_lineas')
    // La unidad de cada ingrediente viene pegada: la receta se enseña en g / ml y la
    // conversión no puede depender de que la lista de artículos ya esté cargada.
    .select('articulo_id, cantidad, stock_articulos!stock_elaboracion_lineas_articulo_id_fkey(unidad)')
    .eq('elaborado_id', elaboradoId)
  if (error) throw new Error(traducir(error))
  return data || []
}

export const guardarElaboracion = (elaboradoId, lineas) =>
  rpc('stock_guardar_elaboracion', { p_elaborado_id: elaboradoId, p_lineas: lineas })

export const preparar = (articuloId, cant, motivo) =>
  rpc('stock_preparar', { p_articulo_id: articuloId, p_cantidad: cant, p_motivo: motivo || null })

// Corregir a mano lo que cuesta un artículo. Normalmente el coste sale de las facturas
// de compra; esto es para el género que ya estaba en la cámara antes de arrancar, un
// proveedor sin factura, o un precio mal tecleado. Queda apuntado en el libro como
// `ajuste_coste`, no se escribe la columna a escondidas.
export const fijarCoste = (articuloId, coste, motivo) =>
  rpc('stock_fijar_coste', { p_articulo_id: articuloId, p_coste: coste, p_motivo: motivo || null })

export const arranqueDesdeCarta = (estId, productoIds) =>
  rpc('stock_arranque_desde_carta', { p_establecimiento_id: estId, p_producto_ids: productoIds })

// Cierra el arranque SIN crear artículos, para las cartas que no tienen nada que se
// venda tal cual (todo platos elaborados). Sin esto, esos restaurantes se quedaban
// encerrados en el asistente: la pantalla del Almacén no se abre hasta que hay época cero.
export const cerrarArranque = (estId) =>
  rpc('stock_cerrar_arranque', { p_establecimiento_id: estId })

// El % que se lleva Pidoo por lo que entra por la app. NO es siempre el 10 %: cada
// restaurante puede tener su trato pactado, y quien lo sabe es la base de datos.
export const comisionPidoo = (estId) =>
  rpc('pidoo_comision_pct', { p_establecimiento_id: estId, p_origen: 'pido' })

export const contabilizarFactura = (facturaId) =>
  rpc('stock_contabilizar_factura', { p_factura_id: facturaId })

/* ── Contabilidad del día: un pago se apunta UNA vez ──────────────────────── */
// Marlon, 15 sep: «compré 60 panes a 13,20: súmalos al inventario, cuéntalo como compra,
// descuéntalo de lo vendido y dime cuánto queda en efectivo». Antes eran tres pantallas
// (factura, contabilizar y salida en la caja del TPV). Ahora la RPC hace las tres cosas
// a la vez o ninguna: entra en el almacén, pone el coste y saca el dinero del cajón.

export const diaContable = (estId, fecha) =>
  rpc('contab_dia', { p_establecimiento_id: estId, p_fecha: fecha || null })

export const diasContables = (estId, desde, hasta) =>
  rpc('contab_dias', { p_establecimiento_id: estId, p_desde: desde, p_hasta: hasta })

// lineas: [{ articulo_id, cantidad, importe }] — «importe» es lo pagado por la línea entera.
export const apuntarCompra = (estId, { lineas, pagadoCon, fecha, proveedorId, nota, cajaMovimientoId }) =>
  rpc('contab_apuntar_compra', {
    p_establecimiento_id: estId, p_lineas: lineas, p_pagado_con: pagadoCon,
    p_fecha: fecha || null, p_proveedor_id: proveedorId || null, p_nota: nota || null,
    p_caja_movimiento_id: cajaMovimientoId || null,
  })

export const apuntarGasto = (estId, { categoria, importe, pagadoCon, fecha, concepto, fijoId, cajaMovimientoId }) =>
  rpc('contab_apuntar_gasto', {
    p_establecimiento_id: estId, p_categoria: categoria || null, p_importe: importe,
    p_pagado_con: pagadoCon, p_fecha: fecha || null, p_concepto: concepto || null,
    p_fijo_id: fijoId || null, p_caja_movimiento_id: cajaMovimientoId || null,
  })

// tipo: 'compra' | 'gasto'
export const deshacerPago = (tipo, id) =>
  rpc('contab_deshacer_pago', { p_tipo: tipo, p_id: id })

export const marcarPagado = (tipo, id, pagadoCon) =>
  rpc('contab_marcar_pagado', { p_tipo: tipo, p_id: id, p_pagado_con: pagadoCon })

export const salidaNoEsGasto = (movimientoId, nota) =>
  rpc('contab_salida_no_es_gasto', { p_movimiento_id: movimientoId, p_nota: nota || null })

/* ── Tu dinero: caja menor, caja mayor, banco y lo que debe Pidoo ─────────── */
// Marlon, 15 sep: «del cierre se deja la base y lo demás pasa a la caja mayor; de ahí se
// pagan los gastos». Casi todo se DERIVA en `contab_tesoreria` (cierres, compras, gastos,
// datáfono, liquidaciones); solo se apunta a mano el recuento y el dinero que se mueve
// sin ser gasto (llevarlo al banco, meter o sacar).

// Dónde puede salir un pago. El orden es el de la pantalla: lo normal primero.
export const PAGADO_CON = {
  caja_mayor: { label: 'Caja mayor', corto: 'Caja mayor' },
  banco: { label: 'Tarjeta o banco', corto: 'Banco' },
  caja: { label: 'Cajón del TPV', corto: 'Cajón' },
}

export const tesoreria = (estId) =>
  rpc('contab_tesoreria', { p_establecimiento_id: estId })

// bolsillo: 'caja_mayor' | 'banco'
export const contarBolsillo = (estId, bolsillo, importe, nota) =>
  rpc('contab_tesoreria_contar', { p_establecimiento_id: estId, p_bolsillo: bolsillo, p_importe: importe, p_nota: nota || null })

// movimiento: caja_mayor_a_banco · banco_a_caja_mayor · entrada_caja_mayor ·
// salida_caja_mayor · entrada_banco · salida_banco
export const moverDinero = (estId, movimiento, importe, nota) =>
  rpc('contab_tesoreria_mover', { p_establecimiento_id: estId, p_movimiento: movimiento, p_importe: importe, p_nota: nota || null })

export const borrarApunteDinero = (apunteId) =>
  rpc('contab_tesoreria_borrar', { p_apunte_id: apunteId })

// El cliente pidió en efectivo y pagó con datáfono (o al revés). Solo entre esos dos:
// la tarjeta de la app ya la cobró Pidoo y el mostrador tiene ticket fiscal.
export const cambiarFormaPago = (pedidoId, metodo, motivo) =>
  rpc('pedido_cambiar_forma_pago', { p_pedido_id: pedidoId, p_metodo: metodo, p_motivo: motivo || null })

// ¿Se le puede cambiar la forma de pago a este pedido? Misma regla que la RPC, para no
// ofrecer un botón que va a fallar.
//
// El segundo argumento es opcional (el TPV no lo pasa) y solo cuenta para lo ENTREGADO: en
// `pedido_cambiar_forma_pago` los 14 días (PD283) y la caja cerrada (PD282) solo miran
// estado='entregado'; lo recogido se cambia siempre y lo cambia cualquiera.
//   fecha, hoy      'AAAA-MM-DD' en hora de Canarias: el día del pedido y hoy.
//   puedeEditar     `contab_tesoreria.puede_editar`. false = es del equipo, no el dueño.
//                   Sin cargar todavía (undefined/null) no quita el botón: la RPC manda.
//   enCajaCerrada   ya se sabe que su cobro cae en una caja cerrada, o que se cobró con la caja
//                   cerrada y la caja que se abrió después ya está cerrada.
//   enCajaAbierta   ya se sabe que su cobro cae en la caja que sigue abierta en el TPV.
export function sePuedeCambiarPago(pedido, { fecha, hoy, puedeEditar, enCajaCerrada = false, enCajaAbierta = false } = {}) {
  const via = pedido?.origen_pedido ?? pedido?.via
  const pago = pedido?.metodo_pago ?? pedido?.pago
  const estado = pedido?.estado
  const base = ['efectivo', 'datafono'].includes(pago)
    && via !== 'tpv'
    && !pedido?.reembolsado_at
    && !['cancelado', 'fallido', 'rechazado', 'pendiente_pago'].includes(estado)
  if (!base || estado !== 'entregado') return base
  // PD283: entregado hace más de 14 días. La RPC lo mide a la hora exacta, así que el día de
  // hace 14 ya falla en parte: ese día tampoco se ofrece.
  if (fecha && hoy && fecha <= sumarDias(hoy, -14)) return false
  // PD282: una caja cerrada solo la corrige el dueño. Al equipo no se le ofrece si su cobro cae
  // en una caja cerrada o la caja que se abrió después ya está cerrada, ni en un día anterior a
  // hoy (esa caja pudo cerrarse), salvo que caiga en la caja que sigue abierta.
  if (puedeEditar === false && !enCajaAbierta && (enCajaCerrada || (fecha && hoy && fecha < hoy))) return false
  return true
}

// Lo que devuelve la RPC sobre el cajón, dicho para personas.
export function textoCajon(cajon, importe) {
  if (cajon === 'caja_mayor') return `Salen ${eur(importe)} de la caja mayor.`
  if (cajon === 'salida') return `Han salido ${eur(importe)} del cajón.`
  if (cajon === 'enlazada') return 'Queda explicada la salida del cajón.'
  if (cajon === 'sin_caja') return 'No había caja abierta en el TPV: el cajón no se ha tocado.'
  if (cajon === 'devuelto') return 'El dinero vuelve a contar en el cajón.'
  if (cajon === 'otro_dia') return 'Es de otro día: la caja de ese día ya se contó, el cajón no se toca.'
  return ''
}

// El día de Canarias como 'AAAA-MM-DD'. Nada de toISOString(): recorta en UTC y de 00:00
// a 01:00 daría el día anterior.
export function hoyCanariasIso() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Atlantic/Canary', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date())
      .map(x => [x.type, x.value])
  )
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// «lunes 15 de septiembre»
export function fechaLarga(iso, { diaSemana = true } = {}) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', {
    ...(diaSemana ? { weekday: 'long' } : {}), day: 'numeric', month: 'long',
  })
}

export const descontabilizarFactura = (facturaId) =>
  rpc('stock_descontabilizar_factura', { p_factura_id: facturaId })

// Los códigos PD del módulo son PD230-PD259. Traducirlos aquí evita que al dueño le
// salga un mensaje de base de datos en una pantalla de gestión de su almacén.
const MENSAJES = {
  PD230: 'El almacén lo activa Pidoo. Escríbenos y te lo encendemos.',
  PD231: 'El almacén lo activa Pidoo. Tú puedes pausarlo desde Ajustes.',
  PD233: 'Las existencias no se escriben a mano: apunta una compra, una merma o un recuento.',
  PD237: 'Ese producto no es de este restaurante.',
  PD238: 'Ese artículo no es de este almacén.',
  PD240: 'Esa factura ya está contabilizada. Descontabilízala antes de tocarla.',
  PD241: 'Revisa la cantidad: tiene que ser un número mayor que cero.',
  PD243: 'Ese almacén no es tuyo.',
  PD245: 'Tienes el almacén en pausa. Puedes reactivarlo desde Ajustes.',
  PD246: 'La fecha de la factura no puede estar en el futuro.',
  PD247: 'Esa factura no está contabilizada: no hay nada que deshacer.',
  PD248: 'Los movimientos no se editan ni se borran. Apunta uno que lo corrija.',
  PD249: 'La fecha de arranque la fija el recuento inicial.',
  PD250: 'La fecha del gasto no puede estar en el futuro.',
  PD251: 'Revisa el periodo: "desde" no puede ir después de "hasta".',
  PD252: 'Ese artículo no es una preparación.',
  PD253: 'Esta preparación no tiene receta: añádesela antes de apuntar una tanda.',
  PD255: 'Una preparación no puede ser ingrediente de otra preparación.',
  PD256: 'Ese fijo ya estaba apuntado este mes.',
  PD260: 'Dinos con qué lo pagaste: caja mayor, banco o cajón del TPV.',
  PD261: 'Ese proveedor no es de tu negocio.',
  PD262: 'Añade al menos un artículo.',
  PD263: 'Revisa lo que pagaste: tiene que ser un importe mayor que cero.',
  PD264: 'Esa salida del cajón no es de tu negocio.',
  PD265: 'Esa salida del cajón ya está explicada.',
  // PD266 lleva el importe dentro del mensaje: se enseña tal cual viene.
  PD267: 'Dinos en qué fue el gasto: luz, alquiler, una reparación…',
  PD268: 'Eso ya no existe: recarga la página.',
  PD269: 'Es una factura completa: ábrela en Compras para deshacerla.',
  // PD272-PD279 y PD282-PD285 llevan el motivo exacto en el mensaje de la base de datos
  // (cambio de forma de pago, caja mayor): se enseñan tal cual vienen.
}

function traducir(error) {
  return MENSAJES[error?.code] || error?.message || 'No se ha podido guardar.'
}
