import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const SUPABASE_URL = 'https://rmrbxrabngdmpgpfmjbo.supabase.co'

function fmtFecha(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function Avatar({ logo, nombre }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flexShrink: 0, border: `1px solid ${colors.border}` }}
      />
    )
  }
  const letra = (nombre || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      width: 52, height: 52, borderRadius: 12, flexShrink: 0,
      background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: 20,
    }}>{letra}</div>
  )
}

function Rating({ value }) {
  const v = Number(value || 0)
  if (!v) return <span style={{ fontSize: type.xxs, color: colors.textFaint }}>Sin valoraciones</span>
  return (
    <span style={{ fontSize: type.xs, color: colors.textDim, fontWeight: 600 }}>
      ★ {v.toFixed(1)}
    </span>
  )
}

function ModalRechazo({ onClose, onConfirm, titulo, textoBoton }) {
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

function CardSocio({ row, tipo, onAceptar, onRechazar, onDesvincular }) {
  const socio = row.socios || {}
  return (
    <div style={{ ...ds.card, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <Avatar logo={socio.logo_url} nombre={socio.nombre_comercial} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, letterSpacing: '-0.2px' }}>
            {socio.nombre_comercial || 'Socio sin nombre'}
          </div>
          <Rating value={socio.rating} />
        </div>
        {socio.descripcion && (
          <div style={{
            fontSize: type.xs, color: colors.textMute, marginTop: 6, lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {socio.descripcion}
          </div>
        )}
        <div style={{ fontSize: type.xxs, color: colors.textFaint, marginTop: 8 }}>
          {tipo === 'pendiente'
            ? <>Solicitado el {fmtFecha(row.solicitado_at)}</>
            : <>Activo desde {fmtFecha(row.aceptado_at || row.solicitado_at)}</>}
          {socio.slug && <> · <span style={{ color: colors.textMute }}>/{socio.slug}</span></>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {tipo === 'pendiente' && (
            <>
              <button
                onClick={() => onAceptar(row.id)}
                style={{
                  ...ds.primaryBtn,
                  background: colors.stateOk,
                  borderColor: colors.stateOk,
                }}
              >
                Aceptar
              </button>
              <button
                onClick={() => onRechazar(row.id)}
                style={{
                  ...ds.secondaryBtn,
                  color: colors.danger,
                  borderColor: colors.danger,
                }}
              >
                Rechazar
              </button>
            </>
          )}
          {tipo === 'activa' && (
            <button
              onClick={() => onDesvincular(row.id)}
              style={{
                ...ds.secondaryBtn,
                color: colors.danger,
                borderColor: `${colors.danger}55`,
                background: colors.dangerSoft,
              }}
            >
              Desvincular
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Socios() {
  const { restaurante } = useRest()
  const [pendientes, setPendientes] = useState([])
  const [activos, setActivos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalRechazar, setModalRechazar] = useState(null) // { id } para pendientes
  const [modalDesvincular, setModalDesvincular] = useState(null) // { id } para activos

  const cargar = useCallback(async () => {
    if (!restaurante?.id) return
    try {
      const selectStr = 'id, socio_id, estado, solicitado_at, aceptado_at, motivo_rechazo, destacado, orden_destacado, socios(nombre_comercial, logo_url, slug, rating, descripcion)'

      const { data: pend, error: e1 } = await supabase
        .from('socio_establecimiento')
        .select(selectStr)
        .eq('establecimiento_id', restaurante.id)
        .eq('estado', 'pendiente')
        .order('solicitado_at', { ascending: false })
      if (e1) throw e1
      setPendientes(pend || [])

      const { data: act, error: e2 } = await supabase
        .from('socio_establecimiento')
        .select(selectStr)
        .eq('establecimiento_id', restaurante.id)
        .eq('estado', 'activa')
        .order('aceptado_at', { ascending: false })
      if (e2) throw e2
      setActivos(act || [])
    } catch (err) {
      toast('Error cargando socios: ' + (err.message || err), 'error')
    } finally {
      setLoading(false)
    }
  }, [restaurante?.id])

  useEffect(() => { cargar() }, [cargar])

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

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ ...ds.h1, margin: 0 }}>Socios y repartidores</h1>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.5 }}>
          Gestiona qué socios pueden incluir tu restaurante en su mini-marketplace.
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
      ) : (
        <>
          {/* Bloque 1: Pendientes */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Solicitudes pendientes</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>
                {pendientes.length} solicitud{pendientes.length === 1 ? '' : 'es'}
              </span>
            </div>

            {pendientes.length === 0 ? (
              <div style={{
                padding: 24, textAlign: 'center', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 12,
                color: colors.textMute, fontSize: type.sm,
              }}>
                No tienes solicitudes pendientes.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pendientes.map(row => (
                  <CardSocio
                    key={row.id}
                    row={row}
                    tipo="pendiente"
                    onAceptar={handleAceptar}
                    onRechazar={(id) => setModalRechazar({ id })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bloque 2: Activos */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Socios vinculados</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>
                {activos.length} socio{activos.length === 1 ? '' : 's'}
              </span>
            </div>

            {activos.length === 0 ? (
              <div style={{
                padding: 24, textAlign: 'center', background: colors.surface,
                border: `1px solid ${colors.border}`, borderRadius: 12,
                color: colors.textMute, fontSize: type.sm,
              }}>
                Aún no tienes socios vinculados.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activos.map(row => (
                  <CardSocio
                    key={row.id}
                    row={row}
                    tipo="activa"
                    onDesvincular={(id) => setModalDesvincular({ id })}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {modalRechazar && (
        <ModalRechazo
          titulo="Rechazar solicitud"
          textoBoton="Rechazar"
          onClose={() => setModalRechazar(null)}
          onConfirm={(motivo) => handleRechazar(modalRechazar.id, motivo)}
        />
      )}

      {modalDesvincular && (
        <ModalRechazo
          titulo="Desvincular socio"
          textoBoton="Desvincular"
          onClose={() => setModalDesvincular(null)}
          onConfirm={(motivo) => handleDesvincular(modalDesvincular.id, motivo)}
        />
      )}
    </div>
  )
}
