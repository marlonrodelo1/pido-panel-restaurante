import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Bike, ShoppingBag, Package } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds, stateBadge, stateLabel } from '../lib/uiStyles'

// Historial pensado para la app móvil del panel restaurante.
// Muestra pedidos del día actual o de los últimos 7 días en una lista
// compacta. Tap → modal de detalle con items, extras y rider asignado.
// Pedidos anteriores: aviso para abrir panel.pidoo.es.

const RANGOS = [
  { id: 'hoy', label: 'Hoy', dias: 0 },
  { id: 'semana', label: 'Esta semana', dias: 7 },
]

function startOfTodayIso() {
  // "Hoy" empieza a las 5:00, igual que en la pantalla de Pedidos del TPV: un bar
  // que cierra a las 2 sigue teniendo "hoy" a las 3, y cortar a medianoche partía
  // el servicio por la mitad (y este historial decía una cosa y Pedidos otra).
  const d = new Date()
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  d.setHours(5, 0, 0, 0)
  return d.toISOString()
}

function daysAgoIso(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function formatHora(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function formatFechaCorta(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const hoy = new Date()
  return d.toDateString() === hoy.toDateString()
}

export default function HistorialMovil() {
  const { restaurante } = useRest()
  const [rango, setRango] = useState('hoy')
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [pedidoSel, setPedidoSel] = useState(null)
  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)

  const fetchPedidos = useCallback(async () => {
    if (!restaurante?.id) return
    setError(null)
    const desde = rango === 'hoy' ? startOfTodayIso() : daysAgoIso(7)

    try {
      const { data, error: qErr } = await supabase
        .from('pedidos')
        .select('id, codigo, estado, modo_entrega, origen_pedido, created_at, total, minutos_preparacion, shipday_status, shipday_tracking_url, rider_account_id, metodo_pago, guest_nombre, cliente_telefono, rider_accounts(id, nombre, telefono), usuarios(nombre, apellido, telefono)')
        .eq('establecimiento_id', restaurante.id)
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(200)
      if (qErr) throw qErr
      setPedidos(data || [])
    } catch (err) {
      console.error('[HistorialMovil] Error:', err)
      setError('No se pudo cargar el historial. Toca para reintentar.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [restaurante?.id, rango])

  useEffect(() => {
    setLoading(true)
    fetchPedidos()
  }, [fetchPedidos])

  async function abrirDetalle(p) {
    setPedidoSel(p)
    setItems([])
    setLoadingItems(true)
    try {
      const { data } = await supabase
        .from('pedido_items')
        .select('*')
        .eq('pedido_id', p.id)
      setItems(data || [])
    } catch (err) {
      console.error('[HistorialMovil] Items error:', err)
    }
    setLoadingItems(false)
  }

  function cerrarDetalle() {
    setPedidoSel(null)
    setItems([])
  }

  function refrescar() {
    setRefreshing(true)
    fetchPedidos()
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ ...ds.h1, margin: 0 }}>Historial</h2>
        <button
          onClick={refrescar}
          disabled={refreshing}
          aria-label="Refrescar"
          style={{
            ...ds.actionBtn,
            height: 36, padding: '0 10px',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} strokeWidth={2.2} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Pills rango — estilo bundle PillTabs (terracotta activa) */}
      <div style={{
        display: 'flex', gap: 4,
        padding: 4,
        background: colors.cream2,
        borderRadius: 999,
        marginBottom: 16,
      }}>
        {RANGOS.map(r => {
          const activo = rango === r.id
          return (
            <button
              key={r.id}
              onClick={() => setRango(r.id)}
              style={{
                flex: 1,
                padding: '8px 14px',
                borderRadius: 999,
                border: 'none',
                background: activo ? colors.primary : 'transparent',
                color: activo ? '#fff' : colors.stone,
                fontSize: type.sm,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
                letterSpacing: '0.01em',
              }}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: colors.textMute, fontSize: type.sm }}>
          Cargando...
        </div>
      )}

      {error && !loading && (
        <button
          onClick={() => { setLoading(true); fetchPedidos() }}
          style={{
            width: '100%',
            textAlign: 'center',
            padding: '24px 16px',
            color: colors.danger,
            fontSize: type.sm,
            background: colors.dangerSoft,
            borderRadius: 12,
            border: `1px solid ${colors.dangerSoft}`,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {error}
        </button>
      )}

      {!loading && !error && pedidos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 16px' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: colors.surface2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Package size={26} strokeWidth={1.8} color={colors.textMute} />
          </div>
          <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 4, color: colors.text }}>
            {rango === 'hoy' ? 'Aún no tienes pedidos hoy' : 'Sin pedidos esta semana'}
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5 }}>
            Cuando lleguen pedidos los verás aquí.
          </div>
        </div>
      )}

      {!loading && !error && pedidos.map(p => <PedidoCard key={p.id} pedido={p} onClick={() => abrirDetalle(p)} />)}

      {/* Aviso pedidos anteriores */}
      {!loading && !error && pedidos.length > 0 && (
        <div style={{
          marginTop: 18,
          padding: '14px 16px',
          background: colors.surface2,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          fontSize: type.xs,
          color: colors.textMute,
          textAlign: 'center',
          lineHeight: 1.5,
        }}>
          ¿Buscas pedidos anteriores? Abre <span style={{ color: colors.primary, fontWeight: 700 }}>panel.pidoo.es</span> para ver el historial completo.
        </div>
      )}

      {pedidoSel && (
        <DetalleModal
          pedido={pedidoSel}
          items={items}
          loading={loadingItems}
          onClose={cerrarDetalle}
        />
      )}

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function PedidoCard({ pedido, onClick }) {
  const sb = stateBadge(pedido.estado)
  const { _label, ...sbStyle } = sb
  const isDelivery = pedido.modo_entrega === 'delivery'
  const rider = pedido.rider_accounts

  // Border-left por estado (matches bundle s1-apk LineaPedido).
  const accentMap = {
    entregado:  colors.sage,
    cancelado:  colors.stone2,
    fallido:    colors.stone2,
    listo:      colors.sage,
    recogido:   colors.info,
    en_camino:  colors.info,
    preparando: colors.statePrep,
    aceptado:   colors.statePrep,
    nuevo:      colors.stateNew,
  }
  const accent = accentMap[pedido.estado] || colors.stone2

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        background: colors.paper,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'block',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: type.sm, color: colors.text }}>{pedido.codigo}</span>
          <span style={sbStyle}>{_label}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isDelivery ? colors.infoSoft : colors.stateOkSoft,
            color: isDelivery ? colors.info : colors.stateOk,
            fontSize: type.xxs, fontWeight: 700, padding: '3px 7px',
            borderRadius: 6, letterSpacing: '0.04em',
          }}>
            {isDelivery ? <Bike size={11} strokeWidth={2.4} /> : <ShoppingBag size={11} strokeWidth={2.4} />}
            {isDelivery ? 'Delivery' : 'Recogida'}
          </span>
        </div>
        <span style={{ fontWeight: 800, fontSize: type.sm, color: colors.text }}>
          {(pedido.total || 0).toFixed(2)} €
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: type.xs, color: colors.textMute }}>
        <span>
          {isToday(pedido.created_at) ? formatHora(pedido.created_at) : `${formatFechaCorta(pedido.created_at)} · ${formatHora(pedido.created_at)}`}
        </span>
        {isDelivery && rider?.nombre && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.textDim, fontWeight: 600 }}>
            <Bike size={11} strokeWidth={2.2} /> {rider.nombre}
          </span>
        )}
      </div>
    </button>
  )
}

