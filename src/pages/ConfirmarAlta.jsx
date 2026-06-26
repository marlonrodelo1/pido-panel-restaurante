import { useState, useEffect } from 'react'
import { Utensils, CheckCircle2, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { colors, type, ds } from '../lib/uiStyles'

// Pantalla de confirmación de alta para restaurantes invitados por un socio.
// El socio crea el restaurante (edge function socio-crear-restaurante) → el restaurante
// recibe un email de invitación → este es el destino (panel.pidoo.es/confirmar-alta).
// detectSessionInUrl (activo por defecto en el cliente) capta el token del hash y deja
// sesión iniciada. Aquí el restaurante crea su contraseña y marca alta_confirmada_at.

const PASS_RE = /^(?=.*[A-Z])(?=.*\d).{8,}$/
const FONT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`

export default function ConfirmarAlta() {
  const [estado, setEstado] = useState('cargando') // cargando | form | invalido | hecho
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let done = false
    const aplicarSesion = (session) => {
      if (done || !session?.user) return
      setEmail(session.user.email || '')
      setNombre(session.user.user_metadata?.nombre || '')
      setEstado('form')
    }
    supabase.auth.getSession().then(({ data }) => aplicarSesion(data?.session))
    // detectSessionInUrl puede tardar un instante en procesar el hash del enlace
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => aplicarSesion(session))
    // Si tras 4s no hay sesión, el enlace no es válido o caducó
    const t = setTimeout(() => setEstado(prev => (prev === 'cargando' ? 'invalido' : prev)), 4000)
    return () => { done = true; sub?.subscription?.unsubscribe?.(); clearTimeout(t) }
  }, [])

  const submit = async () => {
    if (!PASS_RE.test(password)) { setError('La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número.'); return }
    if (password !== password2) { setError('Las contraseñas no coinciden.'); return }
    setError(null); setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('Tu sesión no es válida. Vuelve a abrir el enlace del email.')
      const { error: upErr } = await supabase.auth.updateUser({ password })
      if (upErr) throw new Error(upErr.message)
      // Marcar la confirmación (Puerta A). RLS: el dueño puede actualizar su establecimiento.
      const { error: estErr } = await supabase.from('establecimientos')
        .update({ alta_confirmada_at: new Date().toISOString() })
        .eq('user_id', session.user.id)
      if (estErr) console.error('[ConfirmarAlta] no se pudo marcar alta_confirmada_at', estErr)
      setEstado('hecho')
    } catch (e) {
      setError(e.message || 'No se pudo completar el alta.')
    } finally { setLoading(false) }
  }

  const wrap = {
    minHeight: '100vh', background: colors.cream,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '32px 20px',
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  }
  const card = {
    background: colors.paper, borderRadius: 16, padding: 26,
    border: `1px solid ${colors.border}`, boxShadow: colors.shadow, width: '100%', maxWidth: 420,
  }

  if (estado === 'cargando') {
    return (
      <div style={wrap}><style>{FONT_CSS}</style>
        <div style={{ fontSize: type.sm, color: colors.stone, fontWeight: 600 }}>Verificando tu invitación…</div>
      </div>
    )
  }

  if (estado === 'invalido') {
    return (
      <div style={wrap}><style>{FONT_CSS}</style>
        <div style={card}>
          <h1 style={{ ...ds.h1, margin: 0, marginBottom: 8 }}>Enlace no válido</h1>
          <p style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5, marginBottom: 18 }}>
            El enlace de invitación no es válido o ha caducado. Pide a tu socio en Pidoo que te reenvíe la invitación.
          </p>
          <button onClick={() => window.location.assign('/')} style={{ ...ds.glossyBtn, width: '100%', height: 46 }}>
            Ir al inicio de sesión
          </button>
        </div>
      </div>
    )
  }

  if (estado === 'hecho') {
    return (
      <div style={wrap}><style>{FONT_CSS}</style>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{
            width: 60, height: 60, borderRadius: 999, background: colors.sageSoft, color: colors.sage2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <CheckCircle2 size={30} strokeWidth={2} />
          </div>
          <h1 style={{ ...ds.h1, margin: 0, marginBottom: 8 }}>¡Alta confirmada!</h1>
          <p style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5, marginBottom: 18 }}>
            Ya puedes entrar a tu panel y preparar tu carta. El equipo Pidoo verificará tu restaurante
            antes de que aparezca público en el marketplace.
          </p>
          <button onClick={() => window.location.assign('/')} style={{ ...ds.glossyBtn, width: '100%', height: 46 }}>
            Ir a mi panel
          </button>
        </div>
      </div>
    )
  }

  // estado === 'form'
  return (
    <div style={wrap}><style>{FONT_CSS}</style>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: `linear-gradient(135deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
            color: colors.cream, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: colors.shadowMd,
          }}>
            <Utensils size={28} strokeWidth={2} />
          </div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Confirma tu restaurante</h1>
          {nombre && (
            <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginTop: 6 }}>{nombre}</div>
          )}
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 6 }}>
            Cuenta: <strong style={{ color: colors.ink }}>{email}</strong>
          </div>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
            Crea tu contraseña para terminar el alta y entrar a tu panel.
          </div>
        </div>

        <div style={card}>
          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Contraseña</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres, 1 mayúscula y 1 número"
              style={ds.formInput}
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={ds.label}>Repite la contraseña</label>
            <input
              type="password" value={password2}
              onChange={e => setPassword2(e.target.value)}
              placeholder="Vuelve a escribirla"
              style={ds.formInput}
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
          </div>

          {error && (
            <div style={{
              color: colors.danger, fontSize: 12, marginBottom: 12, textAlign: 'center',
              background: colors.dangerSoft, padding: '10px 12px', borderRadius: 8,
            }}>{error}</div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            style={{ ...ds.glossyBtn, width: '100%', height: 46, opacity: loading ? 0.5 : 1 }}
          >
            <Lock size={15} strokeWidth={2} />
            {loading ? 'Guardando…' : 'Crear contraseña y entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
