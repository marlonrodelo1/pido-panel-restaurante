// EliminarCuenta — pantalla de borrado de cuenta del restaurante.
// Cumple requisito de Google Play / App Store (Data Safety).

import { useState } from 'react'
import { ArrowLeft, AlertCircle, XCircle, Check, ArrowRight, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export default function EliminarCuenta({ onBack }) {
  const { user, restaurante, logout } = useRest()
  const [paso, setPaso] = useState(1)
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
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      })
      if (authErr) throw new Error('Contraseña incorrecta')

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

      try { await logout() } catch (_) {}
      try { localStorage.setItem('pidoo_cuenta_eliminada', '1') } catch (_) {}
      try { sessionStorage.clear() } catch (_) {}
      window.location.replace('/')
    } catch (e) {
      setError(e.message || 'Error al eliminar la cuenta')
      setLoading(false)
    }
  }

  const itemsQuePasa = [
    'La suscripción Pidoo se cancela inmediatamente',
    'Tu URL pública se desactiva al instante',
    'Todos los datos del perfil se borran',
    'No hay forma de recuperar la cuenta',
  ]
  const itemsQueSeConserva = [
    'Las facturas ya emitidas (obligación legal)',
    'Los datos contables (art. 30 CCom · 6 años)',
    'Registro de pedidos finalizados anonimizado',
    'Tickets de soporte para resolución de incidencias',
  ]

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 80 }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none',
        color: colors.stone, fontSize: type.sm, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
        marginBottom: 18, padding: '6px 0',
      }}>
        <ArrowLeft size={14} /> Volver a ajustes
      </button>

      {/* Card danger-soft */}
      <div style={{
        background: colors.dangerSoft,
        border: 'none',
        borderRadius: 12,
        padding: 22,
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: '#fff', color: colors.danger,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <AlertCircle size={24} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.danger, letterSpacing: '-0.015em' }}>
              Eliminar cuenta
            </div>
            <div style={{ fontSize: type.sm, color: colors.danger, marginTop: 6, lineHeight: 1.5 }}>
              Esta acción es <b>irreversible</b>. Tu cuenta, datos y URL pública se eliminarán de forma permanente.
            </div>
          </div>
        </div>
      </div>

      {/* Listas 2-col */}
      <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <div>
            <div style={{ ...ds.sectionLabel, color: colors.danger }}>Qué pasará</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {itemsQuePasa.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: type.sm, color: colors.ink }}>
                  <XCircle size={15} style={{ color: colors.danger, flexShrink: 0, marginTop: 2 }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...ds.sectionLabel, color: colors.sage2 }}>Qué se conserva</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {itemsQueSeConserva.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: type.sm, color: colors.ink }}>
                  <Check size={15} style={{ color: colors.sage2, flexShrink: 0, marginTop: 2 }} />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {paso === 1 ? (
        <button onClick={() => setPaso(2)} style={{
          width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
          background: colors.danger, color: '#fff',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 700, fontSize: 15, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          Continuar con la eliminación <ArrowRight size={15} />
        </button>
      ) : (
        <div style={{ ...ds.card, padding: 22 }}>
          <div style={{ ...ds.h2, marginBottom: 16 }}>Confirma tu identidad</div>

          <label style={ds.label}>Email</label>
          <input
            value={user?.email || ''}
            readOnly
            style={{ ...ds.formInput, marginBottom: 14, color: colors.stone, background: colors.cream2 }}
          />

          <label style={ds.label}>Contraseña actual</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Tu contraseña actual"
            style={{ ...ds.formInput, marginBottom: 14 }}
          />

          <label style={ds.label}>Escribe ELIMINAR para confirmar</label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ELIMINAR"
            style={{
              ...ds.formInput,
              marginBottom: 14,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.04em',
            }}
          />

          <div style={{
            background: colors.dangerSoft,
            borderRadius: 10, padding: '10px 12px',
            fontSize: 12, color: colors.danger,
            marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={14} /> Última oportunidad para volver atrás.
          </div>

          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 8, marginBottom: 12,
              fontSize: 12, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setPaso(1)}
              disabled={loading}
              style={{ ...ds.ghostBtn, flex: 1, opacity: loading ? 0.5 : 1 }}
            >
              Cancelar
            </button>
            <button
              onClick={eliminar}
              disabled={loading}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                background: colors.danger, color: '#fff',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 700, fontSize: 14,
                cursor: loading ? 'default' : 'pointer',
                opacity: loading ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Trash2 size={14} /> {loading ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
