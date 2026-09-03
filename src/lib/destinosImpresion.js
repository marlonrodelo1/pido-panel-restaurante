// ¿A qué impresora va cada línea de una comanda?
//
// El destino vive en la CARTA (`categorias.impresora_id` → fila de
// `tpv_impresoras`; NULL = la impresora de caja), así que vale para todos los
// aparatos a la vez y se configura una sola vez en Configuración → Impresora.
//
// Este helper resuelve producto → categoría → impresora con una caché corta
// para no consultar la carta en cada impresión. Mientras un restaurante no
// tenga impresoras dadas de alta en la nube, sigue funcionando el camino
// clásico de este aparato (`impresora_destino`: 'cocina'/'barra').
import { supabase } from './supabase'
import { impresoraCocinaConfigurada, cargarImpresoras } from './printService'

const TTL_MS = 60000
const cache = new Map()   // establecimientoId -> { hasta, catDe: Map(prod->cat), destinoCat: Map(cat->destino) }

async function cargarCarta(establecimientoId, columnaDestino) {
  let entrada = cache.get(establecimientoId)
  if (entrada && entrada.columna === columnaDestino && entrada.hasta >= Date.now()) return entrada
  const [prods, cats] = await Promise.all([
    supabase.from('productos').select('id, categoria_id').eq('establecimiento_id', establecimientoId),
    supabase.from('categorias').select('id, ' + columnaDestino).eq('establecimiento_id', establecimientoId),
  ])
  if (prods.error || cats.error) return null
  const catDe = new Map((prods.data || []).map((p) => [p.id, p.categoria_id]))
  const destinoCat = new Map((cats.data || []).map((c) => [c.id, c[columnaDestino]]))
  entrada = { hasta: Date.now() + TTL_MS, columna: columnaDestino, catDe, destinoCat }
  cache.set(establecimientoId, entrada)
  return entrada
}

// Devuelve una función `(productoId) => destino`, o `null` si no hay nada que
// partir. El destino es un `impresora_id` de la nube (o null = caja) cuando el
// restaurante tiene impresoras dadas de alta ahí, y 'cocina'/'barra' en el
// camino clásico. Nunca lanza: ante cualquier fallo devuelve null y la comanda
// sale entera por el camino de siempre — un fallo de red no puede costar un
// papel.
export async function crearDestinoDe(establecimientoId) {
  try {
    if (!establecimientoId) return null

    // Impresoras en la NUBE: el destino es el impresora_id de la categoría.
    const nube = await cargarImpresoras(establecimientoId)
    if (nube && nube.length) {
      if (nube.length < 2) return null // con una sola impresora no hay reparto
      const entrada = await cargarCarta(establecimientoId, 'impresora_id')
      if (!entrada) return null
      return (productoId) => entrada.destinoCat.get(entrada.catDe.get(productoId)) || null
    }

    // Camino clásico de este aparato (dos impresoras fijas cocina/barra).
    if (!impresoraCocinaConfigurada()) return null
    const entrada = await cargarCarta(establecimientoId, 'impresora_destino')
    if (!entrada) return null
    return (productoId) => {
      const destino = entrada.destinoCat.get(entrada.catDe.get(productoId))
      return destino === 'barra' ? 'barra' : 'cocina'
    }
  } catch {
    return null
  }
}

// Al cambiar el reparto por categorías desde la pantalla de configuración.
export function invalidarDestinos(establecimientoId = null) {
  if (establecimientoId) cache.delete(establecimientoId)
  else cache.clear()
}
