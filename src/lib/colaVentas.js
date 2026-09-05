// LA COLA DE VENTAS SIN INTERNET (modo local del TPV, fase 1).
//
// Cuando el mostrador cobra y no hay conexión, la venta NO se pierde ni se
// bloquea: se guarda aquí (localStorage, por restaurante) con la MISMA clave
// de idempotencia que iba a viajar al servidor, se imprime un ticket
// PROVISIONAL (serie OFF, sin validez fiscal) y el servicio sigue. Al volver
// la conexión, la cola se envía en orden a `tpv-venta`: el servidor numera el
// ticket fiscal de verdad, descuenta stock y apunta la venta.
//
// Por qué es seguro reenviar a ciegas: la clave de idempotencia. Si una venta
// dudosa (corte a mitad de cobro) SÍ había entrado, el servidor contesta
// `repetida` con la venta ya grabada — nunca se cobra dos veces.
//
// Una venta que el servidor RECHAZA por negocio (producto borrado, total que
// ya no cuadra…) no se tira jamás: el dinero ya está en el cajón. Se marca
// ATASCADA con su motivo y se avisa para que la revise una persona.
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const claveCola = (est) => `pidoo_tpv_cola_ventas_${est}`
const claveContador = (est) => `pidoo_tpv_off_n_${est}`

export function leerCola(est) {
  try {
    const v = JSON.parse(localStorage.getItem(claveCola(est)) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function guardarCola(est, lista) {
  try { localStorage.setItem(claveCola(est), JSON.stringify(lista)) } catch { /* lleno */ }
  // El banner del TPV escucha este evento para pintar el contador al momento.
  try { window.dispatchEvent(new CustomEvent('pidoo:cola-ventas', { detail: { est, n: lista.length } })) } catch { /* nada */ }
}

export const ventasPendientes = (est) => leerCola(est).length
export const ventasAtascadas = (est) => leerCola(est).filter((v) => v.atascada).length

// Número provisional OFF-001, OFF-002… por aparato. Solo para el papel: el
// número fiscal lo pone el servidor al sincronizar.
export function siguienteNumeroOff(est) {
  let n = 0
  try { n = Number(localStorage.getItem(claveContador(est))) || 0 } catch { /* nada */ }
  n += 1
  try { localStorage.setItem(claveContador(est), String(n)) } catch { /* nada */ }
  return n
}

// `payload` es EXACTAMENTE el body que iba a viajar a tpv-venta (con su
// idempotency_key dentro). Lo demás es contexto para el papel y para revisar.
export function encolarVenta(est, { payload, numeroOff, total_c, metodo, hora }) {
  const cola = leerCola(est)
  // La misma clave no entra dos veces (doble toque sobre el mismo fallo).
  if (cola.some((v) => v.payload?.idempotency_key === payload?.idempotency_key)) return cola.length
  cola.push({ payload, numeroOff, total_c, metodo, hora: hora || new Date().toISOString(), atascada: false, motivo: null })
  guardarCola(est, cola)
  return cola.length
}

let sincronizando = false

// Envía la cola en orden. Devuelve { ok, enviadas, atascadas, quedan }.
// Corta al primer fallo DE RED (sin conexión: reintentará el siguiente tick);
// un rechazo DE NEGOCIO marca la venta como atascada y sigue con las demás.
export async function sincronizarCola(est) {
  if (sincronizando) return { ok: false, motivo: 'en_marcha' }
  const cola = leerCola(est)
  const pendientes = cola.filter((v) => !v.atascada)
  if (!pendientes.length) return { ok: true, enviadas: 0, atascadas: ventasAtascadas(est), quedan: cola.length }
  sincronizando = true
  let enviadas = 0
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    for (const venta of pendientes) {
      let resp, body
      try {
        const corte = new AbortController()
        const reloj = setTimeout(() => corte.abort(), 30000)
        resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-venta`, {
          method: 'POST',
          signal: corte.signal,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(venta.payload),
        })
        clearTimeout(reloj)
        body = await resp.json().catch(() => ({}))
      } catch {
        // Fallo de RED: seguimos sin internet de verdad. Se para y se
        // reintenta en el siguiente tick, sin marcar nada.
        break
      }
      if (resp.ok && body?.ok) {
        const quedanAhora = leerCola(est).filter((v) => v.payload?.idempotency_key !== venta.payload?.idempotency_key)
        guardarCola(est, quedanAhora)
        enviadas += 1
      } else {
        // Rechazo de NEGOCIO: la venta se conserva, marcada, con su motivo.
        const lista = leerCola(est).map((v) => (v.payload?.idempotency_key === venta.payload?.idempotency_key
          ? { ...v, atascada: true, motivo: body?.detalle || body?.error || ('HTTP ' + resp.status) }
          : v))
        guardarCola(est, lista)
      }
    }
  } finally {
    sincronizando = false
  }
  const quedan = leerCola(est)
  return { ok: true, enviadas, atascadas: quedan.filter((v) => v.atascada).length, quedan: quedan.length }
}

// Quitar a mano una venta atascada (tras revisarla): solo desde la UI, nunca sola.
export function descartarVentaAtascada(est, idempotencyKey) {
  const lista = leerCola(est).filter((v) => v.payload?.idempotency_key !== idempotencyKey)
  guardarCola(est, lista)
}
