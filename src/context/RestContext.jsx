import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { registerWebPush, unregisterWebPush } from '../lib/webPush'
import { registerPushNotifications, unregisterPushNotifications } from '../lib/pushNotifications'
import { establecerContextoImpresion, cargarImpresoras } from '../lib/printService'

const RestContext = createContext({})

export function RestProvider({ children }) {
  const [user, setUser] = useState(null)
  const [restaurante, setRestaurante] = useState(null)
  const [restauranteNotFound, setRestauranteNotFound] = useState(false)
  // Modulo TPV. Mismo gating que `carta_local_activa`: lo enciende Pidoo desde el
  // super-admin y aqui solo se lee. Si no hay fila, el modulo no esta contratado.
  const [tpvConfig, setTpvConfig] = useState(null)
  // Modulo Almacen (stock + escandallos). Mismo patron que el TPV: lo enciende
  // Pidoo y aqui solo se lee. Sin fila, el modulo no esta contratado.
  const [stockConfig, setStockConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchRestaurante(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchRestaurante(session.user.id)
      else { setRestaurante(null); setRestauranteNotFound(false); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Proactive session refresh — refresh 5 min before expiry (prevents 401 on sendPush)
  useEffect(() => {
    if (!user) return
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const msLeft = session.expires_at * 1000 - Date.now()
      if (msLeft < 5 * 60 * 1000) {
        await supabase.auth.refreshSession()
      }
    }
    const interval = setInterval(checkSession, 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.id])

  // MODO SIN INTERNET: con la red caída, supabase-js no lanza — devuelve
  // { data: null, error } — y la app se quedaba en "Cargando restaurante…"
  // para siempre. El último restaurante bueno se guarda en un espejo local y,
  // si al arrancar no hay red, se entra con él: el TPV puede seguir vendiendo.
  const claveEspejo = (uid) => `pidoo_espejo_restaurante_${uid}`

  function entrarConEspejo(userId) {
    try {
      const e = JSON.parse(localStorage.getItem(claveEspejo(userId)) || 'null')
      if (!e?.restaurante?.id) return false
      console.warn('[RestContext] Sin conexión: entrando con el espejo local del restaurante')
      setRestaurante(e.restaurante)
      setTpvConfig(e.tpvConfig || null)
      setStockConfig(e.stockConfig || null)
      establecerContextoImpresion(e.restaurante.id)
      return true
    } catch { return false }
  }

  async function fetchRestaurante(userId) {
    setRestauranteNotFound(false)
    try {
      // Verificar/asignar rol 'restaurante' en tabla usuarios
      const { data: perfil } = await supabase.from('usuarios').select('id, rol, created_at').eq('id', userId).single()
      if (perfil && perfil.rol !== 'restaurante') {
        setAuthError(`Esta cuenta está registrada como "${perfil.rol}". Usa una cuenta de restaurante.`)
        await supabase.auth.signOut()
        setUser(null)
        setRestaurante(null)
        setLoading(false)
        return
      }

      // Tres formas de encontrar el restaurante, en este orden:
      //   1. Es el DUEÑO (`establecimientos.user_id`). Lo normal.
      //   2. Por correo, que es como se ataban las cuentas antiguas.
      //   3. Es del EQUIPO (`establecimiento_usuarios`): varias personas en el mismo
      //      restaurante. Sin este tercer paso, un companero entra y se queda en
      //      "Cargando restaurante..." para siempre, aunque la RLS ya le deje ver
      //      todo lo demas.
      let { data } = await supabase.from('establecimientos').select('*').eq('user_id', userId).maybeSingle()
      if (!data) {
        const { data: userData } = await supabase.auth.getUser()
        const email = userData?.user?.email
        if (email) {
          const res = await supabase.from('establecimientos').select('*').eq('email', email).maybeSingle()
          data = res.data
        }
      }
      if (!data) {
        const { data: equipo } = await supabase
          .from('establecimiento_usuarios')
          .select('establecimiento_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle()
        if (equipo?.establecimiento_id) {
          const res = await supabase.from('establecimientos').select('*')
            .eq('id', equipo.establecimiento_id).maybeSingle()
          data = res.data
        }
      }
      setRestaurante(data)
      if (data) {
        // El modulo TPV se lee aqui una vez, con el restaurante: la pantalla de
        // cobro y la entrada del menu dependen de el. (Y se RELEE al volver la
        // app a primer plano — ver el efecto de abajo: antes, activar el modulo
        // con la tablet abierta exigia matar la app y volver a entrar.)
        // Cada lectura buena refresca el ESPEJO local: es con lo que se entra
        // el día que no haya internet.
        const guardarEspejo = (parcial) => {
          try {
            const prev = JSON.parse(localStorage.getItem(claveEspejo(userId)) || '{}')
            localStorage.setItem(claveEspejo(userId), JSON.stringify({ ...prev, restaurante: data, ...parcial }))
          } catch { /* lleno */ }
        }
        guardarEspejo({})
        supabase.from('tpv_config').select('*').eq('establecimiento_id', data.id).maybeSingle()
          .then(({ data: cfg, error }) => { if (!error) { setTpvConfig(cfg || null); guardarEspejo({ tpvConfig: cfg || null }) } })
        supabase.from('stock_config').select('*').eq('establecimiento_id', data.id).maybeSingle()
          .then(({ data: cfg, error }) => { if (!error) { setStockConfig(cfg || null); guardarEspejo({ stockConfig: cfg || null }) } })
        // Impresoras de la nube: se fija el establecimiento como contexto de
        // impresión y se precargan (deja espejo local para poder imprimir
        // aunque justo se caiga la red).
        establecerContextoImpresion(data.id)
        cargarImpresoras(data.id, { fresco: true }).catch(() => {})
        registerWebPush('restaurante', { establecimiento_id: data.id, user_id: userId })
        registerPushNotifications('restaurante', { establecimiento_id: data.id, user_id: userId })
      } else if (!navigator.onLine && entrarConEspejo(userId)) {
        // Sin red no se puede saber nada del servidor: se entra con lo último
        // bueno y el TPV sigue en modo local.
      } else {
        // Cuenta autenticada pero sin establecimiento vinculado: marcar
        // explicitamente "no encontrado" para no quedar en "Cargando..." infinito.
        setRestauranteNotFound(true)
      }
    } catch (err) {
      console.error('[RestContext] Error cargando restaurante:', err)
      if (!navigator.onLine) entrarConEspejo(userId)
    }
    setLoading(false)
  }

  // Los MÓDULOS (TPV, almacén) se refrescan al VOLVER A PRIMER PLANO: los
  // enciende Pidoo desde el super-admin y la tablet no se enteraba hasta matar
  // la app y volver a entrar. `visibilitychange` cubre la web, la app de
  // Windows y el WebView de Android sin depender de ningún plugin.
  useEffect(() => {
    if (!restaurante?.id) return
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      supabase.from('tpv_config').select('*').eq('establecimiento_id', restaurante.id).maybeSingle()
        .then(({ data: cfg }) => setTpvConfig(cfg || null))
      supabase.from('stock_config').select('*').eq('establecimiento_id', restaurante.id).maybeSingle()
        .then(({ data: cfg }) => setStockConfig(cfg || null))
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [restaurante?.id])

  async function updateRestaurante(updates) {
    if (!restaurante) return
    const { data, error } = await supabase
      .from('establecimientos')
      .update(updates)
      .eq('id', restaurante.id)
      .select()
      .single()
    if (!error && data) setRestaurante(data)
    return { data, error }
  }

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function registro(formData) {
    // Geocodificar la direccion en el cliente (tenemos la API key aqui).
    // El alta real (usuario + establecimiento) la hace la edge function
    // 'registrar-restaurante' con service role: con la confirmacion de email
    // activada, signUp NO devuelve sesion -> auth.uid() null -> el INSERT en
    // establecimientos viola RLS. La edge salta RLS y crea todo de forma atomica.
    let latitud, longitud
    try {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      if (apiKey && formData.direccion) {
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(formData.direccion.trim())}&key=${apiKey}`)
        const geoData = await geoRes.json()
        if (geoData.results?.length > 0) {
          latitud = geoData.results[0].geometry.location.lat
          longitud = geoData.results[0].geometry.location.lng
        }
      }
    } catch (e) { console.warn('[registro] geocoding fallo, la edge usara default:', e) }

    const { data, error } = await supabase.functions.invoke('registrar-restaurante', {
      body: {
        nombre: formData.nombre,
        email: formData.email,
        password: formData.password,
        tipo: formData.tipo || 'restaurante',
        categoria_padre: formData.categoria_padre || 'comida',
        telefono: formData.telefono || null,
        direccion: formData.direccion || null,
        descripcion: formData.descripcion || null,
        ...(typeof latitud === 'number' ? { latitud, longitud } : {}),
      },
    })
    if (error) throw new Error('No se pudo completar el registro. Revisa tu conexion e intenta de nuevo.')
    if (!data?.ok) throw new Error(data?.message || 'No se pudo completar el registro. Intenta de nuevo.')

    // Iniciar sesion para obtener sesion valida (email ya confirmado por la edge).
    // onAuthStateChange cargara el establecimiento recien creado.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    })
    if (signInErr) throw new Error('Cuenta creada correctamente. Inicia sesion con tu email y contrasena.')
    return data
  }

  async function logout() {
    if (restaurante?.id) {
      try { await unregisterWebPush('restaurante', { establecimiento_id: restaurante.id }) } catch {}
      try { await unregisterPushNotifications() } catch {}
    }
    await supabase.auth.signOut()
  }

  return (
    <RestContext.Provider value={{ user, restaurante, restauranteNotFound, loading, authError, setAuthError, login, registro, logout, updateRestaurante, tpvConfig, setTpvConfig, tpvActivo: !!tpvConfig?.activo && !tpvConfig?.pausado_por_restaurante, stockConfig, setStockConfig, stockActivo: !!stockConfig?.activo && !stockConfig?.pausado_por_restaurante, refetch: () => fetchRestaurante(user?.id) }}>
      {children}
    </RestContext.Provider>
  )
}

export const useRest = () => useContext(RestContext)
