import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'

const ESTADOS = {
  pendiente: { label: 'Pendiente de aprobación', bg: 'rgba(245,158,11,0.15)', color: '#FBBF24' },
  activa: { label: 'Activo', bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
  rechazada: { label: 'Rechazado', bg: 'rgba(239,68,68,0.15)', color: '#F87171' },
}

export default function MisRepartidores() {
  const { restaurante } = useRest()
  const [vinc, setVinc] = useState([])
  const [status, setStatus] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [earnings, setEarnings] = useState([])

  useEffect(() => {
    if (!restaurante?.id) return
    load()
    loadEarnings()
    const channel = supabase.channel(`mis-riders-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_status' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurante_riders', filter: `establecimiento_id=eq.${restaurante.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_accounts' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [restaurante?.id])

  async function loadEarnings() {
    const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('rider_earnings')
      .select('*, rider_accounts(nombre)')
      .eq('establecimiento_id', restaurante.id)
      .gte('created_at', hace7)
    setEarnings(data || [])
  }

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

  const pendientes = vinc.filter(v => v.rider_accounts?.estado === 'pendiente').length
  const activos = vinc.filter(v => v.rider_accounts?.estado === 'activa' && v.rider_accounts?.activa).length
  const online = vinc.filter(v => v.rider_accounts?.estado === 'activa' && status[v.rider_accounts?.id]?.is_online).length

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Mis repartidores</h1>
          <div style={{ fontSize: 11.5, color: '#ab8985', marginTop: 3, lineHeight: 1.4 }}>
            Los riders que registras aquí reciben tus pedidos de delivery. Requieren aprobación de Pidoo.
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ ...btnPrimary, fontSize: 11.5, padding: '8px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}>+ Añadir rider</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
        <Stat label="Activos" value={activos} color="#4ade80" />
        <Stat label="En línea" value={online} color="#4ade80" />
        <Stat label="Pendientes" value={pendientes} color="#FBBF24" />
      </div>

      {vinc.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#ab8985', fontSize: 13 }}>
          Aún no tienes repartidores registrados. Pulsa "Añadir repartidor" para empezar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {vinc.map(v => {
            const r = v.rider_accounts
            if (!r) return null
            const st = status[r.id]
            const online = st?.is_online
            const estadoInfo = ESTADOS[r.estado] || ESTADOS.pendiente
            return (
              <div key={r.id} style={{
                padding: 12, borderRadius: 12,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, background: 'rgba(185,28,28,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F87171',
                  fontSize: 13, fontWeight: 800, flexShrink: 0,
                }}>{r.nombre?.[0]?.toUpperCase() || '?'}</div>
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#E5E2E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nombre}</div>
                  <div style={{ fontSize: 10.5, color: '#ab8985', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[r.telefono && `📞 ${r.telefono}`, r.email && `✉ ${r.email}`].filter(Boolean).join(' · ')}
                  </div>
                  {r.estado === 'rechazada' && r.motivo_rechazo && (
                    <div style={{ fontSize: 10.5, color: '#F87171', marginTop: 3 }}>Motivo: {r.motivo_rechazo}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: estadoInfo.bg, color: estadoInfo.color, whiteSpace: 'nowrap',
                  }}>{estadoInfo.label}</span>
                  {r.estado === 'activa' && (
                    online ? (
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#4ade80', whiteSpace: 'nowrap' }}>● Online</span>
                    ) : (
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(148,163,184,0.15)', color: '#94A3B8', whiteSpace: 'nowrap' }}>○ Offline</span>
                    )
                  )}
                  <button onClick={() => desvincular(r)} style={{
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent', color: '#ab8985',
                    fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
                  }}>Desvincular</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Finanzas de riders (últimos 7 días) */}
      <div style={{ marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Finanzas de riders</h2>
          <span style={{ fontSize: 10.5, color: '#ab8985' }}>Últimos 7 días</span>
        </div>
        {earnings.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#ab8985', fontSize: 13 }}>
            Sin pedidos entregados en los últimos 7 días.
          </div>
        ) : (() => {
          const grouped = {}
          for (const e of earnings) {
            const id = e.rider_account_id
            if (!grouped[id]) {
              grouped[id] = {
                rider_id: id,
                nombre: e.rider_accounts?.nombre || '—',
                pedidos: 0,
                total_envios: 0,
                total_comision_rider: 0,
                total_propinas: 0,
                total_neto: 0,
                pendiente: 0,
              }
            }
            const g = grouped[id]
            g.pedidos += 1
            g.total_envios += Number(e.coste_envio || 0)
            g.total_comision_rider += Number(e.comision_rider_sobre_subtotal || 0)
            g.total_propinas += Number(e.propina || 0)
            g.total_neto += Number(e.neto_rider || 0)
            if (e.estado_pago === 'pendiente') g.pendiente += Number(e.neto_rider || 0)
          }
          const rows = Object.values(grouped).sort((a, b) => b.total_neto - a.total_neto)
          const fmt = v => `${Number(v).toFixed(2)} €`
          return (
            <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#E5E2E1' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {['Rider', 'Pedidos', 'Envíos', 'Comisión (10%)', 'Propinas', 'Neto rider', 'Estado'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, color: '#ab8985', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.rider_id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.nombre}</td>
                      <td style={{ padding: '10px 12px' }}>{r.pedidos}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_envios)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_comision_rider)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_propinas)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: '#4ade80' }}>{fmt(r.total_neto)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {r.pendiente > 0 ? (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#FBBF24' }}>
                            Pendiente {fmt(r.pendiente)}
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
                            Pagado
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
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

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 9.5, color: '#ab8985', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 2, lineHeight: 1.1 }}>{value}</div>
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

    // ¿Existe ya un rider con esta API key?
    const { data: existente } = await supabase.from('rider_accounts')
      .select('id, estado, activa').eq('shipday_api_key', key).maybeSingle()

    let riderId
    if (existente) {
      // Reutilizar: si ya está vinculado a este restaurante, no hacemos nada
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
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1A1A1A', borderRadius: 16, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto', padding: 24, border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#E5E2E1', margin: 0 }}>Añadir repartidor</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#ab8985', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{
          padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', marginBottom: 16,
          fontSize: 11, color: '#FBBF24', lineHeight: 1.5,
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
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#4ade80', fontSize: 12, fontWeight: 600 }}>
              ✓ Key válida
            </div>
          )}
          {verifyOk === false && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#F87171', fontSize: 12, fontWeight: 600 }}>
              ✗ Key inválida o error de red
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={verificar} disabled={verifying || !apiKey.trim()} style={{ ...btnGhost, flex: 1, opacity: verifying || !apiKey.trim() ? 0.5 : 1 }}>
              {verifying ? 'Verificando...' : 'Verificar API key'}
            </button>
            <button onClick={guardar} disabled={saving || verifyOk !== true} style={{ ...btnPrimary, flex: 1, opacity: saving || verifyOk !== true ? 0.5 : 1 }}>
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
      <label style={{ fontSize: 11, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#E5E2E1', fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

const btnPrimary = {
  padding: '10px 16px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)',
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
}

const btnGhost = {
  padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)',
  background: 'transparent', color: '#ab8985', fontSize: 11, fontWeight: 700,
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
}
