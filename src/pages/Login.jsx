import { useState, useEffect, useRef } from 'react'
import { useRest } from '../context/RestContext'
import { supabase } from '../lib/supabase'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
)

const TIPOS = [
  { id: 'restaurante', l: '🍽️ Restaurante' }, { id: 'cafeteria', l: '☕ Cafetería' },
  { id: 'pizzeria', l: '🍕 Pizzería' }, { id: 'hamburgueseria', l: '🍔 Hamburguesería' },
  { id: 'sushi', l: '🍣 Sushi' }, { id: 'panaderia', l: '🥐 Panadería' },
  { id: 'minimarket', l: '🛒 Minimarket' }, { id: 'farmacia', l: '💊 Farmacia' },
  { id: 'otro', l: '🏪 Otro' },
]

function LegalModal({ slug, onClose }) {
  const [contenido, setContenido] = useState(null)
  const [titulo, setTitulo] = useState('')

  useEffect(() => {
    supabase.from('paginas_legales').select('titulo, contenido').eq('slug', slug).single()
      .then(({ data }) => {
        if (data) { setTitulo(data.titulo); setContenido(data.contenido) }
        else setContenido('Contenido no disponible.')
      })
  }, [slug])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1A1A1A', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#F5F5F5' }}>{titulo || '...'}</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#F5F5F5', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {contenido === null ? 'Cargando...' : contenido}
        </div>
      </div>
    </div>
  )
}

