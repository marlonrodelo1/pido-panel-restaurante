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
// Una venta que el servidor RECHAZA por negocio (producto borrado, TPV
// desactivado…) no se tira jamás sola: el dinero ya está en el cajón. Se marca
// ATASCADA con su motivo y se ve en «Ventas sin apuntar», donde una persona la
// reintenta o la descarta. Lo que se arregla solo (sesión caducada, servidor
// caído) ya NO la atasca: se reintenta (a6, 22 oct 2026). Qué es cada cosa lo
// decide `colaVentasLogica.js`, que se prueba con `npm run test:cola`.
import { supabase } from './supabase'
import { marcarRedOk, avisarFalloRed } from './estadoRed'
import {
  sincronizar, resumenCola, nuevaEntrada, anadirSiNoEsta, marcarParaReintentar, quitarDeCola,
  cuerpoParaEnviar,
} from './colaVentasLogica'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const claveCola = (est) => `pidoo_tpv_cola_ventas_${est}`
const claveContador = (est) => `pidoo_tpv_off_n_${est}`
const claveDescartadas = (est) => `pidoo_tpv_cola_descartadas_${est}`

// ── EL PERMISO PARA COBRAR, SIN ESPERAR A RENOVARLO (a5, 22 oct 2026) ──────────
// La sesión dura unos 60 minutos y se renueva sola… con internet. Sin él,
// `getSession()` se queda reintentando la renovación hasta medio minuto (y cada
// intento puede colgarse), y el cobro esperaba detrás: a partir de la media hora
// de corte, cada venta tardaba 25-50 s y acababa en «vuelve a pulsar cobrar»,
// sin guardarse. Aquí se espera como mucho `ms`. Si no contesta a tiempo, o no
// devuelve sesión, se usa el token que el aparato tiene guardado TAL CUAL, aunque
// haya caducado: sin internet la petición falla igual y la venta va a la cola; con
// internet el servidor dice 401 y la venta también va a la cola, que la manda en
// cuanto la sesión esté renovada. Con la sesión al día, `getSession()` contesta
// al momento y todo es como siempre.
function tokenGuardado() {
  try {
    const clave = supabase.auth.storageKey
    if (!clave) return null
    const s = JSON.parse(localStorage.getItem(clave) || 'null')
    return s?.access_token || null
  } catch { return null }
}

export async function tokenSinEsperar(ms = 2500) {
  const deSesion = supabase.auth.getSession()
    .then(({ data }) => data?.session?.access_token || null)
    .catch(() => null)
  const r = await Promise.race([deSesion, new Promise((res) => setTimeout(() => res(undefined), ms))])
  if (r) return { token: r, deRespaldo: false }
  const guardado = tokenGuardado()
  return { token: guardado, deRespaldo: !!guardado }
}

