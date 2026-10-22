// ¿HAY INTERNET DE VERDAD? (22 oct 2026, auditoría 05 · a4)
//
// `navigator.onLine` solo dice si el aparato tiene red LOCAL. En el corte más
// normal —el router sigue encendido y lo que se cae es la fibra— sigue diciendo
// que sí, y el TPV no se enteraba de que estaba sin internet hasta que un cobro
// se quedaba colgado medio minuto.
//
// Aquí se decide con lo que de verdad pasa, con dos reglas:
//   1. Cualquier RESPUESTA del servidor, aunque sea un error, es que hay
//      internet (`marcarRedOk`; la llama el fetch de Supabase en cada respuesta).
//   2. Un fallo de red suelto NO basta para pintar «Sin conexión»: puede ser un
//      tropiezo. Se hace una comprobación propia (`comprobarRed`) y solo si
//      TAMBIÉN falla se da la red por caída. Mientras lo esté, se vuelve a mirar
//      cada 15 s; la primera respuesta la levanta.
//
// Cada cambio se avisa con el evento `pidoo:red` ({ caida }): el banner del TPV,
// el turno, el restaurante y la cola de ventas lo escuchan.
//
// Este fichero no importa nada a propósito: así se puede probar con node
// (`npm run test:cola`). La dirección de la comprobación la pone `supabase.js`.

const CADA_MS = 15000      // con la red caída, cada cuánto se vuelve a mirar
const ESPERA_MS = 6000     // lo que se espera a la comprobación antes de darla por fallida

let urlSondeo = null
let caida = false
let caidaDesde = null
let enCurso = null
let reloj = null

export function configurarSondeo(url) { urlSondeo = url || null }

const hayVentana = () => typeof window !== 'undefined' && typeof window.dispatchEvent === 'function'

function avisar() {
  if (!hayVentana()) return
  try { window.dispatchEvent(new CustomEvent('pidoo:red', { detail: { caida: redCaida() } })) } catch { /* nada */ }
}

// ¿Está el aparato sin internet AHORA? Si el sistema dice que no hay red (wifi
// apagado, cable fuera) manda él; si dice que sí, manda lo comprobado.
export function redCaida() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return caida
}

export const redCaidaDesde = () => caidaDesde

// El servidor ha contestado algo: hay internet.
export function marcarRedOk() {
  if (!caida) return
  caida = false
  caidaDesde = null
  if (reloj) { clearTimeout(reloj); reloj = null }
  avisar()
}

function marcarCaida() {
  if (!caida) {
    caida = true
    caidaDesde = Date.now()
    avisar()
  }
  programar()
}

function programar() {
  if (reloj || !caida) return
  reloj = setTimeout(() => { reloj = null; comprobarRed() }, CADA_MS)
  // En node (pruebas) el reloj no puede dejar el proceso colgado.
  reloj?.unref?.()
}

// La comprobación propia. `no-cors` a propósito: la respuesta llega opaca, pero
// que LLEGUE ya demuestra que hay internet, y así ningún ajuste de CORS del
// servidor puede hacerla pasar por un corte. Devuelve true/false, o null si no
// hay forma de comprobar (sin dirección configurada).
async function sondear() {
  if (!urlSondeo || typeof fetch === 'undefined') return null
  const corte = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = setTimeout(() => corte?.abort(), ESPERA_MS)
  try {
    await fetch(urlSondeo + (urlSondeo.includes('?') ? '&' : '?') + '_=' + Date.now(), {
      mode: 'no-cors', cache: 'no-store', signal: corte?.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

// ¿Hay internet? Resuelve true/false. Una sola comprobación a la vez: quien
// llega mientras hay una en marcha espera a esa misma.
export function comprobarRed() {
  if (enCurso) return enCurso
  enCurso = (async () => {
    const ok = await sondear()
    if (ok === true) { marcarRedOk(); return true }
    // Sin forma de comprobar, el fallo que ha llegado hasta aquí manda.
    marcarCaida()
    return false
  })().finally(() => { enCurso = null })
  return enCurso
}

// Lo llama quien ve fallar una petición por la red. No pinta nada todavía:
// lanza la comprobación y es ella la que decide (regla 2).
export function avisarFalloRed() {
  comprobarRed().catch(() => {})
}

// ¿Este error es de RED (la petición no llegó o no volvió)? Sirve para separar
// «no hay internet» de «el servidor ha dicho que no».
export function esErrorDeRed(err) {
  if (!err) return false
  const nombre = String(err.name || '')
  if (nombre === 'AbortError' || nombre === 'TimeoutError' || nombre === 'AuthRetryableFetchError') return true
  return /failed to fetch|networkerror|network error|load failed|network request failed|fetch failed|err_internet_disconnected|err_name_not_resolved|err_connection|aborterror/i
    .test(String(err.message || ''))
}

// Para los resultados de supabase-js ({ data, error, status }): ¿falló SIN que el
// servidor llegara a decir nada que valga? `status` 0 es la red (supabase-js no
// lanza: devuelve el error con status 0); 5xx, 408 y 429 son el servidor caído o
// desbordado. Cualquier otro error es una respuesta de verdad («no existe», «no
// tienes permiso») y se trata como hasta ahora.
export function esFalloSinRespuesta(res) {
  if (!res?.error) return false
  const s = Number(res.status ?? res.error?.status)
  if (!Number.isFinite(s)) return esErrorDeRed(res.error)
  return s === 0 || s >= 500 || s === 408 || s === 429
}

// El sistema también avisa: wifi apagado / encendido. Al volver, se comprueba
// que haya internet de verdad antes de quitar el aviso.
if (hayVentana() && typeof window.addEventListener === 'function') {
  window.addEventListener('offline', () => avisar())
  window.addEventListener('online', () => { if (caida) comprobarRed(); else avisar() })
}
