import { useState, useEffect, useCallback, useRef, Component } from 'react'
import { ClipboardList, Clock, UtensilsCrossed, Settings, Tag, ToggleLeft, Printer, MoreHorizontal, Truck, MessageCircle, BarChart3, Wallet, CreditCard } from 'lucide-react'
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
import MisRepartidores from './pages/MisRepartidores'
import FinanzasRestaurante from './pages/FinanzasRestaurante'
import PlanTiendaPublica from './pages/PlanTiendaPublica'

const isNative = Capacitor.isNativePlatform()

const NAV_ICONS_WEB = { pedidos: ClipboardList, historial: Clock, carta: UtensilsCrossed, promos: Tag, ajustes: Settings }

const NAV_ICONS_NATIVE = { pedidos: ClipboardList, disponibilidad: ToggleLeft, impresora: Printer }

function AppContent() {
  const { user, restaurante, loading } = useRest()
  const [seccion, setSeccion] = useState(isNative ? 'pedidos' : 'historial')

  const handleNuevoPedido = useCallback(() => {
    setSeccion('pedidos')
  }, [])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false })
      StatusBar.setBackgroundColor({ color: '#FAFAF7' })
      StatusBar.setStyle({ style: Style.Light })

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
        <div style={{ fontSize: 13, color: 'var(--c-muted)', fontWeight: 600 }}>Cargando...</div>
      </div>
    )
  }

  if (!user) {
    return <div style={shell}><style>{css}</style><Login /></div>
  }

  // Bypass de pantallas intermedias (CompletarRegistro / Activacion).
  // Si el usuario aún no tiene fila en `establecimientos`, mostramos un
  // estado de carga en lugar de pedirle un formulario — debe entrar directo
  // al panel cuando el restaurante esté disponible.
  if (!restaurante) {
    return (
      <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <style>{css}</style>
        <div style={{ fontSize: 13, color: 'var(--c-muted)', fontWeight: 600 }}>Cargando restaurante...</div>
      </div>
    )
  }

  // (Antes: si restaurante.activado === false → <Activacion />. Bypass solicitado por el usuario.)

  const nav = isNative
    ? [
        { id: 'pedidos', label: 'Pedidos' },
        { id: 'disponibilidad', label: 'Carta' },
        { id: 'impresora', label: 'Config' },
      ]
    : [
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
  const { pedidosNuevos, silenciada, silenciar } = usePedidoAlert()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  async function abrirPanelWeb() {
    try {
      await Browser.open({ url: 'https://panel.pidoo.es' })
    } catch {
      window.open('https://panel.pidoo.es', '_blank')
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const navIcons = isNative ? NAV_ICONS_NATIVE : NAV_ICONS_WEB

  const extraOpciones = [
    { id: 'repartidores', label: 'Repartidores', Icon: Truck },
    { id: 'plan-tienda', label: 'Plan tienda', Icon: CreditCard },
    { id: 'finanzas', label: 'Finanzas', Icon: Wallet },
    { id: 'metricas', label: 'Métricas', Icon: BarChart3 },
    { id: 'soporte', label: 'Soporte', Icon: MessageCircle },
  ]
  const extraActive = extraOpciones.find(e => e.id === seccion)

  return (
    <div style={{ ...shell, minHeight: '100vh', position: 'relative', paddingBottom: 80 }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {restaurante.logo_url ? <img src={restaurante.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{restaurante.nombre?.[0]?.toUpperCase() || 'R'}</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--c-text)', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {restaurante.nombre}
            </div>
            <div style={{ fontSize: 10, color: restaurante.activo ? '#16A34A' : 'var(--c-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: restaurante.activo ? '#16A34A' : 'var(--c-muted)', display: 'inline-block' }} />
              {restaurante.activo ? 'Abierto' : 'Cerrado'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {isNative && pedidosNuevos.length > 0 && seccion !== 'pedidos' && (
            <button onClick={() => setSeccion('pedidos')} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px',
              borderRadius: 10, border: 'none', background: 'var(--c-danger-soft)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-danger)',
              animation: 'pulse 1s infinite',
            }}>
              {pedidosNuevos.length} nuevo{pedidosNuevos.length > 1 ? 's' : ''}
            </button>
          )}
          {isNative ? (
            <button onClick={abrirPanelWeb} style={{
              padding: '7px 12px', borderRadius: 10,
              border: '1px solid var(--c-border)',
              background: 'var(--c-surface2)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-text-soft)',
            }}>
              Panel web
            </button>
          ) : (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                aria-label="Más opciones"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 10,
                  border: 'none',
                  background: extraActive ? 'var(--c-primary)' : 'var(--c-surface2)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  color: extraActive ? '#fff' : 'var(--c-text)',
                  whiteSpace: 'nowrap',
                }}
              >
                {extraActive ? <extraActive.Icon size={14} strokeWidth={2.2} /> : <MoreHorizontal size={16} strokeWidth={2.2} />}
                {extraActive ? extraActive.label : 'Más'}
              </button>
              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
                  minWidth: 180, background: 'var(--c-surface)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 12, padding: 6, display: 'flex', flexDirection: 'column',
                  boxShadow: 'var(--c-shadow-lg)',
                }}>
                  {extraOpciones.map(opt => {
                    const active = seccion === opt.id
                    return (
                      <button
                        key={opt.id}
                        onClick={() => { setSeccion(opt.id); setMenuOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 12px', borderRadius: 8,
                          border: 'none', background: active ? 'var(--c-primary-light)' : 'transparent',
                          cursor: 'pointer', fontFamily: 'inherit',
                          fontSize: 13, fontWeight: 600,
                          color: active ? '#fff' : 'var(--c-text)',
                          textAlign: 'left',
                        }}
                      >
                        <opt.Icon size={15} strokeWidth={2} color={active ? 'var(--c-primary)' : 'var(--c-muted)'} />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Banner flotante cuando hay pedidos nuevos (solo app nativa).
          Se muestra siempre que haya pedidos nuevos — incluso en la sección
          Pedidos — para dar acceso rápido al botón Silenciar. */}
      {isNative && pedidosNuevos.length > 0 && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)', maxWidth: 500, zIndex: 100,
          background: 'linear-gradient(135deg, #FF6B2C, #E85A1F)',
          borderRadius: 14, padding: '12px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, fontFamily: 'inherit',
          boxShadow: '0 8px 32px rgba(255,107,44,0.35)',
          animation: silenciada ? 'none' : 'pulse 1.5s ease-in-out infinite',
        }}>
          <div
            onClick={() => { if (seccion !== 'pedidos') setSeccion('pedidos') }}
            style={{ flex: 1, cursor: seccion !== 'pedidos' ? 'pointer' : 'default', textAlign: 'left', minWidth: 0 }}
          >
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>
              {pedidosNuevos.length} pedido{pedidosNuevos.length > 1 ? 's' : ''} nuevo{pedidosNuevos.length > 1 ? 's' : ''}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 600 }}>
              {silenciada ? 'Alarma silenciada' : (seccion !== 'pedidos' ? 'Toca para ver y aceptar' : 'Acepta o rechaza desde la lista')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {!silenciada && (
              <button
                onClick={(e) => { e.stopPropagation(); silenciar() }}
                style={{
                  padding: '7px 11px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(0,0,0,0.25)', color: '#fff',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >Silenciar</button>
            )}
            {seccion !== 'pedidos' && (
              <button
                onClick={(e) => { e.stopPropagation(); setSeccion('pedidos') }}
                style={{
                  color: '#fff', fontSize: 11, fontWeight: 700,
                  background: 'rgba(255,255,255,0.25)', padding: '7px 11px',
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >Ir a pedidos</button>
            )}
          </div>
        </div>
      )}

      {/* Contenido */}
      <div style={{ padding: 20, animation: 'fadeIn 0.3s ease' }}>
        {seccion === 'pedidos' && isNative && <PedidosEnVivo />}
        {/* Native-only */}
        {seccion === 'disponibilidad' && <DisponibilidadProductos />}
        {seccion === 'impresora' && <ConfigImpresora />}
        {/* Web-only */}
        {seccion === 'historial' && <Historial />}
        {seccion === 'carta' && <Carta />}
        {seccion === 'promos' && <Promociones />}
        {seccion === 'soporte' && <Soporte />}
        {seccion === 'metricas' && <Metricas />}
        {seccion === 'repartidores' && <MisRepartidores />}
        {seccion === 'plan-tienda' && <PlanTiendaPublica />}
        {seccion === 'finanzas' && <FinanzasRestaurante />}
        {seccion === 'ajustes' && <Ajustes />}
      </div>

      {/* Bottom nav */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-around', padding: '8px 0 12px', zIndex: 50 }}>
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
                background: 'var(--c-danger)', color: '#fff',
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
  '--c-accent': '#FF6B2C',
  '--c-btn-gradient': 'linear-gradient(135deg, #FF6B2C 0%, #E85A1F 100%)',
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif", width: '100%',
  background: 'var(--c-bg)', color: 'var(--c-text)',
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
::-webkit-scrollbar{display:none}
body{background:var(--c-bg);margin:0}
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
      background: isError ? '#FEE2E2' : '#DCFCE7',
      border: `1px solid ${isError ? '#DC2626' : '#16A34A'}`,
      color: isError ? '#991B1B' : '#14532D', borderRadius: 12, padding: '12px 18px',
      fontSize: 13, fontWeight: 600, textAlign: 'center',
      boxShadow: 'var(--c-shadow-lg)',
      animation: 'fadeIn 0.25s ease',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {state.msg}
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
    <div onClick={() => responder(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-surface)', borderRadius: 16, padding: '24px 20px', width: '100%', maxWidth: 340, border: '1px solid var(--c-border)', boxShadow: 'var(--c-shadow-lg)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 20, lineHeight: 1.5, textAlign: 'center' }}>{state.mensaje}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => responder(false)} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          <button onClick={() => responder(true)} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--c-danger)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Confirmar</button>
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
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text)', marginBottom: 8 }}>Algo salió mal</div>
          <div style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 24, lineHeight: 1.5 }}>Ha ocurrido un error inesperado. Recarga la página para continuar.</div>
          <button onClick={() => window.location.reload()} style={{ padding: '12px 32px', borderRadius: 12, border: 'none', background: 'var(--c-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Recargar</button>
        </div>
      </div>
    )
  }
}

export default function App() {
  return <ErrorBoundary><RestProvider><AppContent /><ConfirmModal /><ToastNotification /></RestProvider></ErrorBoundary>
}
