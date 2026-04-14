import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast, confirmar } from '../App'

export default function Socios() {
  const { restaurante } = useRest()
  const [relaciones, setRelaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [accionando, setAccionando] = useState(null)
  const [modalConsentimiento, setModalConsentimiento] = useState(null) // { rel }
  const [consentChecked, setConsentChecked] = useState(false)

  useEffect(() => {
    if (!restaurante) return
    cargar()

    const channel = supabase
      .channel(`socios-rest-${restaurante.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'socio_establecimiento',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, () => cargar())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurante?.id])

  async function cargar() {
    const { data, error } = await supabase
      .from('socio_establecimiento')
      .select(`
        id, socio_id, estado, exclusivo, es_captador, destacado,
        solicitado_at, aceptado_at, acepta_publicacion_at,
        socios(id, nombre, nombre_comercial, logo_url, slug, rating, telefono, en_servicio)
      `)
      .eq('establecimiento_id', restaurante.id)
      .in('estado', ['pendiente', 'aceptado'])
      .order('solicitado_at', { ascending: false })

    if (!error) setRelaciones(data || [])
    setLoading(false)
  }

  function abrirModalAceptar(rel) {
    setConsentChecked(false)
    setModalConsentimiento(rel)
  }

  async function confirmarAceptar() {
    if (!modalConsentimiento || !consentChecked) return
    const rel = modalConsentimiento
    setAccionando(rel.id)
    setModalConsentimiento(null)

    const { error } = await supabase
      .from('socio_establecimiento')
      .update({
        estado: 'aceptado',
        aceptado_at: new Date().toISOString(),
        acepta_publicacion_at: new Date().toISOString(),
      })
      .eq('id', rel.id)

    setAccionando(null)
    if (error) {
      toast('Error al aceptar el socio')
    } else {
      toast('Socio aceptado', 'success')
      cargar()
    }
  }

  async function rechazar(rel) {
    const ok = await confirmar(`¿Rechazar la solicitud de ${rel.socios?.nombre_comercial || rel.socios?.nombre}?`)
    if (!ok) return
    setAccionando(rel.id)

    const { error } = await supabase
      .from('socio_establecimiento')
      .update({ estado: 'rechazado' })
      .eq('id', rel.id)

    setAccionando(null)
    if (error) {
      toast('Error al rechazar')
    } else {
      toast('Solicitud rechazada', 'success')
      cargar()
    }
  }

  async function desvincular(rel) {
    const ok = await confirmar(`¿Desvincular a ${rel.socios?.nombre_comercial || rel.socios?.nombre}? Dejará de recibir pedidos de tu restaurante.`)
    if (!ok) return
    setAccionando(rel.id)

    const { error } = await supabase
      .from('socio_establecimiento')
      .update({ estado: 'rechazado' })
      .eq('id', rel.id)

    setAccionando(null)
    if (error) {
      toast('Error al desvincular')
    } else {
      toast('Socio desvinculado', 'success')
      cargar()
    }
  }

  const pendientes = relaciones.filter(r => r.estado === 'pendiente')
  const activos = relaciones.filter(r => r.estado === 'aceptado')

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)', fontSize: 13 }}>
        Cargando socios...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '-0.02em' }}>
          Socios repartidores
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 3 }}>
          Gestiona quién puede repartir desde tu restaurante
        </div>
      </div>

      {/* Solicitudes pendientes */}
      {pendientes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
              Solicitudes pendientes
            </span>
            <span style={{
              background: '#EF4444', color: '#fff',
              fontSize: 11, fontWeight: 800,
              padding: '2px 7px', borderRadius: 8,
            }}>
              {pendientes.length}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendientes.map(rel => (
              <SocioCard
                key={rel.id}
                rel={rel}
                tipo="pendiente"
                accionando={accionando === rel.id}
                onAceptar={() => abrirModalAceptar(rel)}
                onRechazar={() => rechazar(rel)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Socios activos */}
      {activos.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', marginBottom: 12 }}>
            Socios activos
            <span style={{ color: 'var(--c-muted)', fontWeight: 600, marginLeft: 6 }}>
              ({activos.length})
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activos.map(rel => (
              <SocioCard
                key={rel.id}
                rel={rel}
                tipo="activo"
                accionando={accionando === rel.id}
                onDesvincular={() => desvincular(rel)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {pendientes.length === 0 && activos.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '48px 20px',
          background: 'var(--c-surface)', borderRadius: 16,
          border: '1px solid var(--c-border)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 6 }}>
            Sin socios vinculados
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.5 }}>
            Cuando un socio solicite vincularse a tu restaurante,<br />
            verás la solicitud aquí en tiempo real.
          </div>
        </div>
      )}

      {/* Modal consentimiento */}
      {modalConsentimiento && (
        <ModalConsentimiento
          rel={modalConsentimiento}
          checked={consentChecked}
          onCheck={setConsentChecked}
          onConfirmar={confirmarAceptar}
          onCerrar={() => setModalConsentimiento(null)}
        />
      )}
    </div>
  )
}

// ── SocioCard ──────────────────────────────────────────────────────────────────

function SocioCard({ rel, tipo, accionando, onAceptar, onRechazar, onDesvincular }) {
  const socio = rel.socios || {}
  const fecha = rel.solicitado_at
    ? new Date(rel.solicitado_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    : ''

  return (
    <div style={{
      background: 'var(--c-surface)',
      borderRadius: 14,
      border: `1px solid var(--c-border)`,
      borderLeft: tipo === 'pendiente' ? '3px solid #F59E0B' : '1px solid var(--c-border)',
      padding: '14px 16px',
      opacity: accionando ? 0.6 : 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Fila superior */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: 'var(--c-surface2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, overflow: 'hidden', flexShrink: 0,
        }}>
          {socio.logo_url
            ? <img src={socio.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : '🛵'}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>
              {socio.nombre_comercial || socio.nombre || '—'}
            </span>
            {tipo === 'activo' && (
              <>
                <span style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>
                  Activo
                </span>
                {rel.exclusivo
                  ? <span style={{ background: 'rgba(185,28,28,0.1)', color: 'var(--c-primary)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>Exclusivo</span>
                  : <span style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--c-muted)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>Público</span>
                }
                {rel.es_captador && (
                  <span style={{ background: 'rgba(99,102,241,0.12)', color: '#818CF8', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>Captador</span>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
            {socio.slug && (
              <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>@{socio.slug}</span>
            )}
            {socio.rating > 0 && (
              <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>★ {socio.rating.toFixed(1)}</span>
            )}
            {tipo === 'activo' && socio.en_servicio && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4ADE80', fontWeight: 600 }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: '#4ADE80',
                  boxShadow: '0 0 0 0 rgba(74,222,128,0.4)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                En servicio
              </span>
            )}
            {tipo === 'pendiente' && fecha && (
              <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>Solicitó el {fecha}</span>
            )}
          </div>
        </div>
      </div>

      {/* Teléfono */}
      {socio.telefono && (
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 10 }}>
          📞 {socio.telefono}
        </div>
      )}

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8 }}>
        {tipo === 'pendiente' && (
          <>
            <button
              onClick={onAceptar}
              disabled={accionando}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: '#16A34A', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ✓ Aceptar
            </button>
            <button
              onClick={onRechazar}
              disabled={accionando}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                border: '1px solid #EF4444', background: 'transparent',
                color: '#EF4444', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ✗ Rechazar
            </button>
          </>
        )}
        {tipo === 'activo' && (
          <button
            onClick={onDesvincular}
            disabled={accionando}
            style={{
              padding: '9px 16px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
              color: 'var(--c-muted)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Desvincular
          </button>
        )}
      </div>
    </div>
  )
}

// ── Modal consentimiento publicación ──────────────────────────────────────────

function ModalConsentimiento({ rel, checked, onCheck, onConfirmar, onCerrar }) {
  const socio = rel.socios || {}
  const nombre = socio.nombre_comercial || socio.nombre || 'este socio'

  return (
    <div
      onClick={onCerrar}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 9000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1A1A1A',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px 32px',
          width: '100%',
          maxWidth: 480,
          border: '1px solid rgba(255,255,255,0.1)',
          borderBottom: 'none',
          animation: 'slideUp 0.3s ease',
        }}
      >
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.15)',
          margin: '0 auto 20px',
        }} />

        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)', marginBottom: 10 }}>
          Autorización de publicación
        </div>

        <div style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.6, marginBottom: 20 }}>
          Al aceptar a <strong style={{ color: 'var(--c-text)' }}>{nombre}</strong>, autorizas a PIDOGO a mostrar tu restaurante en su tienda pública. Los clientes de {nombre} podrán ver tu carta y hacer pedidos.
        </div>

        {/* Checkbox */}
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '14px 16px',
          background: 'var(--c-surface2)',
          borderRadius: 12,
          border: checked ? '1px solid #16A34A' : '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer',
          marginBottom: 20,
          transition: 'border-color 0.2s',
        }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onCheck(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: '#16A34A', marginTop: 1, flexShrink: 0, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
            He leído y acepto que mi restaurante sea visible en la tienda pública de este socio
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCerrar}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', color: 'rgba(255,255,255,0.6)',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={!checked}
            style={{
              flex: 2, padding: '13px 0', borderRadius: 12, border: 'none',
              background: checked ? '#16A34A' : 'rgba(22,163,74,0.3)',
              color: checked ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 14, fontWeight: 700,
              cursor: checked ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              transition: 'all 0.2s',
            }}
          >
            Confirmar aceptación
          </button>
        </div>
      </div>
    </div>
  )
}
