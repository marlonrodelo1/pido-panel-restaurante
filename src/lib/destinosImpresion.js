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
//
// 🔴 SIN INTERNET (a8, 22 oct 2026): el reparto se GUARDA EN EL APARATO con cada
// lectura buena y, si el servidor no contesta (o la red ya se sabe caída), se
// usa esa copia. Antes un fallo devolvía null y, con dos impresoras, TODA la
// comanda salía por la de caja: la cocina no recibía nada.
import { supabase } from './supabase'
import { impresoraCocinaConfigurada, cargarImpresoras, impresoraCajaDe } from './printService'
import { redCaida, avisarFalloRed } from './estadoRed'
import { destinosAGuardar, destinosDeGuardado, conLimite } from './impresionSinRed'

const TTL_MS = 60000
const cache = new Map()   // establecimientoId -> { hasta, catDe: Map(prod->cat), destinoCat: Map(cat->destino) }
const claveEspejo = (est, columna) => `pidoo_tpv_destinos_${est}_${columna}`

// La copia del aparato, puesta en la caché por poco tiempo (se vuelve a
// preguntar enseguida: en cuanto haya red manda el servidor).
function desdeElAparato(establecimientoId, columnaDestino) {
  try {
    const g = destinosDeGuardado(JSON.parse(localStorage.getItem(claveEspejo(establecimientoId, columnaDestino)) || 'null'))
    if (!g) return null
    const entrada = { hasta: Date.now() + 15000, columna: columnaDestino, ...g }
    cache.set(establecimientoId, entrada)
    return entrada
  } catch { return null }
}

async function cargarCarta(establecimientoId, columnaDestino) {
  let entrada = cache.get(establecimientoId)
  if (entrada && entrada.columna === columnaDestino && entrada.hasta >= Date.now()) return entrada
  // Con la red ya comprobada como caída, ni se pregunta: se quedaría colgada.
  if (redCaida()) {
    const delAparato = desdeElAparato(establecimientoId, columnaDestino)
    if (delAparato) return delAparato
  }
  // Como mucho 5 s: la comanda no puede esperar a una consulta colgada.
  const vencida = { data: null, error: { message: 'sin respuesta en 5 s' } }
  let avisado = false
  const avisar = () => { if (!avisado) { avisado = true; avisarFalloRed() } }
  const [prods, cats] = await Promise.all([
    conLimite(supabase.from('productos').select('id, categoria_id').eq('establecimiento_id', establecimientoId), 5000, vencida, avisar),
    conLimite(supabase.from('categorias').select('id, ' + columnaDestino).eq('establecimiento_id', establecimientoId), 5000, vencida, avisar),
  ])
  if (prods.error || cats.error) return desdeElAparato(establecimientoId, columnaDestino)
  const catDe = new Map((prods.data || []).map((p) => [p.id, p.categoria_id]))
  const destinoCat = new Map((cats.data || []).map((c) => [c.id, c[columnaDestino]]))
  entrada = { hasta: Date.now() + TTL_MS, columna: columnaDestino, catDe, destinoCat }
  cache.set(establecimientoId, entrada)
  try { localStorage.setItem(claveEspejo(establecimientoId, columnaDestino), JSON.stringify(destinosAGuardar(entrada))) } catch { /* lleno */ }
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
      // Las líneas SIN producto (el «Libre»: «extra de huevo») van a LA COCINA,
      // no a la caja: casi siempre son comida y la plancha tiene que verlas
      // (Marlon, 14 sep 2026). «La cocina» es la impresora que no es de caja con
      // MÁS categorías asignadas; en empate, la primera por `orden` (así viene la
      // lista). Si ninguna tiene categorías, caja, como antes. El nombre no se
      // mira: es texto libre. Una categoría SIN impresora sigue yendo a caja: eso
      // no cambia. Solo `null` explícito cuenta como línea libre; una línea que
      // no traiga el campo sigue el camino de siempre.
      const caja = impresoraCajaDe(nube)
      const cuenta = new Map()
      for (const impId of entrada.destinoCat.values()) {
        if (impId) cuenta.set(impId, (cuenta.get(impId) || 0) + 1)
      }
      let cocinaId = null
      let max = 0
      for (const i of nube) {
        if (i.id === caja?.id) continue
        const n = cuenta.get(i.id) || 0
        if (n > max) { max = n; cocinaId = i.id }
      }
      return (productoId) => (productoId === null
        ? cocinaId
        : entrada.destinoCat.get(entrada.catDe.get(productoId)) || null)
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
