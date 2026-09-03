// ¿A qué impresora va cada línea de una comanda cuando el local tiene DOS?
//
// El destino vive en la CARTA (`categorias.impresora_destino`: 'barra' o
// 'cocina', NULL = cocina), así que vale para todos los aparatos a la vez y se
// configura una sola vez en Configuración → Impresora.
//
// Este helper resuelve producto → categoría → destino para las comandas de los
// pedidos de Pidoo (donde solo se conoce el producto_id de cada línea), con una
// caché corta para no consultar la carta en cada impresión. El TPV del
// mostrador no lo necesita: tiene la carta entera en memoria.
import { supabase } from './supabase'
import { impresoraCocinaConfigurada } from './printService'

const TTL_MS = 60000
const cache = new Map()   // establecimientoId -> { hasta, catDe: Map(prod->cat), destinoCat: Map(cat->destino) }

// Devuelve una función `(productoId) => 'cocina' | 'barra'`, o `null` si no hay
// segunda impresora configurada (y entonces no hay nada que partir ni que
// consultar). Nunca lanza: ante cualquier fallo devuelve null y la comanda sale
// entera por el camino de siempre — un fallo de red no puede costar un papel.
export async function crearDestinoDe(establecimientoId) {
  try {
    if (!establecimientoId || !impresoraCocinaConfigurada()) return null

    let entrada = cache.get(establecimientoId)
    if (!entrada || entrada.hasta < Date.now()) {
      const [prods, cats] = await Promise.all([
        supabase.from('productos').select('id, categoria_id').eq('establecimiento_id', establecimientoId),
        supabase.from('categorias').select('id, impresora_destino').eq('establecimiento_id', establecimientoId),
      ])
      if (prods.error || cats.error) return null
      const catDe = new Map((prods.data || []).map((p) => [p.id, p.categoria_id]))
      const destinoCat = new Map((cats.data || []).map((c) => [c.id, c.impresora_destino === 'barra' ? 'barra' : 'cocina']))
      entrada = { hasta: Date.now() + TTL_MS, catDe, destinoCat }
      cache.set(establecimientoId, entrada)
    }

    return (productoId) => {
      const cat = entrada.catDe.get(productoId)
      return entrada.destinoCat.get(cat) || 'cocina'
    }
  } catch {
    return null
  }
}
