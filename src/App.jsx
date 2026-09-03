import { useState, useEffect, useCallback, useRef, Component } from 'react'
import {
  ClipboardList, Clock, UtensilsCrossed, Settings, Tag, ToggleLeft, Printer,
  MoreHorizontal, MessageCircle, Handshake, Bike, History,
  Users, Wallet, LifeBuoy, LogOut, ChevronRight, BookOpen, Receipt, Star, PhoneCall,
  TrendingUp, Video, Calculator, Boxes,
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
import Finanzas from './pages/Finanzas'
import Carta from './pages/Carta'
import Ajustes from './pages/Ajustes'
import SuscripcionCard from './components/SuscripcionCard'
import Promociones from './pages/Promociones'
import Soporte from './pages/Soporte'
import DisponibilidadProductos from './pages/DisponibilidadProductos'
import ConfigImpresora from './pages/ConfigImpresora'
import SociosYRepartidores from './pages/SociosYRepartidores'
import FinanzasRiders from './pages/FinanzasRiders'
import LiquidacionPido from './pages/LiquidacionPido'
import EliminarCuenta from './pages/EliminarCuenta'
import Resenas from './pages/Resenas'
import CrearEnvio from './pages/CrearEnvio'
import Creadores from './pages/Creadores'
import Tpv from './pages/Tpv'
import Almacen from './pages/Almacen'

const isNative = Capacitor.isNativePlatform()

// El TPV es de la APK: es donde estan la impresora y el cajon, y es el aparato
// que se queda en el mostrador. En la web solo aparece en desarrollo, para poder
// afinar la pantalla sin compilar un AAB por cada cambio de tipografia.
// La app de WINDOWS. Es la web de siempre metida en una carcasa de Electron que
// aporta UNA cosa: el socket TCP a la impresora del puerto 9100, que un navegador no
// puede abrir. `window.pidooDesktop` lo pone su preload.
const esEscritorio = typeof window !== 'undefined' && !!window.pidooDesktop

// Donde tiene sentido el TPV: donde se puede imprimir y abrir el cajon. Eso es la
// tablet (Android) y ahora tambien Windows. En un navegador normal no, porque cobraria
// sin sacar el ticket.
const TPV_EN_ESTA_PLATAFORMA = isNative || esEscritorio || import.meta.env.DEV

// Llave de desarrollo para probar la shell TPV en el navegador: `?tpvapp=1`.
const FORZAR_TPV_APP = import.meta.env.DEV &&
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tpvapp')

// Alto de la barra de navegacion inferior de la shell movil. MEDIDO en el navegador
// (8 + 44 + 12 = 64 px), no inventado. Se declara aqui y se le pone al <div> de la
// nav como `height`, asi que las dos no pueden desviarse. El TPV lo recibe por prop
// para levantar su barra de venta y no taparla.
const ALTO_NAV_MOVIL = 64

const NAV_ICONS_WEB = { pedidos: ClipboardList, historial: Clock, carta: UtensilsCrossed, promos: Tag, ajustes: Settings, 'crear-envio': PhoneCall, tpv: Calculator, almacen: Boxes, impresora: Printer }
const NAV_ICONS_NATIVE = { pedidos: ClipboardList, 'crear-envio': PhoneCall, 'historial-movil': History, disponibilidad: ToggleLeft, impresora: Printer, tpv: Calculator }

// Etiquetas legibles para breadcrumbs y títulos
const SECCION_LABELS = {
  historial: 'Historial',
  finanzas: 'Finanzas',
  'crear-envio': 'Pedido telefónico',
  carta: 'Carta',
  promos: 'Promociones',
  resenas: 'Reseñas',
  ajustes: 'Ajustes',
  soporte: 'Soporte',
  'socios-riders': 'Socios y repartidores',
  'finanzas-riders': 'Finanzas con el socio',
  'liquidacion-pido': 'Liquidación con Pido',
  creadores: 'Creadores',
  'eliminar-cuenta': 'Eliminar cuenta',
  pedidos: 'Pedidos',
  'historial-movil': 'Historial',
  disponibilidad: 'Disponibilidad',
  impresora: 'Impresora',
  tpv: 'TPV',
  almacen: 'Almacén',
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

// Secciones a las que se puede aterrizar por URL (?seccion=...). Lista cerrada:
// la usa el retorno de Stripe Connect para volver justo donde estabas.
const SECCIONES_DEEPLINK = ['liquidacion-pido']

function AppContent() {
  const { user, restaurante, restauranteNotFound, loading, logout, tpvActivo } = useRest()
  const [seccion, setSeccion] = useState(() => {
    if (isNative) return 'pedidos'
    try {
      const s = new URLSearchParams(window.location.search).get('seccion')
      if (s && SECCIONES_DEEPLINK.includes(s)) return s
    } catch {}
    return 'historial'
  })

  // En la shell normal, un pedido nuevo lleva a Pedidos.
  //
  // 🔴 Pero NUNCA si estas en el TPV. Antes saltaba siempre, en todas las plataformas:
  // entraba un pedido, el <Tpv/> se desmontaba y el carrito —que vive solo en
  // `useState`, sin persistir nada— se perdia ENTERO con el cliente delante esperando
  // a pagar. Y en escritorio aterrizabas ademas en una seccion vacia, porque
  // `PedidosEnVivo` solo se monta si `isNative`.
  //
  // Estando en el TPV no hace falta ir a ningun lado: el propio TPV levanta su aviso
  // (`AvisoPedido`) y abre la capa de Pedidos ENCIMA, dejando el mostrador detras.
  const handleNuevoPedido = useCallback(() => {
    setSeccion((actual) => {
      if (actual === 'tpv') return actual
      // 🔴 En ESCRITORIO la seccion 'pedidos' NO PINTA NADA: `PedidosEnVivo` solo se
      // monta si `isNative` (mas abajo), y la app de Windows es Electron, no Capacitor.
      // Mandar ahi a alguien es dejarlo en una pagina en blanco. Con el modulo de TPV
      // encendido, los pedidos se ven y se aceptan DENTRO del TPV, asi que ahi se va.
      if (!isNative && tpvActivo && TPV_EN_ESTA_PLATAFORMA) return 'tpv'
      if (!isNative) return actual   // sin TPV no hay donde llevarle: mejor no moverlo
      return 'pedidos'
    })
  }, [tpvActivo])

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
        // El TPV va el primero: durante el servicio es la pantalla en la que
        // se vive. Solo aparece si Pidoo ha activado el modulo.
        ...(tpvActivo && TPV_EN_ESTA_PLATAFORMA ? [{ id: 'tpv', label: 'TPV' }] : []),
        { id: 'pedidos', label: 'Pedidos' },
        { id: 'historial-movil', label: 'Historial' },
        { id: 'disponibilidad', label: 'Carta' },
        { id: 'impresora', label: 'Config' },
      ]
    : [
        ...(tpvActivo && TPV_EN_ESTA_PLATAFORMA ? [{ id: 'tpv', label: 'TPV' }] : []),
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
  const { tpvActivo, stockActivo } = useRest()
  const main = [
    ...(tpvActivo && TPV_EN_ESTA_PLATAFORMA ? [{ id: 'tpv', Icon: Calculator, label: 'TPV' }] : []),
    { id: 'historial', Icon: ClipboardList, label: 'Historial' },
    { id: 'finanzas', Icon: TrendingUp, label: 'Finanzas' },
    { id: 'crear-envio', Icon: PhoneCall, label: 'Pedido telefónico' },
    { id: 'carta', Icon: BookOpen, label: 'Carta' },
    ...(stockActivo ? [{ id: 'almacen', Icon: Boxes, label: 'Almacén' }] : []),
    // Solo en la app de Windows: alli SI se puede hablar con la impresora por el
    // puerto 9100. En un navegador la entrada no podria hacer nada.
    ...(esEscritorio ? [{ id: 'impresora', Icon: Printer, label: 'Impresora' }] : []),
    { id: 'promos', Icon: Tag, label: 'Promociones' },
    { id: 'resenas', Icon: Star, label: 'Reseñas' },
    { id: 'ajustes', Icon: Settings, label: 'Ajustes' },
  ]
  const more = [
    { id: 'socios-riders', Icon: Users, label: 'Socios y repartidores', badge: sociosPendientes },
    { id: 'finanzas-riders', Icon: Wallet, label: 'Finanzas con el socio' },
    { id: 'liquidacion-pido', Icon: Receipt, label: 'Liquidación con Pido' },
    // Va en "Más" y no en el bottom-nav nativo a propósito: gestionar premios es
    // trabajo de escritorio, y meterlo en la APK obligaría a una build nueva.
    { id: 'creadores', Icon: Video, label: 'Creadores' },
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
  const { restaurante, user, logout, tpvActivo, stockActivo } = useRest()

  // El TPV a pantalla completa. En un monitor, la barra lateral y las migas le comen
  // un tercio de la pantalla, y en un TPV el sitio son productos que se ven sin
  // buscar. Se guarda para que no haya que darle cada vez que se abre la caja.
  const [tpvExpandido, setTpvExpandido] = useState(() => {
    try { return localStorage.getItem('pidoo_tpv_pantalla_completa') === '1' } catch { return false }
  })
  const alternarTpv = () => setTpvExpandido((v) => {
    try { localStorage.setItem('pidoo_tpv_pantalla_completa', v ? '0' : '1') } catch { /* modo incognito */ }
    return !v
  })
  // Escape para salir, que es lo que todo el mundo prueba primero.
  useEffect(() => {
    if (!tpvExpandido) return
    const salir = (e) => { if (e.key === 'Escape') alternarTpv() }
    window.addEventListener('keydown', salir)
    return () => window.removeEventListener('keydown', salir)
  }, [tpvExpandido])
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
    { id: 'finanzas', label: 'Finanzas', Icon: TrendingUp },
    { id: 'crear-envio', label: 'Pedido telefónico', Icon: PhoneCall },
    { id: 'resenas', label: 'Reseñas', Icon: Star },
    { id: 'socios-riders', label: 'Socios y repartidores', Icon: Handshake, badge: sociosPendientes },
    { id: 'finanzas-riders', label: 'Finanzas con el socio', Icon: Bike },
    { id: 'liquidacion-pido', label: 'Liquidación con Pido', Icon: Receipt },
    { id: 'creadores', label: 'Creadores', Icon: Video },
    ...(stockActivo ? [{ id: 'almacen', label: 'Almacén', Icon: Boxes }] : []),
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

  // El TPV ocupando la pantalla del escritorio. Se calcula ANTES de armar el
  // contenido porque tanto el shell como el contenido esconden piezas con él.
  const tpvFull = isDesktop && !isNative && seccion === 'tpv' && tpvExpandido

  // Contenido de la sección (compartido)
  const seccionContent = (
    <>
      {/* Aviso de cuota sin pagar, en TODAS las secciones. Solo sale si el
          restaurante es de cuota fija y no está al día; el que no ha pagado no
          va a entrar en Ajustes por su cuenta a buscarlo. (Con el TPV a pantalla
          completa no: ahí encima del mostrador oscuro no pinta nada.) */}
      {!tpvFull && <SuscripcionCard variant="banner" />}
      {seccion === 'pedidos' && isNative && <PedidosEnVivo />}
      {seccion === 'historial-movil' && <HistorialMovil />}
      {seccion === 'disponibilidad' && <DisponibilidadProductos />}
      {seccion === 'impresora' && <ConfigImpresora />}
      {seccion === 'crear-envio' && <CrearEnvio />}
      {seccion === 'historial' && <Historial />}
      {seccion === 'finanzas' && !isNative && <Finanzas />}
      {seccion === 'carta' && <Carta />}
      {seccion === 'promos' && <Promociones />}
      {seccion === 'resenas' && <Resenas />}
      {seccion === 'soporte' && <Soporte />}
      {seccion === 'socios-riders' && <SociosYRepartidores />}
      {seccion === 'finanzas-riders' && <FinanzasRiders />}
      {seccion === 'liquidacion-pido' && <LiquidacionPido />}
      {seccion === 'creadores' && !isNative && <Creadores />}
      {seccion === 'tpv' && <Tpv pantallaCompleta={tpvExpandido} onAlternarPantalla={alternarTpv}
        huecoAbajo={isDesktop ? 0 : ALTO_NAV_MOVIL} />}
      {/* El almacen es de ESCRITORIO: dar de alta articulos y escribir escandallos
          con el dedo en una tablet es inviable, y meterlo en la APK obligaria a un
          AAB por cada retoque. En la tablet solo va lo del servicio, dentro del TPV. */}
      {seccion === 'almacen' && !isNative && <Almacen />}
      {seccion === 'ajustes' && <Ajustes />}
      {seccion === 'eliminar-cuenta' && <EliminarCuenta onBack={() => setSeccion('ajustes')} />}
    </>
  )

  // ─────────────────────────────────────────────────────────────────────────
  // SHELL TPV (app nativa CON el modulo de TPV activo)
  //
  // Decision de Marlon (30 ago 2026): cuando el restaurante tiene el TPV, el TPV
  // ES la aplicacion. Nada de barra inferior ni cabecera aparte: el TPV ocupa la
  // pantalla entera y TODO —pedidos, historial, carta, impresora— cuelga de su
  // menu, abriendose ENCIMA en vez de sustituirlo.
  //
  // Eso ademas arregla un problema real que ya existia: al entrar un pedido, la
  // app saltaba a Pedidos y el TPV se DESMONTABA, perdiendo el carrito a medias
  // con el cliente delante. Como capa, el carrito sigue detras intacto.
  //
  // A quien NO tenga el modulo, la app le queda exactamente igual que antes.
  // Para poder verlo en la vista previa sin compilar un AAB: `?tpvapp=1` en la URL.
  // Solo funciona en `npm run dev`; en la web de produccion `import.meta.env.DEV` es
  // false, asi que panel.pidoo.es nunca entra en esta shell.
  // El fondo OSCURO del TPV, no el crema del panel: aqui el TPV ocupa la pantalla
  // entera y con el `shell` de siempre quedaba una franja clara debajo de la caja.
  // También en la APP DE WINDOWS (decisión de Marlon, 3 sep 2026): en el
  // ordenador del mostrador solo existe el TPV, a pantalla completa y sin menú
  // del panel — todo lo demás (pedidos, carta, impresora, historial) cuelga de
  // su propio menú como capas. El panel completo sigue en panel.pidoo.es desde
  // cualquier navegador. Quien no tenga el módulo TPV ve la app como siempre.
  if ((isNative || esEscritorio || FORZAR_TPV_APP) && tpvActivo) {
    return (
      <div style={{ ...shell, minHeight: '100vh', background: '#12100E' }}>
        <style>{css}</style>
        <Tpv modoApp />
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHELL DESKTOP (≥1024px, no native)
  // ─────────────────────────────────────────────────────────────────────────
  // TPV a pantalla completa: la barra lateral, las migas y el banner se ESCONDEN
  // pero el árbol es EL MISMO — antes había una rama aparte que devolvía otro
  // árbol y React desmontaba el Tpv al ampliar o reducir (Tpv vs Sidebar en la
  // misma posición): el carrito a medias se borraba, y Escape lo disparaba de un
  // tecleo. Los `{!tpvFull && ...}` conservan el hueco en el árbol, así que el
  // Tpv no se mueve de sitio y su estado sobrevive al cambio.
  if (isDesktop && !isNative) {
    return (
      <div style={{ ...shell, minHeight: '100vh', display: 'flex', ...(tpvFull ? { background: '#12100E' } : null) }}>
        <style>{css}</style>
        {!tpvFull && <Sidebar
          seccion={seccion}
          setSeccion={setSeccion}
          restaurante={restaurante}
          user={user}
          sociosPendientes={sociosPendientes}
          onLogout={logout}
        />}
        <main style={{
          flex: 1, minWidth: 0,
          padding: tpvFull ? 0 : 'clamp(20px, 2.4vw, 36px) clamp(16px, 3vw, 40px)',
          width: '100%',
          overflowX: 'hidden',
          animation: 'fadeIn 0.3s ease',
        }}>
          {/* 30 jul 2026: 1100 -> 1600. En un monitor de 1920 se desperdiciaban ~800 px
              a los lados. Mismo criterio que se aplicó en pido-super-admin el 24 jul.
              El <main> ya lleva minWidth: 0, necesario para que las tablas anchas no
              provoquen scroll horizontal en tablet. */}
          <div style={{ maxWidth: tpvFull ? 'none' : 1600, margin: '0 auto', width: '100%', minWidth: 0 }}>
            {!tpvFull && <Breadcrumbs seccion={seccion} />}
            {!tpvFull && fiscalBanner}
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
            <button onClick={() => setSeccion('crear-envio')} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: 10, border: 'none',
              background: 'var(--c-primary)', color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
              <PhoneCall size={13} strokeWidth={2.3} />
              Pedido telefónico
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
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', height: ALTO_NAV_MOVIL, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-around', padding: '8px 0 12px', zIndex: 50 }}>
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
