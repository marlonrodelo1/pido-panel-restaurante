import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { startAlarm, stopAlarm, unlockAudio } from '../lib/alarm'
import { sendPush } from '../lib/webPush'
import { imprimirPedido, imprimirPedidoWeb } from '../lib/printService'
import { Capacitor } from '@capacitor/core'
import { ChevronLeft } from 'lucide-react'
import { toast } from '../App'

// ─── Badges ────────────────────────────────────────────────────────────────
function PagoBadge({ pago }) {
  const t = pago === 'tarjeta'
  return <span style={{ background: t ? '#DBEAFE' : '#DCFCE7', color: t ? '#1E40AF' : '#166534', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{t ? '💳 Tarjeta' : '💵 Efectivo'}</span>
}
function CanalBadge() {
  return <span style={{ background: '#FFF7ED', color: '#C2410C', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>📱 PIDO</span>
}
function EstadoBadge({ estado }) {
  const map = {
    preparando: { bg: '#FEF3C7', c: '#92400E', label: 'Preparando' },
    aceptado:   { bg: '#FEF3C7', c: '#92400E', label: 'Preparando' },
    listo:      { bg: '#DCFCE7', c: '#166534', label: 'Listo' },
    recogido:   { bg: '#DBEAFE', c: '#1E40AF', label: 'Recogido' },
    en_camino:  { bg: '#F3E8FF', c: '#6B21A8', label: 'En camino' },
    nuevo:      { bg: '#FEE2E2', c: '#991B1B', label: 'Nuevo' },
  }
  const s = map[estado] || { bg: '#F3F4F6', c: '#6B7280', label: estado }
  return <span style={{ background: s.bg, color: s.c, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{s.label}</span>
}

// ─── Constantes ────────────────────────────────────────────────────────────
const MOTIVOS_RECHAZO = [
  { id: 'sin_personal', label: 'No tenemos personal', icon: '👤' },
  { id: 'sin_productos', label: 'No hay productos disponibles', icon: '📦' },
  { id: 'mucha_demanda', label: 'Mucha demanda ahora mismo', icon: '🔥' },
]
const MOTIVOS_CANCELACION = [
  { id: 'sin_rider', label: 'Sin repartidor disponible', icon: '🛵' },
  { id: 'sin_stock', label: 'Producto agotado', icon: '📦' },
  { id: 'problema_cocina', label: 'Problema en cocina', icon: '🍳' },
  { id: 'cliente_no_contesta', label: 'Cliente no contesta', icon: '📵' },
  { id: 'otro', label: 'Otro motivo', icon: '❌' },
]

const formatTimer = s => {
  if (!s || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function PedidosEnVivo() {
  const { restaurante } = useRest()
  const [entrantes, setEntrantes] = useState([])
  const [activos, setActivos] = useState([])
  const [itemsMap, setItemsMap] = useState({})
  const [timers, setTimers] = useState({})
  const [loadingInicial, setLoadingInicial] = useState(true)
  const [pedidoDetalleId, setPedidoDetalleId] = useState(null)

  // ── Cerrar detalle si el pedido desaparece (cancelado/entregado) ──────────
  useEffect(() => {
    if (!pedidoDetalleId) return
    const existe = [...entrantes, ...activos].some(p => p.id === pedidoDetalleId)
    if (!existe) setPedidoDetalleId(null)
  }, [entrantes, activos])

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!restaurante) return
    fetchPedidos()

    const channel = supabase.channel('pedidos-rest')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, async payload => {
        let pedidoConCliente = payload.new
        if (payload.new.usuario_id) {
          const { data: usr } = await supabase.from('usuarios').select('nombre, apellido, telefono').eq('id', payload.new.usuario_id).single()
          if (usr) pedidoConCliente = { ...payload.new, usuarios: usr }
        }
        setEntrantes(prev => [pedidoConCliente, ...prev])
        setTimers(prev => ({ ...prev, [payload.new.id]: 180 }))
        const { data: newItems } = await supabase.from('pedido_items').select('*').eq('pedido_id', payload.new.id)
        if (newItems?.length > 0) setItemsMap(prev => ({ ...prev, [payload.new.id]: newItems }))
        startAlarm()
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        const p = payload.new
        if (['entregado', 'cancelado'].includes(p.estado)) {
          setActivos(prev => prev.filter(x => x.id !== p.id))
          setEntrantes(prev => {
            const remaining = prev.filter(x => x.id !== p.id)
            if (remaining.length === 0) stopAlarm()
            return remaining
          })
        } else if (['aceptado', 'preparando', 'listo', 'recogido', 'en_camino'].includes(p.estado)) {
          setActivos(prev => prev.map(x => x.id === p.id ? { ...x, ...p } : x))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurante?.id])

  // ── Timer countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (entrantes.length === 0) return
    const i = setInterval(() => {
      setTimers(prev => {
        const n = { ...prev }
        Object.keys(n).forEach(id => {
          if (n[id] > 0) { n[id] -= 1 }
          else if (n[id] === 0) { n[id] = -1; autoCancelarPedido(id) }
        })
        return n
      })
    }, 1000)
    return () => clearInterval(i)
  }, [entrantes.length])

  // ── Polling rider timeout ──────────────────────────────────────────────────
  useEffect(() => {
    if (activos.length === 0) return
    const check = () => {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rider_timeout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: '{}',
      }).then(() => fetchPedidos()).catch(() => {})
    }
    const interval = setInterval(check, 30000)
    check()
    return () => clearInterval(interval)
  }, [activos.length])

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchPedidos() {
    try {
      const [{ data: nuevos }, { data: prep }] = await Promise.all([
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono)').eq('establecimiento_id', restaurante.id).eq('estado', 'nuevo').order('created_at', { ascending: false }),
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono)').eq('establecimiento_id', restaurante.id).in('estado', ['aceptado', 'preparando', 'listo', 'recogido', 'en_camino']).order('created_at', { ascending: false }),
      ])
      setEntrantes(nuevos || [])
      setActivos(prep || [])
      if ((nuevos || []).length > 0) startAlarm()
      const t = {}
      for (const p of nuevos || []) t[p.id] = 180
      setTimers(t)
      const allIds = [...(nuevos || []), ...(prep || [])].map(p => p.id)
      if (allIds.length > 0) {
        const { data: items } = await supabase.from('pedido_items').select('*').in('pedido_id', allIds)
        const map = {}
        for (const item of items || []) {
          if (!map[item.pedido_id]) map[item.pedido_id] = []
          map[item.pedido_id].push(item)
        }
        setItemsMap(map)
      }
    } catch (err) { console.error('[Pedidos]', err) }
    setLoadingInicial(false)
  }

  // ── Acciones ───────────────────────────────────────────────────────────────
  async function aceptarPedido(pedido, minutos) {
    const now = new Date().toISOString()
    await supabase.from('pedidos').update({
      estado: 'preparando', minutos_preparacion: minutos, aceptado_at: now,
    }).eq('id', pedido.id)
    setEntrantes(prev => { const r = prev.filter(p => p.id !== pedido.id); if (!r.length) stopAlarm(); return r })
    setActivos(prev => [{ ...pedido, estado: 'preparando', minutos_preparacion: minutos }, ...prev])
    setTimers(prev => { const n = { ...prev }; delete n[pedido.id]; return n })
    if (pedido.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido aceptado', body: `Tu pedido ${pedido.codigo} está siendo preparado (~${minutos} min)` })
    imprimirPedido({ ...pedido, minutos_preparacion: minutos }, itemsMap[pedido.id] || [], restaurante).catch(() => {})
    // Fire-and-forget: enviar pedido a Shipday para asignación de rider
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          console.error('[Shipday] Sin sesión activa, no se puede crear order')
          return
        }
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-shipday-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ pedido_id: pedido.id }),
        })
        if (!res.ok) {
          const body = await res.text()
          console.error(`[Shipday] Error ${res.status}:`, body)
        } else {
          console.log('[Shipday] Order creada para pedido', pedido.id)
        }
      } catch (err) {
        console.error('[Shipday] Error al crear order:', err)
      }
    })()
  }

  async function rechazarPedido(id, motivo) {
    const pedido = entrantes.find(p => p.id === id)
    const motivoTexto = MOTIVOS_RECHAZO.find(m => m.id === motivo)?.label || motivo || 'El restaurante no pudo aceptar tu pedido'
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() }).eq('id', id)
    setEntrantes(prev => { const r = prev.filter(p => p.id !== id); if (!r.length) stopAlarm(); return r })
    if (pedido?.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado: ${motivoTexto}` })
  }

  async function autoCancelarPedido(id) {
    const { data: pedido } = await supabase.from('pedidos').select('id, codigo, usuario_id, estado').eq('id', id).single()
    if (!pedido || pedido.estado !== 'nuevo') return
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: 'El restaurante no respondió a tiempo', cancelado_at: new Date().toISOString() }).eq('id', id)
    setEntrantes(prev => { const r = prev.filter(p => p.id !== id); if (!r.length) stopAlarm(); return r })
    if (pedido?.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado porque el restaurante no respondió a tiempo` })
  }

  async function cancelarPedidoActivo(pedido, motivoId) {
    const motivoTexto = MOTIVOS_CANCELACION.find(m => m.id === motivoId)?.label || 'Cancelado por el restaurante'
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() }).eq('id', pedido.id)
    setActivos(prev => prev.filter(p => p.id !== pedido.id))
    if (pedido.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado: ${motivoTexto}` })
  }

  async function marcarListo(id) {
    await supabase.from('pedidos').update({ estado: 'listo' }).eq('id', id)
    setActivos(prev => prev.map(p => p.id === id ? { ...p, estado: 'listo' } : p))
  }

  async function marcarRecogido(id) {
    await supabase.from('pedidos').update({ estado: 'recogido', recogido_at: new Date().toISOString() }).eq('id', id)
    setActivos(prev => prev.map(p => p.id === id ? { ...p, estado: 'recogido' } : p))
  }

  async function marcarEntregado(id) {
    const pedido = activos.find(p => p.id === id)
    await supabase.from('pedidos').update({ estado: 'entregado', entregado_at: new Date().toISOString() }).eq('id', id)
    setActivos(prev => prev.filter(p => p.id !== id))
    supabase.functions.invoke('calcular_comisiones', { body: { pedido_id: id } }).catch(() => {})
    if (pedido?.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido entregado', body: `Tu pedido ${pedido.codigo} ha sido entregado. ¡Gracias!` })
  }

  function reimprimir(pedido) {
    const items = itemsMap[pedido.id] || []
    if (Capacitor.isNativePlatform()) {
      imprimirPedido(pedido, items, restaurante).then(r => { if (!r?.ok) toast('No se pudo imprimir. Verifica la IP de la impresora en Config.') }).catch(() => toast('Error de conexión con la impresora.'))
    } else {
      imprimirPedidoWeb(pedido, items, restaurante)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadingInicial) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 0', color: 'var(--c-muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Cargando pedidos...</div>
      </div>
    )
  }

  // Pantalla de detalle
  const pedidoDetalle = pedidoDetalleId ? [...entrantes, ...activos].find(p => p.id === pedidoDetalleId) : null
  if (pedidoDetalleId && pedidoDetalle) {
    return (
      <DetallePedido
        pedido={pedidoDetalle}
        items={itemsMap[pedidoDetalle.id] || []}
        timer={timers[pedidoDetalle.id]}
        isNuevo={entrantes.some(p => p.id === pedidoDetalle.id)}
        restaurante={restaurante}
        onVolver={() => setPedidoDetalleId(null)}
        onAceptar={aceptarPedido}
        onRechazar={rechazarPedido}
        onMarcarListo={marcarListo}
        onMarcarRecogido={marcarRecogido}
        onMarcarEntregado={marcarEntregado}
        onCancelar={cancelarPedidoActivo}
        onReimprimir={reimprimir}
      />
    )
  }

  // Secciones de la lista
  const preparando = activos.filter(p => ['aceptado', 'preparando'].includes(p.estado))
  const listos = activos.filter(p => p.estado === 'listo')
  const enCamino = activos.filter(p => ['recogido', 'en_camino'].includes(p.estado))
  const hayAlgo = entrantes.length + activos.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Pedidos en vivo</h2>
        <button onClick={() => { unlockAudio(); startAlarm(); setTimeout(stopAlarm, 2000) }} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-muted)' }}>
          🔔 Probar alarma
        </button>
      </div>

      {!hayAlgo && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--c-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🍽️</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Esperando nuevos pedidos...</div>
        </div>
      )}

      {/* 🔴 Nuevos */}
      {entrantes.length > 0 && (
        <SeccionPedidos titulo="Nuevos" color="#B91C1C" bg="rgba(185,28,28,0.08)" border="rgba(185,28,28,0.2)">
          {entrantes.map(p => (
            <LineaPedido key={p.id} pedido={p} timer={timers[p.id]} isNuevo onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {/* 🟡 En preparación */}
      {preparando.length > 0 && (
        <SeccionPedidos titulo="En preparación" color="#92400E" bg="rgba(251,191,36,0.08)" border="rgba(251,191,36,0.2)">
          {preparando.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {/* 🟢 Listos */}
      {listos.length > 0 && (
        <SeccionPedidos titulo="Listos para recoger" color="#166534" bg="rgba(34,197,94,0.08)" border="rgba(34,197,94,0.2)">
          {listos.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {/* 🔵 En camino */}
      {enCamino.length > 0 && (
        <SeccionPedidos titulo="En camino" color="#1E40AF" bg="rgba(59,130,246,0.08)" border="rgba(59,130,246,0.2)">
          {enCamino.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}
    </div>
  )
}

// ─── Sección ───────────────────────────────────────────────────────────────
function SeccionPedidos({ titulo, color, bg, border, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
        <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</span>
      </div>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Línea de pedido (lista) ───────────────────────────────────────────────
function LineaPedido({ pedido, timer, isNuevo, onTap }) {
  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  return (
    <button onClick={onTap} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 16px', background: 'none', border: 'none',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    }}>
      {/* Código */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--c-text)' }}>{pedido.codigo}</span>
          <EstadoBadge estado={pedido.estado} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 500 }}>{nombre}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Timer (solo nuevos) */}
      {isNuevo && timer != null && timer > 0 && (
        <span style={{
          fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: timer < 60 ? '#EF4444' : '#FBBF24',
          animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }}>{formatTimer(timer)}</span>
      )}

      {/* Total */}
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--c-text)', flexShrink: 0 }}>
        {(pedido.total || 0).toFixed(2)} €
      </span>

      {/* Chevron */}
      <ChevronLeft size={16} style={{ transform: 'rotate(180deg)', color: 'var(--c-muted)', flexShrink: 0 }} />
    </button>
  )
}

// ─── Pantalla de detalle ───────────────────────────────────────────────────
function DetallePedido({ pedido, items, timer, isNuevo, restaurante, onVolver, onAceptar, onRechazar, onMarcarListo, onMarcarRecogido, onMarcarEntregado, onCancelar, onReimprimir }) {
  const [rechazando, setRechazando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [aceptando, setAceptando] = useState(false)

  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      {/* Header detalle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onVolver} style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
          borderRadius: 10, border: '1px solid var(--c-border)', background: 'var(--c-surface)',
          color: 'var(--c-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <ChevronLeft size={16} /> Volver
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>{pedido.codigo}</span>
            <EstadoBadge estado={pedido.estado} />
          </div>
        </div>
        {isNuevo && timer != null && timer > 0 && (
          <div style={{
            background: timer < 60 ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)',
            borderRadius: 10, padding: '6px 12px',
            color: timer < 60 ? '#EF4444' : '#FBBF24',
            fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          }}>{formatTimer(timer)}</div>
        )}
      </div>

      {/* Info cliente */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 16, marginBottom: 12, border: '1px solid var(--c-border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cliente</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: pedido.usuarios?.telefono ? 6 : 0 }}>
          <span style={{ fontSize: 16 }}>👤</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{nombre}</span>
        </div>
        {pedido.usuarios?.telefono && (
          <div style={{ fontSize: 12, color: 'var(--c-muted)', paddingLeft: 24 }}>📞 {pedido.usuarios.telefono}</div>
        )}
        {pedido.direccion_entrega && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 0 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>📍</span>
            <span style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>{pedido.direccion_entrega}</span>
          </div>
        )}
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <CanalBadge canal={pedido.canal} />
        <PagoBadge pago={pedido.metodo_pago} />
        {pedido.metodo_pago === 'efectivo' && <span style={{ fontSize: 10, fontWeight: 600, color: '#FBBF24', background: 'rgba(251,191,36,0.1)', padding: '3px 8px', borderRadius: 6 }}>⚠️ Cobrar en efectivo</span>}
      </div>

      {/* Productos */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 16, marginBottom: 12, border: '1px solid var(--c-border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Productos</div>
        {items.map((item, i) => (
          <div key={i} style={{ marginBottom: i < items.length - 1 ? 10 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{item.cantidad}x {item.nombre_producto}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{(item.precio_unitario * item.cantidad).toFixed(2)} €</span>
            </div>
            {item.extras_texto && <div style={{ fontSize: 11, color: 'var(--c-muted)', paddingLeft: 12, marginTop: 2 }}>+ {item.extras_texto}</div>}
            {item.tamano && <div style={{ fontSize: 11, color: 'var(--c-muted)', paddingLeft: 12, marginTop: 2 }}>{item.tamano}</div>}
          </div>
        ))}
        {pedido.notas && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--c-surface2)', borderRadius: 8, fontSize: 12, color: 'var(--c-muted)', fontStyle: 'italic' }}>
            📝 {pedido.notas}
          </div>
        )}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{(pedido.total || 0).toFixed(2)} €</span>
        </div>
      </div>

      {/* ── Acciones según estado ── */}

      {/* NUEVO: aceptar + rechazar */}
      {isNuevo && (
        <div style={{ marginBottom: 12 }}>
          {rechazando ? (
            <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 10 }}>Motivo del rechazo:</div>
              {MOTIVOS_RECHAZO.map(m => (
                <button key={m.id} onClick={() => { onRechazar(pedido.id, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>{m.icon} {m.label}</button>
              ))}
              <button onClick={() => setRechazando(false)} style={{ width: '100%', padding: '8px 0', borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            </div>
          ) : aceptando ? (
            <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: '14px 16px', border: '1px solid var(--c-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-muted)', marginBottom: 10 }}>Tiempo de preparación:</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[15, 20, 30, 45].map(min => (
                  <button key={min} onClick={() => { onAceptar(pedido, min); onVolver() }} style={{ flex: 1, padding: '14px 0', borderRadius: 10, border: 'none', background: 'var(--c-primary)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{min}<br /><span style={{ fontSize: 10, fontWeight: 600 }}>min</span></button>
                ))}
              </div>
              <button onClick={() => setAceptando(false)} style={{ width: '100%', marginTop: 8, padding: '8px 0', borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setRechazando(true)} style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: '2px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#EF4444', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Rechazar</button>
              <button onClick={() => setAceptando(true)} style={{ flex: 2, padding: '14px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #16A34A, #22C55E)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>✅ Aceptar pedido</button>
            </div>
          )}
        </div>
      )}

      {/* PREPARANDO: listo + reimprimir */}
      {(pedido.estado === 'preparando' || pedido.estado === 'aceptado') && !isNuevo && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => onReimprimir(pedido)} style={{ padding: '13px 16px', borderRadius: 12, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Reimprimir</button>
          <button onClick={() => { onMarcarListo(pedido.id); onVolver() }} style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: '#16A34A', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✅ Pedido listo para recoger</button>
        </div>
      )}

      {/* LISTO: recogida en local */}
      {pedido.estado === 'listo' && pedido.modo_entrega === 'recogida' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: '#DCFCE7', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#166534' }}>🏪 Esperando al cliente</div>
          <button onClick={() => { onMarcarEntregado(pedido.id); onVolver() }} style={{ padding: '13px 18px', borderRadius: 12, border: 'none', background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Entregado</button>
        </div>
      )}

      {/* LISTO: delivery */}
      {pedido.estado === 'listo' && pedido.modo_entrega !== 'recogida' && (
        <div style={{ padding: '13px 16px', borderRadius: 12, background: '#DCFCE7', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 12 }}>
          🛵 Esperando repartidor (Shipday)
        </div>
      )}

      {/* RECOGIDO */}
      {pedido.estado === 'recogido' && (
        <div style={{ padding: '13px 16px', borderRadius: 12, background: '#DBEAFE', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#1E40AF', marginBottom: 12 }}>
          🛵 Repartidor recogió el pedido — en camino al cliente
        </div>
      )}

      {/* EN CAMINO */}
      {pedido.estado === 'en_camino' && (
        <div style={{ padding: '13px 16px', borderRadius: 12, background: '#F3E8FF', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#6B21A8', marginBottom: 12 }}>
          📍 Repartidor en camino al cliente
        </div>
      )}

      {/* Cancelar (todos los activos) */}
      {!isNuevo && (
        cancelando ? (
          <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 10 }}>Motivo de cancelación:</div>
            {MOTIVOS_CANCELACION.map(m => (
              <button key={m.id} onClick={() => { onCancelar(pedido, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>{m.icon} {m.label}</button>
            ))}
            <button onClick={() => setCancelando(false)} style={{ width: '100%', padding: '8px 0', borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Volver</button>
          </div>
        ) : (
          <button onClick={() => setCancelando(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.06)', color: '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar pedido</button>
        )
      )}
    </div>
  )
}