export function leerCola(est) {
  try {
    const v = JSON.parse(localStorage.getItem(claveCola(est)) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

// Devuelve si se pudo guardar de verdad. 🔴 Antes un almacenamiento lleno se
// tragaba en silencio y la venta se daba por guardada sin estarlo (a6).
function guardarCola(est, lista) {
  let ok = true
  try { localStorage.setItem(claveCola(est), JSON.stringify(lista)) } catch { ok = false }
  // El banner del TPV escucha este evento para pintar el contador al momento.
  try { window.dispatchEvent(new CustomEvent('pidoo:cola-ventas', { detail: { est, n: lista.length } })) } catch { /* nada */ }
  return ok
}

export const ventasPendientes = (est) => leerCola(est).length
export const ventasAtascadas = (est) => leerCola(est).filter((v) => v.atascada).length
// { total, atascadas, fallando, conProblema, esperandoRed, importe_c, importeConProblema_c }
export const estadoCola = (est) => resumenCola(leerCola(est))

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
// Devuelve { n, guardada }: `guardada` falso = el aparato NO la ha podido
// guardar (almacenamiento lleno o bloqueado) y hay que apuntarla a mano.
export function encolarVenta(est, { payload, numeroOff, total_c, metodo, hora, lineas, carrito }) {
  const { lista, anadida } = anadirSiNoEsta(leerCola(est), nuevaEntrada({ payload, numeroOff, total_c, metodo, hora, lineas, carrito }))
  if (!anadida) return { n: lista.length, guardada: true }
  const guardada = guardarCola(est, lista)
  return { n: lista.length, guardada }
}

// Manda UNA venta. Nunca lanza: { errorRed } si no hubo respuesta, o
// { status, body } con lo que contestó (body null si no era JSON).
// Viaja con la hora real de la venta (`fecha_operacion`, a7): ver
// `cuerpoParaEnviar`.
async function enviarVenta(venta, token) {
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(), 30000)
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-venta`, {
      method: 'POST',
      signal: corte.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cuerpoParaEnviar(venta)),
    })
    marcarRedOk()
    const body = await resp.json().catch(() => null)
    // El servidor nuevo avisa si la hora no se pudo usar (reloj del aparato mal
    // puesto, o más de 72 h): la venta entra igual, con la hora de llegada.
    if (body?.aviso_fecha) console.warn('[colaVentas] La hora de la venta OFF-' + venta.numeroOff + ' no se ha usado:', body.aviso_fecha)
    return { status: resp.status, body }
  } catch {
    // Fallo de RED: seguimos sin internet de verdad. Se para y se reintenta
    // en el siguiente tick, sin marcar nada malo.
    avisarFalloRed()
    return { errorRed: true }
  } finally {
    clearTimeout(reloj)
  }
}

// Envía la cola en orden. Devuelve { ok, enviadas, sinRed, quedan, ...estado }.
// Una sola vuelta a la vez: quien llama mientras hay una en marcha recibe ESA
// misma (el cierre Z la espera en vez de cerrar a medias).
let enMarcha = null
export function sincronizarCola(est) {
  if (enMarcha) return enMarcha
  if (!leerCola(est).some((v) => !v.atascada)) {
    const r = estadoCola(est)
    return Promise.resolve({ ok: true, enviadas: 0, sinRed: false, quedan: r.total, ...r })
  }
  enMarcha = (async () => {
    // Sin esperar a renovar la sesión más de la cuenta (a5): la cola corre por
    // detrás, pero no puede quedarse medio minuto parada en cada vuelta.
    const { token } = await tokenSinEsperar(8000)
    return sincronizar({
      leer: () => leerCola(est),
      guardar: (lista) => guardarCola(est, lista),
      enviar: (venta) => enviarVenta(venta, token),
    })
  })().finally(() => { enMarcha = null })
  return enMarcha
}

// ¿Hay una vuelta mandando ventas ahora mismo? La pantalla «Ventas sin apuntar»
// no deja descartar nada mientras tanto.
export const sincronizandoAhora = () => !!enMarcha

// «Volver a intentar» desde «Ventas sin apuntar»: la venta (o todas las que
// tienen problema, sin clave) vuelve a la cola normal con el contador a cero y
// se manda. Si había una vuelta en marcha se espera a que acabe: esa vuelta
// eligió sus ventas al empezar y no llevaría esta.
export async function reintentarVenta(est, idempotencyKey = null) {
  let cola = leerCola(est)
  const claves = idempotencyKey
    ? [idempotencyKey]
    : cola.filter((v) => v.atascada || v.ultimoResultado === 'pasajero').map((v) => v.payload?.idempotency_key)
  for (const k of claves) cola = marcarParaReintentar(cola, k)
  guardarCola(est, cola)
  if (enMarcha) { try { await enMarcha } catch { /* da igual: se vuelve a intentar */ } }
  return sincronizarCola(est)
}

// Quitar a mano una venta de la cola (tras revisarla): solo desde la UI, nunca
// sola. No se tira: pasa a un archivo de descartadas en el aparato (las 200
// últimas), con el porqué, por si Pidoo tiene que recuperarla. `porque`:
// 'descartada' (la persona dice que no hay que apuntarla) o 'al_mostrador' (se
// vuelve a cobrar desde el mostrador con otra clave).
export function descartarVentaAtascada(est, idempotencyKey, porque = 'descartada') {
  const cola = leerCola(est)
  const venta = cola.find((v) => v.payload?.idempotency_key === idempotencyKey)
  if (venta) {
    try {
      const archivo = JSON.parse(localStorage.getItem(claveDescartadas(est)) || '[]')
      const lista = Array.isArray(archivo) ? archivo : []
      lista.push({ ...venta, descartada_at: new Date().toISOString(), porque })
      localStorage.setItem(claveDescartadas(est), JSON.stringify(lista.slice(-200)))
    } catch { /* sin sitio: se descarta igual, lo ha pedido una persona */ }
  }
  guardarCola(est, quitarDeCola(cola, idempotencyKey))
}

// El archivo de lo descartado en este aparato (lo más nuevo primero).
export function leerDescartadas(est) {
  try {
    const v = JSON.parse(localStorage.getItem(claveDescartadas(est)) || '[]')
    return Array.isArray(v) ? v.slice().reverse() : []
  } catch { return [] }
}
