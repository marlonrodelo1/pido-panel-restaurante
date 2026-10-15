// LectorContext — el móvil del mostrador como puente con el lector de tarjetas, EN SEGUNDO PLANO
// (15 oct 2026, v21 del panel).
//
// Antes (v18-v20) todo esto vivía en la pantalla «Lector de tarjetas»: si el móvil salía de ella,
// el TPV del ordenador dejaba de mandarle cobros, y Marlon cayó en la trampa la primera noche.
// Ahora es un servicio de la app: mientras la app esté abierta y este aparato sea «el cobrador»
// (lo marca el botón de la pantalla, se guarda en localStorage y sobrevive a cerrar y abrir):
//   1. conecta solo el lector por Bluetooth (el de siempre, o el único que encuentre);
//   2. si el lector se apaga o se aleja, lo vuelve a buscar cada 30 s;
//   3. da señal de vida cada 20 s (el TPV solo manda cobros si el móvil está listo);
//   4. cuando llega un cobro, lo pasa al lector y lo enseña encima de CUALQUIER pantalla
//      (`CobroLectorFlotante`), con su botón de cancelar.
// Deja de hacerlo SOLO con «Dejar de usar este móvil como lector».
//
// 🔴 La app tiene que seguir ABIERTA: si Android la mata (Xiaomi lo hace para ahorrar batería),
// deja de cobrar. Por eso: enchufado y pantalla encendida (se pide wake lock).
// El aparato cobrador NO IMPRIME (printService.aparatoNoImprime lee la misma clave).
//
// Servidor: edge `tpv-cobro-lector`. Lector: lib/lectorTarjetas.js.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { CreditCard, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from './RestContext'
import { llamarLector, mensajeErrorLector } from '../lib/cobroLector'
import {
  lectorSoportado, escucharLector, buscarLectores, conectarLector, desconectarLector,
  lectorConectado, serialGuardado, cobrarEnLector, cancelarLectura,
} from '../lib/lectorTarjetas'

export const CLAVE_MODO_COBRADOR = 'pidoo_lector_cobrador'
const LATIDO_MS = 20_000
const SONDEO_MS = 3_000
const REINTENTO_MS = 30_000

const eur = (cent) => `${((Number(cent) || 0) / 100).toFixed(2).replace('.', ',')} €`
const leerCobrador = () => { try { return localStorage.getItem(CLAVE_MODO_COBRADOR) === '1' } catch { return false } }

const LectorCtx = createContext({ soportado: false, activado: false, esCobrador: false, fase: 'apagado' })
export const useLector = () => useContext(LectorCtx)