function DetalleModal({ pedido, items, loading, onClose }) {
  const sb = stateBadge(pedido.estado)
  const { _label } = sb
  const isDelivery = pedido.modo_entrega === 'delivery'
  const rider = pedido.rider_accounts
  const cliente = pedido.usuarios

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.5)',
        zIndex: 1000, display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.surface,
          borderRadius: '18px 18px 0 0',
          width: '100%', maxWidth: 520, maxHeight: '92vh',
          overflowY: 'auto',
          padding: '14px 18px 28px',
          boxShadow: colors.shadowLg,
          animation: 'slideUp 0.25s ease',
        }}
      >
        {/* Drag handle + back */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button
            onClick={onClose}
            style={{ ...ds.backBtn, marginBottom: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <ArrowLeft size={16} strokeWidth={2.2} /> Volver
          </button>
          <span style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 600 }}>
            {new Date(pedido.created_at).toLocaleString('es-ES')}
          </span>
        </div>

        {/* Código + estado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, letterSpacing: '-0.4px' }}>{pedido.codigo}</span>
          <span style={{
            background: sb.background, color: sb.color,
            fontSize: type.xxs, fontWeight: 700, padding: '4px 10px',
            borderRadius: 8, letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>{_label}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isDelivery ? colors.infoSoft : colors.stateOkSoft,
            color: isDelivery ? colors.info : colors.stateOk,
            fontSize: type.xxs, fontWeight: 700, padding: '4px 10px',
            borderRadius: 8, letterSpacing: '0.04em',
          }}>
            {isDelivery ? <Bike size={11} strokeWidth={2.4} /> : <ShoppingBag size={11} strokeWidth={2.4} />}
            {isDelivery ? 'Delivery' : 'Recogida'}
          </span>
        </div>

        {/* Cliente */}
        {cliente && (
          <Section titulo="Cliente">
            <Row label="Nombre" value={`${cliente.nombre || ''} ${cliente.apellido || ''}`.trim() || '—'} />
            {cliente.telefono && <Row label="Teléfono" value={cliente.telefono} />}
          </Section>
        )}

        {/* Rider */}
        {isDelivery && (
          <Section titulo="Repartidor">
            {rider?.nombre ? (
              <>
                <Row label="Nombre" value={rider.nombre} />
                {rider.telefono && <Row label="Teléfono" value={rider.telefono} />}
                {(() => {
                  const label = {
                    created: 'Asignado', assigned: 'Asignado', accepted: 'Aceptado',
                    picked_up: 'Recogido', pickedup: 'Recogido', on_the_way: 'En camino',
                    delivered: 'Entregado', no_rider: 'Sin rider disponible',
                    error_crear_orden: 'Error de asignación',
                  }[pedido.shipday_status]
                  return label ? <Row label="Estado entrega" value={label} /> : null
                })()}
              </>
            ) : (
              <div style={{ fontSize: type.sm, color: colors.textMute }}>Sin rider asignado</div>
            )}
          </Section>
        )}

        {/* Items */}
        <Section titulo={`Productos (${items.length})`}>
          {loading && <div style={{ fontSize: type.sm, color: colors.textMute }}>Cargando...</div>}
          {!loading && items.length === 0 && <div style={{ fontSize: type.sm, color: colors.textMute }}>Sin productos.</div>}
          {!loading && items.map(it => (
            <div key={it.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>
                  {it.cantidad}× {it.nombre_producto || 'Producto'}
                </span>
                <span style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>
                  {(Number(it.precio_unitario || 0) * (it.cantidad || 1)).toFixed(2)} €
                </span>
              </div>
              {it.tamano && (
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 2 }}>Tamaño: {it.tamano}</div>
              )}
              {Array.isArray(it.extras) && it.extras.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {it.extras.map((ex, i) => (
                    <div key={i} style={{ fontSize: type.xxs, color: colors.textMute, paddingLeft: 8 }}>+ {ex}</div>
                  ))}
                </div>
              )}
              {it.notas && (
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4, fontStyle: 'italic' }}>"{it.notas}"</div>
              )}
            </div>
          ))}
        </Section>

        {/* Totales y meta */}
        <Section titulo="Resumen">
          {pedido.minutos_preparacion != null && (
            <Row label="Tiempo prep" value={`${pedido.minutos_preparacion} min`} />
          )}
          {pedido.origen_pedido === 'telefonico' && (
            <Row label="Origen" value="Pedido telefónico" />
          )}
          {pedido.metodo_pago && (
            <Row label="Pago" value={pedido.metodo_pago === 'tarjeta' ? 'Tarjeta' : pedido.metodo_pago === 'pagado_local' ? 'Ya pagado (bizum/local)' : 'Efectivo'} />
          )}
          <Row label="Total" value={`${(pedido.total || 0).toFixed(2)} €`} bold />
        </Section>

        {pedido.shipday_tracking_url && (
          <a
            href={pedido.shipday_tracking_url}
            target="_blank"
            rel="noreferrer"
            style={{
              ...ds.secondaryBtn,
              width: '100%', height: 42, marginTop: 8,
              textDecoration: 'none',
            }}
          >
            Ver seguimiento
          </a>
        )}
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  )
}

function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {titulo}
      </div>
      <div style={{ background: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', gap: 12 }}>
      <span style={{ fontSize: type.xs, color: colors.textMute, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: type.sm, color: colors.text, fontWeight: bold ? 800 : 600, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}
