// LectorTarjetas.jsx — el móvil del mostrador como puente con el lector de tarjetas (15 oct 2026).
//
// Marlon compró un BBPOS WisePad 3 para cobrar con tarjeta desde el TPV del ordenador. Ese lector
// solo se puede usar desde una app de móvil (Bluetooth), así que un móvil Android con la app del
// panel se queda en el mostrador con ESTA pantalla abierta:
//   1. conecta el lector por Bluetooth (la primera vez lo busca; luego lo recuerda);
//   2. da señal de vida al servidor cada 20 s (el TPV solo manda cobros si el móvil está listo);
//   3. cuando el TPV pide un cobro, lo pasa al lector, el cliente paga y el servidor lo apunta;
//   4. el TPV lo ve y imprime el ticket.
// El servidor es la edge `tpv-cobro-lector`; el lector, lib/lectorTarjetas.js.
//
// Se recuerda que este aparato es «el cobrador» (localStorage): si la app se cierra o se reinicia,
// el TPV vuelve a abrir esta pantalla solo.
import { useEffect, useRef, useState, useCallback } from 'react'
import { CreditCard, Bluetooth, BatteryMedium, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react'
import { App as CapApp } from '@capacitor/app'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, ds, radius, type } from '../lib/uiStyles'
import { llamarLector, mensajeErrorLector } from '../lib/cobroLector'
import {
  lectorSoportado, escucharLector, buscarLectores, conectarLector, desconectarLector,
  lectorConectado, serialGuardado, cobrarEnLector, cancelarLectura,
} from '../lib/lectorTarjetas'

export const CLAVE_MODO_COBRADOR = 'pidoo_lector_cobrador'
const LATIDO_MS = 20_000
const SONDEO_MS = 3_000

const eur = (cent) => `${((Number(cent) || 0) / 100).toFixed(2).replace('.', ',')} €`

