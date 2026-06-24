import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { usePedidoAlert } from '../context/PedidoAlertContext'
import { stopAlarm, unlockAudio, startAlarm } from '../lib/alarm'
import { sendPush } from '../lib/webPush'
import { imprimirPedido, imprimirPedidoWeb } from '../lib/printService'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { toast } from '../App'
import { Truck, Bell, BellOff, Bike, ShoppingBag } from 'lucide-react'
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

// Etiqueta del canal de venta según el origen del pedido.
const canalVentaLabel = (origen) => {
  if (origen === 'tienda_publica') return 'Tienda del restaurante'
  if (origen === 'marketplace_socio') return 'Marketplace del socio'
  return 'App Pidoo'
}

// Solo dos métodos de pago: tarjeta (online) o efectivo. Cualquier valor legacy
// (p.ej. 'datafono') se trata como efectivo a efectos de visualización.
const metodoPagoLabel = (m) => (m === 'tarjeta' ? 'Tarjeta (online)' : 'Efectivo')

// ─── Hook: detectar tablet horizontal (>=900px, landscape) ─────────────────
// Calcula isTabletHorizontal solo en resize/orientationchange (debounced 120ms)
// para no re-renderizar en cada scroll/repaint. Devuelve false en SSR.
function useIsTabletHorizontal() {
  const [isTablet, setIsTablet] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth >= 900 && window.innerWidth > window.innerHeight
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    let t = null
    const recalc = () => {
      const next = window.innerWidth >= 900 && window.innerWidth > window.innerHeight
      setIsTablet(prev => prev === next ? prev : next)
    }
    const debounced = () => {
      if (t) clearTimeout(t)
      t = setTimeout(recalc, 120)
    }
    window.addEventListener('resize', debounced)
    window.addEventListener('orientationchange', debounced)
    return () => {
      if (t) clearTimeout(t)
      window.removeEventListener('resize', debounced)
      window.removeEventListener('orientationchange', debounced)
    }
  }, [])
  return isTablet
}

