import { useState, useEffect, useCallback, Component } from 'react'
import { ClipboardList, Clock, UtensilsCrossed, Settings, BarChart3, Tag, MessageCircle, ToggleLeft, Printer, Globe } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { Browser } from '@capacitor/browser'
import { supabase } from './lib/supabase'
import { RestProvider, useRest } from './context/RestContext'
import { PedidoAlertProvider, usePedidoAlert } from './context/PedidoAlertContext'
import Login from './pages/Login'
import CompletarRegistro from './pages/CompletarRegistro'
import PedidosEnVivo from './pages/PedidosEnVivo'
import Historial from './pages/Historial'
import Carta from './pages/Carta'
import Metricas from './pages/Metricas'
import Ajustes from './pages/Ajustes'
import Promociones from './pages/Promociones'
import Soporte from './pages/Soporte'
import DisponibilidadProductos from './pages/DisponibilidadProductos'
import ConfigImpresora from './pages/ConfigImpresora'
import Activacion from './pages/Activacion'

const isNative = Capacitor.isNativePlatform()

const NAV_ICONS_WEB = { pedidos: ClipboardList, historial: Clock, carta: UtensilsCrossed, promos: Tag, ajustes: Settings }
const NAV_ICONS_NATIVE = { pedidos: ClipboardList, disponibilidad: ToggleLeft, impresora: Printer }

function AppContent() {
  const { user, restaurante, loading } = useRest()
  const [seccion, setSeccion] = useState('pedidos')

  const handleNuevoPedido = useCallback(() => {
    setSeccion('pedidos')
  }, [])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false })
      StatusBar.setBackgroundColor({ color: '#0D0D0D' })
      StatusBar.setStyle({ style: Style.Dark })

      CapApp.addListener('appUrlOpen', async ({ url }) => {
        if (url.includes('access_token') || url.includes('refresh_token') || url.includes('code=')) {
          // Cerrar el browser del OAuth
          try { await Browser.close() } catch {}
          const parsed = new URL(url)
          const hashOrQuery = parsed.hash || parsed.search
          if (hashOrQuery) {
            const params = new URLSearchParams(hashOrQuery.replace('#', '?').replace('?', ''))
            const access_token = params.get('access_token')
            const refresh_token = params.get('refresh_token')
            if (access_token && refresh_token) {
              supabase.auth.setSession({ access_token, refresh_token })
            }
          }
        }
      })
    }
  }, [])

  if (loading) {
    return (
      <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🍽️</div>
      </div>
    )
  }

  if (!user) {
    return <div style={shell}><style>{css}</style><Login /></div>
  }

  if (!restaurante) {
    return <div style={shell}><style>{css}</style><CompletarRegistro /></div>
  }

  // Restaurante registrado por un socio pero aún no activado por el dueño
  if (restaurante.activado === false) {
    return <div style={shell}><style>{css}</style><Activacion /></div>
  }

  const nav = isNative
    ? [
        { id: 'pedidos', label: 'Pedidos' },
        { id: 'disponibilidad', label: 'Carta' },
        { id: 'impresora', label: 'Config' },
      ]
    : [
        { id: 'pedidos', label: 'Pedidos' },
        { id: 'historial', label: 'Historial' },
        { id: 'carta', label: 'Carta' },
        { id: 'promos', label: 'Promos' },
        { id: 'ajustes', label: 'Ajustes' },
      ]

  return (
    <PedidoAlertProvider onNuevoPedido={handleNuevoPedido}>
      <AppInner seccion={seccion} setSeccion={setSeccion} nav={nav} />
    </PedidoAlertProvider>
  )
}