export default function LectorTarjetas() {
  const { restaurante } = useRest()
  const est = restaurante?.id
  // fase: comprobando | no_soportado | desactivado | buscando | elegir | conectando | listo | cobrando | resultado | error
  const [fase, setFase] = useState('comprobando')
  const [error, setError] = useState(null)
  const [lectores, setLectores] = useState([])
  const [lector, setLector] = useState(null)
  const [bateria, setBateria] = useState(null)
  const [actualizando, setActualizando] = useState(null)   // 0..1 mientras se actualiza el lector
  const [cobro, setCobro] = useState(null)                 // el cobro en curso
  const [mensaje, setMensaje] = useState('')               // lo que pide el lector
  const [paso, setPaso] = useState(null)
  const [resultado, setResultado] = useState(null)         // { ok, texto }
  const locationRef = useRef(null)
  const ocupadoRef = useRef(false)
  const cobroRef = useRef(null)
  const versionRef = useRef(null)

  // Este aparato pasa a ser «el cobrador».
  useEffect(() => {
    try { localStorage.setItem(CLAVE_MODO_COBRADOR, '1') } catch { /* no pasa nada */ }
    CapApp.getInfo().then((i) => { versionRef.current = i?.version || null }).catch(() => {})
  }, [])

  // Pantalla siempre encendida mientras esté aquí (si el sistema lo permite).
  useEffect(() => {
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
  }, [])

  // Lo que cuenta el lector.
  useEffect(() => escucharLector((ev) => {
    if (ev.tipo === 'desconectado') { setLector(null); if (!cobroRef.current) setFase('elegir') }
    if (ev.tipo === 'mensaje') setMensaje(ev.texto)
    if (ev.tipo === 'actualizando') setActualizando(ev.progreso)
    if (ev.tipo === 'actualizado') setActualizando(null)
    if (ev.tipo === 'bateria') setBateria({ nivel: ev.nivel, cargando: ev.cargando })
  }), [])

  const conectar = useCallback(async (l) => {
    setFase('conectando'); setError(null)
    try {
      await conectarLector(l)
      setLector(l)
      if (Number.isFinite(l?.batteryLevel)) setBateria({ nivel: l.batteryLevel, cargando: false })
      setActualizando(null)
      setFase('listo')
    } catch (e) {
      setError(e.message); setFase('error')
    }
  }, [])

  const buscar = useCallback(async () => {
    if (!est) return
    setFase('buscando'); setError(null)
    try {
      const encontrados = await buscarLectores(est, locationRef.current)
      setLectores(encontrados)
      if (!encontrados.length) { setError('No se encuentra el lector. Enciéndelo (botón del lateral), acércalo al móvil y vuelve a buscar.'); setFase('error'); return }
      // El de siempre, o el único que hay: directo.
      const guardado = serialGuardado()
      const elegido = encontrados.find((l) => l.serialNumber === guardado) || (encontrados.length === 1 ? encontrados[0] : null)
      if (elegido) await conectar(elegido)
      else setFase('elegir')
    } catch (e) {
      setError(e.message); setFase('error')
    }
  }, [est, conectar])

  // Arranque: ¿se puede?, ¿está activado?, ¿ya hay lector conectado?
  useEffect(() => {
    if (!est) return
    let vivo = true
    ;(async () => {
      if (!lectorSoportado()) { setFase('no_soportado'); return }
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
  }, [est, buscar])

  // Señal de vida: el TPV solo manda cobros si este móvil está listo.
  useEffect(() => {
    if (!est || fase === 'no_soportado' || fase === 'desactivado' || fase === 'comprobando') return
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
  }, [est, fase, lector, bateria])

  // Al salir de la pantalla: el TPV deja de mandarle cobros enseguida.
  useEffect(() => () => {
    if (est) llamarLector('latido', est, { conectado: false })
  }, [est])

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
      // Si fue el TPV quien canceló, no hace falta asustar a nadie.
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

  // ¿Hay un cobro esperando? Se pregunta cada 3 s y, además, en cuanto llega por realtime.
  const mirar = useCallback(async () => {
    if (!est || ocupadoRef.current) return
    const r = await llamarLector('pendiente', est)
    if (r.ok && r.data?.cobro) atender(r.data.cobro)
  }, [est, atender])

  useEffect(() => {
    if (fase !== 'listo' || !est) return
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
  }, [fase, est, mirar])

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

  async function cancelarAqui() {
    if (!cobro) return
    await cancelarLectura()
    llamarLector('cancelar', est, { cobro_id: cobro.id }).catch(() => {})
  }

  async function olvidarLector() {
    await desconectarLector()
    try { localStorage.removeItem('pidoo_lector_serial') } catch { /* no pasa nada */ }
    setLector(null)
    buscar()
  }

  // ── Pintar ─────────────────────────────────────────────────────────────────
  const tarjeta = { ...ds.card, padding: 20, borderRadius: radius.lg, textAlign: 'center' }
  const grande = { fontSize: 34, fontWeight: 800, color: colors.text, fontVariantNumeric: 'tabular-nums', margin: '6px 0' }
  const estadoLinea = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', fontSize: type.sm, color: colors.textMute, marginTop: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Bluetooth size={14} /> {lector ? (lector.label || lector.serialNumber || 'Lector conectado') : 'Sin lector'}
      </span>
      {bateria?.nivel != null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <BatteryMedium size={14} /> {Math.round(bateria.nivel * 100)} %{bateria.cargando ? ' · cargando' : ''}
        </span>
      )}
    </div>
  )

  let contenido
  if (fase === 'comprobando' || fase === 'buscando' || fase === 'conectando') {
    contenido = (
      <div style={tarjeta}>
        <Loader2 size={36} color={colors.primary} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginTop: 10 }}>
          {fase === 'comprobando' ? 'Preparando…' : fase === 'buscando' ? 'Buscando el lector…' : actualizando != null ? 'Actualizando el lector…' : 'Conectando con el lector…'}
        </div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          {actualizando != null
            ? `${Math.round(actualizando * 100)} %. No lo apagues ni lo alejes del móvil: la primera vez puede tardar unos minutos.`
            : fase === 'buscando' ? 'Enciende el lector (botón del lateral) y déjalo cerca del móvil.' : ''}
        </div>
      </div>
    )
  } else if (fase === 'no_soportado') {
    contenido = <div style={tarjeta}><Aviso texto="Este aparato no puede usar el lector de tarjetas. Hace falta la app de Pidoo en un móvil o tablet Android." /></div>
  } else if (fase === 'desactivado') {
    contenido = <div style={tarjeta}><Aviso texto="El cobro con lector de tarjetas no está activado en este restaurante. Pídeselo a Pidoo." /></div>
  } else if (fase === 'elegir') {
    contenido = (
      <div style={tarjeta}>
        <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginBottom: 12 }}>Elige tu lector</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {lectores.map((l) => (
            <button key={l.serialNumber} onClick={() => conectar(l)} style={{ ...ds.secondaryBtn, justifyContent: 'center', height: 48 }}>
              <Bluetooth size={16} style={{ marginRight: 6 }} /> {l.label || l.serialNumber}
            </button>
          ))}
        </div>
        <button onClick={buscar} style={{ ...ds.ghostBtn, marginTop: 12 }}><RefreshCw size={14} style={{ marginRight: 6 }} />Buscar otra vez</button>
      </div>
    )
  } else if (fase === 'error') {
    contenido = (
      <div style={tarjeta}>
        <Aviso texto={error || 'Algo ha fallado con el lector.'} />
        <button onClick={buscar} style={{ ...ds.primaryBtn, marginTop: 16, width: '100%', justifyContent: 'center', height: 48 }}>
          <RefreshCw size={16} style={{ marginRight: 6 }} /> Volver a intentarlo
        </button>
      </div>
    )
  } else if (fase === 'listo') {
    contenido = (
      <div style={tarjeta}>
        <CheckCircle2 size={44} color={colors.sage} />
        <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, marginTop: 8 }}>Listo para cobrar</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          Cobra con «Tarjeta» en el TPV y el importe saldrá aquí y en el lector. Deja este móvil en esta pantalla, enchufado.
        </div>
        {estadoLinea}
        <button onClick={olvidarLector} style={{ ...ds.ghostBtn, marginTop: 16, fontSize: type.xs }}>Usar otro lector</button>
      </div>
    )
  } else if (fase === 'cobrando') {
    contenido = (
      <div style={{ ...tarjeta, border: `2px solid ${colors.primary}` }}>
        <CreditCard size={40} color={colors.primary} />
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6 }}>{cobro?.codigo || 'Cobro del mostrador'}</div>
        <div style={grande}>{eur(cobro?.importe_cent)}</div>
        <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.text, minHeight: 26 }}>
          {paso === 'confirmando' ? 'Cobrando…' : (mensaje || 'Pasa la tarjeta por el lector')}
        </div>
        {paso !== 'confirmando' && (
          <button onClick={cancelarAqui} style={{ ...ds.secondaryBtn, marginTop: 18, width: '100%', justifyContent: 'center', height: 46 }}>
            Cancelar el cobro
          </button>
        )}
      </div>
    )
  } else if (fase === 'resultado' && resultado) {
    contenido = (
      <div style={{ ...tarjeta, background: resultado.ok ? colors.sageSoft : colors.dangerSoft }}>
        {resultado.ok ? <CheckCircle2 size={48} color={colors.sage} /> : <XCircle size={48} color={colors.danger} />}
        <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, marginTop: 8 }}>{resultado.texto}</div>
      </div>
    )
  } else {
    contenido = <div style={tarjeta}><Loader2 size={30} color={colors.primary} style={{ animation: 'spin 1s linear infinite' }} /></div>
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'grid', gap: 14 }}>
      {contenido}
      <div style={{ fontSize: type.xs, color: colors.textFaint, textAlign: 'center', lineHeight: 1.5, padding: '0 10px' }}>
        El cobro queda apuntado en la venta como tarjeta. El dinero entra en la cuenta de Stripe de Pidoo.
      </div>
    </div>
  )
}

function Aviso({ texto }) {
  return (
    <>
      <XCircle size={40} color={colors.warning} />
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginTop: 10, lineHeight: 1.5 }}>{texto}</div>
    </>
  )
}
