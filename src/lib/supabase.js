import { createClient } from '@supabase/supabase-js'
import { configurarSondeo, marcarRedOk, avisarFalloRed, renovacionSeReintenta, sesionSinRenovarDe } from './estadoRed'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('[Supabase] Faltan variables de entorno: VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

const urlDe = (input) => (typeof input === 'string' ? input : (input?.url || String(input || '')))

// MODO SIN INTERNET (a4, 22 oct 2026): cada petición a Supabase cuenta como
// prueba de si hay internet. Una respuesta (la que sea) = hay red; un fallo de
// red = que `estadoRed` lo compruebe. El fetch es el de siempre: aquí se MIRA, y
// lo que se manda y lo que vuelve no cambia… con UNA excepción:
//
// 🔴 LA RENOVACIÓN DE LA SESIÓN CON EL SERVIDOR DE SESIONES CAÍDO (revisión del
// 24 oct 2026). Si la renovación recibe un 500, un 52x de Cloudflare o una página
// HTML, supabase-js da la sesión por rechazada y la BORRA: el TPV salta a la
// pantalla de entrar en mitad del servicio, y para volver hace falta la contraseña
// del dueño e internet. Esa respuesta se le pasa como un 503 (que sí sabe
// reintentar): la sesión se queda en el aparato y se renueva sola cuando el
// servidor vuelva. Un rechazo de verdad (400/401 en JSON) pasa tal cual. Con el
// servidor bien, la renovación contesta 200 y esto no hace nada.
const fetchVigilado = (input, init) => fetch(input, init).then(
  async (resp) => {
    marcarRedOk()
    if (!resp.ok && renovacionSeReintenta({
      url: urlDe(input), status: resp.status, contentType: resp.headers?.get?.('content-type'),
    })) {
      console.warn('[Supabase] La renovación de la sesión ha fallado en el servidor (HTTP ' + resp.status + '): se reintentará, la sesión se queda')
      const texto = await resp.text().catch(() => '')
      return new Response(texto, { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/plain' } })
    }
    return resp
  },
  (err) => {
    // Un corte pedido por el propio código (AbortController) no es la red.
    if (err?.name !== 'AbortError') avisarFalloRed()
    throw err
  },
)

configurarSondeo(url ? url.replace(/\/+$/, '') + '/auth/v1/health' : null)

export const supabase = createClient(url, key, { global: { fetch: fetchVigilado } })

// ¿Lo que acaba de contestar el servidor puede haber viajado SIN la sesión?
// (revisión del 24 oct 2026, ver `sesionSinRenovarDe` en estadoRed.js). Con la
// sesión caducada y sin poder renovarla, las tablas privadas devuelven «0 filas»
// sin error: quien lee algo del aparato que no puede quedarse vacío por error
// (tpv_config, el turno, las impresoras, el restaurante del equipo) lo trata
// entonces como «sin respuesta» y no toca lo que tiene ni la copia guardada.
export function sesionSinRenovar() {
  try {
    const clave = supabase.auth.storageKey
    if (!clave) return false
    return sesionSinRenovarDe(JSON.parse(localStorage.getItem(clave) || 'null'))
  } catch { return false }
}
