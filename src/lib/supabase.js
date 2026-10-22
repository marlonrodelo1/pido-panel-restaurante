import { createClient } from '@supabase/supabase-js'
import { configurarSondeo, marcarRedOk, avisarFalloRed } from './estadoRed'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('[Supabase] Faltan variables de entorno: VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

// MODO SIN INTERNET (a4, 22 oct 2026): cada petición a Supabase cuenta como
// prueba de si hay internet. Una respuesta (la que sea) = hay red; un fallo de
// red = que `estadoRed` lo compruebe. El fetch es el de siempre: aquí solo se
// MIRA, no se cambia nada de lo que se manda ni de lo que vuelve.
const fetchVigilado = (input, init) => fetch(input, init).then(
  (resp) => { marcarRedOk(); return resp },
  (err) => {
    // Un corte pedido por el propio código (AbortController) no es la red.
    if (err?.name !== 'AbortError') avisarFalloRed()
    throw err
  },
)

configurarSondeo(url ? url.replace(/\/+$/, '') + '/auth/v1/health' : null)

export const supabase = createClient(url, key, { global: { fetch: fetchVigilado } })
