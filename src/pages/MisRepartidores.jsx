import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const ESTADOS = {
  pendiente: { label: 'Pendiente', bg: colors.statePrepSoft, color: colors.statePrep },
  activa: { label: 'Aprobado', bg: colors.stateOkSoft, color: colors.stateOk },
  rechazada: { label: 'Rechazado', bg: colors.dangerSoft, color: colors.danger },
}

export default function MisRepartidores() {
  const { restaurante } = useRest()
  const [vinc, setVinc] = useState([])
  const [status, setStatus] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState('todos')

  useEffect(() => {
    if (!restaurante?.id) return
    load()
    const channel = supabase.channel(`mis-riders-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_status' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurante_riders', filter: `establecimiento_id=eq.${restaurante.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_accounts' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [restaurante?.id])

  async function load() {
    const { data } = await supabase.from('restaurante_riders')
      .select('prioridad, rider_accounts(id, nombre, telefono, email, activa, estado, motivo_rechazo, shipday_api_key)')
      .eq('establecimiento_id', restaurante.id)
      .order('prioridad', { ascending: true })
    setVinc(data || [])
    const ids = (data || []).map(v => v.rider_accounts?.id).filter(Boolean)
    if (ids.length > 0) {
      const { data: st } = await supabase.from('rider_status').select('*').in('rider_account_id', ids)
      const map = {}
      ;(st || []).forEach(s => { map[s.rider_account_id] = s })
      setStatus(map)
    } else {
      setStatus({})
    }
  }

  async function desvincular(rider) {
    if (!confirm(`¿Desvincular "${rider.nombre}" de tu restaurante?`)) return
    const { error } = await supabase.from('restaurante_riders')
      .delete()
      .eq('establecimiento_id', restaurante.id)
      .eq('rider_account_id', rider.id)
    if (error) return toast('Error: ' + error.message, 'error')
    toast('Rider desvinculado')
    load()
  }

  const aprobados = vinc.filter(v => v.rider_accounts?.estado === 'activa' && v.rider_accounts?.activa)
  const pendientes = vinc.filter(v => v.rider_accounts?.estado === 'pendiente')
  const rechazados = vinc.filter(v => v.rider_accounts?.estado === 'rechazada')
  const onlineIds = aprobados.filter(v => status[v.rider_accounts?.id]?.is_online).map(v => v.rider_accounts?.id)

  const lista = tab === 'aprobados' ? aprobados
    : tab === 'pendientes' ? pendientes
    : tab === 'rechazados' ? rechazados
    : vinc

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Mis repartidores</h1>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.4 }}>
            Los riders que registres aquí recibirán tus pedidos de delivery. Requieren aprobación de Pidoo.
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} style={ds.primaryBtn}>+ Añadir rider</button>
      </div>

      {/* Stats compactas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 18 }}>
        <Stat label="Vinculados" value={aprobados.length} color={colors.text} />
        <Stat label="En línea ahora" value={onlineIds.length} color={colors.stateOk} sub={`${aprobados.length > 0 ? Math.round(onlineIds.length / aprobados.length * 100) : 0}% online`} />
        <Stat label="Pendientes" value={pendientes.length} color={colors.statePrep} />
        <Stat label="Rechazados" value={rechazados.length} color={colors.danger} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', borderBottom: `1px solid ${colors.border}`, paddingBottom: 2 }}>
        {[
          { id: 'todos', label: `Todos (${vinc.length})` },
          { id: 'aprobados', label: `Aprobados (${aprobados.length})` },
          { id: 'pendientes', label: `Pendientes (${pendientes.length})` },
          { id: 'rechazados', label: `Rechazados (${rechazados.length})` },
        ].map(t => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 14px',
                border: 'none',
                background: 'transparent',
                color: active ? colors.primary : colors.textMute,
                fontSize: type.xs,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'Inter', system-ui, sans-serif",
                borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
                marginBottom: -2,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tabla de riders */}
      {lista.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
          {vinc.length === 0
            ? 'Aún no tienes repartidores registrados. Pulsa "Añadir rider" para empezar.'
            : 'No hay repartidores en este filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(v => {
            const r = v.rider_accounts
            if (!r) return null
            const st = status[r.id]
            const online = st?.is_online
            const estadoInfo = ESTADOS[r.estado] || ESTADOS.pendiente
            return (
              <div key={r.id} style={{
                padding: 14, borderRadius: 12,
                background: colors.surface, border: `1px solid ${colors.border}`,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 12, background: colors.primarySoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.primary,
                  fontSize: type.base, fontWeight: 800, flexShrink: 0,
                }}>{r.nombre?.[0]?.toUpperCase() || '?'}</div>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nombre}</div>
                  <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[r.telefono, r.email].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {r.estado === 'rechazada' && r.motivo_rechazo && (
                    <div style={{ fontSize: type.xxs, color: colors.danger, marginTop: 4 }}>Motivo: {r.motivo_rechazo}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                    background: estadoInfo.bg, color: estadoInfo.color, whiteSpace: 'nowrap',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{estadoInfo.label}</span>
                  {r.estado === 'activa' && (
                    online ? (
                      <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk, whiteSpace: 'nowrap' }}>● Online</span>
                    ) : (
                      <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateNeutralSoft, color: colors.stateNeutral, whiteSpace: 'nowrap' }}>○ Offline</span>
                    )
                  )}
                  <button onClick={() => desvincular(r)} style={{
                    ...ds.actionBtn, color: colors.textMute,
                  }}>Desvincular</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Info box */}
      <div style={{
        marginTop: 18, padding: '12px 14px', borderRadius: 10,
        background: colors.infoSoft, border: `1px solid ${colors.border}`,
        fontSize: type.xxs, color: colors.textDim, lineHeight: 1.5,
      }}>
        💡 Cuando un pedido de delivery llega, Pidoo elige automáticamente al rider vinculado más cercano y disponible. Los pedidos de tu tienda pública se notifican a todos tus riders vinculados a la vez.
      </div>

      {showAdd && (
        <AddRiderModal
          restauranteId={restaurante.id}
          vinculadosIds={vinc.map(v => v.rider_accounts?.id).filter(Boolean)}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, color: statColor, sub }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: colors.surface, border: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: type.xl, fontWeight: 800, color: statColor, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function AddRiderModal({ restauranteId, vinculadosIds, onClose, onSaved }) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyOk, setVerifyOk] = useState(null)
  const [saving, setSaving] = useState(false)

  async function verificar() {
    const key = apiKey.trim()
    if (!key) return toast('Pega la API key del rider primero', 'error')
    setVerifying(true); setVerifyOk(null)
    try {
      const resp = await fetch('https://api.shipday.com/carriers', {
        method: 'GET', headers: { 'Authorization': `Basic ${key}` },
      })
      if (!resp.ok) { setVerifyOk(false); toast(`Key inválida (${resp.status})`, 'error') }
      else {
        const data = await resp.json()
        const list = Array.isArray(data) ? data : (data.carriers || data.data || [])
        setVerifyOk(true)
        toast(`Key válida — ${list.length} carrier${list.length === 1 ? '' : 's'} en Shipday`)
      }
    } catch {
      setVerifyOk(false); toast('Error de red', 'error')
    }
    setVerifying(false)
  }

  async function guardar() {
    if (!nombre.trim() || !apiKey.trim()) return toast('Nombre y API key obligatorios', 'error')
    if (verifyOk !== true) return toast('Verifica la API key antes de guardar', 'error')
    setSaving(true)

    const key = apiKey.trim()

    const { data: existente } = await supabase.from('rider_accounts')
      .select('id, estado, activa').eq('shipday_api_key', key).maybeSingle()

    let riderId
    if (existente) {
      if (vinculadosIds.includes(existente.id)) {
        toast('Ese rider ya está vinculado a tu restaurante', 'error')
        setSaving(false); return
      }
      riderId = existente.id
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: nuevo, error: e1 } = await supabase.from('rider_accounts')
        .insert({
          nombre: nombre.trim(),
          telefono: telefono.trim() || null,
          email: email.trim() || null,
          shipday_api_key: key,
          activa: true,
          estado: 'pendiente',
          creado_por: user?.id,
          establecimiento_origen_id: restauranteId,
        })
        .select('id').single()
      if (e1) { toast('Error guardando: ' + e1.message, 'error'); setSaving(false); return }
      riderId = nuevo.id
    }

    const { error: e2 } = await supabase.from('restaurante_riders').insert({
      establecimiento_id: restauranteId,
      rider_account_id: riderId,
      prioridad: 100,
    })
    if (e2) { toast('Error vinculando: ' + e2.message, 'error'); setSaving(false); return }

    toast(existente
      ? (existente.estado === 'activa' ? 'Rider ya aprobado — vinculado correctamente' : 'Rider vinculado (aún pendiente de aprobación)')
      : 'Rider registrado — pendiente de aprobación por Pidoo')
    onSaved()
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...ds.modalContent,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Añadir repartidor</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMute, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{
          padding: 12, borderRadius: 10, background: colors.statePrepSoft,
          border: `1px solid ${colors.statePrepSoft}`, marginBottom: 16,
          fontSize: type.xs, color: colors.statePrep, lineHeight: 1.5,
        }}>
          ⓘ El repartidor debe crear su propia cuenta en <strong>Shipday</strong> y darte su API Key personal
          (Settings → API). Al guardarlo, quedará pendiente hasta que Pidoo lo apruebe.
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Nombre del repartidor" value={nombre} onChange={setNombre} placeholder="Ej: Pedro Martín" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Teléfono" value={telefono} onChange={setTelefono} placeholder="600 123 456" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="rider@email.com" />
          </div>
          <Field
            label="API Key Shipday del rider"
            value={apiKey}
            onChange={(v) => { setApiKey(v); setVerifyOk(null) }}
            placeholder="xxxxx.xxxxxxxxxx"
            mono
          />

          {verifyOk === true && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: colors.stateOkSoft, color: colors.stateOk, fontSize: type.xs, fontWeight: 600 }}>
              ✓ Key válida
            </div>
          )}
          {verifyOk === false && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: colors.dangerSoft, color: colors.danger, fontSize: type.xs, fontWeight: 600 }}>
              ✗ Key inválida o error de red
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={verificar} disabled={verifying || !apiKey.trim()} style={{ ...ds.secondaryBtn, flex: 1, opacity: verifying || !apiKey.trim() ? 0.5 : 1 }}>
              {verifying ? 'Verificando...' : 'Verificar API key'}
            </button>
            <button onClick={guardar} disabled={saving || verifyOk !== true} style={{ ...ds.primaryBtn, flex: 1, opacity: saving || verifyOk !== true ? 0.5 : 1 }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, mono }) {
  return (
    <div>
      <label style={ds.label}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          ...ds.formInput,
          fontFamily: mono ? 'monospace' : "'Inter', system-ui, sans-serif",
        }}
      />
    </div>
  )
}
