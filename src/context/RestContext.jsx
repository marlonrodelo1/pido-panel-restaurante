import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { registerWebPush } from '../lib/webPush'
import { registerPushNotifications } from '../lib/pushNotifications'

const RestContext = createContext({})

export function RestProvider({ children }) {
  const [user, setUser] = useState(null)
  const [restaurante, setRestaurante] = useState(null)
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
      else { setRestaurante(null); setLoading(false) }
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

  async function fetchRestaurante(userId) {
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

      // First try by user_id (new system), fallback to email (legacy)
      let { data } = await supabase.from('establecimientos').select('*').eq('user_id', userId).single()
      if (!data) {
        const { data: userData } = await supabase.auth.getUser()
        const email = userData?.user?.email
        if (email) {
          const res = await supabase.from('establecimientos').select('*').eq('email', email).single()
          data = res.data
        }
      }
      setRestaurante(data)
      if (data) {
        registerWebPush('restaurante', { establecimiento_id: data.id })
        registerPushNotifications('restaurante', { establecimiento_id: data.id })
      }
    } catch (err) {
      console.error('[RestContext] Error cargando restaurante:', err)
    }
    setLoading(false)
  }

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
    // Verificar email no existe en otros roles
    const { data: roleCheck } = await supabase.rpc('check_email_role', { check_email: formData.email })
    if (roleCheck?.exists) throw new Error(`Este email ya está registrado como ${roleCheck.role}. Usa otro email.`)

    // Crear auth user
    const { data, error } = await supabase.auth.signUp({ email: formData.email, password: formData.password, options: { data: { nombre: formData.nombre, rol: 'restaurante' } } })
    if (error) throw error

    // Crear establecimiento con user_id
    const { error: estError } = await supabase.from('establecimientos').insert({
      user_id: data.user?.id,
      nombre: formData.nombre,
      tipo: formData.tipo || 'restaurante',
      categoria_padre: formData.categoria_padre || 'comida',
      email: formData.email,
      telefono: formData.telefono || null,
      direccion: formData.direccion || null,
      descripcion: formData.descripcion || null,
      activo: true,
      rating: 0,
      total_resenas: 0,
      latitud: null,
      longitud: null,
      radio_cobertura_km: 10,
    })
    if (estError) {
      // Rollback: eliminar el usuario auth huerfano
      try { await supabase.auth.admin?.deleteUser(data.user?.id) } catch {}
      // Al menos cerrar la sesion para que no quede logueado sin establecimiento
      await supabase.auth.signOut()
      throw new Error('Error al crear el establecimiento. Intenta de nuevo.')
    }
    return data
  }

  async function logout() { await supabase.auth.signOut() }

  return (
    <RestContext.Provider value={{ user, restaurante, loading, authError, setAuthError, login, registro, logout, updateRestaurante, refetch: () => fetchRestaurante(user?.id) }}>
      {children}
    </RestContext.Provider>
  )
}

export const useRest = () => useContext(RestContext)
