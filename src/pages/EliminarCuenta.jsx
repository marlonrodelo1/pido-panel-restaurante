// EliminarCuenta — pantalla de borrado de cuenta del restaurante.
// Cumple requisito de Google Play / App Store (Data Safety: cuenta eliminable
// desde la propia app sin pasar por web).
//
// Flujo: pide email + contraseña actual → re-autentica con signInWithPassword
// → invoca edge function eliminar_cuenta_restaurante → logout + redirect.
//
// La pantalla la abre Ajustes.jsx desde la "zona peligrosa" al final.

import { useState } from 'react'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export default function EliminarCuenta({ onBack }) {
  const { user, restaurante, logout } = useRest()
  const [paso, setPaso] = useState(1) // 1=aviso, 2=confirmacion con password
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const eliminar = async () => {
    setError(null)
    if (!password) { setError('Introduce tu contraseña actual'); return }
    if (confirmText.trim().toUpperCase() !== 'ELIMINAR') {
      setError('Escribe ELIMINAR para confirmar')
      return
    }

    setLoading(true)
    try {
      // 1) Re-autenticar con la contraseña actual para confirmar identidad
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      })
      if (authErr) throw new Error('Contraseña incorrecta')

      // 2) Llamar edge function (recoge JWT vigente)
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/eliminar_cuenta_restaurante`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ establecimiento_id: restaurante?.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo eliminar la cuenta')

      // 3) Logout + redirigir a Login con flag
      try { await logout() } catch (_) {}
      try { localStorage.setItem('pidoo_cuenta_eliminada', '1') } catch (_) {}
      try { sessionStorage.clear() } catch (_) {}
      window.location.replace('/')
    } catch (e) {
      setError(e.message || 'Error al eliminar la cuenta')
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 80 }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none',
        border: 'none', color: 'var(--c-text)', fontSize: 13, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16, padding: 0,
      }}>
        <ArrowLeft size={16} /> Volver
      </button>

      <div style={{
        background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
        borderRadius: 14, padding: 16, marginBottom: 16,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <AlertTriangle size={22} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#DC2626', marginBottom: 6 }}>
            Eliminar cuenta de restaurante
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
            Esta acción es <strong>irreversible</strong>. No podrás recuperar tu cuenta ni los datos asociados.
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--c-surface)', border: '1px solid var(--c-border)',
        borderRadius: 14, padding: 18, marginBottom: 16,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', marginBottom: 10 }}>
          Qué pasará al eliminar tu cuenta
        </div>
        <ul style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Tu cuenta de acceso se borrará por completo (email + contraseña).</li>
          <li>Tu restaurante dejará de aparecer en Pidoo y no recibirá más pedidos.</li>
          <li>Se eliminarán los tokens de notificaciones de tu dispositivo.</li>
          <li>Se eliminarán de Pidoo tu email, teléfono y datos fiscales.</li>
        </ul>

        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', margin: '14px 0 10px' }}>
          Qué se conserva (obligación legal)
        </div>
        <ul style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Histórico de pedidos completados (mín. 6 años — art. 30 Código de Comercio).</li>
          <li>Comisiones, facturas y movimientos contables anonimizados.</li>
        </ul>
      </div>

      {paso === 1 && (
        <button
          onClick={() => setPaso(2)}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
            background: '#DC2626', color: '#fff',
            fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Continuar con la eliminación
        </button>
      )}

      {paso === 2 && (
        <div style={{
          background: 'var(--c-surface)', border: '1px solid var(--c-border)',
          borderRadius: 14, padding: 18,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', marginBottom: 12 }}>
            Confirma con tu contraseña
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              value={user?.email || ''}
              readOnly
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--c-border)', background: 'var(--c-surface2)',
                color: 'var(--c-muted)', fontSize: 13, fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
              Contraseña actual
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                color: 'var(--c-text)', fontSize: 13, fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
              Escribe <strong style={{ color: '#DC2626' }}>ELIMINAR</strong> para confirmar
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ELIMINAR"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                color: 'var(--c-text)', fontSize: 13, fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(220,38,38,0.08)', color: '#DC2626',
              padding: '10px 12px', borderRadius: 8, marginBottom: 12,
              fontSize: 12, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setPaso(1)}
              disabled={loading}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                color: 'var(--c-text)', fontSize: 13, fontWeight: 700,
                cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={eliminar}
              disabled={loading}
              style={{
                flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
                background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 800,
                cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Eliminando…' : 'Eliminar cuenta permanentemente'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
