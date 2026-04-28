import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'
import { formatTarifa, compararTarifas, formatCuentaAtras, formatFechaCorta } from '../lib/tarifas'

const SUPABASE_URL = 'https://rmrbxrabngdmpgpfmjbo.supabase.co'

const ESTADOS = {
  pendiente: { label: 'Pendiente', bg: colors.statePrepSoft, color: colors.statePrep },
  activa: { label: 'Activo', bg: colors.stateOkSoft, color: colors.stateOk },
  rechazada: { label: 'Rechazado', bg: colors.dangerSoft, color: colors.danger },
}

function fmtFecha(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function Avatar({ logo, nombre, size = 52 }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        style={{ width: size, height: size, borderRadius: 12, objectFit: 'cover', flexShrink: 0, border: `1px solid ${colors.border}` }}
      />
    )
  }
  const letra = (nombre || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: 12, flexShrink: 0,
      background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.38,
    }}>{letra}</div>
  )
}

function ModalMotivo({ titulo, textoBoton, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function submit() {
    setEnviando(true)
    try {
      await onConfirm(motivo.trim() || undefined)
      onClose()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={ds.modal} onClick={onClose}>
      <div style={ds.modalContent} onClick={e => e.stopPropagation()}>
        <div style={{ ...ds.h2, marginBottom: 8 }}>{titulo}</div>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14, lineHeight: 1.5 }}>
          Puedes añadir un motivo opcional para que el socio entienda la decisión.
        </div>
        <textarea
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Motivo (opcional)"
          rows={4}
          style={{
            ...ds.formInput,
            height: 'auto',
            padding: '10px 12px',
            resize: 'vertical',
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ds.secondaryBtn} disabled={enviando}>Cancelar</button>
          <button
            onClick={submit}
            disabled={enviando}
            style={{
              ...ds.primaryBtn,
              background: colors.danger,
              borderColor: colors.danger,
              opacity: enviando ? 0.6 : 1,
            }}
          >
            {enviando ? 'Enviando...' : textoBoton}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalCambiarTarifa({ row, onClose, onPropuesta }) {
  const tarifaActual = {
    tarifa_base: row.tarifa_base,
    tarifa_radio_base_km: row.tarifa_radio_base_km,
    tarifa_precio_km: row.tarifa_precio_km,
    tarifa_maxima: row.tarifa_maxima,
  }
  const pendiente = row.tarifa_pendiente || null
  const inicial = pendiente && row.tarifa_pendiente_origen === 'restaurante' ? pendiente : tarifaActual

  const [base, setBase] = useState(inicial?.tarifa_base ?? '')
  const [radio, setRadio] = useState(inicial?.tarifa_radio_base_km ?? '')
  const [precioKm, setPrecioKm] = useState(inicial?.tarifa_precio_km ?? '')
  const [maxima, setMaxima] = useState(inicial?.tarifa_maxima ?? '')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const propuesta = {
    tarifa_base: base === '' ? null : Number(base),
    tarifa_radio_base_km: radio === '' ? null : Number(radio),
    tarifa_precio_km: precioKm === '' ? null : Number(precioKm),
    tarifa_maxima: maxima === '' ? null : Number(maxima),
  }
  const diffs = compararTarifas(tarifaActual, propuesta)
  const valid = [base, radio, precioKm, maxima].every(v => v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0)

  const yaPendiente = !!pendiente

  async function submit() {
    if (!valid) {
      toast('Rellena todos los campos numéricos', 'error')
      return
    }
    setEnviando(true)
    try {
      await onPropuesta({
        socio_establecimiento_id: row.id,
        tarifa_base: Number(base),
        tarifa_radio_base_km: Number(radio),
        tarifa_precio_km: Number(precioKm),
        tarifa_maxima: Number(maxima),
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      })
      onClose()
    } finally {
      setEnviando(false)
    }
  }

  function NumInput({ value, onChange, step }) {
    return (
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ ...ds.formInput, fontFamily: "'Inter', system-ui, sans-serif" }}
      />
    )
  }

  return (
    <div style={ds.modal} onClick={onClose}>
      <div style={{ ...ds.modalContent, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ ...ds.h2, marginBottom: 6 }}>Cambiar tarifa pactada</div>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14, lineHeight: 1.5 }}>
          Cambios delicados: las bajadas son sensibles. El socio tendrá <strong style={{ color: colors.text }}>7 días</strong> para aceptar o rechazar; si no responde, se aplicará automáticamente.
        </div>

        {yaPendiente && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, marginBottom: 14,
            background: colors.statePrepSoft, border: `1px solid ${colors.statePrep}55`,
            fontSize: type.xs, color: colors.statePrep, lineHeight: 1.4,
          }}>
            ⏳ Ya hay una propuesta pendiente expirando el {formatFechaCorta(row.tarifa_pendiente_expira_en)}. Al enviar esta, la sustituirá.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tarifa base (€)</div>
            <NumInput value={base} onChange={setBase} step="0.10" />
          </div>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Radio base (km)</div>
            <NumInput value={radio} onChange={setRadio} step="0.5" />
          </div>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>€/km adicional</div>
            <NumInput value={precioKm} onChange={setPrecioKm} step="0.10" />
          </div>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tarifa máxima (€)</div>
            <NumInput value={maxima} onChange={setMaxima} step="0.50" />
          </div>
        </div>

        <div style={{
          marginBottom: 14, padding: 10, borderRadius: 8,
          background: colors.elev2, border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Diferencia</div>
          {diffs.map(d => {
            const arrow = d.igual ? '=' : d.sube === true ? '▲' : d.sube === false ? '▼' : ''
            const color = d.igual ? colors.textMute : d.sube === true ? colors.stateOk : d.sube === false ? colors.danger : colors.textDim
            return (
              <div key={d.campo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: type.xs, padding: '3px 0' }}>
                <span style={{ color: colors.textDim }}>{d.label}</span>
                <span style={{ color, fontWeight: 600 }}>
                  {d.actual ?? '—'} → {d.propuesta ?? '—'} <span style={{ marginLeft: 4 }}>{arrow}</span>
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Motivo del cambio (opcional)</div>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej. ajuste por subida de costes operativos"
            rows={3}
            style={{
              ...ds.formInput, height: 'auto', padding: '10px 12px', resize: 'vertical',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={ds.secondaryBtn} disabled={enviando}>Cancelar</button>
          <button
            onClick={submit}
            disabled={enviando || !valid}
            style={{ ...ds.primaryBtn, opacity: (enviando || !valid) ? 0.6 : 1 }}
          >
            {enviando ? 'Enviando...' : 'Proponer cambio'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SocioCard({ row, rider, riderStatus, expanded, onToggle, onAceptar, onRechazar, onDesvincular, onCambiarTarifa }) {
  const socio = row.socios || {}
  const estadoInfo = ESTADOS[row.estado] || ESTADOS.pendiente
  const online = riderStatus?.is_online
  const isPendiente = row.estado === 'pendiente'
  const isActivo = row.estado === 'activa'

  return (
    <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
      {/* Cabecera clickable */}
      <div
        onClick={() => isActivo && onToggle()}
        style={{
          padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center',
          cursor: isActivo ? 'pointer' : 'default',
          background: expanded ? colors.elev2 : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <Avatar logo={socio.logo_url} nombre={socio.nombre_comercial} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, letterSpacing: '-0.2px' }}>
              {socio.nombre_comercial || 'Socio sin nombre'}
            </div>
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
              background: estadoInfo.bg, color: estadoInfo.color,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>{estadoInfo.label}</span>
            {isActivo && rider && (
              online ? (
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk }}>● Online</span>
              ) : (
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateNeutralSoft, color: colors.stateNeutral }}>○ Offline</span>
              )
            )}
          </div>
          {socio.descripcion && (
            <div style={{
              fontSize: type.xs, color: colors.textMute, marginTop: 6, lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {socio.descripcion}
            </div>
          )}
          <div style={{ fontSize: type.xxs, color: colors.textFaint, marginTop: 6 }}>
            {isPendiente
              ? <>Solicitado el {fmtFecha(row.solicitado_at)}</>
              : <>Activo desde {fmtFecha(row.aceptado_at || row.solicitado_at)}</>}
            {socio.slug && <> · <span style={{ color: colors.textMute, fontFamily: 'monospace' }}>/{socio.slug}</span></>}
          </div>
        </div>
        {isActivo && (
          <div style={{ fontSize: type.base, color: colors.textMute, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </div>
        )}
      </div>

      {/* Acciones según estado (siempre visibles para pendiente) */}
      {isPendiente && (
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onAceptar(row.id)} style={{
            ...ds.primaryBtn, background: colors.stateOk, borderColor: colors.stateOk,
          }}>Aceptar</button>
          <button onClick={() => onRechazar(row.id)} style={{
            ...ds.secondaryBtn, color: colors.danger, borderColor: colors.danger,
          }}>Rechazar</button>
        </div>
      )}

      {/* Desplegable — solo activos */}
      {isActivo && expanded && (
        <div style={{
          borderTop: `1px solid ${colors.border}`,
          padding: '14px 16px', background: colors.elev2,
        }}>
          <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Repartidor del socio
          </div>
          {rider ? (
            <div style={{
              padding: 12, borderRadius: 10,
              background: colors.surface, border: `1px solid ${colors.border}`,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: colors.primarySoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.primary,
                fontSize: type.sm, fontWeight: 800, flexShrink: 0,
              }}>{rider.nombre?.[0]?.toUpperCase() || '?'}</div>
              <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rider.nombre}</div>
                <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[rider.telefono, rider.email].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {online ? (
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk }}>● Online</span>
              ) : (
                <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateNeutralSoft, color: colors.stateNeutral }}>○ Offline</span>
              )}
            </div>
          ) : (
            <div style={{
              padding: 14, textAlign: 'center', borderRadius: 10,
              background: colors.surface, border: `1px dashed ${colors.border}`,
              color: colors.textMute, fontSize: type.xs,
            }}>
              Sin rider asociado. El socio debe completar su alta en <span style={{ fontFamily: 'monospace', color: colors.textDim }}>socio.pidoo.es</span>.
            </div>
          )}

          {/* Tarifa pactada */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Tarifa pactada
            </div>
            <div style={{
              padding: 12, borderRadius: 10,
              background: colors.surface, border: `1px solid ${colors.border}`,
            }}>
              <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600 }}>
                {formatTarifa(row) || <span style={{ color: colors.textMute, fontWeight: 500 }}>Por defecto de la plataforma</span>}
              </div>
              {row.tarifa_aceptada_en && formatTarifa(row) && (
                <div style={{ fontSize: type.xxs, color: colors.textFaint, marginTop: 4 }}>
                  Aceptada el {formatFechaCorta(row.tarifa_aceptada_en)}
                </div>
              )}

              {row.tarifa_pendiente && (() => {
                const expira = formatCuentaAtras(row.tarifa_pendiente_expira_en)
                const propio = row.tarifa_pendiente_origen === 'restaurante'
                const tooltipDiffs = compararTarifas(row, row.tarifa_pendiente)
                  .map(d => `${d.label}: ${d.actual ?? '—'} → ${d.propuesta ?? '—'}`)
                  .join('\n')
                return (
                  <div
                    title={tooltipDiffs}
                    style={{
                      marginTop: 10, padding: '8px 10px', borderRadius: 8,
                      background: colors.statePrepSoft, border: `1px solid ${colors.statePrep}55`,
                      fontSize: type.xs, color: colors.statePrep, fontWeight: 600,
                      cursor: 'help',
                    }}
                  >
                    ⏳ {propio ? 'Propuesta enviada' : 'Propuesta del socio'} · expira en {expira}
                  </div>
                )
              })()}

              <div style={{ marginTop: 10 }}>
                <button onClick={() => onCambiarTarifa(row)} style={ds.secondaryBtn}>
                  Cambiar tarifa
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => onDesvincular(row.id)} style={{
              ...ds.secondaryBtn,
              color: colors.danger,
              borderColor: `${colors.danger}55`,
              background: colors.dangerSoft,
            }}>Desvincular socio</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SociosYRepartidores() {
  const { restaurante } = useRest()
  const [vincs, setVincs] = useState([])
  const [riderStatus, setRiderStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('todos')
  const [expanded, setExpanded] = useState({})
  const [modalRechazar, setModalRechazar] = useState(null)
  const [modalDesvincular, setModalDesvincular] = useState(null)
  const [modalTarifa, setModalTarifa] = useState(null)

  const cargar = useCallback(async () => {
    if (!restaurante?.id) return
    try {
      const selectStr = 'id, socio_id, estado, solicitado_at, aceptado_at, destacado, orden_destacado, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, tarifa_aceptada_en, tarifa_pendiente, tarifa_pendiente_at, tarifa_pendiente_origen, tarifa_pendiente_expira_en, socios(id, nombre_comercial, logo_url, slug, rating, descripcion, shipday_api_key)'
      const { data: rows, error } = await supabase
        .from('socio_establecimiento')
        .select(selectStr)
        .eq('establecimiento_id', restaurante.id)
        .order('solicitado_at', { ascending: false })
      if (error) throw error

      const enriched = rows || []
      const apiKeys = enriched.map(r => r.socios?.shipday_api_key).filter(Boolean)

      let ridersByKey = {}
      if (apiKeys.length > 0) {
        const { data: riders } = await supabase
          .from('rider_accounts')
          .select('id, nombre, telefono, email, shipday_api_key, activa, estado')
          .in('shipday_api_key', apiKeys)
        ridersByKey = {}
        ;(riders || []).forEach(r => { ridersByKey[r.shipday_api_key] = r })
      }

      const withRider = enriched.map(row => ({
        ...row,
        rider: row.socios?.shipday_api_key ? ridersByKey[row.socios.shipday_api_key] || null : null,
      }))
      setVincs(withRider)

      const riderIds = withRider.map(r => r.rider?.id).filter(Boolean)
      if (riderIds.length > 0) {
        const { data: st } = await supabase.from('rider_status').select('*').in('rider_account_id', riderIds)
        const map = {}
        ;(st || []).forEach(s => { map[s.rider_account_id] = s })
        setRiderStatus(map)
      } else {
        setRiderStatus({})
      }
    } catch (err) {
      toast('Error cargando socios: ' + (err.message || err), 'error')
    } finally {
      setLoading(false)
    }
  }, [restaurante?.id])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (!restaurante?.id) return
    const channel = supabase.channel(`socios-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'socio_establecimiento', filter: `establecimiento_id=eq.${restaurante.id}` }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_status' }, cargar)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [restaurante?.id, cargar])

  async function callFunction(vinculacion_id, accion, motivo) {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/aprobar-vinculacion-socio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ vinculacion_id, accion, ...(motivo ? { motivo } : {}) }),
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok || !body?.ok) {
      throw new Error(body?.error || 'Error al procesar la solicitud')
    }
    return body
  }

  async function handleAceptar(id) {
    try {
      await callFunction(id, 'aceptar')
      toast('Socio aceptado', 'success')
      cargar()
    } catch (err) {
      toast(err.message || 'Error al aceptar', 'error')
    }
  }

  async function handleRechazar(id, motivo) {
    try {
      await callFunction(id, 'rechazar', motivo)
      toast('Solicitud rechazada', 'success')
      cargar()
    } catch (err) {
      toast(err.message || 'Error al rechazar', 'error')
      throw err
    }
  }

  async function handleProponerTarifa(payload) {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/proponer-tarifa-socio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok || !body?.ok) {
      const msg = body?.error || 'Error al proponer la tarifa'
      toast(msg, 'error')
      throw new Error(msg)
    }
    toast('Propuesta enviada al socio', 'success')
    cargar()
  }

  async function handleDesvincular(id, motivo) {
    try {
      await callFunction(id, 'rechazar', motivo || 'Desvinculado por restaurante')
      toast('Socio desvinculado', 'success')
      cargar()
    } catch (err) {
      toast(err.message || 'Error al desvincular', 'error')
      throw err
    }
  }

  const pendientes = vincs.filter(v => v.estado === 'pendiente')
  const activos = vincs.filter(v => v.estado === 'activa')
  const rechazados = vincs.filter(v => v.estado === 'rechazada')
  const onlineCount = activos.filter(v => v.rider && riderStatus[v.rider.id]?.is_online).length

  const lista = tab === 'activos' ? activos
    : tab === 'pendientes' ? pendientes
    : tab === 'rechazados' ? rechazados
    : vincs

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ ...ds.h1, margin: 0 }}>Socios y repartidores</h1>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.5 }}>
          Los repartidores que reciben tus pedidos de delivery son los riders de tus socios. Cada socio gestiona su rider desde <span style={{ fontFamily: 'monospace', color: colors.textDim }}>socio.pidoo.es</span>.
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        <Stat label="Activos" value={activos.length} color={colors.stateOk} />
        <Stat label="Online ahora" value={onlineCount} color={colors.stateOk} sub={`${activos.length > 0 ? Math.round(onlineCount / activos.length * 100) : 0}% disponibles`} />
        <Stat label="Pendientes" value={pendientes.length} color={colors.statePrep} />
        <Stat label="Rechazados" value={rechazados.length} color={colors.danger} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', borderBottom: `1px solid ${colors.border}`, paddingBottom: 2 }}>
        {[
          { id: 'todos', label: `Todos (${vincs.length})` },
          { id: 'activos', label: `Activos (${activos.length})` },
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

      {/* Lista */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
      ) : lista.length === 0 ? (
        <div style={{
          padding: 30, textAlign: 'center', background: colors.surface,
          border: `1px solid ${colors.border}`, borderRadius: 12,
          color: colors.textMute, fontSize: type.sm,
        }}>
          {vincs.length === 0
            ? 'Aún no tienes socios vinculados. Los socios te solicitarán vinculación desde socio.pidoo.es.'
            : 'No hay socios en este filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lista.map(row => (
            <SocioCard
              key={row.id}
              row={row}
              rider={row.rider}
              riderStatus={row.rider ? riderStatus[row.rider.id] : null}
              expanded={!!expanded[row.id]}
              onToggle={() => setExpanded(e => ({ ...e, [row.id]: !e[row.id] }))}
              onAceptar={handleAceptar}
              onRechazar={(id) => setModalRechazar({ id })}
              onDesvincular={(id) => setModalDesvincular({ id })}
              onCambiarTarifa={(rowSel) => setModalTarifa(rowSel)}
            />
          ))}
        </div>
      )}

      {/* Info box */}
      <div style={{
        marginTop: 20, padding: '12px 14px', borderRadius: 10,
        background: colors.infoSoft, border: `1px solid ${colors.border}`,
        fontSize: type.xxs, color: colors.textDim, lineHeight: 1.5,
      }}>
        💡 Todos los repartidores de Pidoo son socios. Si alguien quiere repartir para ti, debe darse de alta en <strong style={{ color: colors.text }}>socio.pidoo.es</strong> y después solicitarte vinculación.
      </div>

      {modalRechazar && (
        <ModalMotivo
          titulo="Rechazar solicitud"
          textoBoton="Rechazar"
          onClose={() => setModalRechazar(null)}
          onConfirm={(motivo) => handleRechazar(modalRechazar.id, motivo)}
        />
      )}

      {modalDesvincular && (
        <ModalMotivo
          titulo="Desvincular socio"
          textoBoton="Desvincular"
          onClose={() => setModalDesvincular(null)}
          onConfirm={(motivo) => handleDesvincular(modalDesvincular.id, motivo)}
        />
      )}

      {modalTarifa && (
        <ModalCambiarTarifa
          row={modalTarifa}
          onClose={() => setModalTarifa(null)}
          onPropuesta={handleProponerTarifa}
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
