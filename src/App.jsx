import { useState, useEffect, useCallback, useRef, Component } from 'react'
import {
  ClipboardList, Clock, UtensilsCrossed, Settings, Tag, ToggleLeft, Printer,
  MoreHorizontal, MessageCircle, Handshake, Bike, History,
  Users, Wallet, LifeBuoy, LogOut, ChevronRight, BookOpen, Receipt,
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { Browser } from '@capacitor/browser'
import { supabase } from './lib/supabase'
import { colors, ds } from './lib/uiStyles'
import { RestProvider, useRest } from './context/RestContext'
import { PedidoAlertProvider, usePedidoAlert } from './context/PedidoAlertContext'
import Login from './pages/Login'
import ConfirmarAlta from './pages/ConfirmarAlta'
import PedidosEnVivo from './pages/PedidosEnVivo'
import Historial from './pages/Historial'
import HistorialMovil from './pages/HistorialMovil'
import Carta from './pages/Carta'
import Ajustes from './pages/Ajustes'
import Promociones from './pages/Promociones'
import Soporte from './pages/Soporte'
import DisponibilidadProductos from './pages/DisponibilidadProductos'
import ConfigImpresora from './pages/ConfigImpresora'
import SociosYRepartidores from './pages/SociosYRepartidores'
import FinanzasRiders from './pages/FinanzasRiders'
import LiquidacionPido from './pages/LiquidacionPido'
import EliminarCuenta from './pages/EliminarCuenta'

const isNative = Capacitor.isNativePlatform()

const NAV_ICONS_WEB = { pedidos: ClipboardList, historial: Clock, carta: UtensilsCrossed, promos: Tag, ajustes: Settings }
const NAV_ICONS_NATIVE = { pedidos: ClipboardList, 'historial-movil': History, disponibilidad: ToggleLeft, impresora: Printer }

// Etiquetas legibles para breadcrumbs y títulos
const SECCION_LABELS = {
  historial: 'Historial',
  carta: 'Carta',
  promos: 'Promociones',
  ajustes: 'Ajustes',
  soporte: 'Soporte',
  'socios-riders': 'Socios y repartidores',
  'finanzas-riders': 'Finanzas con el socio',
  'liquidacion-pido': 'Liquidación con Pido',
  'eliminar-cuenta': 'Eliminar cuenta',
  pedidos: 'Pedidos',
  'historial-movil': 'Historial',
  disponibilidad: 'Disponibilidad',
  impresora: 'Impresora',
}

// Hook simple para detectar viewport desktop
function useIsDesktop(breakpoint = 1024) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth >= breakpoint
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsDesktop(window.innerWidth >= breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return isDesktop
}

function AppContent() {
  const { user, restaurante, restauranteNotFound, loading, logout } = useRest()
  const [seccion, setSeccion] = useState(isNative ? 'pedidos' : 'historial')

  const handleNuevoPedido = useCallback(() => {
    setSeccion('pedidos')
  }, [])

  // Navegacion entre secciones via window event (usado por Ajustes para abrir
  // /eliminar-cuenta sin pasar setSeccion por props).
  useEffect(() => {
    const handler = (e) => {
      const target = e?.detail
      if (typeof target === 'string') setSeccion(target)
    }
    window.addEventListener('pidoo:goto', handler)
    return () => window.removeEventListener('pidoo:goto', handler)
  }, [])

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false })
      StatusBar.setBackgroundColor({ color: '#F7F3EC' })
      StatusBar.setStyle({ style: Style.Light })

      CapApp.addListener('appUrlOpen', async ({ url }) => {
        if (url.includes('access_token') || url.includes('refresh_token') || url.includes('code=')) {
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

  // Cuenta autenticada pero sin establecimiento vinculado: pantalla legible con
  // salida (evita el "Cargando restaurante..." infinito).
  if (!restaurante && restauranteNotFound) {
    return (
      <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 32 }}>
        <style>{css}</style>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: colors.ink, marginBottom: 8 }}>
            No encontramos un negocio vinculado a esta cuenta
          </div>
          <div style={{ fontSize: 13, color: colors.stone, marginBottom: 24, lineHeight: 1.5 }}>
            Esta cuenta no tiene ningún restaurante asociado. Si crees que es un error, contacta con el equipo de Pidoo o inicia sesión con otra cuenta.
          </div>
          <button
            onClick={logout}
            style={{ ...ds.primaryBtn, height: 42, padding: '0 28px' }}
          >
            <LogOut size={15} strokeWidth={2} />
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (!restaurante) {
    return (
      <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <style>{css}</style>
        <div style={{ fontSize: 13, color: 'var(--c-muted)', fontWeight: 600 }}>Cargando restaurante...</div>
      </div>
    )
  }

  const nav = isNative
    ? [
        { id: 'pedidos', label: 'Pedidos' },
        { id: 'historial-movil', label: 'Historial' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar desktop (≥1024px)
// ─────────────────────────────────────────────────────────────────────────────

function PidooWordmark({ size = 18 }) {
  // Wordmark "pidoo" con los dos "o" como círculos terracotta
  const color = colors.ink
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      fontSize: size, fontWeight: 800, color,
      letterSpacing: '-0.02em', fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      <span>pid</span>
      <span style={{ display: 'inline-block', width: size * 0.62, height: size * 0.62, borderRadius: '50%', background: colors.terracotta, margin: '0 1px' }} />
      <span style={{ display: 'inline-block', width: size * 0.62, height: size * 0.62, borderRadius: '50%', background: colors.terracotta, marginLeft: 1 }} />
    </div>
  )
}

function PidooMark({ size = 32 }) {
  // Cuadrado terracotta con "P" blanca
  return (
    <div style={{
      width: size, height: size, borderRadius: 9,
      background: `linear-gradient(135deg, ${colors.terracotta} 0%, ${colors.terracotta2} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.55,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      boxShadow: '0 1px 2px rgba(26,24,21,0.2)',
    }}>P</div>
  )
}

function NavItem({ Icon, label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px', borderRadius: 10,
        cursor: 'pointer',
        border: 'none',
        background: active ? colors.cream2 : 'transparent',
        color: active ? colors.terracotta : colors.stone,
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        textAlign: 'left',
        width: '100%',
        position: 'relative',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = colors.cream2 }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {Icon && <Icon size={17} strokeWidth={active ? 2.3 : 2} />}
      <span style={{ flex: 1 }}>{label}</span>
      {badge > 0 && (
        <span style={{
          background: colors.terracotta, color: '#fff', borderRadius: 999,
          fontSize: 10, fontWeight: 800, padding: '1px 7px', minWidth: 18,
          textAlign: 'center', lineHeight: '14px',
        }}>{badge}</span>
      )}
    </button>
  )
}

function Sidebar({ seccion, setSeccion, restaurante, user, sociosPendientes, onLogout }) {
  const main = [
    { id: 'historial', Icon: ClipboardList, label: 'Historial' },
    { id: 'carta', Icon: BookOpen, label: 'Carta' },
    { id: 'promos', Icon: Tag, label: 'Promociones' },
    { id: 'ajustes', Icon: Settings, label: 'Ajustes' },
  ]
  const more = [
    { id: 'socios-riders', Icon: Users, label: 'Socios y repartidores', badge: sociosPendientes },
    { id: 'finanzas-riders', Icon: Wallet, label: 'Finanzas con el socio' },
    { id: 'liquidacion-pido', Icon: Receipt, label: 'Liquidación con Pido' },
    { id: 'soporte', Icon: LifeBuoy, label: 'Soporte' },
  ]

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Owner'
  const initial = (userName[0] || 'O').toUpperCase()

  return (
    <aside style={{
      width: 248, background: colors.paper,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      padding: '20px 12px',
      height: '100vh', position: 'sticky', top: 0,
      overflow: 'hidden',
    }}>
      {/* Tarjeta NEGOCIO con logo del restaurante */}
      <div style={{
        padding: '10px 12px', background: colors.cream2, borderRadius: 10,
        marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: '#fff', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${colors.border}`,
        }}>
          {restaurante?.logo_url ? (
            <img
              src={restaurante.logo_url} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 14, fontWeight: 800, color: colors.terracotta }}>
              {restaurante?.nombre?.[0]?.toUpperCase() || 'R'}
            </span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 10, color: colors.stone, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Negocio
          </div>
          <div style={{
            fontSize: 13, fontWeight: 700, color: colors.ink, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {restaurante?.nombre || 'Mi restaurante'}
          </div>
          <div style={{
            marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 7px', borderRadius: 999,
            background: restaurante?.activo ? colors.sageSoft : colors.cream,
            color: restaurante?.activo ? colors.sage2 : colors.stone,
            fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: restaurante?.activo ? colors.sage : colors.stone2,
            }} />
            {restaurante?.activo ? 'ABIERTO' : 'CERRADO'}
          </div>
        </div>
      </div>

      {/* Nav principal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {main.map(it => (
          <NavItem
            key={it.id}
            Icon={it.Icon}
            label={it.label}
            active={seccion === it.id}
            onClick={() => setSeccion(it.id)}
          />
        ))}
      </div>

      <div style={{ margin: '14px 8px', height: 1, background: colors.border }} />

      <div style={{
        fontSize: 10, fontWeight: 800, color: colors.stone2,
        padding: '0 10px 6px', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>Más</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {more.map(it => (
          <NavItem
            key={it.id}
            Icon={it.Icon}
            label={it.label}
            badge={it.badge}
            active={seccion === it.id}
            onClick={() => setSeccion(it.id)}
          />
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Footer: avatar + nombre + logout */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px', borderRadius: 10,
        borderTop: `1px solid ${colors.border}`,
        marginTop: 10, paddingTop: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: restaurante?.logo_url ? '#fff' : colors.terracotta,
          color: '#fff', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 13, flexShrink: 0,
          border: restaurante?.logo_url ? `1px solid ${colors.border}` : 'none',
        }}>
          {restaurante?.logo_url ? (
            <img
              src={restaurante.logo_url} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: colors.ink,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{userName}</div>
          <div style={{ fontSize: 11, color: colors.stone }}>Owner</div>
        </div>
        <button
          onClick={onLogout}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          style={{
            width: 30, height: 30, borderRadius: 8,
            border: 'none', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.stone, cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.cream2; e.currentTarget.style.color = colors.terracotta }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.stone }}
        >
          <LogOut size={15} strokeWidth={2} />
        </button>
      </div>
    </aside>
  )
}

function Breadcrumbs({ seccion }) {
  const label = SECCION_LABELS[seccion] || 'Inicio'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 13, color: colors.stone,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      marginBottom: 14,
    }}>
      <span style={{ color: colors.stone, fontWeight: 500 }}>Inicio</span>
      <ChevronRight size={12} style={{ color: colors.stone2 }} strokeWidth={2} />
      <span style={{ color: colors.ink, fontWeight: 600 }}>{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// App inner
// ─────────────────────────────────────────────────────────────────────────────

function AppInner({ seccion, setSeccion, nav }) {
  const { restaurante, user, logout } = useRest()
  const { pedidosNuevos } = usePedidoAlert()
  const [menuOpen, setMenuOpen] = useState(false)
  const [sociosPendientes, setSociosPendientes] = useState(0)
  const menuRef = useRef(null)
  const isDesktop = useIsDesktop(900)

  // Si pasamos a desktop y la sección actual no es válida para desktop, redirigir
  useEffect(() => {
    if (isDesktop && isNative) return
    // En desktop no native, las secciones válidas existen ya en las opciones del shell
  }, [isDesktop])

  // Contador solicitudes socios pendientes
  useEffect(() => {
    if (!restaurante?.id || isNative) return
    let cancel = false
    async function fetchCount() {
      const { count, error } = await supabase
        .from('socio_establecimiento')
        .select('id', { count: 'exact', head: true })
        .eq('establecimiento_id', restaurante.id)
        .eq('estado', 'pendiente')
      if (!cancel && !error) setSociosPendientes(count || 0)
    }
    fetchCount()
    const id = setInterval(fetchCount, 30000)
    return () => { cancel = true; clearInterval(id) }
  }, [restaurante?.id, seccion])

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
    { id: 'socios-riders', label: 'Socios y repartidores', Icon: Handshake, badge: sociosPendientes },
    { id: 'finanzas-riders', label: 'Finanzas con el socio', Icon: Bike },
    { id: 'liquidacion-pido', label: 'Liquidación con Pido', Icon: Receipt },
    { id: 'soporte', label: 'Soporte', Icon: MessageCircle },
  ]
  const extraActive = extraOpciones.find(e => e.id === seccion)

  // ── Banner datos fiscales (compartido entre desktop y mobile)
  const fiscalIncompleto = !restaurante?.nif || !restaurante?.razon_social || !restaurante?.direccion_fiscal
  const showFiscalBanner = fiscalIncompleto && seccion !== 'ajustes'

  const fiscalBanner = showFiscalBanner ? (
    <div
      onClick={() => setSeccion('ajustes')}
      style={{
        margin: isDesktop ? '0 0 18px' : '12px 16px 0',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(245,158,11,0.14)',
        border: '1px solid rgba(245,158,11,0.35)',
        color: '#92400E',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, cursor: 'pointer', flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#92400E' }}>
          Completa tus datos fiscales
        </div>
        <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>
          El socio no puede emitir facturas hasta que rellenes razón social, CIF/NIF y dirección fiscal.
        </div>
      </div>
      <span style={{
        padding: '7px 12px', borderRadius: 8,
        background: '#F59E0B', color: '#fff',
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        Ir a Ajustes
      </span>
    </div>
  ) : null

  // Contenido de la sección (compartido)
  const seccionContent = (
    <>
      {seccion === 'pedidos' && isNative && <PedidosEnVivo />}
      {seccion === 'historial-movil' && <HistorialMovil />}
      {seccion === 'disponibilidad' && <DisponibilidadProductos />}
      {seccion === 'impresora' && <ConfigImpresora />}
      {seccion === 'historial' && <Historial />}
      {seccion === 'carta' && <Carta />}
      {seccion === 'promos' && <Promociones />}
      {seccion === 'soporte' && <Soporte />}
      {seccion === 'socios-riders' && <SociosYRepartidores />}
      {seccion === 'finanzas-riders' && <FinanzasRiders />}
      {seccion === 'liquidacion-pido' && <LiquidacionPido />}
      {seccion === 'ajustes' && <Ajustes />}
      {seccion === 'eliminar-cuenta' && <EliminarCuenta onBack={() => setSeccion('ajustes')} />}
    </>
  )

  // ─────────────────────────────────────────────────────────────────────────
  // SHELL DESKTOP (≥1024px, no native)
  // ─────────────────────────────────────────────────────────────────────────
  if (isDesktop && !isNative) {
    return (
      <div style={{ ...shell, minHeight: '100vh', display: 'flex' }}>
        <style>{css}</style>
        <Sidebar
          seccion={seccion}
          setSeccion={setSeccion}
          restaurante={restaurante}
          user={user}
          sociosPendientes={sociosPendientes}
          onLogout={logout}
        />
        <main style={{
          flex: 1, minWidth: 0,
          padding: 'clamp(20px, 2.4vw, 36px) clamp(16px, 3vw, 40px)',
          width: '100%',
          overflowX: 'hidden',
          animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
            <Breadcrumbs seccion={seccion} />
            {fiscalBanner}
            <div>
              {seccionContent}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHELL MOBILE (<1024px o native) — comportamiento original intacto
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...shell, minHeight: '100vh', position: 'relative', paddingBottom: 80 }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #C5562C 0%, #A8451F 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {restaurante.logo_url ? <img src={restaurante.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{restaurante.nombre?.[0]?.toUpperCase() || 'R'}</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--c-text)', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {restaurante.nombre}
            </div>
            <div style={{ fontSize: 10, color: restaurante.activo ? '#8B9D7A' : 'var(--c-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: restaurante.activo ? '#8B9D7A' : 'var(--c-muted)', display: 'inline-block' }} />
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
                  whiteSpace: 'nowrap', position: 'relative',
                }}
              >
                {extraActive ? <extraActive.Icon size={14} strokeWidth={2.2} /> : <MoreHorizontal size={16} strokeWidth={2.2} />}
                {extraActive ? extraActive.label : 'Más'}
                {sociosPendientes > 0 && seccion !== 'socios-riders' && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                    background: '#C5562C', color: '#fff',
                    fontSize: 9, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--c-surface)',
                  }}>{sociosPendientes}</span>
                )}
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
                        <span style={{ flex: 1 }}>{opt.label}</span>
                        {opt.badge > 0 && (
                          <span style={{
                            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                            background: '#C5562C', color: '#fff',
                            fontSize: 10, fontWeight: 800,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{opt.badge}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Banner fiscal */}
      {fiscalBanner}

      {/* Contenido */}
      <div style={{ padding: 20, animation: 'fadeIn 0.3s ease' }}>
        {seccionContent}
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
  '--c-accent': '#C5562C',
  '--c-btn-gradient': 'linear-gradient(135deg, #C5562C 0%, #A8451F 100%)',
  fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", width: '100%',
  background: 'var(--c-bg)', color: 'var(--c-text)',
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
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
      border: `1px solid ${isError ? '#B5564A' : '#8B9D7A'}`,
      color: isError ? '#991B1B' : '#14532D', borderRadius: 12, padding: '12px 18px',
      fontSize: 13, fontWeight: 600, textAlign: 'center',
      boxShadow: 'var(--c-shadow-lg)',
      animation: 'fadeIn 0.25s ease',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      {state.msg}
    </div>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
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
  // Ruta dedicada de confirmación de alta (restaurante invitado por un socio).
  // Cae aquí por el enlace del email → panel.pidoo.es/confirmar-alta. Va FUERA de
  // RestProvider para no chocar con la verificación de rol mientras pone su contraseña.
  const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : ''
  if (path === '/confirmar-alta') {
    return <ErrorBoundary><ConfirmarAlta /><ToastNotification /></ErrorBoundary>
  }
  return <ErrorBoundary><RestProvider><AppContent /><ConfirmModal /><ToastNotification /></RestProvider></ErrorBoundary>
}
