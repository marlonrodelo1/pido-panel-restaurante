import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { startAlarm, stopAlarm, unlockAudio } from '../lib/alarm'
import { sendPush } from '../lib/webPush'
import { imprimirPedido, imprimirPedidoWeb } from '../lib/printService'
import { Capacitor } from '@capacitor/core'
import { toast } from '../App'

// ─── Badges ────────────────────────────────────────────────────────────────
function PagoBadge({ pago }) {
  const t = pago === 'tarjeta'
  return <span style={{ background: t ? 'rgba(96,165,250,0.15)' : 'rgba(74,222,128,0.12)', color: t ? '#93c5fd' : '#86efac', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>{t ? 'Tarjeta' : 'Efectivo'}</span>
}
function CanalBadge() {
  return <span style={{ background: 'rgba(251,146,60,0.12)', color: '#fdba74', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>PIDO</span>
}
function EstadoBadge({ estado }) {
  const map = {
    preparando: { bg: 'rgba(251,191,36,0.12)', c: '#fcd34d', label: 'Preparando' },
    aceptado:   { bg: 'rgba(251,191,36,0.12)', c: '#fcd34d', label: 'Preparando' },
    listo:      { bg: 'rgba(74,222,128,0.12)', c: '#86efac', label: 'Listo' },
    recogido:   { bg: 'rgba(96,165,250,0.12)', c: '#93c5fd', label: 'Recogido' },
    en_camino:  { bg: 'rgba(167,139,250,0.12)', c: '#c4b5fd', label: 'En camino' },
    nuevo:      { bg: 'rgba(185,28,28,0.2)', c: '#fca5a5', label: 'Nuevo' },
  }
  const s = map[estado] || { bg: '#242424', c: '#ab8985', label: estado }
  return <span style={{ background: s.bg, color: s.c, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{s.label}</span>
}

// ─── Constantes ────────────────────────────────────────────────────────────
const MOTIVOS_RECHAZO = [
  { id: 'sin_personal', label: 'No tenemos personal' },
  { id: 'sin_productos', label: 'No hay productos disponibles' },
  { id: 'mucha_demanda', label: 'Mucha demanda ahora mismo' },
]
const MOTIVOS_CANCELACION = [
  { id: 'sin_rider', label: 'Sin repartidor disponible' },
  { id: 'sin_stock', label: 'Producto agotado' },
  { id: 'problema_cocina', label: 'Problema en cocina' },
  { id: 'cliente_no_contesta', label: 'Cliente no contesta' },
  { id: 'otro', label: 'Otro motivo' },
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
        if (payload.new.canal !== 'pido') return
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
        if (payload.new.canal !== 'pido') return
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
          else if (n[id] === 0) {
            n[id] = -1
            autoCancelarPedido(id).catch(err => {
              console.error(`[AutoCancel] Error cancelando pedido ${id}:`, err)
              setEntrantes(prev => prev.map(p => p.id === id ? { ...p, cancelError: true } : p))
            })
          }
        })
        return n
      })
    }, 1000)
    return () => clearInterval(i)
  }, [entrantes.length, restaurante?.id])

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchPedidos() {
    try {
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [{ data: nuevos }, { data: prep }] = await Promise.all([
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono)').eq('establecimiento_id', restaurante.id).eq('estado', 'nuevo').gte('created_at', hace24h).order('created_at', { ascending: false }),
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono)').eq('establecimiento_id', restaurante.id).in('estado', ['aceptado', 'preparando', 'listo', 'recogido', 'en_camino']).gte('created_at', hace24h).order('created_at', { ascending: false }),
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
    const { error: updateError } = await supabase.from('pedidos').update({
      estado: 'preparando', minutos_preparacion: minutos, aceptado_at: now,
    }).eq('id', pedido.id)
    if (updateError) {
      console.error('[aceptarPedido] Error actualizando BD:', updateError)
      toast('Error al aceptar el pedido. Intenta de nuevo.', 'error')
      return
    }
    setEntrantes(prev => { const r = prev.filter(p => p.id !== pedido.id); if (!r.length) stopAlarm(); return r })
    setActivos(prev => [{ ...pedido, estado: 'preparando', minutos_preparacion: minutos }, ...prev])
    setTimers(prev => { const n = { ...prev }; delete n[pedido.id]; return n })
    setPedidoDetalleId(null)
    toast('Pedido aceptado correctamente', 'success')
    if (pedido.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido aceptado', body: `Tu pedido ${pedido.codigo} está siendo preparado (~${minutos} min)` })
    imprimirPedido({ ...pedido, minutos_preparacion: minutos }, itemsMap[pedido.id] || [], restaurante).catch(() => {})
    if (pedido.modo_entrega === 'delivery') {
      ;(async () => {
        const MAX_RETRIES = 1
        const RETRY_DELAY = 3000
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const { data, error } = await supabase.functions.invoke('create-shipday-order', { body: { pedido_id: pedido.id } })
            if (!error) { console.log(`[Shipday] Pedido ${pedido.codigo} enviado correctamente`, data); return }
            throw error
          } catch (err) {
            console.error(`[Shipday] Intento ${attempt + 1}/${MAX_RETRIES + 1} fallido para pedido ${pedido.id}:`, err)
            if (attempt === MAX_RETRIES) { toast('Pedido aceptado. Repartidor no asignado automáticamente — revisa Shipday.', 'error'); return }
            await new Promise(r => setTimeout(r, RETRY_DELAY))
          }
        }
      })()
    }
  }

  async function rechazarPedido(id, motivo) {
    const pedido = entrantes.find(p => p.id === id)
    const motivoTexto = MOTIVOS_RECHAZO.find(m => m.id === motivo)?.label || motivo || 'El restaurante no pudo aceptar tu pedido'
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() }).eq('id', id)
    setEntrantes(prev => { const r = prev.filter(p => p.id !== id); if (!r.length) stopAlarm(); return r })
    setTimers(prev => { const n = { ...prev }; delete n[id]; return n })
    setPedidoDetalleId(prev => prev === id ? null : prev)
    if (pedido?.usuario_id) {
      sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido rechazado', body: `Tu pedido ${pedido.codigo} fue rechazado: ${motivoTexto}. Disculpa las molestias.` })
    }
    if (pedido?.metodo_pago === 'tarjeta') {
      supabase.functions.invoke('crear_reembolso_stripe', { body: { pedido_id: id } }).catch(err => console.error('[Reembolso] Error:', err))
    }
  }

  async function autoCancelarPedido(id) {
    const { data: pedido } = await supabase.from('pedidos').select('id, codigo, usuario_id, estado, metodo_pago').eq('id', id).single()
    if (!pedido || pedido.estado !== 'nuevo') return
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: 'El restaurante no respondió a tiempo', cancelado_at: new Date().toISOString() }).eq('id', id)
    setEntrantes(prev => { const r = prev.filter(p => p.id !== id); if (!r.length) stopAlarm(); return r })
    setTimers(prev => { const n = { ...prev }; delete n[id]; return n })
    setPedidoDetalleId(prev => prev === id ? null : prev)
    if (pedido?.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado porque el restaurante no respondió a tiempo` })
    if (pedido?.metodo_pago === 'tarjeta') {
      supabase.functions.invoke('crear_reembolso_stripe', { body: { pedido_id: id } }).catch(err => console.error('[Reembolso] Error:', err))
    }
  }

  async function cancelarPedidoActivo(pedido, motivoId) {
    const motivoTexto = MOTIVOS_CANCELACION.find(m => m.id === motivoId)?.label || 'Cancelado por el restaurante'
    await supabase.from('pedidos').update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() }).eq('id', pedido.id)
    setActivos(prev => prev.filter(p => p.id !== pedido.id))
    setPedidoDetalleId(prev => prev === pedido.id ? null : prev)
    if (pedido.usuario_id) sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado: ${motivoTexto}` })
    if (pedido.metodo_pago === 'tarjeta') {
      supabase.functions.invoke('crear_reembolso_stripe', { body: { pedido_id: pedido.id } }).catch(err => console.error('[Reembolso] Error:', err))
    }
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
        <div style={{ fontSize: 14, fontWeight: 600 }}>Cargando pedidos...</div>
      </div>
    )
  }

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

  const preparando = activos.filter(p => ['aceptado', 'preparando'].includes(p.estado))
  const listos = activos.filter(p => p.estado === 'listo')
  const enCamino = activos.filter(p => ['recogido', 'en_camino'].includes(p.estado))
  const hayAlgo = entrantes.length + activos.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: '#E5E2E1', letterSpacing: '0.02em', textTransform: 'uppercase' }}>Pedidos en Vivo</h2>
        <button onClick={() => { unlockAudio(); startAlarm(); setTimeout(stopAlarm, 2000) }} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #353535', background: '#1A1A1A', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#ab8985' }}>
          Probar alarma
        </button>
      </div>

      {!hayAlgo && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#ab8985' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Esperando nuevos pedidos...</div>
          <div style={{ fontSize: 11, color: '#353535', marginTop: 4 }}>Los pedidos aparecerán aquí en tiempo real</div>
        </div>
      )}

      {entrantes.length > 0 && (
        <SeccionPedidos titulo="Nuevos" count={entrantes.length} color="#fca5a5" accentColor="#B91C1C">
          {entrantes.map(p => (
            <LineaPedido key={p.id} pedido={p} timer={timers[p.id]} isNuevo onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {preparando.length > 0 && (
        <SeccionPedidos titulo="En Preparación" count={preparando.length} color="#fcd34d" accentColor="#d97706">
          {preparando.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {listos.length > 0 && (
        <SeccionPedidos titulo="Listos" count={listos.length} color="#86efac" accentColor="#16a34a">
          {listos.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {enCamino.length > 0 && (
        <SeccionPedidos titulo="En Camino" count={enCamino.length} color="#93c5fd" accentColor="#2563eb">
          {enCamino.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}
    </div>
  )
}

// ─── Sección ───────────────────────────────────────────────────────────────
function SeccionPedidos({ titulo, count, color, accentColor, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 2px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{titulo}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: accentColor, border: `1px solid ${accentColor}44`, padding: '1px 7px', borderRadius: 10 }}>{count}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Línea de pedido (card estilo Stitch) ─────────────────────────────────
function LineaPedido({ pedido, timer, isNuevo, onTap }) {
  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  const accionLabel = isNuevo ? 'ACEPTAR'
    : ['aceptado', 'preparando'].includes(pedido.estado) ? 'MARCAR LISTO'
    : pedido.estado === 'listo' ? 'RECOGIDO'
    : null

  const accionStyle = isNuevo
    ? { background: 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)', color: '#fff', border: 'none' }
    : ['aceptado', 'preparando'].includes(pedido.estado)
    ? { background: 'rgba(74,222,128,0.12)', color: '#86efac', border: '1px solid rgba(74,222,128,0.25)' }
    : { background: '#242424', color: '#E5E2E1', border: 'none' }

  return (
    <div
      onClick={onTap}
      style={{
        background: '#1A1A1A',
        borderRadius: 12,
        padding: '16px',
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {/* Timer (solo nuevos) */}
      {isNuevo && timer != null && timer > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <span style={{
            fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: timer < 60 ? '#fca5a5' : '#fcd34d',
            background: timer < 60 ? 'rgba(185,28,28,0.15)' : 'rgba(217,119,6,0.12)',
            padding: '3px 8px', borderRadius: 6,
            animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          }}>{formatTimer(timer)}</span>
        </div>
      )}

      {/* Código */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#ab8985', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{pedido.codigo}</div>

      {/* Nombre cliente */}
      <div style={{ fontSize: 15, fontWeight: 700, color: '#E5E2E1', marginBottom: 14 }}>{nombre}</div>

      {/* Precio + botón acción */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#ffb4ab' }}>{(pedido.total || 0).toFixed(2)}€</span>
        {accionLabel && (
          <button
            onClick={e => { e.stopPropagation(); onTap() }}
            style={{
              padding: '8px 16px', borderRadius: 8,
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.05em',
              ...accionStyle,
            }}
          >{accionLabel}</button>
        )}
      </div>
    </div>
  )
}

// ─── Pantalla de detalle ───────────────────────────────────────────────────
const seccionLabel = { fontSize: 10, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'block' }
const seccionCard = { background: '#1A1A1A', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }

function DetallePedido({ pedido, items, timer, isNuevo, restaurante, onVolver, onAceptar, onRechazar, onMarcarListo, onMarcarRecogido, onMarcarEntregado, onCancelar, onReimprimir }) {
  const [rechazando, setRechazando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [minutosSel, setMinutosSel] = useState(20)

  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onVolver} style={{
          padding: '8px 14px', borderRadius: 8,
          border: '1px solid #353535', background: '#1A1A1A',
          color: '#ab8985', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#E5E2E1', letterSpacing: '0.03em' }}>{pedido.codigo}</span>
            <EstadoBadge estado={pedido.estado} />
          </div>
          <div style={{ fontSize: 11, color: '#ab8985', marginTop: 2 }}>{restaurante?.nombre}</div>
        </div>
        {isNuevo && timer != null && timer > 0 && (
          <div style={{
            background: timer < 60 ? 'rgba(185,28,28,0.2)' : 'rgba(217,119,6,0.15)',
            borderRadius: 8, padding: '6px 12px',
            color: timer < 60 ? '#fca5a5' : '#fcd34d',
            fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          }}>{formatTimer(timer)}</div>
        )}
      </div>

      {/* Tiempo estimado */}
      {(pedido.estado === 'preparando' || pedido.estado === 'aceptado') && pedido.minutos_preparacion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#1A1A1A', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: '#ab8985' }}>Tiempo estimado: <strong style={{ color: '#fcd34d' }}>{pedido.minutos_preparacion} min</strong></span>
        </div>
      )}

      {/* CLIENTE */}
      <div style={seccionCard}>
        <span style={seccionLabel}>Cliente</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#E5E2E1', marginBottom: 4 }}>{nombre}</div>
        {pedido.usuarios?.telefono && (
          <div style={{ fontSize: 12, color: '#ab8985', marginBottom: pedido.direccion_entrega ? 8 : 0 }}>{pedido.usuarios.telefono}</div>
        )}
        {pedido.direccion_entrega && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #242424' }}>
            <span style={{ fontSize: 12, color: '#E5E2E1', lineHeight: 1.5 }}>{pedido.direccion_entrega}</span>
          </div>
        )}
      </div>

      {/* ORIGEN & PAGO */}
      <div style={seccionCard}>
        <span style={seccionLabel}>Origen y Pago</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Método de Pago</div>
            <div style={{ fontSize: 12, color: '#E5E2E1', fontWeight: 600 }}>{pedido.metodo_pago === 'tarjeta' ? 'Tarjeta (Online)' : 'Efectivo'}</div>
            {pedido.metodo_pago === 'efectivo' && <div style={{ fontSize: 10, color: '#fcd34d', marginTop: 2 }}>Cobrar en mano</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Canal de Venta</div>
            <div style={{ fontSize: 12, color: '#E5E2E1', fontWeight: 600 }}>App Móvil PIDO</div>
          </div>
        </div>
      </div>

      {/* PRODUCTOS */}
      <div style={seccionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ ...seccionLabel, marginBottom: 0 }}>Detalle de Productos</span>
          <span style={{ fontSize: 10, color: '#ab8985' }}>{items.length} artículo{items.length !== 1 ? 's' : ''}</span>
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < items.length - 1 ? 10 : 0, marginBottom: i < items.length - 1 ? 10 : 0, borderBottom: i < items.length - 1 ? '1px solid #242424' : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ab8985', minWidth: 20, flexShrink: 0 }}>{item.cantidad}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E2E1', marginBottom: 2 }}>{item.nombre_producto}</div>
              {item.tamano && <div style={{ fontSize: 11, color: '#ab8985' }}>Tamaño: {item.tamano}</div>}
              {item.extras_texto && <div style={{ fontSize: 11, color: '#ab8985' }}>Extras: {item.extras_texto}</div>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ffb4ab', flexShrink: 0 }}>{(item.precio_unitario * item.cantidad).toFixed(2)}€</div>
          </div>
        ))}
        {pedido.notas && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#242424', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Notas del Cliente</div>
            <div style={{ fontSize: 12, fontStyle: 'italic', color: '#E5E2E1' }}>"{pedido.notas}"</div>
          </div>
        )}
      </div>

      {/* RESUMEN */}
      <div style={{ background: '#1A1A1A', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#ab8985', marginBottom: 6 }}>
          <span>Subtotal</span><span>{((pedido.subtotal) || 0).toFixed(2)}€</span>
        </div>
        {pedido.coste_envio > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#ab8985', marginBottom: 6 }}>
            <span>Coste de Envío</span><span>{(pedido.coste_envio || 0).toFixed(2)}€</span>
          </div>
        )}
        {pedido.descuento > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#4ade80', marginBottom: 6 }}>
            <span>Descuento</span><span>-{(pedido.descuento || 0).toFixed(2)}€</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#ffb4ab', paddingTop: 8, borderTop: '1px solid #242424', marginTop: 4 }}>
          <span>Total Pedido</span><span>{(pedido.total || 0).toFixed(2)}€</span>
        </div>
      </div>

      {/* NUEVO: selector tiempo + aceptar/rechazar */}
      {isNuevo && (
        <div style={{ marginBottom: 12 }}>
          {rechazando ? (
            <div style={{ background: 'rgba(185,28,28,0.1)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(185,28,28,0.25)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fca5a5', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo del rechazo</div>
              {MOTIVOS_RECHAZO.map(m => (
                <button key={m.id} onClick={() => { onRechazar(pedido.id, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(185,28,28,0.08)', color: '#E5E2E1', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
              ))}
              <button onClick={() => setRechazando(false)} style={{ width: '100%', padding: '8px 0', border: 'none', background: 'transparent', color: '#ab8985', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#ab8985', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Seleccionar tiempo de preparación</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[15, 20, 30, 45].map(min => (
                    <button key={min} onClick={() => setMinutosSel(min)} style={{
                      padding: '11px 0', borderRadius: 8,
                      border: `1px solid ${minutosSel === min ? '#B91C1C' : '#353535'}`,
                      background: minutosSel === min ? 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)' : '#1A1A1A',
                      color: minutosSel === min ? '#fff' : '#ab8985',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}>{min} min</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setRechazando(true)} style={{ flex: 1, padding: '14px 0', borderRadius: 8, border: '1px solid #353535', background: 'transparent', color: '#E5E2E1', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Rechazar
                </button>
                <button onClick={() => { onAceptar(pedido, minutosSel); onVolver() }} style={{ flex: 2, padding: '14px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Aceptar pedido
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* PREPARANDO: listo + reimprimir */}
      {(pedido.estado === 'preparando' || pedido.estado === 'aceptado') && !isNuevo && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => onReimprimir(pedido)} style={{ padding: '13px 16px', borderRadius: 8, border: '1px solid #353535', background: '#1A1A1A', color: '#ab8985', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Imprimir</button>
          <button onClick={() => { onMarcarListo(pedido.id); onVolver() }} style={{ flex: 1, padding: '13px 0', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.15)', color: '#86efac', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Pedido listo para recoger</button>
        </div>
      )}

      {/* LISTO: recogida en local */}
      {pedido.estado === 'listo' && pedido.modo_entrega === 'recogida' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, padding: '13px 0', borderRadius: 8, background: 'rgba(74,222,128,0.1)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#86efac', border: '1px solid rgba(74,222,128,0.2)' }}>Esperando al cliente</div>
          <button onClick={() => { onMarcarEntregado(pedido.id); onVolver() }} style={{ padding: '13px 18px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.2)', color: '#86efac', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Entregado</button>
        </div>
      )}

      {/* LISTO: delivery */}
      {pedido.estado === 'listo' && pedido.modo_entrega !== 'recogida' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'rgba(74,222,128,0.08)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#86efac', marginBottom: 12, border: '1px solid rgba(74,222,128,0.2)' }}>
          Esperando repartidor (Shipday)
        </div>
      )}

      {/* RECOGIDO */}
      {pedido.estado === 'recogido' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'rgba(96,165,250,0.08)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#93c5fd', marginBottom: 12, border: '1px solid rgba(96,165,250,0.2)' }}>
          Repartidor recogió el pedido — en camino al cliente
        </div>
      )}

      {/* EN CAMINO */}
      {pedido.estado === 'en_camino' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginBottom: 12, border: '1px solid rgba(167,139,250,0.2)' }}>
          Repartidor en camino al cliente
        </div>
      )}

      {/* Cancelar (activos) */}
      {!isNuevo && (
        cancelando ? (
          <div style={{ background: 'rgba(185,28,28,0.08)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(185,28,28,0.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fca5a5', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo de cancelación</div>
            {MOTIVOS_CANCELACION.map(m => (
              <button key={m.id} onClick={() => { onCancelar(pedido, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(185,28,28,0.06)', color: '#E5E2E1', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
            ))}
            <button onClick={() => setCancelando(false)} style={{ width: '100%', padding: '8px 0', border: 'none', background: 'transparent', color: '#ab8985', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Volver</button>
          </div>
        ) : (
          <button onClick={() => setCancelando(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 8, border: '1px solid rgba(185,28,28,0.25)', background: 'rgba(185,28,28,0.06)', color: '#fca5a5', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar pedido</button>
        )
      )}
    </div>
  )
}
