import { useState, useEffect, useRef } from 'react'
import { useRest } from '../context/RestContext'
import { supabase } from '../lib/supabase'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
)

const UtensilsIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
  </svg>
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-surface2)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--c-border)', borderBottom: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-text)' }}>{titulo || '...'}</span>
          <button onClick={onClose} style={{ background: 'var(--c-surface2)', border: 'none', color: 'var(--c-text)', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {contenido === null ? 'Cargando...' : contenido}
        </div>
      </div>
    </div>
  )
}

function ResetPassword({ email, setEmail, onBack }) {
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
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 8 }}>Email enviado</div>
        <p style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5, marginBottom: 20 }}>
          Hemos enviado un enlace a <strong style={{ color: 'var(--c-text)' }}>{email}</strong> para restablecer tu contraseña.
        </p>
        <button onClick={onBack} style={btnPrimary}>Volver al login</button>
      </div>
    )
  }

  return (
    <>
      <InputField type="email" placeholder="Tu email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleReset()} />
      {error && <ErrorBox msg={error} />}
      <button onClick={handleReset} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
        {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
      </button>
      <button onClick={onBack} style={btnGhost}>← Volver al login</button>
    </>
  )
}

// ── Estilos reutilizables ─────────────────────────────────────────────────────
const btnPrimary = {
  width: '100%', padding: '15px 0', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)',
  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 8, letterSpacing: '0.02em',
}
const btnGhost = {
  width: '100%', padding: '13px 0', borderRadius: 8,
  border: '1px solid var(--c-border)', background: 'transparent',
  color: 'var(--c-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const sectionLabel = {
  fontSize: 11, fontWeight: 700, color: 'var(--c-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block',
}

function InputField({ label, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={sectionLabel}>{label}</label>}
      <input
        {...props}
        onFocus={e => { setFocused(true); props.onFocus?.(e) }}
        onBlur={e => { setFocused(false); props.onBlur?.(e) }}
        style={{
          width: '100%', padding: '13px 14px', borderRadius: 8,
          border: `1px solid ${focused ? 'var(--c-primary)' : 'var(--c-border)'}`,
          fontSize: 14, fontFamily: 'inherit',
          background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none',
          boxSizing: 'border-box', transition: 'border-color 0.2s',
          ...props.style,
        }}
      />
    </div>
  )
}

