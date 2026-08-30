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
  const [valor, ciegos] = await Promise.all([
    supabase.from('v_stock_valor_inventario').select('*').eq('establecimiento_id', estId).maybeSingle(),
    supabase.from('v_stock_puntos_ciegos').select('*').eq('establecimiento_id', estId).maybeSingle(),
  ])
  return {
    valor: valor.data || { articulos: 0, valor: 0, en_negativo: 0, bajo_minimo: 0, sin_coste: 0 },
    ciegos: ciegos.data || null,
  }
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
}

function traducir(error) {
  return MENSAJES[error?.code] || error?.message || 'No se ha podido guardar.'
}
