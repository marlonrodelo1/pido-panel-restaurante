// La carta del KIOSKO y las cuentas de la pantalla.
//
// Se lee igual que la del TPV (mismas tablas, misma sesión del restaurante) con dos
// diferencias a propósito:
//   - Precio de BARRA (`precio_local ?? precio`): el cliente está dentro del local.
//     El servidor (`kiosko-pedido` + `precio_suelo_linea`) vuelve a ponerlo; esto es
//     solo lo que se enseña.
//   - Lo apagado NO se vende pero SÍ se ve, en gris y con "Agotado" (decisión del
//     14 oct). La barra del TPV vende aunque el almacén diga cero; el kiosko no,
//     porque al otro lado no hay nadie que pueda decir "no me queda".
//     Lo que nunca se enseña: precio 0 (regalos de promo, no se venden sueltos) y
//     las categorías apagadas (los menús de mediodía fuera de su franja).

import { supabase } from '../lib/supabase'

export async function cargarCarta(establecimientoId) {
  const [cats, prods, gru] = await Promise.all([
    supabase.from('categorias').select('id, nombre, orden')
      .eq('establecimiento_id', establecimientoId).eq('activa', true).order('orden'),
    supabase.from('productos')
      .select('id, nombre, descripcion, precio, precio_local, categoria_id, disponible, orden, imagen_url')
      .eq('establecimiento_id', establecimientoId).order('orden', { nullsFirst: false }).order('nombre'),
    supabase.from('grupos_extras').select('id, nombre, tipo, max_selecciones, extras_opciones(id, nombre, precio, orden)')
      .eq('establecimiento_id', establecimientoId),
  ])
  const error = cats.error || prods.error || gru.error
  if (error) throw error

  const catsActivas = new Set((cats.data || []).map((c) => c.id))
  const productos = (prods.data || [])
    .filter((p) => Number(p.precio) > 0 && catsActivas.has(p.categoria_id))
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      categoria_id: p.categoria_id,
      img: p.imagen_url || '',
      ok: p.disponible !== false,
      precioC: aCentimos(p.precio_local ?? p.precio),
    }))

  let tamanos = [], vinculos = []
  if (productos.length) {
    const ids = productos.map((p) => p.id)
    const [t, v] = await Promise.all([
      supabase.from('producto_tamanos').select('id, producto_id, nombre, precio, precio_local, orden')
        .in('producto_id', ids).order('orden'),
      supabase.from('producto_extras').select('producto_id, grupo_id').in('producto_id', ids),
    ])
    if (t.error || v.error) throw (t.error || v.error)
    tamanos = t.data || []
    vinculos = v.data || []
  }

  // Grupos por nombre: es el orden de la tienda, y por eso los de los menús se
  // llaman "1 · Elige tu…" / "2 · Elige tu bebida".
  const grupos = {}
  for (const g of gru.data || []) {
    grupos[g.id] = {
      id: g.id,
      nombre: g.nombre,
      unico: g.tipo !== 'multiple',
      max: g.tipo === 'multiple' ? (Number(g.max_selecciones) > 0 ? Number(g.max_selecciones) : 99) : 1,
      opciones: [...(g.extras_opciones || [])]
        .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || String(a.nombre).localeCompare(b.nombre))
        .map((o) => ({ id: o.id, nombre: o.nombre, precioC: Math.max(0, aCentimos(o.precio)) })),
    }
  }

  for (const p of productos) {
    p.grupos = vinculos.filter((v) => v.producto_id === p.id && grupos[v.grupo_id])
      .map((v) => grupos[v.grupo_id])
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
    p.tamanos = tamanos.filter((t) => t.producto_id === p.id)
      .map((t) => ({ id: t.id, nombre: t.nombre, precioC: aCentimos(t.precio_local ?? t.precio) }))
  }

  // Solo las categorías que tienen algo que enseñar.
  const conAlgo = new Set(productos.map((p) => p.categoria_id))
  const categorias = (cats.data || []).filter((c) => conAlgo.has(c.id))

  return { categorias, productos }
}

export const aCentimos = (euros) => Math.round(Number(euros || 0) * 100)
export const eur = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',') + ' €'
export const sinPrefijo = (t) => String(t || '').replace(/^\d+\s*·\s*/, '')

