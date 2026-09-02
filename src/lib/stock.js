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
    .select('articulo_id, cantidad')
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
}

function traducir(error) {
  return MENSAJES[error?.code] || error?.message || 'No se ha podido guardar.'
}