// ─── Aviso único de pedido nuevo (es el propio pedido) ──────────────────────
// Un solo aviso, arriba del todo: muestra el pedido nuevo más reciente con su
// código, tipo, total, cliente y timer, y un botón "Ver pedido" que abre el
// detalle (donde se acepta o rechaza). Sustituye a los dos banners anteriores.
function AlertaNuevoPedido({ entrantes, timers, silenciada, onVer, onSilenciar }) {
  const nuevo = entrantes[0]
  if (!nuevo) return null
  const n = entrantes.length
  const nombre = nuevo.usuarios?.nombre
    ? `${nuevo.usuarios.nombre}${nuevo.usuarios.apellido ? ' ' + nuevo.usuarios.apellido : ''}`
    : 'Cliente'
  const isDelivery = nuevo.modo_entrega === 'delivery'
  const timer = timers[nuevo.id]

  return (
    <div style={{
      background: `linear-gradient(180deg, ${colors.terracotta} 0%, ${colors.terracotta2} 100%)`,
      color: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 16,
      boxShadow: '0 10px 28px rgba(168,69,31,0.34), inset 0 1px 0 rgba(255,255,255,0.16)',
      animation: silenciada ? 'none' : 'pidooPulse 1.8s infinite',
    }}>
      <style>{`@keyframes pidooPulse{0%,100%{box-shadow:0 10px 28px rgba(168,69,31,0.30)}50%{box-shadow:0 12px 34px rgba(197,86,44,0.55)}}`}</style>

      {/* Cabecera: campana + título + timer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Bell size={18} strokeWidth={2.3} />
          <span style={{ fontWeight: 800, fontSize: type.base, letterSpacing: '-0.01em' }}>
            {n > 1 ? `${n} pedidos nuevos` : '¡Nuevo pedido!'}
          </span>
        </div>
        {timer != null && timer > 0 && (
          <span style={{
            fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: type.sm,
            background: 'rgba(0,0,0,0.22)', padding: '3px 10px', borderRadius: 8,
            animation: timer < 60 ? 'pulse 0.6s ease-in-out infinite' : 'none',
          }}>{formatTimer(timer)}</span>
        )}
      </div>

      {/* Resumen del pedido */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontFamily: type.mono, fontSize: type.xs, opacity: 0.92, fontWeight: 700 }}>{nuevo.codigo}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'rgba(255,255,255,0.18)', padding: '2px 8px', borderRadius: 6,
          fontSize: 11, fontWeight: 700,
        }}>
          {isDelivery ? <Bike size={11} strokeWidth={2.4} /> : <ShoppingBag size={11} strokeWidth={2.4} />}
          {isDelivery ? 'Delivery' : 'Recogida'}
        </span>
        <span style={{ fontWeight: 800, fontSize: type.base }}>{(nuevo.total || 0).toFixed(2)}€</span>
        <span style={{
          opacity: 0.95, fontSize: type.sm, fontWeight: 600, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>· {nombre}</span>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onVer(nuevo.id)}
          style={{
            flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
            background: '#fff', color: colors.terracotta2, fontWeight: 800, fontSize: type.sm,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Ver pedido</button>
        {!silenciada && (
          <button
            onClick={onSilenciar}
            style={{
              padding: '12px 14px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.18)',
              color: '#fff', fontWeight: 700, fontSize: type.xs, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
            }}
          ><BellOff size={13} strokeWidth={2.2} /> Silenciar</button>
        )}
      </div>

      {n > 1 && (
        <div style={{ marginTop: 9, fontSize: type.xxs, opacity: 0.85, fontWeight: 600 }}>
          y {n - 1} más sin aceptar · empieza por el más reciente
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function PedidosEnVivo() {
  const { restaurante } = useRest()
  // pedidosNuevos viene del contexto global (fuente única de verdad para "nuevos").
  // La suscripción realtime de INSERT vive en PedidoAlertContext, por encima
  // del router, así la alarma persiste al cambiar de sección.
  const { pedidosNuevos, silenciar, silenciada } = usePedidoAlert()
  const [entrantes, setEntrantes] = useState([])
  const [activos, setActivos] = useState([])
  const [itemsMap, setItemsMap] = useState({})
  const [timers, setTimers] = useState({})
  const [loadingInicial, setLoadingInicial] = useState(true)
  const [pedidoDetalleId, setPedidoDetalleId] = useState(null)
  const isTabletHorizontal = useIsTabletHorizontal()

  // ── Cerrar detalle si el pedido desaparece (cancelado/entregado) ──────────
  useEffect(() => {
    if (!pedidoDetalleId) return
    const existe = [...entrantes, ...activos].some(p => p.id === pedidoDetalleId)
    if (!existe) setPedidoDetalleId(null)
  }, [entrantes, activos])

  // ── Tablet horizontal (split): auto-seleccionar el pedido nuevo más reciente ──
  // Así el aviso es directamente el pedido: el detalle con Aceptar/Rechazar
  // aparece solo en la columna derecha, sin banners extra.
  useEffect(() => {
    if (!isTabletHorizontal) return
    if (pedidoDetalleId) return
    if (entrantes.length === 0) return
    setPedidoDetalleId(entrantes[0].id)
  }, [isTabletHorizontal, entrantes, pedidoDetalleId])

  // ref a fetchPedidos para usarlo en listeners de foreground sin reset effect
  const fetchPedidosRef = useRef(null)

  // ── Recovery de pedidos delivery en limbo ────────────────────────────────
  // Si la app murió mientras aceptarPedido() reintentaba create-shipday-order,
  // el pedido queda en 'preparando' (delivery) sin shipday_status y sin que
  // el cron de reasignación lo recoja (ese cron solo mira assigned_at). Aquí
  // detectamos ese caso y reinvocamos el dispatcher UNA sola vez por pedido.
  const recoveryIntentadoRef = useRef(new Set())
  async function recoverPedidosLimbo(lista) {
    if (!Array.isArray(lista) || lista.length === 0) return
    const ahora = Date.now()
    for (const p of lista) {
      if (
        p.modo_entrega === 'delivery' &&
        p.estado === 'preparando' &&
        !p.shipday_status &&
        !recoveryIntentadoRef.current.has(p.id)
      ) {
        const ref = p.assigned_at || p.aceptado_at
        // Solo si han pasado >30s desde que se aceptó (margen para el IIFE normal).
        if (ref && ahora - new Date(ref).getTime() > 30000) {
          recoveryIntentadoRef.current.add(p.id)
          supabase.functions
            .invoke('create-shipday-order', { body: { pedido_id: p.id } })
            .then(({ error }) => {
              if (error) console.error(`[Recovery] Falló reintento dispatcher para ${p.id}:`, error)
              else console.log(`[Recovery] Dispatcher reinvocado para pedido en limbo ${p.codigo || p.id}`)
            })
            .catch(err => console.error(`[Recovery] Error reintento dispatcher ${p.id}:`, err))
        }
      }
    }
  }

  // ── Fetch inicial + Realtime UPDATE (los INSERT los maneja el contexto) ──
  useEffect(() => {
    if (!restaurante) return
    fetchPedidos()
    // Pequeño retry: si la sesión Supabase aún no estaba lista al primer
    // mount (caso de abrir la app desde un push), refrescamos a los 1500ms.
    const retryT = setTimeout(() => fetchPedidos(), 1500)

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

    return () => {
      clearTimeout(retryT)
      supabase.removeChannel(channel)
    }
  }, [restaurante?.id])

  // ── Refetch al volver al foreground ─────────────────────────────────────
  // Cuando la app entra en background y vuelve, el realtime puede haber
  // perdido eventos. Refrescamos pedidos para que el restaurante vea de
  // inmediato cualquier pedido recibido por push mientras la app dormía.
  useEffect(() => { fetchPedidosRef.current = fetchPedidos })

  useEffect(() => {
    if (!restaurante) return

    const refresh = () => { if (fetchPedidosRef.current) fetchPedidosRef.current() }

    let appListenerHandle = null
    if (Capacitor.isNativePlatform()) {
      try {
        const p = CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) refresh()
        })
        if (p && typeof p.then === 'function') p.then(h => { appListenerHandle = h }).catch(() => {})
        else appListenerHandle = p
      } catch (_) {}
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      try {
        if (appListenerHandle) {
          if (typeof appListenerHandle.remove === 'function') appListenerHandle.remove()
          else if (typeof appListenerHandle.then === 'function') appListenerHandle.then(h => h && h.remove && h.remove()).catch(() => {})
        }
      } catch (_) {}
    }
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
      // Recovery: reintenta el dispatcher para pedidos delivery atascados en
      // 'preparando' sin shipday_status (app murió durante los retries).
      recoverPedidosLimbo(prep || [])
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
            if (!error) { console.log(`[Dispatcher] Pedido ${pedido.codigo} enviado correctamente`, data); return }
            throw error
          } catch (err) {
            console.error(`[Dispatcher] Intento ${attempt + 1}/${MAX_RETRIES + 1} fallido para pedido ${pedido.id}:`, err)
            if (attempt === MAX_RETRIES) {
              toast(`No se pudo asignar repartidor tras 4 intentos para ${pedido.codigo}. Super-admin avisado.`, 'error')
              try {
                await supabase.from('pedidos').update({ shipday_status: 'error_crear_orden' }).eq('id', pedido.id)
              } catch (e) { console.error('[Dispatcher] Error marcando pedido con error_crear_orden:', e) }
              try {
                const { data: admins } = await supabase.from('usuarios').select('id').eq('rol', 'superadmin')
                for (const a of admins || []) {
                  await supabase.functions.invoke('enviar_push', {
                    body: {
                      usuarioId: a.id,
                      titulo: 'Pedido con error delivery',
                      cuerpo: `${restaurante.nombre} aceptó pedido ${pedido.codigo} pero el dispatcher falló 4 veces. Revisar manualmente.`,
                      tipo: 'admin_alert',
                    },
                  })
                }
              } catch (e) { console.error('[Dispatcher] Error notificando superadmin:', e) }
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
    const pedido = activos.find(p => p.id === id)
    await supabase.from('pedidos').update({ estado: 'listo' }).eq('id', id)
    setActivos(prev => prev.map(p => p.id === id ? { ...p, estado: 'listo' } : p))
    if (pedido?.usuario_id) {
      const esRecogida = pedido.modo_entrega === 'recogida'
      sendPush({
        targetType: 'cliente',
        targetId: pedido.usuario_id,
        title: esRecogida ? 'Pedido listo para recoger' : 'Pedido listo',
        body: esRecogida
          ? `Tu pedido ${pedido.codigo} está listo. Pásate cuando puedas.`
          : `Tu pedido ${pedido.codigo} está listo. El rider lo recogerá enseguida.`,
      })
    }
  }

  async function marcarRecogido(id) {
    const pedido = activos.find(p => p.id === id)
    await supabase.from('pedidos').update({ estado: 'recogido', recogido_at: new Date().toISOString() }).eq('id', id)
    setActivos(prev => prev.map(p => p.id === id ? { ...p, estado: 'recogido' } : p))
    if (pedido?.usuario_id && pedido.modo_entrega !== 'recogida') {
      sendPush({
        targetType: 'cliente',
        targetId: pedido.usuario_id,
        title: 'Pedido en camino',
        body: `El rider tiene tu pedido ${pedido.codigo} y va de camino.`,
      })
    }
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

  // En MOBILE PORTRAIT: detalle full-screen (push view, comportamiento actual).
  // En TABLET HORIZONTAL: el detalle se muestra en la columna derecha del split.
  if (pedidoDetalleId && pedidoDetalle && !isTabletHorizontal) {
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

  // ─── TABLET HORIZONTAL: split view 40/60 ───────────────────────────────
  if (isTabletHorizontal) {
    return (
      <SplitView
        entrantes={entrantes}
        preparando={preparando}
        listos={listos}
        enCamino={enCamino}
        timers={timers}
        itemsMap={itemsMap}
        pedidoSeleccionado={pedidoDetalle}
        onSelectPedido={setPedidoDetalleId}
        restaurante={restaurante}
        hayAlgo={hayAlgo}
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

  // ─── MOBILE PORTRAIT: lista compacta con aviso único + secciones ──────
  return (
    <div>
      {/* Aviso único: el propio pedido nuevo, con "Ver pedido" → aceptar/rechazar */}
      <AlertaNuevoPedido
        entrantes={entrantes}
        timers={timers}
        silenciada={silenciada}
        onVer={(id) => setPedidoDetalleId(id)}
        onSilenciar={silenciar}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ ...ds.h1, margin: 0 }}>Pedidos en vivo</h2>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>
            {entrantes.length + activos.length} activos
            {entrantes.length > 0 ? ` · ${entrantes.length} sin aceptar` : ''}
          </div>
        </div>
        <button onClick={() => { unlockAudio(); startAlarm(); setTimeout(stopAlarm, 2000) }} style={ds.filterBtn}>
          Probar alarma
        </button>
      </div>

      {!hayAlgo && (
        <div style={{ textAlign: 'center', padding: '60px 16px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: colors.cream2, color: colors.stone2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14, fontSize: 32,
          }}>📋</div>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Esperando nuevos pedidos…</div>
          <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>
            Aparecerán aquí en tiempo real con sonido. Mantén el sonido activado.
          </div>
          <div style={{
            marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: colors.sageSoft, color: colors.sage2,
            fontSize: type.xxs, fontWeight: 700,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.sage }} /> Conectado
          </div>
        </div>
      )}

      {entrantes.length > 0 && (
        <SeccionMobile tone="danger" label="Nuevos" count={entrantes.length}>
          {entrantes.map(p => (
            <LineaPedido key={p.id} pedido={p} timer={timers[p.id]} isNuevo onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionMobile>
      )}

      {preparando.length > 0 && (
        <SeccionMobile tone="warning" label="En preparación" count={preparando.length}>
          {preparando.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionMobile>
      )}

      {listos.length > 0 && (
        <SeccionMobile tone="sage" label="Listos" count={listos.length}>
          {listos.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionMobile>
      )}

      {enCamino.length > 0 && (
        <SeccionMobile tone="info" label="En camino" count={enCamino.length}>
          {enCamino.map(p => (
            <LineaPedido key={p.id} pedido={p} onTap={() => setPedidoDetalleId(p.id)} />
          ))}
        </SeccionMobile>
      )}

      <style>{`
        @keyframes pidooPulse {
          0%, 100% { box-shadow: 0 2px 8px rgba(168,69,31,0.25); }
          50% { box-shadow: 0 2px 18px rgba(197,86,44,0.45); }
        }
      `}</style>
    </div>
  )
}

// Sección móvil — mismo estilo header dot+label+counter que el bundle (s1-apk).
function SeccionMobile({ tone, label, count, children }) {
  const tones = {
    danger:  { bg: colors.dangerSoft,  fg: colors.danger },
    warning: { bg: colors.warningSoft, fg: '#8B6126' },
    sage:    { bg: colors.sageSoft,    fg: colors.sage2 },
    info:    { bg: colors.infoSoft,    fg: '#4A6480' },
  }
  const t = tones[tone] || tones.sage
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderRadius: 10, background: t.bg, marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.fg }} />
          <span style={{ color: t.fg, fontWeight: 700, fontSize: type.xs, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
        </div>
        <span style={{ color: t.fg, fontWeight: 800, fontSize: type.sm }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

// ─── Split View tablet horizontal (40/60) ──────────────────────────────────
// Columna izquierda 40%: secciones agrupadas + lista de pedidos.
// Columna derecha 60%: detalle persistente del pedido seleccionado.
// Reutiliza DetallePedido tal cual (sin botón Volver, suelto en `embedded`).
function SplitView({
  entrantes, preparando, listos, enCamino, timers, itemsMap,
  pedidoSeleccionado, onSelectPedido, restaurante, hayAlgo,
  onAceptar, onRechazar, onMarcarListo, onMarcarRecogido, onMarcarEntregado, onCancelar, onReimprimir,
}) {
  const totalActivos = entrantes.length + preparando.length + listos.length + enCamino.length
  return (
    <div style={{
      display: 'flex', gap: 0,
      height: 'calc(100vh - 100px)', // sale del padding del layout
      minHeight: 500,
      margin: '-16px -16px 0', // pegar a bordes del contenedor
    }}>
      {/* COLUMNA IZQUIERDA — Lista (40%) */}
      <div style={{
        width: '40%', minWidth: 280,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column',
        background: colors.cream,
      }}>
        {/* Header lista */}
        <div style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.paper,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.ink, letterSpacing: '-0.015em' }}>Pedidos</div>
            <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
              {totalActivos} activos{entrantes.length > 0 ? ` · ${entrantes.length} sin aceptar` : ''}
            </div>
          </div>
          <button
            onClick={() => { unlockAudio(); startAlarm(); setTimeout(stopAlarm, 2000) }}
            style={{ ...ds.filterBtn, fontSize: type.xxs }}
            title="Probar alarma"
          >
            Alarma
          </button>
        </div>

        {/* Lista scroll */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {!hayAlgo && (
            <div style={{ textAlign: 'center', padding: '60px 12px', color: colors.textMute }}>
              <div style={{ fontSize: type.sm, fontWeight: 600 }}>Esperando nuevos pedidos…</div>
              <div style={{ fontSize: type.xs, color: colors.textFaint, marginTop: 4 }}>Aparecerán aquí en tiempo real</div>
            </div>
          )}

          {entrantes.length > 0 && (
            <SeccionSplit tone="danger" label="Nuevos" count={entrantes.length}>
              {entrantes.map(p => (
                <LineaPedidoSplit
                  key={p.id} pedido={p}
                  timer={timers[p.id]} isNuevo
                  selected={pedidoSeleccionado?.id === p.id}
                  onTap={() => onSelectPedido(p.id)}
                />
              ))}
            </SeccionSplit>
          )}

          {preparando.length > 0 && (
            <SeccionSplit tone="warning" label="En preparación" count={preparando.length}>
              {preparando.map(p => (
                <LineaPedidoSplit
                  key={p.id} pedido={p}
                  selected={pedidoSeleccionado?.id === p.id}
                  onTap={() => onSelectPedido(p.id)}
                />
              ))}
            </SeccionSplit>
          )}

          {listos.length > 0 && (
            <SeccionSplit tone="sage" label="Listos" count={listos.length}>
              {listos.map(p => (
                <LineaPedidoSplit
                  key={p.id} pedido={p}
                  selected={pedidoSeleccionado?.id === p.id}
                  onTap={() => onSelectPedido(p.id)}
                />
              ))}
            </SeccionSplit>
          )}

          {enCamino.length > 0 && (
            <SeccionSplit tone="info" label="En camino" count={enCamino.length}>
              {enCamino.map(p => (
                <LineaPedidoSplit
                  key={p.id} pedido={p}
                  selected={pedidoSeleccionado?.id === p.id}
                  onTap={() => onSelectPedido(p.id)}
                />
              ))}
            </SeccionSplit>
          )}
        </div>
      </div>

      {/* COLUMNA DERECHA — Detalle persistente (60%) */}
      <div style={{
        flex: 1, minWidth: 0,
        background: colors.cream,
        overflowY: 'auto',
        padding: '22px 24px',
      }}>
        {pedidoSeleccionado ? (
          <DetallePedido
            key={pedidoSeleccionado.id /* re-monta al cambiar pedido (resets estados locales) */}
            pedido={pedidoSeleccionado}
            items={itemsMap[pedidoSeleccionado.id] || []}
            timer={timers[pedidoSeleccionado.id]}
            isNuevo={entrantes.some(p => p.id === pedidoSeleccionado.id)}
            restaurante={restaurante}
            embedded
            onVolver={() => onSelectPedido(null)}
            onAceptar={onAceptar}
            onRechazar={onRechazar}
            onMarcarListo={onMarcarListo}
            onMarcarRecogido={onMarcarRecogido}
            onMarcarEntregado={onMarcarEntregado}
            onCancelar={onCancelar}
            onReimprimir={onReimprimir}
          />
        ) : (
          <EstadoVacioDetalle hayAlgo={hayAlgo} />
        )}
      </div>
    </div>
  )
}

// Sección split: header con dot + label + contador, igual estilo que el bundle.
function SeccionSplit({ tone, label, count, children }) {
  const tones = {
    danger:  { bg: colors.dangerSoft,  fg: colors.danger },
    warning: { bg: colors.warningSoft, fg: '#8B6126' },
    sage:    { bg: colors.sageSoft,    fg: colors.sage2 },
    info:    { bg: colors.infoSoft,    fg: '#4A6480' },
  }
  const t = tones[tone] || tones.sage
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px', borderRadius: 10, background: t.bg, marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.fg }} />
          <span style={{ color: t.fg, fontWeight: 700, fontSize: type.xs, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
        </div>
        <span style={{ color: t.fg, fontWeight: 800, fontSize: type.sm }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

// Línea de pedido compacta para el split view (la versión mobile sigue intacta).
function LineaPedidoSplit({ pedido, timer, isNuevo, selected, onTap }) {
  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'
  const colorMap = {
    nuevo:      colors.stateNew,
    aceptado:   colors.statePrep,
    preparando: colors.statePrep,
    listo:      colors.stateOk,
    recogido:   colors.info,
    en_camino:  colors.info,
  }
  const accent = colorMap[pedido.estado] || colors.stone

  return (
    <div
      onClick={onTap}
      style={{
        background: selected ? colors.cream2 : colors.paper,
        border: selected ? `1.5px solid ${colors.terracotta}` : `1px solid ${colors.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 12, padding: '11px 13px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 6,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Fila 1: código + tipo + total */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: type.mono, fontSize: type.xs, color: colors.stone, fontWeight: 600 }}>{pedido.codigo}</span>
          <span style={{
            background: pedido.modo_entrega === 'delivery' ? colors.infoSoft : colors.cream2,
            color: pedido.modo_entrega === 'delivery' ? '#4A6480' : colors.stone,
            fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.03em',
          }}>
            {pedido.modo_entrega === 'delivery' ? 'Delivery' : 'Recogida'}
          </span>
        </div>
        <span style={{ fontSize: type.base, color: colors.ink, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {(pedido.total || 0).toFixed(2)}€
        </span>
      </div>

      {/* Fila 2: nombre + timer/acción */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: type.sm, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nombre}
          </div>
          {pedido.rider_accounts?.nombre && (
            <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>
              Rider: {pedido.rider_accounts.nombre}
            </div>
          )}
        </div>
        {isNuevo && timer != null && timer > 0 && (
          <div style={{
            fontSize: type.base, fontWeight: 800,
            color: timer < 60 ? colors.stateNew : colors.statePrep,
            background: timer < 60 ? colors.stateNewSoft : colors.statePrepSoft,
            padding: '2px 8px', borderRadius: 6, fontVariantNumeric: 'tabular-nums',
            animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          }}>
            {formatTimer(timer)}
          </div>
        )}
      </div>
    </div>
  )
}

// Estado vacío del panel derecho.
function EstadoVacioDetalle({ hayAlgo }) {
  return (
    <div style={{
      height: '100%', minHeight: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        background: colors.paper,
        border: `1px solid ${colors.border}`,
        borderRadius: 16, padding: '40px 32px',
        textAlign: 'center', maxWidth: 460,
        boxShadow: colors.shadow,
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: colors.cream2, color: colors.stone2,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16, fontSize: 32,
        }}>
          📋
        </div>
        <div style={{ ...ds.h2, color: colors.ink, marginBottom: 8 }}>
          {hayAlgo ? 'Selecciona un pedido' : 'Esperando nuevos pedidos…'}
        </div>
        <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5 }}>
          {hayAlgo
            ? 'Toca un pedido de la lista a la izquierda para ver el detalle aquí.'
            : 'Aparecerán aquí en tiempo real con sonido. Mantén el sonido activado y el dispositivo enchufado.'}
        </div>
        {!hayAlgo && (
          <div style={{
            marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            background: colors.sageSoft, color: colors.sage2,
            fontSize: type.xxs, fontWeight: 700,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.sage }} /> Conectado
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Línea de pedido móvil (card con border-left color estado, estilo bundle) ─
function LineaPedido({ pedido, timer, isNuevo, onTap }) {
  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  const colorMap = {
    nuevo:      colors.stateNew,
    aceptado:   colors.statePrep,
    preparando: colors.statePrep,
    listo:      colors.stateOk,
    recogido:   colors.info,
    en_camino:  colors.info,
  }
  const accent = colorMap[pedido.estado] || colors.stone

  const accionLabel = ['aceptado', 'preparando'].includes(pedido.estado) ? 'MARCAR LISTO'
    : pedido.estado === 'listo' ? 'RECOGIDO'
    : pedido.estado === 'recogido' || pedido.estado === 'en_camino' ? 'ENTREGADO'
    : null
  const accionStyle = ['aceptado', 'preparando'].includes(pedido.estado)
    ? { background: colors.warningSoft, color: '#8B6126' }
    : pedido.estado === 'listo'
    ? { background: colors.sageSoft, color: colors.sage2 }
    : { background: colors.infoSoft, color: '#4A6480' }

  const isDelivery = pedido.modo_entrega === 'delivery'

  return (
    <div
      onClick={onTap}
      style={{
        background: colors.paper,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 12,
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 8,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Fila 1: código mono + tipo badge + total */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: type.mono, fontSize: type.xs, color: colors.stone, fontWeight: 600 }}>{pedido.codigo}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isDelivery ? colors.infoSoft : colors.cream2,
            color: isDelivery ? '#4A6480' : colors.stone,
            fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.03em',
          }}>
            {isDelivery ? <Bike size={10} strokeWidth={2.4} /> : <ShoppingBag size={10} strokeWidth={2.4} />}
            {isDelivery ? 'Delivery' : 'Recogida'}
          </span>
        </div>
        <span style={{ fontSize: type.base, color: colors.ink, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {(pedido.total || 0).toFixed(2)}€
        </span>
      </div>

      {/* Fila 2: nombre + rider/items · timer/acción */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: type.sm, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nombre}
          </div>
          {pedido.rider_accounts?.nombre && (
            <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>
              Rider: {pedido.rider_accounts.nombre}
            </div>
          )}
          {isDelivery && !pedido.rider_accounts?.nombre && pedido.shipday_status === 'no_rider' && (
            <div style={{ fontSize: type.xxs, color: colors.danger, marginTop: 2, fontWeight: 600 }}>
              Sin rider disponible
            </div>
          )}
          {pedido.intento_asignacion > 1 && (
            <div style={{ fontSize: 10, color: '#8B6126', marginTop: 2, fontWeight: 700 }}>
              Reintento {pedido.intento_asignacion}/3
            </div>
          )}
        </div>

        {/* Timer (solo nuevos) o acción rápida */}
        {isNuevo && timer != null && timer > 0 ? (
          <div style={{
            fontSize: type.lg, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: timer < 60 ? colors.danger : colors.statePrep,
            background: timer < 60 ? colors.dangerSoft : colors.warningSoft,
            padding: '2px 10px', borderRadius: 8,
            animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
          }}>
            {formatTimer(timer)}
          </div>
        ) : isNuevo && timer === 0 ? (
          <span style={{
            fontSize: type.xs, fontWeight: 800,
            color: colors.danger, background: colors.dangerSoft,
            padding: '4px 10px', borderRadius: 8,
          }}>Expirando…</span>
        ) : accionLabel ? (
          <button
            onClick={e => { e.stopPropagation(); onTap() }}
            style={{
              padding: '5px 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', fontFamily: 'inherit',
              ...accionStyle,
            }}
          >
            {accionLabel}
          </button>
        ) : null}
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
          <Truck size={13} color="#6B6356" />
          <span>Rider: <strong>{rider.nombre}</strong>{rider.telefono ? ` · ${rider.telefono}` : ''}</span>
        </div>
      ) : sinRiders ? (
        <span style={{ background: 'var(--c-danger-soft)', color: '#B5564A', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Sin riders disponibles</span>
      ) : (
        <span style={{ background: 'var(--c-warning-soft)', color: '#C99551', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Sin asignar</span>
      )}
      {intento > 1 && (
        <span style={{ background: 'rgba(217,119,6,0.15)', color: '#C99551', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em' }}>Reintento {intento}/3</span>
      )}
    </div>
  )
}

// ─── Modal Reasignar rider ─────────────────────────────────────────────────
// Coincide con el diseño del bundle (sx-extras.jsx ModalReasignar):
// header con código + close, info card sage con riders cercanos, textarea motivo,
// footer separado con CTA "Reasignar" en glossy ink (terracotta).
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
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26,24,21,0.45)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', background: colors.paper,
          borderRadius: 16, width: '100%', maxWidth: 480,
          border: `1px solid ${colors.borderStrong}`,
          boxShadow: colors.shadowLg, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.ink, letterSpacing: '-0.01em' }}>
            Reasignar pedido{' '}
            <span style={{ fontFamily: type.mono, color: colors.stone, fontSize: type.sm, fontWeight: 600 }}>
              {pedido?.codigo || ''}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar"
            style={{
              width: 30, height: 30, borderRadius: 7, border: 'none',
              background: colors.cream2, color: colors.stone,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit',
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.55 }}>
            Se buscará el siguiente rider disponible más cercano al restaurante.
            El rider actual recibirá la notificación de que el pedido fue reasignado.
          </div>

          <div style={{
            background: colors.sageSoft, borderRadius: 12,
            padding: '11px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: colors.sage,
              flexShrink: 0,
            }} />
            <div style={{ fontSize: type.sm, color: colors.sage2, fontWeight: 600 }}>
              Pidoo elegirá el rider activo más cercano al restaurante.
            </div>
          </div>

          <div>
            <label style={ds.label}>Motivo (opcional)</label>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: El rider no responde tras varios intentos."
              rows={3}
              style={{
                width: '100%', padding: '10px 12px',
                borderRadius: 8, border: `1px solid ${colors.border}`,
                background: colors.paper, color: colors.text,
                fontSize: type.sm, fontFamily: type.family,
                resize: 'vertical', boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${colors.border}`,
          background: colors.cream,
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              ...ds.secondaryBtn,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={loading}
            style={{
              ...ds.glossyBtn,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              minWidth: 130,
            }}
          >
            {loading ? 'Reasignando…' : 'Reasignar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Cambiar de socio (multi-socio) ──────────────────────────────────
// El restaurante elige a cuál de sus socios vinculados asignar el pedido.
// La edge `assign-pedido-restaurante` elige el rider más cercano ONLINE de ese socio.
function ModalCambiarSocio({ pedido, socios, onClose }) {
  const [seleccion, setSeleccion] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !loading) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  async function confirmar() {
    if (!seleccion || loading) return
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('assign-pedido-restaurante', { body: { pedido_id: pedido.id, socio_id: seleccion } })
      if (error) throw error
      if (data?.ok === false) {
        toast(data.reason === 'socio_sin_rider_online' ? 'Ese socio no tiene repartidores en línea ahora mismo' : (data.reason || 'No se pudo asignar'), 'error')
        setLoading(false)
        return
      }
      toast('Pedido asignado al socio elegido', 'success')
      onClose()
    } catch (err) {
      console.error('[CambiarSocio]', err)
      toast(err?.message || 'Error al asignar el pedido', 'error')
      setLoading(false)
    }
  }

  const handleOverlayClick = () => { if (!loading) onClose() }

  return (
    <div onClick={handleOverlayClick} style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,0.45)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: colors.paper, borderRadius: 16, width: '100%', maxWidth: 480, border: `1px solid ${colors.borderStrong}`, boxShadow: colors.shadowLg, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.ink, letterSpacing: '-0.01em' }}>
            Cambiar de socio{' '}
            <span style={{ fontFamily: type.mono, color: colors.stone, fontSize: type.sm, fontWeight: 600 }}>{pedido?.codigo || ''}</span>
          </div>
          <button onClick={onClose} disabled={loading} aria-label="Cerrar" style={{ width: 30, height: 30, borderRadius: 7, border: 'none', background: colors.cream2, color: colors.stone, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>

        {/* Body: lista de socios */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.55, marginBottom: 4 }}>
            Elige el socio que repartirá este pedido. Se asignará a su repartidor más cercano que esté en línea.
          </div>
          {socios.map(s => {
            const activo = seleccion === s.socio_id
            const disabled = !s.en_servicio
            return (
              <button key={s.socio_id} onClick={() => !disabled && setSeleccion(s.socio_id)} disabled={disabled}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, textAlign: 'left',
                  border: `${activo ? 2 : 1}px solid ${activo ? colors.terracotta : colors.border}`,
                  background: activo ? colors.terracottaSoft || colors.cream2 : colors.surface,
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, fontFamily: 'inherit', width: '100%',
                }}>
                <div style={{ width: 38, height: 38, borderRadius: 8, flexShrink: 0, background: s.logo_url ? `url(${s.logo_url}) center/cover` : colors.cream2, border: `1px solid ${colors.border}`, display: 'grid', placeItems: 'center', color: colors.stone, fontWeight: 800 }}>
                  {!s.logo_url && (s.nombre?.[0] || 'S').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nombre}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: type.xxs, color: s.en_servicio ? colors.sage2 : colors.stone, fontWeight: 600, marginTop: 2 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.en_servicio ? colors.sage : colors.stone2 }} />
                    {s.en_servicio ? 'En línea' : 'Fuera de servicio'}
                  </div>
                </div>
                {activo && <span style={{ color: colors.terracotta, fontWeight: 800, fontSize: 16 }}>✓</span>}
              </button>
            )
          })}
          {socios.length === 0 && (
            <div style={{ fontSize: type.sm, color: colors.stone }}>No tienes socios vinculados activos.</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${colors.border}`, background: colors.cream, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={loading} style={{ ...ds.secondaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>Cancelar</button>
          <button onClick={confirmar} disabled={loading || !seleccion} style={{ ...ds.glossyBtn, cursor: (loading || !seleccion) ? 'not-allowed' : 'pointer', opacity: (loading || !seleccion) ? 0.6 : 1, minWidth: 130 }}>
            {loading ? 'Asignando…' : 'Asignar socio'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pantalla de detalle ───────────────────────────────────────────────────
const seccionLabel = { fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'block' }
const seccionCard = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }

function DetallePedido({ pedido, items, timer, isNuevo, restaurante, embedded, onVolver, onAceptar, onRechazar, onMarcarListo, onMarcarRecogido, onMarcarEntregado, onCancelar, onReimprimir }) {
  const [rechazando, setRechazando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [minutosSel, setMinutosSel] = useState(20)
  const [aceptando, setAceptando] = useState(false)
  const [reasignando, setReasignando] = useState(false)
  const [sociosVinc, setSociosVinc] = useState([])
  const [cambiarSocio, setCambiarSocio] = useState(false)

  const puedeReasignar = pedido.modo_entrega === 'delivery'
    && ['preparando', 'listo', 'nuevo', 'aceptado'].includes(pedido.estado) // 'aceptado' equivale a 'preparando' en este panel
    && !!pedido.rider_accounts
    && pedido.shipday_status !== 'no_rider'

  // Socios vinculados (multi-socio): permite que el restaurante elija a cuál asignar.
  useEffect(() => {
    let cancel = false
    if (pedido.modo_entrega !== 'delivery' || !restaurante?.id) { setSociosVinc([]); return }
    ;(async () => {
      try {
        const { data } = await supabase.functions.invoke('list-socios-restaurante', { body: { establecimiento_id: restaurante.id } })
        if (!cancel && data?.ok) setSociosVinc(data.socios || [])
      } catch (_) { /* silencioso: si falla, no se muestra el botón */ }
    })()
    return () => { cancel = true }
  }, [pedido.modo_entrega, restaurante?.id])

  const puedeCambiarSocio = pedido.modo_entrega === 'delivery'
    && ['nuevo', 'aceptado', 'preparando', 'listo'].includes(pedido.estado)
    && sociosVinc.length > 1

  const nombre = pedido.usuarios?.nombre
    ? `${pedido.usuarios.nombre}${pedido.usuarios.apellido ? ' ' + pedido.usuarios.apellido : ''}`
    : 'Cliente'

  // En modo embedded (split view tablet): no auto-cerrar el detalle tras acciones.
  // El padre re-renderiza con el pedido actualizado o lo elimina del array.
  const afterAction = embedded ? () => {} : onVolver

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {!embedded && (
          <button onClick={onVolver} style={{
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--c-border)', background: 'var(--c-surface)',
            color: 'var(--c-muted)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Volver</button>
        )}
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
              color: timer < 60 ? '#B5564A' : '#C99551',
              fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              animation: timer < 60 ? 'pulse 0.5s ease-in-out infinite' : 'none',
            }}>{formatTimer(timer)}</div>
          ) : (
            <div style={{
              background: 'var(--c-danger-soft)', borderRadius: 8, padding: '6px 12px',
              color: '#B5564A', fontSize: 14, fontWeight: 800,
            }}>Expirando...</div>
          )
        )}
      </div>

      {/* Tiempo estimado */}
      {(pedido.estado === 'preparando' || pedido.estado === 'aceptado') && pedido.minutos_preparacion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: 'var(--c-surface)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>Tiempo estimado: <strong style={{ color: '#C99551' }}>{pedido.minutos_preparacion} min</strong></span>
        </div>
      )}

      {/* RIDER (solo delivery) */}
      {pedido.modo_entrega === 'delivery' && (
        <div style={seccionCard}>
          <span style={seccionLabel}>Repartidor</span>
          <RiderInfo pedido={pedido} />
          {(puedeReasignar || puedeCambiarSocio) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {puedeReasignar && (
                <button onClick={() => setReasignando(true)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface2)', color: 'var(--c-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Reasignar
                </button>
              )}
              {puedeCambiarSocio && (
                <button onClick={() => setCambiarSocio(true)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface2)', color: 'var(--c-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cambiar de socio
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {reasignando && <ModalReasignar pedido={pedido} onClose={() => setReasignando(false)} />}
      {cambiarSocio && <ModalCambiarSocio pedido={pedido} socios={sociosVinc} onClose={() => setCambiarSocio(false)} />}

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
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600 }}>{metodoPagoLabel(pedido.metodo_pago)}</div>
            {pedido.metodo_pago !== 'tarjeta' && <div style={{ fontSize: 10, color: '#C99551', marginTop: 2 }}>Cobrar en mano</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Canal de Venta</div>
            <div style={{ fontSize: 12, color: 'var(--c-text)', fontWeight: 600 }}>{canalVentaLabel(pedido.origen_pedido)}</div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8B9D7A', marginBottom: 6 }}>
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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#B5564A', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo del rechazo</div>
              {MOTIVOS_RECHAZO.map(m => (
                <button key={m.id} onClick={() => { onRechazar(pedido.id, m.id); afterAction() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(220,38,38,0.08)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
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
                      background: minutosSel === min ? colors.primary : 'var(--c-surface)',
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
                <button onClick={() => { if (aceptando) return; setAceptando(true); onAceptar(pedido, minutosSel); afterAction() }} disabled={aceptando} style={{ flex: 2, padding: '14px 0', borderRadius: 8, border: 'none', background: colors.primary, color: '#fff', fontSize: 14, fontWeight: 800, cursor: aceptando ? 'wait' : 'pointer', opacity: aceptando ? 0.7 : 1, fontFamily: 'inherit' }}>
                  {aceptando ? 'Aceptando…' : 'Aceptar pedido'}
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
          <button onClick={() => { onMarcarListo(pedido.id); afterAction() }} style={{ flex: 1, padding: '13px 0', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'var(--c-success-soft)', color: '#8B9D7A', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Pedido listo para recoger</button>
        </div>
      )}

      {/* LISTO: recogida en local */}
      {pedido.estado === 'listo' && pedido.modo_entrega === 'recogida' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, padding: '13px 0', borderRadius: 8, background: 'var(--c-success-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#8B9D7A', border: '1px solid rgba(74,222,128,0.2)' }}>Esperando al cliente</div>
          <button onClick={() => { onMarcarEntregado(pedido.id); afterAction() }} style={{ padding: '13px 18px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(22,163,74,0.20)', color: '#8B9D7A', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Entregado</button>
        </div>
      )}

      {/* LISTO: delivery */}
      {pedido.estado === 'listo' && pedido.modo_entrega !== 'recogida' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'var(--c-success-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#8B9D7A', marginBottom: 12, border: '1px solid rgba(74,222,128,0.2)' }}>
          Esperando repartidor
        </div>
      )}

      {/* RECOGIDO */}
      {pedido.estado === 'recogido' && (
        <div style={{ padding: '13px 16px', borderRadius: 8, background: 'var(--c-info-soft)', textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#7B8FA8', marginBottom: 12, border: '1px solid rgba(96,165,250,0.2)' }}>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: '#B5564A', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motivo de cancelación</div>
            {MOTIVOS_CANCELACION.map(m => (
              <button key={m.id} onClick={() => { onCancelar(pedido, m.id); afterAction() }} style={{ width: '100%', padding: '11px 14px', borderRadius: 8, marginBottom: 6, border: '1px solid rgba(185,28,28,0.2)', background: 'rgba(220,38,38,0.06)', color: 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{m.label}</button>
            ))}
            <button onClick={() => setCancelando(false)} style={{ width: '100%', padding: '8px 0', border: 'none', background: 'transparent', color: 'var(--c-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Volver</button>
          </div>
        ) : (
          <button onClick={() => setCancelando(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 8, border: '1px solid rgba(185,28,28,0.25)', background: 'rgba(220,38,38,0.06)', color: '#B5564A', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar pedido</button>
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
    if (estado === 'aceptado') return { icon: '✅', label: 'Aceptado', color: '#8B9D7A' }
    if (estado === 'rechazado') return { icon: '❌', label: 'Rechazado', color: '#B5564A' }
    if (estado === 'timeout') return { icon: '⏱', label: 'Timeout', color: '#C99551' }
    if (estado === 'cancelado') return { icon: '⊘', label: 'Cancelado', color: 'var(--c-muted)' }
    return { icon: '⏳', label: 'Esperando aceptación', color: '#C99551' }
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