// Lo que vale UNA unidad de una línea: base (o tamaño) + extras.
export function precioUnidad(p, sel) {
  const tam = sel.tamanoId ? p.tamanos.find((t) => t.id === sel.tamanoId) : null
  const base = tam ? tam.precioC : p.precioC
  let extras = 0
  for (const g of p.grupos) {
    for (const id of sel.ops[g.id] || []) {
      extras += g.opciones.find((o) => o.id === id)?.precioC || 0
    }
  }
  return base + extras
}

// Lo que le falta a una línea para poder pedirse: tamaño y grupos obligatorios.
export function queFalta(p, sel) {
  if (p.tamanos.length && !sel.tamanoId) return 'Elige el tamaño'
  const g = p.grupos.find((x) => x.unico && !(sel.ops[x.id] || []).length)
  return g ? sinPrefijo(g.nombre) : null
}

// Firma de una línea: dos iguales se suman en vez de duplicarse. La nota cuenta:
// una hamburguesa "sin cebolla" y otra normal son dos líneas en la comanda.
export function firmaLinea(productoId, sel) {
  const ops = Object.keys(sel.ops || {}).sort()
    .map((k) => k + ':' + [...sel.ops[k]].sort().join(',')).join(';')
  return productoId + '|' + (sel.tamanoId || '') + '|' + ops + '|' + (sel.nota || '').toLowerCase()
}

// ── Nota de la línea para la cocina ("sin cebolla, bien hecha") ──
// El servidor la corta a 120; aquí se para antes para que el contador no engañe.
export const NOTA_MAX = 100

// Sin espacios ni comas sueltas al principio, al final o repetidas.
export const limpiarNota = (t) => String(t || '')
  .replace(/\s+/g, ' ')
  .replace(/\s*,[\s,]*/g, ', ')
  .replace(/^[\s,]+|[\s,]+$/g, '')
  .slice(0, NOTA_MAX)

// Lo que se pide más a menudo, según la categoría del producto: un toque y listo.
export function atajosNota(categoria) {
  const c = String(categoria || '')
  if (/bebida|refresco|zumo|batido|agua|cerveza/i.test(c)) return ['Sin hielo', 'Con hielo', 'Bien fría', 'Con pajita']
  if (/papa|patata|frita/i.test(c)) return ['Sin sal', 'Salsa aparte', 'Bien hechas', 'Sin salsa']
  if (/postre|dulce|helado/i.test(c)) return ['Sin nata', 'Sin sirope']
  return ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillo', 'Sin salsas', 'Salsa aparte', 'Bien hecha', 'Cortada a la mitad']
}

// Una tecla del teclado de la nota: mayúscula al empezar y tras una coma.
export function teclearNota(texto, k) {
  const t = texto || ''
  if (k === ' ') return (!t || t.endsWith(' ')) ? t : (t + ' ').slice(0, NOTA_MAX)
  if (k === ',') return (!t.trim() || /,\s*$/.test(t)) ? t : (t.trimEnd() + ', ').slice(0, NOTA_MAX)
  const inicio = !t.trim() || /,\s*$/.test(t)
  return (t + (inicio ? k.toUpperCase() : k.toLowerCase())).slice(0, NOTA_MAX)
}

// Un atajo se pone o se quita (si ya estaba escrito, tal cual, se borra).
export function alternarAtajo(texto, atajo) {
  const partes = limpiarNota(texto).split(', ').filter(Boolean)
  const i = partes.findIndex((p) => p.toLowerCase() === atajo.toLowerCase())
  if (i >= 0) partes.splice(i, 1)
  else partes.push(atajo)
  return limpiarNota(partes.join(', '))
}

// Texto de los extras de una línea, como en la comanda.
export function textoExtras(p, sel) {
  const partes = []
  const tam = sel.tamanoId ? p.tamanos.find((t) => t.id === sel.tamanoId) : null
  if (tam) partes.push(tam.nombre)
  for (const g of p.grupos) {
    for (const id of sel.ops[g.id] || []) {
      const o = g.opciones.find((x) => x.id === id)
      if (!o) continue
      partes.push(g.unico ? o.nombre : (/salsa/i.test(g.nombre) ? o.nombre + ' aparte' : '+ ' + o.nombre))
    }
  }
  return partes.join(' · ')
}

export const uuidv4 = () => crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
