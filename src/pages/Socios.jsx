import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { sendPush } from '../lib/webPush'
import { confirmar, toast } from '../App'

export default function Socios() {
  const { restaurante } = useRest()
  const [relaciones, setRelaciones] = useState([])
  const [tabPrincipal, setTabPrincipal] = useState('activos') // 'activos' | 'solicitudes' | 'rechazados'
  const [detalle, setDetalle] = useState(null)
  const [tab, setTab] = useState('info')
  const [facturas, setFacturas] = useState([])
  const [mensajes, setMensajes] = useState([])
  const [msgInput, setMsgInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [consentModal, setConsentModal] = useState(null) // { relId, socioNombre }
  const [aceptaTerminos, setAceptaTerminos] = useState(false)

  useEffect(() => { if (restaurante) fetchSocios() }, [restaurante?.id])
  useEffect(() => { setAceptaTerminos(false) }, [consentModal])

  async function fetchSocios() {
    setLoading(true)
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('socio_establecimiento')
      .select('*, socios(id, nombre, nombre_comercial, email, telefono, rating, total_resenas, logo_url, tarifa_base, radio_tarifa_base_km, precio_km_adicional)')
      .eq('establecimiento_id', restaurante.id)
      .or('estado.neq.rechazado,solicitado_at.gte.' + hace30d)
    setRelaciones(data || [])
    setLoading(false)
  }

  async function cambiarEstado(relId, estado) {
    const update = { estado }
    if (estado === 'aceptado') {
      update.aceptado_at = new Date().toISOString()
      update.acepta_publicacion_at = new Date().toISOString()
    }
    await supabase.from('socio_establecimiento').update(update).eq('id', relId)
    const rel = relaciones.find(r => r.id === relId)
    if (rel?.socios?.id) {
      if (estado === 'aceptado') {
        sendPush({ targetType: 'socio', targetId: rel.socios.id, title: '¡Solicitud aceptada!', body: `${restaurante.nombre} ha aceptado tu solicitud. Ya puedes repartir sus pedidos.` })
      } else if (estado === 'rechazado') {
        sendPush({ targetType: 'socio', targetId: rel.socios.id, title: 'Solicitud rechazada', body: `${restaurante.nombre} ha rechazado tu solicitud de vinculación.` })
      }
    }
    fetchSocios()
    setDetalle(null)
  }

  const chatScrollRef = useRef()

  async function abrirDetalle(rel) {
    setDetalle(rel)
    setTab('info')
    const { data: facts } = await supabase.from('facturas_semanales')
      .select('*').eq('socio_id', rel.socios.id).eq('establecimiento_id', restaurante.id)
      .order('semana_inicio', { ascending: false }).limit(10)
    setFacturas(facts || [])
    const { data: msgs } = await supabase.from('mensajes')
      .select('*').eq('tipo', 'socio_restaurante').eq('socio_id', rel.socios.id).eq('establecimiento_id', restaurante.id)
      .order('created_at', { ascending: true }).limit(50)
    setMensajes(msgs || [])
  }

  // Realtime chat
  useEffect(() => {
    if (!detalle || tab !== 'chat') return
    const socioId = detalle.socios.id
    const channel = supabase.channel(`chat-rest-${socioId}-${restaurante.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'mensajes',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        if (payload.new.socio_id === socioId && payload.new.tipo === 'socio_restaurante') {
          setMensajes(prev => {
            if (prev.some(m => m.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [detalle?.socios?.id, tab])

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [mensajes.length])

  async function enviarMensaje() {
    if (!msgInput.trim() || !detalle) return
    const texto = msgInput.trim()
    setMsgInput('')
    try {
      const { data, error } = await supabase.from('mensajes').insert({
        tipo: 'socio_restaurante', socio_id: detalle.socios.id,
        establecimiento_id: restaurante.id, de: 'restaurante', texto,
      }).select().single()
      if (error) throw error
      if (data) {
        setMensajes(prev => {
          if (prev.some(m => m.id === data.id)) return prev
          return [...prev, data]
        })
        sendPush({
          targetType: 'socio',
          targetId: detalle.socios.id,
          title: `Mensaje de ${restaurante.nombre}`,
          body: texto.length > 80 ? texto.substring(0, 80) + '...' : texto,
        })
      }
    } catch (err) {
      console.error('[Chat] Error al enviar:', err)
      setMsgInput(texto)
      toast('No se pudo enviar el mensaje. Intenta de nuevo.')
    }
  }

  const activos = relaciones.filter(r => r.estado === 'aceptado')
  const solicitudes = relaciones.filter(r => r.estado === 'pendiente')
  const rechazados = relaciones.filter(r => r.estado === 'rechazado')

  // ---- Vista detalle del socio ----
  if (detalle) {
    const s = detalle.socios
    const esCaptador = detalle.es_captador === true
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <button onClick={() => setDetalle(null)} style={{ background: 'none', border: 'none', color: 'var(--c-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 16, padding: 0, fontFamily: 'inherit' }}>← Volver</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--c-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, overflow: 'hidden' }}>
            {s.logo_url ? <img src={s.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛵'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{s.nombre_comercial || s.nombre}</div>
            <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>★ {s.rating} · {s.total_resenas} reseñas</div>
          </div>
          {/* Badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {esCaptador && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', color: '#FBBF24' }}>Captador ⭐</span>
            )}
            {detalle.exclusivo
              ? <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.15)', color: '#A78BFA' }}>Exclusivo 🔒</span>
              : <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.12)', color: '#4ADE80' }}>Público</span>
            }
          </div>
        </div>

        {/* Tabs info/facturas/chat */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--c-surface2)', borderRadius: 10, padding: 3, marginBottom: 20 }}>
          {['info', 'facturas', 'chat'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: tab === t ? 'var(--c-primary)' : 'transparent', color: tab === t ? '#fff' : 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{t}</button>
          ))}
        </div>

        {tab === 'info' && (
          <>
            <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 12 }}>
              {[
                { l: 'Nombre', v: s.nombre },
                { l: 'Email', v: s.email },
                { l: 'Teléfono', v: s.telefono },
                { l: 'Rating', v: `★ ${s.rating}` },
                { l: 'Tarifa base', v: `${s.tarifa_base || 3} €` },
                { l: 'Radio tarifa', v: `${s.radio_tarifa_base_km || 3} km` },
                { l: 'Precio/km extra', v: `${s.precio_km_adicional || 0.5} €/km` },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 6 ? '1px solid var(--c-border)' : 'none' }}>
                  <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>{item.l}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{item.v || '—'}</span>
                </div>
              ))}
            </div>

            {esCaptador ? (
              <div style={{ borderRadius: 12, padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 12, color: '#FBBF24', lineHeight: 1.5 }}>
                ⭐ Este socio registró tu negocio en PIDOGO y no puede ser desvinculado. Contacta con soporte si necesitas hacer cambios.
              </div>
            ) : (
              <button onClick={async () => {
                if (!await confirmar('¿Desvincular a este socio? Dejará de repartir para tu restaurante.')) return
                await supabase.from('socio_establecimiento').delete().eq('id', detalle.id)
                setDetalle(null)
                fetchSocios()
              }} style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Desvincular socio
              </button>
            )}
          </>
        )}

        {tab === 'facturas' && (
          <div>
            {facturas.length === 0 && <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--c-muted)', fontSize: 13 }}>Sin facturas</div>}
            {facturas.map((f, i) => (
              <div key={i} style={{ background: 'var(--c-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--c-border)', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{f.semana_inicio} — {f.semana_fin}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: f.estado === 'pagado' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: f.estado === 'pagado' ? '#4ADE80' : '#FBBF24' }}>{f.estado === 'pagado' ? 'Pagado' : 'Pendiente'}</span>
                </div>
                {f.numero_factura && <div style={{ fontSize: 10, color: 'var(--c-primary)', fontWeight: 700, marginBottom: 6 }}>{f.numero_factura}</div>}
                <div style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.6 }}>
                  {f.pedidos_entregados} entregados · Ventas: {f.total_ventas?.toFixed(2)} € · Comisión: {f.total_comisiones?.toFixed(2)} € · Envíos: {f.total_envios?.toFixed(2)} €
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#16A34A' }}>{f.total_ganado?.toFixed(2)} €</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'chat' && (
          <div>
            <div ref={chatScrollRef} style={{ minHeight: 200, maxHeight: 'calc(100vh - 320px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {mensajes.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>
                  <span style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>💬</span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Sin mensajes</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Los mensajes se borran cada semana</div>
                </div>
              )}
              {mensajes.map(m => (
                <div key={m.id || m.created_at} style={{ alignSelf: m.de === 'restaurante' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                  <div style={{
                    background: m.de === 'restaurante' ? 'var(--c-primary)' : 'var(--c-surface)',
                    color: m.de === 'restaurante' ? '#fff' : 'var(--c-text)',
                    borderRadius: m.de === 'restaurante' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    padding: '10px 14px', fontSize: 13, wordBreak: 'break-word',
                    border: m.de !== 'restaurante' ? '1px solid var(--c-border)' : 'none',
                  }}>{m.texto}</div>
                  <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 3, textAlign: m.de === 'restaurante' ? 'right' : 'left' }}>
                    {new Date(m.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviarMensaje()} placeholder="Escribe un mensaje..." style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--c-border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none' }} />
              <button onClick={enviarMensaje} disabled={!msgInput.trim()} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: msgInput.trim() ? 'var(--c-primary)' : 'rgba(255,255,255,0.1)', color: '#fff', cursor: msgInput.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- Vista principal: 3 tabs ----
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>Socios repartidores</h2>

      {/* Tabs principales */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--c-surface2)', borderRadius: 12, padding: 4, marginBottom: 20 }}>
        {[
          { id: 'activos', label: 'Activos' },
          { id: 'solicitudes', label: 'Solicitudes', count: solicitudes.length },
          { id: 'rechazados', label: 'Rechazados' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTabPrincipal(t.id)}
            style={{
              flex: 1, padding: '9px 4px', borderRadius: 9, border: 'none',
              background: tabPrincipal === t.id ? 'var(--c-primary)' : 'transparent',
              color: tabPrincipal === t.id ? '#fff' : 'var(--c-muted)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              position: 'relative',
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{
                background: tabPrincipal === t.id ? 'rgba(255,255,255,0.3)' : '#B91C1C',
                color: '#fff', fontSize: 10, fontWeight: 800,
                width: 18, height: 18, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--c-muted)' }}>Cargando...</div>}

      {/* TAB: ACTIVOS */}
      {tabPrincipal === 'activos' && (
        <div>
          {activos.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>🛵</span>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Sin socios activos</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Los socios que aceptes aparecerán aquí</div>
            </div>
          )}
          {activos.map(r => {
            const esCaptador = r.es_captador === true
            return (
              <div
                key={r.id}
                onClick={() => abrirDetalle(r)}
                style={{ background: 'var(--c-surface)', borderRadius: 14, padding: '14px 16px', border: '1px solid var(--c-border)', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--c-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, overflow: 'hidden', flexShrink: 0 }}>
                  {r.socios?.logo_url
                    ? <img src={r.socios.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🛵'
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.socios?.nombre_comercial || r.socios?.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
                    ★ {r.socios?.rating} · {r.socios?.tarifa_base || 3} € base
                  </div>
                </div>
                {/* Badges */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                  {esCaptador && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(245,158,11,0.15)', color: '#FBBF24', whiteSpace: 'nowrap' }}>Captador ⭐</span>
                  )}
                  {r.exclusivo
                    ? <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(139,92,246,0.15)', color: '#A78BFA', whiteSpace: 'nowrap' }}>Exclusivo 🔒</span>
                    : <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(34,197,94,0.12)', color: '#4ADE80', whiteSpace: 'nowrap' }}>Público</span>
                  }
                </div>
                <span style={{ color: 'var(--c-muted)', fontSize: 16, flexShrink: 0 }}>›</span>
              </div>
            )
          })}
        </div>
      )}

      {/* TAB: SOLICITUDES */}
      {tabPrincipal === 'solicitudes' && (
        <div>
          {solicitudes.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>📬</span>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Sin solicitudes pendientes</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Los socios que soliciten trabajar contigo aparecerán aquí</div>
            </div>
          )}
          {solicitudes.map(r => (
            <div key={r.id} style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 16, border: '2px solid rgba(245,158,11,0.3)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, overflow: 'hidden', flexShrink: 0 }}>
                  {r.socios?.logo_url
                    ? <img src={r.socios.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🛵'
                  }
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{r.socios?.nombre_comercial || r.socios?.nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>
                    ★ {r.socios?.rating || '—'} · {r.socios?.total_resenas || 0} reseñas
                  </div>
                </div>
              </div>

              {/* Tarifa del socio */}
              <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: 'var(--c-muted)', display: 'flex', gap: 12 }}>
                <span>💰 <strong style={{ color: 'var(--c-text)' }}>{r.socios?.tarifa_base || 3} €</strong> base</span>
                <span>📍 hasta <strong style={{ color: 'var(--c-text)' }}>{r.socios?.radio_tarifa_base_km || 3} km</strong></span>
                <span>+<strong style={{ color: 'var(--c-text)' }}>{r.socios?.precio_km_adicional || 0.5} €</strong>/km</span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setConsentModal({ relId: r.id, socioNombre: r.socios?.nombre_comercial || r.socios?.nombre })}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Aceptar
                </button>
                <button
                  onClick={() => cambiarEstado(r.id, 'rechazado')}
                  style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.08)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#EF4444' }}
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB: RECHAZADOS */}
      {tabPrincipal === 'rechazados' && (
        <div>
          {rechazados.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>✅</span>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Sin socios rechazados</div>
            </div>
          )}
          {rechazados.map(r => (
            <div key={r.id} style={{ background: 'var(--c-surface)', borderRadius: 14, padding: '14px 16px', border: '1px solid var(--c-border)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--c-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🛵</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.socios?.nombre_comercial || r.socios?.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>★ {r.socios?.rating || '—'}</div>
                </div>
              </div>
              <button
                onClick={() => setConsentModal({ relId: r.id, socioNombre: r.socios?.nombre_comercial || r.socios?.nombre })}
                style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: 'var(--c-surface2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-primary)' }}
              >
                Reactivar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal de consentimiento de publicación */}
      {consentModal && (
        <div onClick={() => setConsentModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1A1A1A', borderRadius: '20px 20px 0 0', padding: '24px 20px',
            width: '100%', maxWidth: 500, border: '1px solid rgba(255,255,255,0.1)',
            borderBottom: 'none', animation: 'slideUp 0.3s ease',
            maxHeight: '85vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#F5F5F5' }}>Autorizar publicación</div>
              <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 6 }}>
                Socio: <strong style={{ color: '#F5F5F5' }}>{consentModal.socioNombre}</strong>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 16, marginBottom: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F5F5', marginBottom: 12 }}>Al aceptar, autorizas lo siguiente:</div>
              {[
                'Tu carta de productos será visible en la tienda pública del socio repartidor, accesible para cualquier cliente.',
                'Los clientes podrán realizar pedidos de tus productos a través del socio repartidor.',
                'El socio repartidor se encargará de la entrega de los pedidos realizados en su tienda.',
                'Puedes revocar esta autorización en cualquier momento desvinculando al socio.',
              ].map((txt, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < 3 ? 10 : 0, fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--c-primary)', fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>•</span>
                  <span>{txt}</span>
                </div>
              ))}
            </div>

            <button onClick={() => setAceptaTerminos(!aceptaTerminos)} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0',
              marginBottom: 20, textAlign: 'left', fontFamily: 'inherit',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                border: aceptaTerminos ? 'none' : '2px solid rgba(255,255,255,0.25)',
                background: aceptaTerminos ? 'var(--c-primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                {aceptaTerminos && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: aceptaTerminos ? '#F5F5F5' : 'var(--c-muted)', lineHeight: 1.4 }}>
                He leído y acepto la publicación de mi carta en la tienda del socio
              </span>
            </button>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConsentModal(null)} style={{
                flex: 1, padding: '14px 0', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancelar</button>
              <button onClick={() => {
                cambiarEstado(consentModal.relId, 'aceptado')
                setConsentModal(null)
              }} disabled={!aceptaTerminos} style={{
                flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                background: aceptaTerminos ? '#16A34A' : 'rgba(22,163,74,0.3)',
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: aceptaTerminos ? 'pointer' : 'default',
                fontFamily: 'inherit', transition: 'background 0.2s',
              }}>Aceptar y autorizar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
