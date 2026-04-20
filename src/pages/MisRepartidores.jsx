import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const ESTADOS = {
  pendiente: { label: 'Pendiente', bg: colors.statePrepSoft, color: colors.statePrep },
  activa: { label: 'Activo', bg: colors.stateOkSoft, color: colors.stateOk },
  rechazada: { label: 'Rechazado', bg: colors.dangerSoft, color: colors.danger },
}

export default function MisRepartidores() {
  const { restaurante, updateRestaurante } = useRest()
  const [vinc, setVinc] = useState([])
  const [status, setStatus] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [earnings, setEarnings] = useState([])
  const [riderUnicoId, setRiderUnicoId] = useState(restaurante?.rider_unico_id || null)
  const [savingRiderUnico, setSavingRiderUnico] = useState(false)

  useEffect(() => {
    setRiderUnicoId(restaurante?.rider_unico_id || null)
  }, [restaurante?.rider_unico_id])

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

  async function setRiderUnico(newId) {
    if (savingRiderUnico) return
    setSavingRiderUnico(true)
    const prev = riderUnicoId
    setRiderUnicoId(newId)
    const { error } = await supabase.from('establecimientos')
      .update({ rider_unico_id: newId })
      .eq('id', restaurante.id)
    setSavingRiderUnico(false)
    if (error) {
      setRiderUnicoId(prev)
      toast('Error: ' + error.message, 'error')
      return
    }
    await updateRestaurante?.({ rider_unico_id: newId })
    toast('Rider de tienda pública actualizado')
  }

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
    // Si es el rider forzado para tienda pública, limpiar la referencia
    const esForzado = rider.id === riderUnicoId
    if (esForzado) {
      await supabase.from('establecimientos').update({ rider_unico_id: null }).eq('id', restaurante.id)
      setRiderUnicoId(null)
      await updateRestaurante?.({ rider_unico_id: null })
    }
    const { error } = await supabase.from('restaurante_riders')
      .delete()
      .eq('establecimiento_id', restaurante.id)
      .eq('rider_account_id', rider.id)
    if (error) return toast('Error: ' + error.message, 'error')
    toast(esForzado ? 'Rider desvinculado y quitado de tienda pública' : 'Rider desvinculado')
    load()
  }

  const pendientes = vinc.filter(v => v.rider_accounts?.estado === 'pendiente').length
  const activos = vinc.filter(v => v.rider_accounts?.estado === 'activa' && v.rider_accounts?.activa).length
  const online = vinc.filter(v => v.rider_accounts?.estado === 'activa' && status[v.rider_accounts?.id]?.is_online).length

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Mis repartidores</h1>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.4 }}>
            Los riders que registras aquí reciben tus pedidos de delivery. Requieren aprobación de Pidoo.
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} style={ds.primaryBtn}>+ Añadir rider</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
        <Stat label="Activos" value={activos} color={colors.stateOk} />
        <Stat label="En línea" value={online} color={colors.stateOk} />
        <Stat label="Pendientes" value={pendientes} color={colors.statePrep} />
      </div>

      {/* Sección Rider de tienda pública (solo plan pro) */}
      {restaurante?.plan_pro && (() => {
        const ridersActivos = vinc
          .map(v => v.rider_accounts)
          .filter(r => r && r.estado === 'activa' && r.activa)
        const modoEspecifico = riderUnicoId != null
        return (
          <div style={{ ...ds.card, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4, gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>🏪 Rider de tienda pública</h2>
            </div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14, lineHeight: 1.5 }}>
              Elige quién recibe los pedidos que entran por <span style={{ fontFamily: 'monospace', color: colors.textDim }}>pidoo.es/{restaurante.slug || 'tu-tienda'}</span>.
            </div>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
              borderRadius: 10, cursor: savingRiderUnico ? 'default' : 'pointer',
              background: !modoEspecifico ? colors.primarySoft : colors.elev,
              border: `1px solid ${!modoEspecifico ? colors.primaryBorder : colors.border}`,
              marginBottom: 8, transition: 'all 0.15s',
            }}>
              <input
                type="radio"
                checked={!modoEspecifico}
                disabled={savingRiderUnico}
                onChange={() => setRiderUnico(null)}
                style={{ marginTop: 2, accentColor: colors.primary }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>🔀 Todos mis riders vinculados</div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 3, lineHeight: 1.4 }}>
                  Algoritmo normal: elige el más cercano online entre tus riders. (Recomendado)
                </div>
              </div>
            </label>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
              borderRadius: 10, cursor: savingRiderUnico || ridersActivos.length === 0 ? 'default' : 'pointer',
              background: modoEspecifico ? colors.primarySoft : colors.elev,
              border: `1px solid ${modoEspecifico ? colors.primaryBorder : colors.border}`,
              marginBottom: 10, opacity: ridersActivos.length === 0 ? 0.55 : 1, transition: 'all 0.15s',
            }}>
              <input
                type="radio"
                checked={modoEspecifico}
                disabled={savingRiderUnico || ridersActivos.length === 0}
                onChange={() => {
                  if (ridersActivos.length === 0) return
                  setRiderUnico(ridersActivos[0].id)
                }}
                style={{ marginTop: 2, accentColor: colors.primary }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>📌 Solo un rider específico</div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 3, lineHeight: 1.4 }}>
                  Todos los pedidos de tienda pública van siempre a ese rider (si está offline, cae al algoritmo normal).
                </div>
                {modoEspecifico && (
                  <select
                    value={riderUnicoId || ''}
                    disabled={savingRiderUnico}
                    onChange={e => setRiderUnico(e.target.value || null)}
                    onClick={e => e.stopPropagation()}
                    style={{ ...ds.select, marginTop: 10, maxWidth: 320 }}
                  >
                    {ridersActivos.map(r => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            {ridersActivos.length === 0 && (
              <div style={{ fontSize: type.xxs, color: colors.statePrep, marginBottom: 8 }}>
                Añade y aprueba al menos 1 rider para poder elegir uno específico.
              </div>
            )}

            <div style={{
              marginTop: 6, padding: '10px 12px', borderRadius: 10,
              background: colors.infoSoft, border: `1px solid ${colors.border}`,
              fontSize: type.xxs, color: colors.textDim, lineHeight: 1.5,
            }}>
              💡 <strong style={{ color: colors.text }}>Recomendación Pidoo:</strong> paga al rider 10% del subtotal + 100% del envío. Puedes pactar otra cifra libremente con él.
            </div>
          </div>
        )
      })()}

      {vinc.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
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
                background: colors.surface, border: `1px solid ${colors.border}`,
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, background: colors.primarySoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.primary,
                  fontSize: type.sm, fontWeight: 800, flexShrink: 0,
                }}>{r.nombre?.[0]?.toUpperCase() || '?'}</div>
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nombre}</div>
                  <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[r.telefono, r.email].filter(Boolean).join(' · ')}
                  </div>
                  {r.estado === 'rechazada' && r.motivo_rechazo && (
                    <div style={{ fontSize: type.xxs, color: colors.danger, marginTop: 3 }}>Motivo: {r.motivo_rechazo}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {restaurante?.plan_pro && r.id === riderUnicoId && (
                    <span style={{
                      padding: '3px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                      background: colors.primarySoft, color: colors.primary, whiteSpace: 'nowrap',
                      letterSpacing: '0.02em', border: `1px solid ${colors.primaryBorder}`,
                    }}>📌 Tienda pública</span>
                  )}
                  <span style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                    background: estadoInfo.bg, color: estadoInfo.color, whiteSpace: 'nowrap',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{estadoInfo.label}</span>
                  {r.estado === 'activa' && (
                    online ? (
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk, whiteSpace: 'nowrap' }}>● Online</span>
                    ) : (
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateNeutralSoft, color: colors.stateNeutral, whiteSpace: 'nowrap' }}>○ Offline</span>
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

      {/* Finanzas de riders (últimos 7 días) */}
      <div style={{ marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Finanzas de riders</h2>
          <span style={{ fontSize: type.xxs, color: colors.textMute }}>Últimos 7 días</span>
        </div>
        {earnings.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
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
            <div style={{ overflowX: 'auto', ...ds.table }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
                <thead>
                  <tr style={{ background: colors.elev }}>
                    {['Rider', 'Pedidos', 'Envíos', 'Comisión (10%)', 'Propinas', 'Neto rider', 'Estado'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.rider_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.nombre}</td>
                      <td style={{ padding: '10px 12px' }}>{r.pedidos}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_envios)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_comision_rider)}</td>
                      <td style={{ padding: '10px 12px' }}>{fmt(r.total_propinas)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: colors.stateOk }}>{fmt(r.total_neto)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {r.pendiente > 0 ? (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.statePrepSoft, color: colors.statePrep, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Pendiente {fmt(r.pendiente)}
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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

function Stat({ label, value, color: statColor }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: colors.surface, border: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: type.xl, fontWeight: 800, color: statColor, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
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