function ResetPassword({ email, setEmail, onBack, inp }) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const handleReset = async () => {
    if (!email.trim()) { setError('Introduce tu email'); return }
    setError(null); setLoading(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'https://pidoo.es/reset-password',
      })
      if (err) throw err
      setSent(true)
    } catch (err) {
      if (err.message?.includes('rate limit')) setError('Demasiados intentos. Espera unos minutos.')
      else setError(err.message || 'Error al enviar el email')
    } finally { setLoading(false) }
  }

  if (sent) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 8 }}>Email enviado</div>
        <p style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5, marginBottom: 20 }}>
          Hemos enviado un enlace a <strong style={{ color: 'var(--c-text)' }}>{email}</strong> para restablecer tu contraseña. Revisa tu bandeja de entrada y spam.
        </p>
        <button onClick={onBack} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: 'var(--c-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Volver al login
        </button>
      </div>
    )
  }

  return (
    <>
      <input placeholder="Tu email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} onKeyDown={e => e.key === 'Enter' && handleReset()} />
      {error && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 10, textAlign: 'center', background: 'rgba(220,38,38,0.1)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
      <button onClick={handleReset} disabled={loading} style={{ width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', background: loading ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
        {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
      </button>
      <button onClick={onBack} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}>
        Volver al login
      </button>
    </>
  )
}

export default function Login() {
  const { login, registro, authError, setAuthError } = useRest()
  const [modo, setModo] = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [loginBloqueado, setLoginBloqueado] = useState(false)
  const [bloqueadoSegundos, setBloqueadoSegundos] = useState(0)
  const intentosFallidos = useRef(0)
  const bloqueadoTimer = useRef(null)

  // Mostrar error de rol incorrecto del context
  useEffect(() => {
    if (authError) { setError(authError); setAuthError(null) }
  }, [authError])
  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [legalSlug, setLegalSlug] = useState(null)

  // Login
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Registro
  const [form, setForm] = useState({
    nombre: '', tipo: 'restaurante', categoria_padre: 'comida',
    email: '', password: '', telefono: '', direccion: '', descripcion: '',
  })

  function traducirError(msg) {
    if (!msg) return 'Error desconocido'
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos'
    if (msg.includes('Email not confirmed')) return 'Debes confirmar tu email antes de iniciar sesión'
    if (msg.includes('User already registered')) return 'Este email ya está registrado. Intenta iniciar sesión.'
    if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número'
    if (msg.includes('Unable to validate email')) return 'El formato del email no es válido'
    if (msg.includes('Email rate limit exceeded')) return 'Demasiados intentos. Espera unos minutos.'
    if (msg.includes('For security purposes')) return 'Demasiados intentos. Espera unos segundos.'
    if (msg.includes('Network')) return 'Error de conexión. Verifica tu internet.'
    return msg
  }

  function iniciarBloqueo(segundos) {
    setLoginBloqueado(true)
    setBloqueadoSegundos(segundos)
    const intervalo = setInterval(() => {
      setBloqueadoSegundos(s => {
        if (s <= 1) { clearInterval(intervalo); setLoginBloqueado(false); return 0 }
        return s - 1
      })
    }, 1000)
    bloqueadoTimer.current = intervalo
  }

  const handleLogin = async () => {
    if (loginBloqueado) return
    setError(null); setLoading(true)
    try {
      await login(email, password)
      intentosFallidos.current = 0
    } catch (err) {
      intentosFallidos.current += 1
      setError(traducirError(err.message))
      if (intentosFallidos.current >= 5) {
        intentosFallidos.current = 0
        iniciarBloqueo(60)
        setError('Demasiados intentos fallidos. Espera 60 segundos.')
      } else {
        iniciarBloqueo(5)
      }
    } finally { setLoading(false) }
  }

  const handleRegistro = async () => {
    setError(null)
    if (!form.nombre.trim()) { setError('El nombre del negocio es obligatorio'); return }
    if (!form.email.trim()) { setError('El email es obligatorio'); return }
    if (!form.password || !/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(form.password)) { setError('La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número'); return }
    if (!aceptaTerminos) { setError('Debes aceptar los términos y condiciones'); return }
    setLoading(true)
    try { await registro(form) }
    catch (err) { setError(traducirError(err.message)) }
    finally { setLoading(false) }
  }

  const inp = { width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--c-border)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box' }
  const sel = { ...inp, appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 36 }
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', marginBottom: 4, display: 'block' }

  return (
    <>
    {legalSlug && <LegalModal slug={legalSlug} onClose={() => setLegalSlug(null)} />}
    <div style={{ padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🍽️</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--c-text)', marginBottom: 4 }}>Panel Restaurante</div>
      <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 24 }}>{modo === 'login' ? 'Gestiona tus pedidos y carta' : modo === 'reset' ? 'Recupera el acceso a tu cuenta' : 'Registra tu negocio en PIDOO'}</p>

      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Tabs */}
        {modo !== 'reset' && (
          <div style={{ display: 'flex', background: 'var(--c-surface2)', borderRadius: 12, padding: 3, marginBottom: 20 }}>
            {['login', 'registro'].map(m => (
              <button key={m} onClick={() => { setModo(m); setError(null) }} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: modo === m ? 'var(--c-primary)' : 'transparent',
                color: modo === m ? '#fff' : 'var(--c-muted)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{m === 'login' ? 'Iniciar sesión' : 'Registrarse'}</button>
            ))}
          </div>
        )}

        {modo === 'login' ? (
          <>
            <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} onKeyDown={e => e.key === 'Enter' && !loginBloqueado && handleLogin()} />
            <input placeholder="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} style={inp} onKeyDown={e => e.key === 'Enter' && !loginBloqueado && handleLogin()} />
            {error && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 10, textAlign: 'center', background: 'rgba(220,38,38,0.1)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
            <button onClick={handleLogin} disabled={loading || loginBloqueado} style={{ width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', background: loading || loginBloqueado ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: loading || loginBloqueado ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Entrando...' : loginBloqueado ? 'Espera ' + bloqueadoSegundos + 's...' : 'Entrar'}
            </button>
            <button onClick={() => { setModo('reset'); setError(null) }} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: 'var(--c-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8 }}>
              ¿Olvidaste tu contraseña?
            </button>
          </>
        ) : modo === 'reset' ? (
          <ResetPassword email={email} setEmail={setEmail} onBack={() => { setModo('login'); setError(null) }} inp={inp} />
        ) : (
          <>
            <div style={{ marginBottom: 10 }}><label style={lbl}>Nombre del negocio *</label><input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: La Pizzeria del Puerto" style={inp} /></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>Tipo</label><select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={sel}>{TIPOS.map(t => <option key={t.id} value={t.id}>{t.l}</option>)}</select></div>
              <div style={{ flex: 1 }}><label style={lbl}>Categoría</label><select value={form.categoria_padre} onChange={e => setForm({ ...form, categoria_padre: e.target.value })} style={sel}>
                <option value="comida">🍕 Comida</option><option value="farmacia">💊 Farmacia</option><option value="marketplace">🛒 Marketplace</option>
              </select></div>
            </div>
            <div style={{ marginBottom: 10 }}><label style={lbl}>Email *</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="tu@email.com" style={inp} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl}>Contraseña *</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mín. 8 caracteres, 1 mayúscula y 1 número" style={inp} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl}>Teléfono</label><input type="tel" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="+34 600 000 000" style={inp} /></div>
            <div style={{ marginBottom: 10 }}><label style={lbl}>Dirección</label><input value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} placeholder="Dirección del negocio" style={inp} /></div>

            {/* Términos */}
            <button onClick={() => setAceptaTerminos(!aceptaTerminos)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, marginBottom: 14 }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1, border: aceptaTerminos ? 'none' : '2px solid rgba(255,255,255,0.2)', background: aceptaTerminos ? 'var(--c-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>{aceptaTerminos && '✓'}</div>
              <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4 }}>
                Acepto los{' '}
                <button type="button" onClick={e => { e.stopPropagation(); setLegalSlug('terminos-restaurantes') }} style={{ color: 'var(--c-primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>términos y condiciones</button>
                {' '}y la{' '}
                <button type="button" onClick={e => { e.stopPropagation(); setLegalSlug('privacidad-restaurantes') }} style={{ color: 'var(--c-primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}>política de privacidad</button>
              </span>
            </button>

            {error && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 10, textAlign: 'center', background: 'rgba(220,38,38,0.1)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
            <button onClick={handleRegistro} disabled={loading} style={{ width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', background: loading ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Creando...' : 'Registrar negocio'}
            </button>
          </>
        )}

        {/* Google */}
        {modo !== 'reset' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
              <span style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600 }}>o</span>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
            </div>
            <button onClick={async () => {
              if (Capacitor.isNativePlatform()) {
                const { data } = await supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: { redirectTo: 'com.pido.restaurante://login', skipBrowserRedirect: true },
                })
                if (data?.url) await Browser.open({ url: data.url })
              } else {
                supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
              }
            }} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-text)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <GoogleIcon /> Continuar con Google
            </button>
          </>
        )}
      </div>
    </div>
    </>
  )
}
