// Qué pedidos ya han salido por la impresora.
//
// Hace falta porque hay TRES sitios que mandan al papel un pedido que entra, y con
// la aceptación automática pueden coincidir dos sobre el mismo:
//
//   1. `PedidosEnVivo`, al ver el INSERT por realtime (solo si esa pantalla está
//      montada).
//   2. `PedidosEnVivo`, cuando alguien lo acepta a mano.
//   3. `PedidoAlertContext`, cuando el servidor lo acepta solo — ese vive por encima
//      del router, así que dispara aunque el TPV esté en el mostrador.
//
// Sin esto, un restaurante con la aceptación automática y la pantalla de Pedidos
// abierta sacaría DOS comandas del mismo pedido, y en cocina dos papeles iguales
// son dos pedidos.
//
// Va en `localStorage` y no en memoria a propósito: la tablet se recarga sola con
// más frecuencia de la que uno cree (service worker, vuelta de segundo plano), y
// una lista en memoria se perdería justo cuando importa.
//
// 🔴 NO lo usa la reimpresión manual: si el dueño le da a reimprimir es porque
// quiere otro papel, y ahí estorbar sería el fallo.

const CLAVE = 'pidoo_tickets_impresos'
const MAX = 200   // el histórico no sirve para nada; sobra con los últimos.

function leer(clave = CLAVE) {
  try {
    const v = JSON.parse(localStorage.getItem(clave) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    // Modo incógnito, almacenamiento lleno o un valor corrupto: mejor imprimir de
    // más que quedarse sin comanda.
    return []
  }
}

function escribir(lista, clave = CLAVE) {
  try { localStorage.setItem(clave, JSON.stringify(lista.slice(-MAX))) } catch { /* da igual */ }
}

export function yaImpreso(pedidoId) {
  return !!pedidoId && leer().includes(pedidoId)
}

// Se RESERVA antes de imprimir, no después: entre que se manda a la impresora y
// responde pasan segundos, y en ese hueco cabe el otro camino.
export function reservarImpresion(pedidoId) {
  if (!pedidoId) return false
  const lista = leer()
  if (lista.includes(pedidoId)) return false
  escribir([...lista, pedidoId])
  return true
}

// Si la impresora falló, se suelta para que otro camino (o un reintento) pueda
// volver a intentarlo. Quedarse sin comanda es peor que arriesgar una repetida.
export function soltarImpresion(pedidoId) {
  if (!pedidoId) return
  escribir(leer().filter((x) => x !== pedidoId))
}

// ── COMANDAS QUE NO SALIERON Y YA SE AVISÓ (revisión del 25 oct 2026) ─────────
//
// Cuando la comanda de un pedido falla en ESTE aparato, se suelta la reserva (para
// que otro camino pueda volver a intentarlo) y se avisa «sácala con Reimprimir
// comanda». Aquí se apunta ese aviso, aparte de la reserva.
//
// Lo mira SOLO la recuperación de `PedidoAlertContext` (lo aceptado mientras el
// aparato no escuchaba): si sacara sola, sin avisar, una comanda que ya se le ha
// pedido a una persona que saque a mano, quien hizo caso al aviso sacaría otra, y
// en cocina dos papeles iguales son dos pedidos. Antes de la recuperación eso no
// pasaba. Los demás caminos no lo miran: se quedan como estaban.
// Sin almacenamiento (incógnito, lleno) no queda apuntado y la recuperación la
// saca: como arriba, mejor una comanda de más que ninguna.
const CLAVE_AVISADAS = 'pidoo_comandas_avisadas'

export function marcarComandaAvisada(pedidoId) {
  if (!pedidoId) return
  const lista = leer(CLAVE_AVISADAS)
  if (!lista.includes(pedidoId)) escribir([...lista, pedidoId], CLAVE_AVISADAS)
}

export function comandaAvisada(pedidoId) {
  return !!pedidoId && leer(CLAVE_AVISADAS).includes(pedidoId)
}

// ¿El pedido NACIÓ aceptado? Los telefónicos del TPV (`tpv-pedido`) se insertan
// ya en 'preparando' con `aceptado_at` = ahora: nadie los acepta, así que no hay
// aviso de «aceptado» que perderse. Su comanda la saca el aparato que lo crea, y
// la recuperación no debe sacar otra en este. En Duende (SELECT del 25 oct, 30
// días) los 117 que nacieron aceptados dan ≤ 0 s entre `created_at` y
// `aceptado_at`; los aceptados de verdad (web, tienda, Lucía), ≥ 0,95 s. Con una
// fecha que no se entiende responde que no: mejor una comanda de más que ninguna.
const NACIO_ACEPTADO_MS = 500

export function nacioAceptado(p) {
  const aceptado = Date.parse(p?.aceptado_at || '')
  const creado = Date.parse(p?.created_at || '')
  return Number.isFinite(aceptado) && Number.isFinite(creado) && aceptado - creado < NACIO_ACEPTADO_MS
}