function AppInner({ seccion, setSeccion, nav }) {
  const { restaurante } = useRest()
  const { pedidosNuevos } = usePedidoAlert()
  async function abrirPanelWeb() {
    try {
      await Browser.open({ url: 'https://parnert.pidoo.es' })
    } catch {
      window.open('https://parnert.pidoo.es', '_blank')
    }
  }

  const navIcons = isNative ? NAV_ICONS_NATIVE : NAV_ICONS_WEB

  return (
    <div style={{ ...shell, minHeight: '100vh', position: 'relative', paddingBottom: 80 }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#131313', borderBottom: '1px solid #1e1e1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, overflow: 'hidden', flexShrink: 0 }}>
            {restaurante.logo_url ? <img src={restaurante.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🍽️'}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: '#E5E2E1', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{restaurante.nombre}</div>
            <div style={{ fontSize: 10, color: restaurante.activo ? '#4ade80' : '#ab8985', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {restaurante.activo ? '● Abierto' : '● Cerrado'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pedidosNuevos.length > 0 && seccion !== 'pedidos' && (
            <button onClick={() => setSeccion('pedidos')} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px',
              borderRadius: 10, border: 'none', background: '#FEF2F2',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', color: '#991B1B',
              animation: 'pulse 1s infinite',
            }}>
              🔔 {pedidosNuevos.length} nuevo{pedidosNuevos.length > 1 ? 's' : ''}
            </button>
          )}
          {isNative ? (
            <button onClick={abrirPanelWeb} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px',
              borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)',
              background: 'var(--c-surface2)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-muted)',
            }}>
              <Globe size={13} strokeWidth={2} />
              Panel web
            </button>
          ) : (
            <>
              <button onClick={() => setSeccion('soporte')} style={{
                padding: '7px 10px', borderRadius: 10, border: 'none',
                background: seccion === 'soporte' ? 'var(--c-primary)' : 'var(--c-surface2)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                color: seccion === 'soporte' ? '#fff' : 'var(--c-muted)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}><MessageCircle size={14} strokeWidth={2} /></button>
              <button onClick={() => setSeccion('metricas')} style={{
                padding: '7px 10px', borderRadius: 10, border: 'none',
                background: seccion === 'metricas' ? 'var(--c-primary)' : 'var(--c-surface2)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                color: seccion === 'metricas' ? '#fff' : 'var(--c-muted)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}><BarChart3 size={14} strokeWidth={2} /></button>
            </>
          )}
        </div>
      </div>

      {/* Banner flotante cuando hay pedidos nuevos y NO estamos en Pedidos */}
      {pedidosNuevos.length > 0 && seccion !== 'pedidos' && (
        <button onClick={() => setSeccion('pedidos')} style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)', maxWidth: 500, zIndex: 100,
          background: 'linear-gradient(135deg, #B91C1C, #DC2626)',
          borderRadius: 14, padding: '14px 18px', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 8px 32px rgba(185,28,28,0.4)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔔</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>
                {pedidosNuevos.length} pedido{pedidosNuevos.length > 1 ? 's' : ''} nuevo{pedidosNuevos.length > 1 ? 's' : ''}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600 }}>Toca para ver y aceptar</div>
            </div>
          </div>
          <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.25)', padding: '6px 12px', borderRadius: 8 }}>
            Ir a pedidos
          </div>
        </button>
      )}

      {/* Contenido */}
      <div style={{ padding: 20, animation: 'fadeIn 0.3s ease' }}>
        {seccion === 'pedidos' && <PedidosEnVivo />}
        {/* Native-only */}
        {seccion === 'disponibilidad' && <DisponibilidadProductos />}
        {seccion === 'impresora' && <ConfigImpresora />}
        {/* Web-only */}
        {seccion === 'historial' && <Historial />}
        {seccion === 'carta' && <Carta />}
        {seccion === 'promos' && <Promociones />}
        {seccion === 'soporte' && <Soporte />}
        {seccion === 'metricas' && <Metricas />}
        {seccion === 'ajustes' && <Ajustes />}
      </div>

      {/* Bottom nav */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', background: 'rgba(19,19,19,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-around', padding: '8px 0 12px', zIndex: 50 }}>
        {nav.map(n => (
          <button key={n.id} onClick={() => setSeccion(n.id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            color: seccion === n.id ? 'var(--c-primary)' : 'var(--c-muted)',
            fontSize: 10, fontWeight: 600, padding: '4px 8px', transition: 'color 0.2s',
            position: 'relative',
          }}>
            {(() => { const Icon = navIcons[n.id]; return Icon ? <Icon size={20} strokeWidth={seccion === n.id ? 2.5 : 1.8} /> : null })()}
            {n.label}
            {n.id === 'pedidos' && pedidosNuevos.length > 0 && (
              <span style={{
                position: 'absolute', top: -2, right: 0,
                width: 16, height: 16, borderRadius: 8,
                background: '#EF4444', color: '#fff',
                fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse 1s infinite',
              }}>{pedidosNuevos.length}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

const shell = {
  '--c-primary': '#B91C1C', '--c-primary-light': 'rgba(185,28,28,0.15)', '--c-primary-soft': 'rgba(185,28,28,0.25)',
  '--c-bg': '#0D0D0D', '--c-surface': '#1A1A1A', '--c-surface2': '#242424',
  '--c-surface3': '#2a2a2a', '--c-border': '#353535',
  '--c-text': '#E5E2E1', '--c-muted': '#ab8985', '--c-accent': '#ffb4ab',
  '--c-btn-gradient': 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)',
  fontFamily: "'DM Sans', sans-serif", width: '100%',
  background: 'var(--c-bg)', color: 'var(--c-text)',
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;0,9..40,800&display=swap');
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
::-webkit-scrollbar{display:none}
body{background:#0D0D0D;margin:0}
input,select,textarea{font-size:16px !important}
@media(min-width:600px){input,select,textarea{font-size:13px !important}}
`

// ── Toast notifications ──────────────────────────────────────────────────────
let _setToastState = null

export function toast(msg, type = 'error') {
  if (_setToastState) _setToastState({ visible: true, msg, type })
}

function ToastNotification() {
  const [state, setState] = useState({ visible: false, msg: '', type: 'error' })
  useEffect(() => { _setToastState = setState }, [])

  useEffect(() => {
    if (!state.visible) return
    const t = setTimeout(() => setState(s => ({ ...s, visible: false })), 3000)
    return () => clearTimeout(t)
  }, [state.visible, state.msg])

  if (!state.visible) return null

  const isError = state.type === 'error'
  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9998, maxWidth: 'calc(100% - 40px)', width: 'max-content',
      background: isError ? '#7F1D1D' : '#14532D',
      border: `1px solid ${isError ? '#DC2626' : '#16A34A'}`,
      color: '#fff', borderRadius: 12, padding: '12px 18px',
      fontSize: 13, fontWeight: 600, textAlign: 'center',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'fadeIn 0.25s ease',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {isError ? '⚠️ ' : '✅ '}{state.msg}
    </div>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
/**
 * Custom confirm dialog that works in Capacitor WebView.
 * Returns a Promise<boolean>.
 */
let _confirmResolve = null
let _setConfirmState = null

export function confirmar(mensaje) {
  return new Promise(resolve => {
    _confirmResolve = resolve
    if (_setConfirmState) _setConfirmState({ visible: true, mensaje })
  })
}

function ConfirmModal() {
  const [state, setState] = useState({ visible: false, mensaje: '' })
  useEffect(() => { _setConfirmState = setState }, [])

  if (!state.visible) return null

  const responder = (val) => {
    setState({ visible: false, mensaje: '' })
    if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null }
  }

  return (
    <div onClick={() => responder(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1A1A1A', borderRadius: 16, padding: '24px 20px', width: '100%', maxWidth: 340, border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F5F5', marginBottom: 20, lineHeight: 1.5, textAlign: 'center' }}>{state.mensaje}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => responder(false)} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={() => responder(true)} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: '#EF4444', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Confirmar</button>
        </div>
      </div>
    </div>
  )
}

class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ ...shell, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 340 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#F5F5F5', marginBottom: 8 }}>Algo salió mal</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 24, lineHeight: 1.5 }}>Ha ocurrido un error inesperado. Recarga la página para continuar.</div>
          <button onClick={() => window.location.reload()} style={{ padding: '12px 32px', borderRadius: 12, border: 'none', background: '#B91C1C', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Recargar</button>
        </div>
      </div>
    )
  }
}

export default function App() {
  return <ErrorBoundary><RestProvider><AppContent /><ConfirmModal /><ToastNotification /></RestProvider></ErrorBoundary>
}