function SelectField({ label, children, value, onChange, style }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={sectionLabel}>{label}</label>}
      <select value={value} onChange={onChange} style={{
        width: '100%', padding: '13px 14px', borderRadius: 8,
        border: '1px solid var(--c-border)',
        fontSize: 14, fontFamily: 'inherit',
        background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none',
        boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 36,
        ...style,
      }}>{children}</select>
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div style={{
      color: 'var(--c-primary)', fontSize: 12, marginBottom: 12, textAlign: 'center',
      background: 'var(--c-primary-light)', padding: '10px 14px', borderRadius: 8,
      border: '1px solid var(--c-primary-soft)',
    }}>{msg}</div>
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

  useEffect(() => {
    if (authError) { setError(authError); setAuthError(null) }
  }, [authError])

  const [aceptaTerminos, setAceptaTerminos] = useState(false)
  const [legalSlug, setLegalSlug] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

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

  return (
    <>
      {legalSlug && <LegalModal slug={legalSlug} onClose={() => setLegalSlug(null)} />}
      <div style={{
        minHeight: '100vh', background: 'var(--c-bg)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '32px 20px',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Logo + título */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 16,
              background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(255,107,44,0.30)',
            }}>
              <UtensilsIcon />
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.02em', marginBottom: 2 }}>PIDO</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Panel Restaurante</div>
          </div>

          {/* Card contenedor */}
          <div style={{ background: 'var(--c-surface)', borderRadius: 16, padding: '28px 24px', border: '1px solid var(--c-border)' }}>

            {modo === 'reset' ? (
              <>
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4 }}>Recuperar acceso</h2>
                  <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>Te enviaremos un enlace a tu email.</p>
                </div>
                <ResetPassword email={email} setEmail={setEmail} onBack={() => { setModo('login'); setError(null) }} />
              </>
            ) : (
              <>
                {/* Encabezado */}
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4 }}>
                    {modo === 'login' ? 'Bienvenido de nuevo' : 'Registra tu negocio'}
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--c-muted)' }}>
                    {modo === 'login' ? 'Gestiona tu operación en tiempo real.' : 'Crea tu cuenta en PIDOO y empieza a recibir pedidos.'}
                  </p>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', background: 'var(--c-surface2)', borderRadius: 8, padding: 3, marginBottom: 20, gap: 3 }}>
                  {['login', 'registro'].map(m => (
                    <button key={m} onClick={() => { setModo(m); setError(null) }} style={{
                      flex: 1, padding: '9px 0', borderRadius: 6, border: 'none',
                      background: modo === m ? 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)' : 'transparent',
                      color: modo === m ? '#fff' : 'var(--c-muted)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.2s',
                    }}>{m === 'login' ? 'Iniciar sesión' : 'Registrarse'}</button>
                  ))}
                </div>

                {modo === 'login' ? (
                  <>
                    <InputField type="email" placeholder="Email del restaurante" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loginBloqueado && handleLogin()} />

                    {/* Password con toggle */}
                    <div style={{ marginBottom: 12, position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Contraseña"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !loginBloqueado && handleLogin()}
                        style={{
                          width: '100%', padding: '13px 44px 13px 14px', borderRadius: 8,
                          border: '1px solid var(--c-border)',
                          fontSize: 14, fontFamily: 'inherit',
                          background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                      <button onClick={() => setShowPassword(!showPassword)} style={{
                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', color: 'var(--c-muted)', cursor: 'pointer',
                        fontSize: 10, fontWeight: 700, padding: 4, fontFamily: 'inherit', letterSpacing: '0.04em',
                      }}>{showPassword ? 'OCULTAR' : 'VER'}</button>
                    </div>

                    {/* Requisitos de seguridad */}
                    <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--c-surface2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Requisitos de seguridad</div>
                      {[
                        { label: 'Mínimo 8 caracteres', ok: password.length >= 8 },
                        { label: '1 letra mayúscula', ok: /[A-Z]/.test(password) },
                        { label: '1 número', ok: /\d/.test(password) },
                      ].map(r => (
                        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <div style={{ width: 4, height: 4, borderRadius: 2, background: r.ok ? '#16A34A' : 'var(--c-border)', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: r.ok ? '#16A34A' : 'var(--c-muted)' }}>{r.label}</span>
                        </div>
                      ))}
                    </div>

                    {error && <ErrorBox msg={error} />}

                    <button onClick={handleLogin} disabled={loading || loginBloqueado} style={{ ...btnPrimary, opacity: loading || loginBloqueado ? 0.6 : 1, marginBottom: 8 }}>
                      {loading ? 'Entrando...' : loginBloqueado ? `Espera ${bloqueadoSegundos}s...` : 'Iniciar sesión →'}
                    </button>

                    <button onClick={() => { setModo('reset'); setError(null) }} style={{ width: '100%', padding: '8px 0', background: 'none', border: 'none', color: 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
                      ¿Olvidaste tu contraseña?
                    </button>
                  </>
                ) : (
                  <>
                    <InputField label="Nombre del negocio *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: La Pizzeria del Puerto" />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <SelectField label="Tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                          {TIPOS.map(t => <option key={t.id} value={t.id}>{t.l}</option>)}
                        </SelectField>
                      </div>
                      <div style={{ flex: 1 }}>
                        <SelectField label="Categoría" value={form.categoria_padre} onChange={e => setForm({ ...form, categoria_padre: e.target.value })}>
                          <option value="comida">🍕 Comida</option>
                          <option value="farmacia">💊 Farmacia</option>
                          <option value="marketplace">🛒 Marketplace</option>
                        </SelectField>
                      </div>
                    </div>
                    <InputField label="Email *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="tu@email.com" />
                    <InputField label="Contraseña *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mín. 8 caracteres, 1 mayúscula y 1 número" />
                    <InputField label="Teléfono" type="tel" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="+34 600 000 000" />
                    <InputField label="Dirección" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} placeholder="Dirección del negocio" />

                    {/* Términos */}
                    <button onClick={() => setAceptaTerminos(!aceptaTerminos)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, marginBottom: 16 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1, border: aceptaTerminos ? 'none' : '2px solid var(--c-border)', background: aceptaTerminos ? 'var(--c-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff' }}>{aceptaTerminos && '✓'}</div>
                      <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4 }}>
                        Acepto los{' '}
                        <button type="button" onClick={e => { e.stopPropagation(); setLegalSlug('terminos-restaurantes') }} style={{ color: 'var(--c-primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0 }}>términos y condiciones</button>
                        {' '}y la{' '}
                        <button type="button" onClick={e => { e.stopPropagation(); setLegalSlug('privacidad-restaurantes') }} style={{ color: 'var(--c-primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0 }}>política de privacidad</button>
                      </span>
                    </button>

                    {error && <ErrorBox msg={error} />}
                    <button onClick={handleRegistro} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
                      {loading ? 'Creando...' : 'Registrar negocio'}
                    </button>
                  </>
                )}

                {/* Google */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
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
                }} style={btnGhost}>
                  <GoogleIcon /> Continuar con Google
                </button>
              </>
            )}
          </div>

          {/* Footer seguridad */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>Encriptación AES-256</div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>Soporte 24/7</div>
          </div>
        </div>
      </div>
    </>
  )
}