export function LectorProvider({ children }) {
  const { restaurante, tpvConfig } = useRest()
  const est = restaurante?.id || null
  const soportado = lectorSoportado()
  const activado = !!tpvConfig?.cobro_lector          // lo enciende Pidoo para el restaurante
  const [esCobrador, setEsCobrador] = useState(leerCobrador)
  const activo = soportado && activado && esCobrador && !!est

  // fase: apagado | comprobando | desactivado | buscando | elegir | conectando | sin_lector | error
  //       | listo | cobrando | resultado
  const [fase, setFase] = useState('apagado')
  const [error, setError] = useState(null)
  const [lectores, setLectores] = useState([])
  const [lector, setLector] = useState(null)
  const [bateria, setBateria] = useState(null)
  const [actualizando, setActualizando] = useState(null)
  const [cobro, setCobro] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [paso, setPaso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const locationRef = useRef(null)
  const ocupadoRef = useRef(false)    // hay un cobro en marcha
  const buscandoRef = useRef(false)   // hay una búsqueda/conexión en marcha
  const cobroRef = useRef(null)
  const versionRef = useRef(null)
  const activoRef = useRef(activo)
  useEffect(() => { activoRef.current = activo }, [activo])

  useEffect(() => {
    CapApp.getInfo().then((i) => { versionRef.current = i?.version || null }).catch(() => {})
  }, [])

  // Lo que cuenta el lector.
  useEffect(() => escucharLector((ev) => {
    if (ev.tipo === 'desconectado') {
      setLector(null)
      if (!cobroRef.current) setFase((f) => (f === 'apagado' ? f : 'sin_lector'))
    }
    if (ev.tipo === 'mensaje') setMensaje(ev.texto)
    if (ev.tipo === 'actualizando') setActualizando(ev.progreso)
    if (ev.tipo === 'actualizado') setActualizando(null)
    if (ev.tipo === 'bateria') setBateria({ nivel: ev.nivel, cargando: ev.cargando })
  }), [])

  const conectar = useCallback(async (l) => {
    buscandoRef.current = true
    setFase('conectando'); setError(null)
    try {
      await conectarLector(l)
      if (!activoRef.current) return
      setLector(l)
      if (Number.isFinite(l?.batteryLevel)) setBateria({ nivel: l.batteryLevel, cargando: false })
      setActualizando(null)
      setFase('listo')
    } catch (e) {
      setError(e.message); setFase('error')
    } finally {
      buscandoRef.current = false
    }
  }, [])

  // Busca el lector. `silencioso`: el reintento automático no pinta «Buscando…» encima del error.
  const buscar = useCallback(async ({ silencioso = false } = {}) => {
    if (!est || buscandoRef.current || ocupadoRef.current) return
    buscandoRef.current = true
    if (!silencioso) { setFase('buscando'); setError(null) }
    let elegido = null
    try {
      const encontrados = await buscarLectores(est, locationRef.current)
      if (!activoRef.current) return
      setLectores(encontrados)
      if (!encontrados.length) {
        setError('No se encuentra el lector. Enciéndelo (botón del lateral) y déjalo cerca del móvil. Se vuelve a buscar solo.')
        setFase('sin_lector')
        return
      }
      const guardado = serialGuardado()
      elegido = encontrados.find((l) => l.serialNumber === guardado) || (encontrados.length === 1 ? encontrados[0] : null)
      if (!elegido) setFase('elegir')
    } catch (e) {
      setError(e.message); setFase('sin_lector')
    } finally {
      buscandoRef.current = false
    }
    if (elegido) await conectar(elegido)
  }, [est, conectar])

  // Arranque cada vez que pasa a estar activo (al abrir la app, o al pulsar el botón).
  useEffect(() => {
    if (!activo) { setFase('apagado'); return }
    let vivo = true
    setFase('comprobando'); setError(null)
    ;(async () => {
      const r = await llamarLector('config', est)
      if (!vivo) return
      if (!r.ok) { setError(mensajeErrorLector(r.error)); setFase('error'); return }
      if (!r.data?.habilitado) { setFase('desactivado'); return }
      locationRef.current = r.data.location_id
      const ya = await lectorConectado()
      if (!vivo) return
      if (ya) { setLector(ya); setFase('listo') } else buscar()
    })()
    return () => { vivo = false }
  }, [activo, est, buscar])

  // Sin lector (apagado, lejos, sin batería): se vuelve a buscar solo cada 30 s.
  useEffect(() => {
    if (!activo || !['sin_lector', 'error'].includes(fase)) return
    const t = setInterval(() => {
      if (!locationRef.current) {
        // El arranque falló antes de tener la Location: se repite entero.
        llamarLector('config', est).then((r) => {
          if (r.ok && r.data?.habilitado) { locationRef.current = r.data.location_id; buscar({ silencioso: true }) }
        })
        return
      }
      buscar({ silencioso: true })
    }, REINTENTO_MS)
    return () => clearInterval(t)
  }, [activo, fase, est, buscar])

  // Pantalla encendida mientras este aparato es el cobrador (si el sistema lo deja).
  useEffect(() => {
    if (!activo) return
    let lock = null
    const pedir = async () => {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen') } catch { /* no pasa nada */ }
    }
    pedir()
    document.addEventListener('visibilitychange', pedir)
    return () => {
      document.removeEventListener('visibilitychange', pedir)
      try { lock?.release() } catch { /* no pasa nada */ }
    }
  }, [activo])

  // Señal de vida: el TPV solo manda cobros si este móvil está listo.
  useEffect(() => {
    if (!activo || ['apagado', 'comprobando', 'desactivado'].includes(fase)) return
    const latir = () => llamarLector('latido', est, {
      conectado: !!lector,
      lector_serial: lector?.serialNumber || null,
      lector_modelo: lector?.deviceType || null,
      bateria: bateria?.nivel ?? lector?.batteryLevel ?? null,
      dispositivo: (navigator.userAgent.match(/Android[^;)]*;\s*([^;)]+)/)?.[1] || '').slice(0, 80),
      app_version: versionRef.current,
    })
    latir()
    const t = setInterval(latir, LATIDO_MS)
    return () => clearInterval(t)
  }, [activo, est, fase, lector, bateria])

  // Pasa un cobro por el lector.
  const atender = useCallback(async (c) => {
    if (ocupadoRef.current || !c?.client_secret) return
    ocupadoRef.current = true
    cobroRef.current = c
    setCobro(c); setMensaje('Pasa la tarjeta por el lector'); setPaso('tarjeta'); setFase('cobrando')
    try {
      const r = await cobrarEnLector(est, c, { onPaso: setPaso })
      const t = r.tarjeta
      setResultado({ ok: true, texto: `Cobrado ${eur(c.importe_cent)}${t?.ultimos4 ? ` · ···· ${t.ultimos4}` : ''}` })
    } catch (e) {
      setResultado({ ok: false, texto: e.codigo === 'cancelado' ? 'Cobro cancelado. No se ha cobrado nada.' : e.message })
      // Que el TPV se entere: se anula el cobro a medias (si ya se cobró, el servidor lo apunta).
      if (e.codigo !== 'cancelado') llamarLector('cancelar', est, { cobro_id: c.id }).catch(() => {})
    } finally {
      cobroRef.current = null
      setCobro(null); setMensaje(''); setPaso(null)
      setFase('resultado')
      setTimeout(() => {
        ocupadoRef.current = false
        setResultado(null)
        setFase((f) => (f === 'resultado' ? 'listo' : f))
      }, 4000)
    }
  }, [est])

  // ¿Hay un cobro esperando? Cada 3 s y, además, en cuanto llega por realtime.
  const mirar = useCallback(async () => {
    if (!est || ocupadoRef.current) return
    const r = await llamarLector('pendiente', est)
    if (r.ok && r.data?.cobro && activoRef.current) atender(r.data.cobro)
  }, [est, atender])

  useEffect(() => {
    if (!activo || fase !== 'listo' || !est) return
    mirar()
    const t = setInterval(mirar, SONDEO_MS)
    const canal = supabase.channel(`lector-${est}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_cobros_movil', filter: `establecimiento_id=eq.${est}` }, (p) => {
        const fila = p.new
        if (!fila || fila.plataforma !== 'lector_tpv') return
        if (fila.estado === 'creado') mirar()
      })
      .subscribe()
    return () => { clearInterval(t); supabase.removeChannel(canal) }
  }, [activo, fase, est, mirar])

  // Si el TPV cancela el cobro mientras el cliente aún no ha pagado, se corta la lectura.
  useEffect(() => {
    if (fase !== 'cobrando' || !cobro?.id) return
    const canal = supabase.channel(`lector-cobro-${cobro.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedido_cobros_movil', filter: `id=eq.${cobro.id}` }, (p) => {
        if (p.new?.estado === 'cancelado') cancelarLectura()
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [fase, cobro?.id])

  // ── Lo que se puede hacer desde la pantalla ─────────────────────────────────
  const activar = useCallback(() => {
    try { localStorage.setItem(CLAVE_MODO_COBRADOR, '1') } catch { /* no pasa nada */ }
    setEsCobrador(true)
  }, [])

  const desactivar = useCallback(async () => {
    try { localStorage.removeItem(CLAVE_MODO_COBRADOR) } catch { /* no pasa nada */ }
    setEsCobrador(false)
    setFase('apagado')
    if (est) llamarLector('latido', est, { conectado: false }).catch(() => {})
    await desconectarLector()
    setLector(null)
  }, [est])

  const cancelarAqui = useCallback(async () => {
    const c = cobroRef.current
    if (!c) return
    await cancelarLectura()
    llamarLector('cancelar', est, { cobro_id: c.id }).catch(() => {})
  }, [est])

  const olvidarLector = useCallback(async () => {
    await desconectarLector()
    try { localStorage.removeItem('pidoo_lector_serial') } catch { /* no pasa nada */ }
    setLector(null)
    buscar()
  }, [buscar])

  const valor = {
    soportado, activado, esCobrador, activo, fase, error, lectores, lector, bateria, actualizando,
    cobro, mensaje, paso, resultado,
    activar, desactivar, buscar, conectar, cancelarAqui, olvidarLector,
  }

  return (
    <LectorCtx.Provider value={valor}>
      {children}
      {activo && (fase === 'cobrando' || fase === 'resultado') && <CobroLectorFlotante />}
    </LectorCtx.Provider>
  )
}

// El cobro en marcha, encima de cualquier pantalla del móvil. Colores fijos (no las variables del
// panel): tiene que leerse igual sobre el TPV oscuro y sobre las pantallas claras.
function CobroLectorFlotante() {
  const { fase, cobro, mensaje, paso, resultado, cancelarAqui } = useLector()
  const ok = resultado?.ok
  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 3000,
      background: '#1A1815', color: '#F5F5F5', borderRadius: 18, padding: 18,
      border: `2px solid ${fase === 'resultado' ? (ok ? '#8FC46B' : '#FF7A6B') : '#FF6B2C'}`,
      boxShadow: '0 14px 40px rgba(0,0,0,0.5)', textAlign: 'center',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      {fase === 'cobrando' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#A8A08F', fontSize: 13 }}>
            <CreditCard size={16} /> {cobro?.codigo || 'Cobro del mostrador'}
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}>{eur(cobro?.importe_cent)}</div>
          <div style={{ fontSize: 16, fontWeight: 700, minHeight: 22 }}>
            {paso === 'confirmando' ? 'Cobrando…' : (mensaje || 'Pasa la tarjeta por el lector')}
          </div>
          {paso !== 'confirmando' && (
            <button onClick={cancelarAqui} style={{
              marginTop: 14, width: '100%', height: 46, borderRadius: 12, cursor: 'pointer',
              border: '1px solid #332E28', background: '#221F1B', color: '#F5F5F5',
              fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
            }}>
              Cancelar el cobro
            </button>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 18, fontWeight: 800 }}>
          {ok ? <CheckCircle2 size={26} color="#8FC46B" /> : <XCircle size={26} color="#FF7A6B" />}
          {resultado?.texto}
        </div>
      )}
    </div>
  )
}
