import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { usePedidoAlert } from '../context/PedidoAlertContext'
import { stopAlarm, unlockAudio, startAlarm } from '../lib/alarm'
import { sendPush } from '../lib/webPush'
import { imprimirPedido, imprimirPedidoWeb } from '../lib/printService'
import { Capacitor } from '@capacitor/core'
import { toast } from '../App'
import { Truck } from 'lucide-react'
import { colors, type, ds, stateBadge } from '../lib/uiStyles'

// ─── Badges ────────────────────────────────────────────────────────────────
function PagoBadge({ pago }) {
  const t = pago === 'tarjeta'
  return <span style={{ background: t ? colors.infoSoft : colors.stateOkSoft, color: t ? colors.info : colors.stateOk, fontSize: type.xxs, fontWeight: 700, padding: '3px 8px', borderRadius: 6, letterSpacing: '0.04em' }}>{t ? 'Tarjeta' : 'Efectivo'}</span>
}
function CanalBadge() {
  return <span style={{ background: colors.primarySoft, color: colors.primary, fontSize: type.xxs, fontWeight: 700, padding: '3px 8px', borderRadius: 6, letterSpacing: '0.04em' }}>PIDO</span>
}
function EstadoBadge({ estado }) {
  const sb = stateBadge(estado)
  const { _label, ...style } = sb
  return <span style={style}>{_label}</span>
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
  // pedidosNuevos viene del contexto global (fuente única de verdad para "nuevos").
  // La suscripción realtime de INSERT vive en PedidoAlertContext, por encima
  // del router, así la alarma persiste al cambiar de sección.
  const { pedidosNuevos } = usePedidoAlert()
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

  // ── Fetch inicial + Realtime UPDATE (los INSERT los maneja el contexto) ──
  useEffect(() => {
    if (!restaurante) return
    fetchPedidos()

    const channel = supabase.channel('pedidos-rest-page-' + restaurante.id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, async payload => {
        if (payload.new.canal !== 'pido') return
        const p = payload.new
        if (['entregado', 'cancelado'].includes(p.estado)) {
          setActivos(prev => prev.filter(x => x.id !== p.id))
          setTimers(prev => { const n = { ...prev }; delete n[p.id]; return n })
        } else if (['aceptado', 'preparando', 'listo', 'recogido', 'en_camino'].includes(p.estado)) {
          setTimers(prev => {
            if (!(p.id in prev)) return prev
            const n = { ...prev }; delete n[p.id]; return n
          })
          let rider_accounts = null
          if (p.rider_account_id && p.rider_account_id !== payload.old?.rider_account_id) {
            const { data } = await supabase.from('rider_accounts').select('id, nombre, telefono').eq('id', p.rider_account_id).single()
            rider_accounts = data || null
          }
          setActivos(prev => {
            if (!prev.some(x => x.id === p.id)) return prev
            return prev.map(x => {
              if (x.id !== p.id) return x
              const merged = { ...x, ...p }
              if (rider_accounts) merged.rider_accounts = rider_accounts
              else if (!p.rider_account_id) merged.rider_accounts = null
              return merged
            })
          })
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurante?.id])

  // ── Sincronizar "entrantes" locales con pedidosNuevos del contexto ───────
  // Al llegar un pedido nuevo (detectado por el contexto), aquí lo
  // enriquecemos con usuarios/rider/items y arrancamos su timer local.
  useEffect(() => {
    if (!restaurante) return
    const nuevosIds = new Set(pedidosNuevos.map(p => p.id))
    const existentesIds = new Set(entrantes.map(p => p.id))

    const faltan = pedidosNuevos.filter(p => !existentesIds.has(p.id))
    if (faltan.length > 0) {
      ;(async () => {
        for (const p of faltan) {
          let pedidoEnriquecido = p
          if (p.usuario_id) {
            const { data: usr } = await supabase.from('usuarios').select('nombre, apellido, telefono').eq('id', p.usuario_id).single()
            if (usr) pedidoEnriquecido = { ...pedidoEnriquecido, usuarios: usr }
          }
          if (p.rider_account_id) {
            const { data: rider } = await supabase.from('rider_accounts').select('id, nombre, telefono').eq('id', p.rider_account_id).single()
            if (rider) pedidoEnriquecido = { ...pedidoEnriquecido, rider_accounts: rider }
          }
          setEntrantes(prev => {
            if (prev.some(x => x.id === p.id)) return prev
            return [pedidoEnriquecido, ...prev]
          })
          setTimers(prev => prev[p.id] != null ? prev : { ...prev, [p.id]: 180 })
          const { data: newItems } = await supabase.from('pedido_items').select('*').eq('pedido_id', p.id)
          if (newItems?.length > 0) setItemsMap(prev => ({ ...prev, [p.id]: newItems }))
        }
      })()
    }

    // Quitar locales que ya no están en contexto (aceptados/cancelados)
    if (entrantes.some(p => !nuevosIds.has(p.id))) {
      setEntrantes(prev => prev.filter(p => nuevosIds.has(p.id)))
      setTimers(prev => {
        const n = {}
        Object.keys(prev).forEach(id => { if (nuevosIds.has(id)) n[id] = prev[id] })
        return n
      })
    }
  }, [pedidosNuevos, restaurante?.id])

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
  // Solo carga pedidos activos; los "nuevos" vienen del contexto PedidoAlertContext
  // y se sincronizan con "entrantes" en el effect de arriba.
  async function fetchPedidos() {
    try {
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [{ data: nuevos }, { data: prep }] = await Promise.all([
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono), rider_accounts(id, nombre, telefono)').eq('establecimiento_id', restaurante.id).eq('estado', 'nuevo').gte('created_at', hace24h).order('created_at', { ascending: false }),
        supabase.from('pedidos').select('*, usuarios(nombre, apellido, telefono), rider_accounts(id, nombre, telefono)').eq('establecimiento_id', restaurante.id).in('estado', ['aceptado', 'preparando', 'listo', 'recogido', 'en_camino']).gte('created_at', hace24h).order('created_at', { ascending: false }),
      ])
      setEntrantes(nuevos || [])
      setActivos(prep || [])
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
    if (Capacitor.isNativePlatform()) {
      imprimirPedido({ ...pedido, minutos_preparacion: minutos }, itemsMap[pedido.id] || [], restaurante).catch(() => {})
    }
    if (pedido.modo_entrega === 'delivery') {
      ;(async () => {
        const MAX_RETRIES = 3 // total 4 intentos
        const RETRY_DELAYS = [2000, 4000, 8000] // delay exponencial antes de los intentos 2, 3 y 4
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const { data, error } = await supabase.functions.invoke('create-shipday-order', { body: { pedido_id: pedido.id } })
            if (!error) { console.log(`[Shipday] Pedido ${pedido.codigo} enviado correctamente`, data); return }
            throw error
          } catch (err) {
            console.error(`[Shipday] Intento ${attempt + 1}/${MAX_RETRIES + 1} fallido para pedido ${pedido.id}:`, err)
            if (attempt === MAX_RETRIES) {
              toast(`No se pudo crear orden Shipday tras 4 intentos para ${pedido.codigo}. Super-admin avisado.`, 'error')
              try {
                await supabase.from('pedidos').update({ shipday_status: 'error_crear_orden' }).eq('id', pedido.id)
              } catch (e) { console.error('[Shipday] Error marcando pedido con error_crear_orden:', e) }
              try {
                const { data: admins } = await supabase.from('usuarios').select('id').eq('rol', 'superadmin')
                for (const a of admins || []) {
                  await supabase.functions.invoke('enviar_push', {
                    body: {
                      usuarioId: a.id,
                      titulo: 'Pedido con error delivery',
                      cuerpo: `${restaurante.nombre} aceptó pedido ${pedido.codigo} pero Shipday falló 4 veces. Revisar manualmente.`,
                      tipo: 'admin_alert',
                    },
                  })
                }
              } catch (e) { console.error('[Shipday] Error notificando superadmin:', e) }
              return
            }
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]))
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
    setTimers(prev => { const n = { ...prev }; delete n[pedido.id]; return n })
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
        <h2 style={{ ...ds.h1, margin: 0 }}>Pedidos en vivo</h2>
        <button onClick={() => { unlockAudio(); startAlarm(); setTimeout(stopAlarm, 2000) }} style={ds.filterBtn}>
          Probar alarma
        </button>
      </div>

      {!hayAlgo && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: colors.textMute }}>
          <div style={{ fontSize: type.sm, fontWeight: 600 }}>Esperando nuevos pedidos...</div>
          <div style={{ fontSize: type.xs, color: colors.textFaint, marginTop: 4 }}>Los pedidos aparecerán aquí en tiempo real</div>
        </div>
      )}

      {entrantes.length > 0 && (
        <SeccionPedidos titulo="Nuevos" count={entrantes.length} color={colors.stateNew} accentColor={colors.stateNew}>
          {entrantes.map(p => (
            <LineaPedido key={p.id} pedido={p} timer={timers[p.id]} isNuevo onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {preparando.length > 0 && (
        <SeccionPedidos titulo="En preparación" count={preparando.length} color={colors.statePrep} accentColor={colors.statePrep}>
          {preparando.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {listos.length > 0 && (
        <SeccionPedidos titulo="Listos" count={listos.length} color={colors.stateOk} accentColor={colors.stateOk}>
          {listos.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionPedidos>
      )}

      {enCamino.length > 0 && (
        <SeccionPedidos titulo="En camino" count={enCamino.length} color={colors.stateOk} accentColor={colors.stateOk}>
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
        <span style={{ fontSize: type.xxs, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{titulo}</span>
        <span style={{ fontSize: type.xxs, fontWeight: 700, color: accentColor, border: `1px solid ${accentColor}44`, padding: '1px 7px', borderRadius: 10 }}>{count}</span>
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
    ? { background: colors.primary, color: '#fff', border: 'none' }
    : ['aceptado', 'preparando'].includes(pedido.estado)
    ? { background: colors.stateOkSoft, color: colors.stateOk, border: `1px solid ${colors.stateOkSoft}` }
    : { background: colors.surface2, color: colors.text, border: 'none' }

  return (
    <div
      onClick={onTap}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {/* Timer (solo nuevos) */}
      {isNuevo && timer != null && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          {timer > 0 ? (
            <span style={{
              fontSize: type.sm, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: timer < 60 ? colors.stateNew : colors.statePrep,
              background: timer < 60 ? colors.stateNewSoft : colors.statePrepSoft,
              padding: '3px 8px', borderRadius: 6,
              animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
            }}>{formatTimer(timer)}</span>
          ) : (
            <span style={{
              fontSize: type.sm, fontWeight: 800,
              color: colors.stateNew, background: colors.stateNewSoft,
              padding: '3px 8px', borderRadius: 6,
            }}>Expirando...</span>
          )}
        </div>
      )}

      {/* Código */}
      <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{pedido.codigo}</div>

      {/* Nombre cliente */}
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: pedido.modo_entrega === 'delivery' ? 8 : 14 }}>{nombre}</div>

      {/* Rider info (solo delivery) */}
      {pedido.modo_entrega === 'delivery' && <RiderInfo pedido={pedido} />}

      {/* Precio + botón acción */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: type.lg, fontWeight: 800, color: colors.text }}>{(pedido.total || 0).toFixed(2)}€</span>
        {accionLabel && (
          <button
            onClick={e => { e.stopPropagation(); onTap() }}
            style={{
              padding: '8px 16px', borderRadius: 8,
              fontSize: type.xxs, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.05em',
              ...accionStyle,
            }}
          >{accionLabel}</button>
        )}
      </div>
    </div>
  )
}

// ─── Rider info (para delivery) ────────────────────────────────────────────
function RiderInfo({ pedido }) {
  const rider = pedido.rider_accounts
  const sinRiders = pedido.shipday_status === 'no_rider'
  const intento = pedido.intento_asignacion || 0

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      {rider ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text)' }}>
          <Truck size={13} color="#6B6B68" />
          <span>Rider: <strong>{rider.nombre}</strong>{rider.telefono ? ` · ${rider.telefono}` : ''}</span>
        </div>
      ) : sinRiders ? (
        <span style={{ background: 'var(--c-danger-soft)', color: '#DC2626', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Sin riders disponibles</span>
      ) : (
        <span style={{ background: 'var(--c-warning-soft)', color: '#D97706', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Sin asignar</span>
      )}
      {intento > 1 && (
        <span style={{ background: 'rgba(217,119,6,0.15)', color: '#D97706', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Reintento {intento}/3</span>
      )}
    </div>
  )
}

// ─── Modal Reasignar rider ─────────────────────────────────────────────────
function ModalReasignar({ pedido, onClose }) {
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !loading) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  async function confirmar() {
    setLoading(true)
    try {
      const { error } = await supabase.functions.invoke('reassign-pedido', { body: { pedido_id: pedido.id, motivo } })
      if (error) throw error
      toast('Pedido reasignado al siguiente rider disponible', 'success')
      onClose()
    } catch (err) {
      console.error('[Reasignar]', err)
      toast(err?.message || 'Error al reasignar el pedido', 'error')
      setLoading(false)
    }
  }

  const handleOverlayClick = () => { if (!loading) onClose() }

  return (
    <div onClick={handleOverlayClick} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: 'var(--c-surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, border: '1px solid var(--c-border)' }}>
        <button
          onClick={onClose}
          disabled={loading}
          aria-label="Cerrar"
          style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 20, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', borderRadius: 6, lineHeight: 1 }}
        >×</button>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--c-text)', marginBottom: 6, paddingRight: 28 }}>Reasignar pedido</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 14 }}>Se buscará el siguiente rider disponible más cercano.</div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Motivo (opcional)</label>
        <textarea
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Ej: el rider no contesta"
          rows={3}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface2)', color: 'var(--c-text)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical', marginBottom: 14, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={loading} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text)', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={confirmar} disabled={loading} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>{loading ? 'Reasignando...' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Pantalla de detalle ───────────────────────────────────────────────────
const seccionLabel = { fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'block' }
const seccionCard = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }

function DetallePedido({ pedido, items, timer, isNuevo, restaurante, onVolver, onAceptar, onRechazar, onMarcarListo, onMarcarRecogido, onMarcarEntregado, onCancelar, onReimprimir }) {
  const [rechazando, setRechazando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [minutosSel, setMinutosSel] = useState(20)
  const [reasignando, setReasignando] = useState(false)

  const puedeReasignar = pedido.modo_entrega === 'delivery'
    && ['preparando', 'listo', 'nuevo', 'aceptado'].includes(pedido.estado) // 'aceptado' equivale a 'preparando' en este panel
    && !!pedido.rider_accounts
    && pedido.shipday_status !== 'no_rider'

  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onVolver} style={{
          padding: '8px 14px', borderRadius: 8,
          border: '1px solid var(--c-border)', background: 'var(--c-surface)',
          color: 'var(--c-muted)', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text)', letterSpacing: '0.03em' }}>{pedido.codigo}</span>
            <EstadoBadge estado={pedido.estado} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{restaurante?.nombre}</div>
        </div>
        {isNuevo && timer != null && (
          timer > 0 ? (
            <div style={{
              background: timer < 60 ? 'var(--c-danger-soft)' : 'rgba(217,119,6,0.15)',
              borderRadius: 8, padding: '6px 12px',
              color: timer < 60 ? '#DC2626' : '#D97706',
              fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
            }}>{formatTimer(timer)}</div>
          ) : (
            <div style={{
              background: 'var(--c-danger-soft)', borderRadius: 8, padding: '6px 12px',
              color: '#DC2626', fontSize: 14, fontWeight: 800,
            }}>Expirando...</div>
          )
        )}
      </div>

      {/* Tiempo estimado */}
      {(pedido.estado === 'preparando' || pedido.estado === 'aceptado') && pedido.minutos_preparacion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: 'var(--c-surface)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>Tiempo estimado: <strong style={{ color: '#D97706' }}>{pedido.minutos_preparacion} min</strong></span>
        </div>
      )}

      {/* RIDER (solo delivery) */}
      {pedido.modo_entrega === 'delivery' && (
        <div style={seccionCard}>
          <span style={seccionLabel}>Repartidor</span>
          <RiderInfo pedido={pedido} />
          {puedeReasignar && (
            <button onClick={() => setReasignando(true)} style={{ marginTop: 4, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface2)', color: 'var(--c-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Reasignar
            </button>
          )}
        </div>
      )}

      {reasignando && <ModalReasignar pedido={pedido} onClose={() => setReasignando(false)} />}

      {/* CLIENTE */}
      <div style={seccionCard}>
        <span style={seccionLabel}>Cliente</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4 }}>{nombre}</div>
        {pedido.usuarios?.telefono && (
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: pedido.direccion_entrega ? 8 : 0 }}>{pedido.usuarios.telefono}</div>
        )}
        {pedido.direccion_entrega && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--c-border)' }}>
            <span style={{ fontSize: 12, color: 'var(--c-text)', lineHeight: 1.5 }}>{pedido.direccion_entrega}</span>
          </div>
        )}
      </div>

      {/* ORIGEN & PAGO */}
      <div style={seccionCard}>
        <span style={seccionLabel}>Origen y Pago</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Método de Pago</div>
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600 }}>{pedido.metodo_pago === 'tarjeta' ? 'Tarjeta (Online)' : 'Efectivo'}</div>
            {pedido.metodo_pago === 'efectivo' && <div style={{ fontSize: 10, color: '#D97706', marginTop: 2 }}>Cobrar en mano</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Canal de Venta</div>
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600 }}>App Móvil PIDO</div>
          </div>
        </div>
      </div>

      {/* PRODUCTOS */}
      <div style={seccionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ ...seccionLabel, marginBottom: 0 }}>Detalle de Productos</span>
          <span style={{ fontSize: 10, color: 'var(--c-muted)' }}>{items.length} artículo{items.length !== 1 ? 's' : ''}</span>
        </div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < items.length - 1 ? 10 : 0, marginBottom: i < items.length - 1 ? 10 : 0, borderBottom: i < items.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-muted)', minWidth: 20, flexShrink: 0 }}>{item.cantidad}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', marginBottom: 2 }}>{item.nombre_producto}</div>
              {item.tamano && <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>Tamaño: {item.tamano}</div>}
              {item.extras_texto && <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>Extras: {item.extras_texto}</div>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)', flexShrink: 0 }}>{(item.precio_unitario * item.cantidad).toFixed(2)}€</div>
          </div>
        ))}
        {pedido.notas && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--c-surface2)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Notas del Cliente</div>
            <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--c-text)' }}>"{pedido.notas}"</div>
          </div>
        )}
      </div>

      {/* HISTORIAL ASIGNACIÓN (solo delivery) */}
      {pedido.modo_entrega === 'delivery' && <HistorialAsignacion pedidoId={pedido.id} />}

      {/* RESUMEN */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-muted)', marginBottom: 6 }}>
          <span>Subtotal</span><span>{((pedido.subtotal) || 0).toFixed(2)}€</span>
        </div>
        {pedido.coste_envio > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-muted)', marginBottom: 6 }}>
            <span>Coste de Envío</span><span>{(pedido.coste_envio || 0).toFixed(2)}€</span>
          </div>
        )}
        {pedido.descuento > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#16A34A', marginBottom: 6 }}>
            <span>Descuento</span><span>-{(pedido.descuento || 0).toFixed(2)}€</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: 'var(--c-primary)', paddingTop: 8, borderTop: '1px solid var(--c-border)', marginTop: 4 }}>
          <span>Total Pedido</span><span>{(pedido.total || 0).toFixed(2)}€</span>
        </div>
      </div>

      {/* NUEVO: selector tiempo + aceptar/rechazar */}
      {isNuevo && (
        <div style={{ marginBottom: 12 }}>
          {rechazando ? (
            <div style={{ background: 'rgba(185,28,28,0.1)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(185,28,28,0.25)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo del rechazo</div>
              {MOTIVOS_RECHAZO.map(m => (
                <button key={m.id} onClick={() => { onRechazar(pedido.id, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(220,38,38,0.08)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
              ))}
              <button onClick={() => setRechazando(false)} style={{ width: '100%', padding: '8px 0', border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Seleccionar tiempo de preparación</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[15, 20, 30, 45].map(min => (
                    <button key={min} onClick={() => setMinutosSel(min)} style={{
                      padding: '11px 0', borderRadius: 8,
                      border: `1px solid ${minutosSel === min ? 'var(--c-primary)' : 'var(--c-border)'}`,
                      background: minutosSel === min ? 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)' : 'var(--c-surface)',
                      color: minutosSel === min ? '#fff' : 'var(--c-muted)',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.15s',
                    }}>{min} min</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setRechazando(true)} style={{ flex: 1, padding: '14px 0', borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Rechazar
                </button>
                <button onClick={() => { onAceptar(pedido, minutosSel); onVolver() }} style={{ flex: 2, padding: '14px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
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
          <button onClick={() => onReimprimir(pedido)} style={{ padding: '13px 16px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Imprimir</button>
          <button onClick={() => { onMarcarListo(pedido.id); onVolver() }} style={{ flex: 1, padding: '13px 0', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'var(--c-success-soft)', color: '#16A34A', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Pedido listo para recoger</button>
        </div>
      )}

      {/* LISTO: recogida en local */}
      {pedido.estado === 'listo' && pedido.modo_entrega === 'recogida' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, padding: '13px 0', borderRadius: 8, background: 'var(--c-success-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#16A34A', border: '1px solid rgba(74,222,128,0.2)' }}>Esperando al cliente</div>
          <button onClick={() => { onMarcarEntregado(pedido.id); onVolver() }} style={{ padding: '13px 18px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(22,163,74,0.20)', color: '#16A34A', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Entregado</button>
        </div>
      )}

      {/* LISTO: delivery */}
      {pedido.estado === 'listo' && pedido.modo_entrega !== 'recogida' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'var(--c-success-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#16A34A', marginBottom: 12, border: '1px solid rgba(74,222,128,0.2)' }}>
          Esperando repartidor (Shipday)
        </div>
      )}

      {/* RECOGIDO */}
      {pedido.estado === 'recogido' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'var(--c-info-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#2563EB', marginBottom: 12, border: '1px solid rgba(96,165,250,0.2)' }}>
          Repartidor recogió el pedido — en camino al cliente
        </div>
      )}

      {/* EN CAMINO */}
      {pedido.estado === 'en_camino' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'rgba(124,58,237,0.10)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#7C3AED', marginBottom: 12, border: '1px solid rgba(167,139,250,0.2)' }}>
          Repartidor en camino al cliente
        </div>
      )}

      {/* Cancelar (activos) */}
      {!isNuevo && (
        cancelando ? (
          <div style={{ background: 'rgba(220,38,38,0.08)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(185,28,28,0.2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo de cancelación</div>
            {MOTIVOS_CANCELACION.map(m => (
              <button key={m.id} onClick={() => { onCancelar(pedido, m.id); onVolver() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(220,38,38,0.06)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
            ))}
            <button onClick={() => setCancelando(false)} style={{ width: '100%', padding: '8px 0', border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Volver</button>
          </div>
        ) : (
          <button onClick={() => setCancelando(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 8, border: '1px solid rgba(185,28,28,0.25)', background: 'rgba(220,38,38,0.06)', color: '#DC2626', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar pedido</button>
        )
      )}
    </div>
  )
}

// ─── Historial de asignaciones (delivery) ──────────────────────────────────
function HistorialAsignacion({ pedidoId }) {
  const [historial, setHistorial] = useState(null)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data, error } = await supabase
        .from('pedido_asignaciones')
        .select('id, rider_account_id, intento, estado, created_at, resolved_at, motivo_rechazo, rider_accounts(nombre)')
        .eq('pedido_id', pedidoId)
        .order('intento', { ascending: true })
      if (cancel) return
      if (error) { setHistorial([]); return }
      setHistorial(data || [])
    })()
    return () => { cancel = true }
  }, [pedidoId])

  if (!historial || historial.length === 0) return null

  const fmt = iso => iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''

  const iconoEstado = (estado) => {
    if (estado === 'aceptado') return { icon: '✅', label: 'Aceptado', color: '#16A34A' }
    if (estado === 'rechazado') return { icon: '❌', label: 'Rechazado', color: '#DC2626' }
    if (estado === 'timeout') return { icon: '⏱', label: 'Timeout', color: '#D97706' }
    if (estado === 'cancelado') return { icon: '⊘', label: 'Cancelado', color: 'var(--c-muted)' }
    return { icon: '⏳', label: 'Esperando aceptación', color: '#D97706' }
  }

  return (
    <div style={seccionCard}>
      <span style={seccionLabel}>Historial de asignación</span>
      {historial.map((h, i) => {
        const est = iconoEstado(h.estado)
        const riderNombre = h.rider_accounts?.nombre || 'Rider'
        return (
          <div key={h.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: i < historial.length - 1 ? 8 : 0, marginBottom: i < historial.length - 1 ? 8 : 0, borderBottom: i < historial.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-muted)', minWidth: 52, flexShrink: 0 }}>#{h.intento || i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600 }}>{riderNombre} · <span style={{ color: 'var(--c-muted)', fontWeight: 500 }}>{fmt(h.created_at)}</span></div>
              <div style={{ fontSize: 11, color: est.color, marginTop: 2 }}>
                {est.icon} {est.label}{h.resolved_at ? ` ${fmt(h.resolved_at)}` : ''}
                {h.motivo_rechazo ? ` · ${h.motivo_rechazo}` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
