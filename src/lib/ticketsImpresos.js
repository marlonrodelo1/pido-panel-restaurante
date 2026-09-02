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

function leer() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    // Modo incógnito, almacenamiento lleno o un valor corrupto: mejor imprimir de
    // más que quedarse sin comanda.
    return []
  }
}

function escribir(lista) {
  try { localStorage.setItem(CLAVE, JSON.stringify(lista.slice(-MAX))) } catch { /* da igual */ }
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
