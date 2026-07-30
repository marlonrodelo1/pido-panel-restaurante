import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'

const euro = (v) => `${Number(v || 0).toFixed(2)} €`
const periodoLabel = (i, f) => {
  if (!i) return '—'
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  return `${fmt(i)} – ${fmt(f)}`
}
const ESTADOS = {
  pendiente: { label: 'Pendiente', color: colors.warning, bg: 'rgba(201,149,81,0.15)' },
  pagada: { label: 'Pagada', color: colors.sage2, bg: colors.sageSoft },
  sin_movimiento: { label: 'Sin movimiento', color: colors.stone, bg: colors.cream2 },
  fallida: { label: 'Fallida', color: colors.danger, bg: colors.dangerSoft },
  arrastrada: { label: 'Incluida en la siguiente', color: colors.stone, bg: colors.cream2 },
}

// ── Tarjeta "dónde cobras": onboarding de Stripe Connect.
// Estados que escribe el backend: null (sin cuenta) → onboarding → pendiente → activa
const CONNECT_UI = {
  sin_cuenta: {
    titulo: 'Aún no nos has dicho dónde cobrar',
    texto: 'Registra tu cuenta bancaria para que podamos enviarte el dinero de tus ventas cada lunes. Los datos los guarda Stripe, nuestro proveedor de pagos, no Pidoo.',
    cta: 'Configurar cuenta de cobro',
    color: colors.terracotta,
    bg: 'rgba(197,86,44,0.08)',
  },
  onboarding: {
    titulo: 'Te faltan datos por rellenar',
    texto: 'Empezaste el registro pero quedó a medias. Hasta que lo termines no podemos enviarte los pagos.',
    cta: 'Continuar donde lo dejaste',
    color: colors.warning,
    bg: 'rgba(201,149,81,0.15)',
  },
  pendiente: {
    titulo: 'Stripe está verificando tus datos',
    texto: 'Ya has enviado todo. La verificación suele tardar unos minutos, a veces algún día. Te avisaremos en cuanto esté.',
    cta: 'Revisar mis datos',
    color: colors.warning,
    bg: 'rgba(201,149,81,0.15)',
  },
  activa: {
    titulo: 'Todo listo, cobras sin problema',
    texto: 'Tu cuenta está verificada. Cada lunes te enviamos ahí el dinero de tus ventas.',
    cta: 'Ver o cambiar mis datos',
    color: colors.sage2,
    bg: colors.sageSoft,
  },
}

function CobroCard() {
  const { restaurante } = useRest()
  const [estado, setEstado] = useState(restaurante?.stripe_connect_status || null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Al volver de Stripe (?connect=ok) preguntamos el estado REAL a Stripe en vez
  // de fiarnos del webhook, que puede tardar o no estar configurado.
  useEffect(() => {
    if (!restaurante?.id) return
    let volviendo = false
    try {
      volviendo = new URLSearchParams(window.location.search).get('connect') === 'ok'
    } catch {}
    if (!volviendo) return
    let cancel = false
    ;(async () => {
      setCargando(true)
      const { data, error: err } = await supabase.functions.invoke('stripe-connect-onboarding', {
        body: { establecimiento_id: restaurante.id, action: 'status' },
      })
      if (cancel) return
      if (!err && data?.estado) setEstado(data.estado)
      setCargando(false)
    })()
    return () => { cancel = true }
  }, [restaurante?.id])

  async function abrirOnboarding() {
    if (!restaurante?.id) return
    setCargando(true)
    setError('')
    try {
      const base = `${window.location.origin}/?seccion=liquidacion-pido`
      const { data, error: err } = await supabase.functions.invoke('stripe-connect-onboarding', {
        body: {
          establecimiento_id: restaurante.id,
          return_url: `${base}&connect=ok`,
          refresh_url: `${base}&connect=refresh`,
        },
      })
      if (err) {
        // El detalle del fallo viene en el cuerpo de la respuesta, no en err.message
        let msg = err.message || 'No se pudo abrir la configuración'
        try { const body = await err.context?.json(); if (body?.error) msg = body.error } catch {}
        throw new Error(msg)
      }
      if (!data?.url) throw new Error('Stripe no devolvió un enlace válido')
      window.location.href = data.url
    } catch (e) {
      setError(e.message || String(e))
      setCargando(false)
    }
  }

  const ui = CONNECT_UI[estado] || CONNECT_UI.sin_cuenta
  const verificada = estado === 'activa'

  return (
    <div style={{ ...ds.card, padding: 18, marginBottom: 18, borderLeft: `3px solid ${ui.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: type.base, fontWeight: 800, color: colors.ink }}>{ui.titulo}</span>
            <span style={{ fontSize: type.xxs, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: ui.color, background: ui.bg }}>
              {verificada ? 'Verificada' : 'Acción necesaria'}
            </span>
          </div>
          <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5, maxWidth: 620 }}>{ui.texto}</div>
          {error && (
            <div style={{ fontSize: type.xs, color: colors.danger, marginTop: 8, fontWeight: 600 }}>{error}</div>
          )}
        </div>
        <button
          onClick={abrirOnboarding}
          disabled={cargando}
          style={{ ...(verificada ? ds.ghostBtn : ds.primaryBtn), opacity: cargando ? 0.6 : 1, whiteSpace: 'nowrap' }}
        >
          {cargando ? 'Abriendo…' : ui.cta}
        </button>
      </div>
    </div>
  )
}

// ── Tarjeta "debes a Pido": cobra el saldo con tarjeta.
// Solo aparece cuando el corte sale negativo, que pasa cuando el restaurante
// cobro mucho en efectivo y la comision no cabe en lo que paso por tarjeta.
function DeudaCard({ debe, onSaldado }) {
  const { restaurante } = useRest()
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [pagado, setPagado] = useState(null)

  // Al volver de Stripe (?cobro=ok) confirmamos contra Stripe y saldamos.
  useEffect(() => {
    if (!restaurante?.id) return
    let params
    try { params = new URLSearchParams(window.location.search) } catch { return }
    if (params.get('cobro') !== 'ok') return
    const sid = params.get('session_id')
    if (!sid) return
    let cancel = false
    ;(async () => {
      setCargando(true)
      const { data } = await supabase.functions.invoke('cobrar-saldo-restaurante', {
        body: { establecimiento_id: restaurante.id, action: 'confirmar', session_id: sid },
      })
      if (cancel) return
      setCargando(false)
      if (data?.pagado) {
        setPagado(data.importe)
        onSaldado?.()
      }
    })()
    return () => { cancel = true }
  }, [restaurante?.id])

  async function pagar() {
    if (!restaurante?.id) return
    setCargando(true)
    setError('')
    try {
      const base = `${window.location.origin}/?seccion=liquidacion-pido`
      const { data, error: err } = await supabase.functions.invoke('cobrar-saldo-restaurante', {
        body: { establecimiento_id: restaurante.id, return_url: base },
      })
      if (err) {
        let msg = err.message || 'No se pudo abrir el pago'
        try { const b = await err.context?.json(); if (b?.error) msg = b.error } catch {}
        throw new Error(msg)
      }
      if (data?.ya_pagado) { setPagado(0); onSaldado?.(); setCargando(false); return }
      if (!data?.url) throw new Error('Stripe no devolvio un enlace de pago')
      window.location.href = data.url
    } catch (e) {
      setError(e.message || String(e))
      setCargando(false)
    }
  }

  if (pagado !== null) {
    return (
      <div style={{ ...ds.card, padding: 18, marginBottom: 18, borderLeft: `3px solid ${colors.sage2}` }}>
        <div style={{ fontSize: type.base, fontWeight: 800, color: colors.ink }}>Saldo liquidado</div>
        <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
          Hemos recibido tu pago. Tu cuenta con Pido queda al día.
        </div>
      </div>
    )
  }

  if (!debe || debe <= 0) return null

  return (
    <div style={{ ...ds.card, padding: 18, marginBottom: 18, borderLeft: `3px solid ${colors.terracotta}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontSize: type.base, fontWeight: 800, color: colors.ink, marginBottom: 4 }}>
            Tienes {euro(debe)} pendientes de pagar a Pido
          </div>
          <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5, maxWidth: 620 }}>
            Cobraste en efectivo más de lo que pasó por tarjeta, así que nuestra comisión
            no se pudo descontar. Puedes saldarlo ahora con tarjeta.
          </div>
          {error && (
            <div style={{ fontSize: type.xs, color: colors.danger, marginTop: 8, fontWeight: 600 }}>{error}</div>
          )}
        </div>
        <button
          onClick={pagar}
          disabled={cargando}
          style={{ ...ds.primaryBtn, opacity: cargando ? 0.6 : 1, whiteSpace: 'nowrap' }}
        >
          {cargando ? 'Abriendo…' : 'Liquidar saldo a Pido'}
        </button>
      </div>
    </div>
  )
}

export default function LiquidacionPido() {
  const { restaurante } = useRest()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    if (!restaurante?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('liquidaciones_semanales')
        .select('*')
        .eq('establecimiento_id', restaurante.id)
        .order('periodo_inicio', { ascending: false })
      if (!cancel) { setRows(data || []); setLoading(false) }
    })()
    return () => { cancel = true }
  }, [restaurante?.id, recarga])

  // Se decide por el IMPORTE, no por la columna 'direccion': hay filas historicas
  // con esa columna corrupta (llego a contener una direccion postal dentro).
  const pendientePido = rows.filter(r => r.estado === 'pendiente' && Number(r.neto_a_pagar) > 0)
    .reduce((s, r) => s + Number(r.neto_a_pagar || 0), 0)
  const pendienteDebes = rows.filter(r => r.estado === 'pendiente' && Number(r.neto_a_pagar) < 0)
    .reduce((s, r) => s + Math.abs(Number(r.neto_a_pagar || 0)), 0)

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ ...ds.h1, margin: 0 }}>Liquidación con Pido</h2>
        <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4, lineHeight: 1.5, maxWidth: 680 }}>
          Cada lunes calculamos tu corte: te enviamos el 90% de tus ventas (descontando lo cobrado en efectivo) y nuestra comisión del 10%. Si cobraste mucho en efectivo, la diferencia la pagas tú.
        </div>
      </div>

      <CobroCard />
      <DeudaCard debe={pendienteDebes} onSaldado={() => setRecarga(n => n + 1)} />

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 18 }}>
        <div style={{ ...ds.card, padding: 16 }}>
          <div style={{ fontSize: type.xxs, color: colors.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pido te enviará</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: colors.sage2, marginTop: 6 }}>{euro(pendientePido)}</div>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>pendiente de pago</div>
        </div>
        <div style={{ ...ds.card, padding: 16 }}>
          <div style={{ fontSize: type.xxs, color: colors.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Debes a Pido</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: colors.terracotta, marginTop: 6 }}>{euro(pendienteDebes)}</div>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>por exceso de efectivo</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: colors.stone, fontSize: type.sm }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 32, color: colors.stone, fontSize: type.sm }}>
          Aún no tienes liquidaciones. Se generan automáticamente cada lunes con los pedidos de la semana.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => {
            const est = ESTADOS[r.estado] || ESTADOS.pendiente
            const neto = Number(r.neto_a_pagar || 0)
            const arr = Number(r.saldo_arrastre || 0)
            const linea = r.estado === 'arrastrada' ? 'Incluida en la liquidación siguiente'
              : r.direccion === 'sin_movimiento' ? 'Sin movimiento esta semana'
              : r.direccion === 'pido_paga' ? `Pido te envía ${euro(neto)}`
              : `Debes a Pido ${euro(Math.abs(neto))}`
            const lineaColor = r.estado === 'arrastrada' ? colors.stone
              : r.direccion === 'pido_paga' ? colors.sage2
              : r.direccion === 'restaurante_paga' ? colors.terracotta : colors.stone
            return (
              <div key={r.id} style={{ ...ds.card, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink }}>{periodoLabel(r.periodo_inicio, r.periodo_fin)}</div>
                    <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>{r.pedidos_count} pedido{r.pedidos_count !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: type.base, fontWeight: 800, color: lineaColor }}>{linea}</div>
                    <span style={{ fontSize: type.xxs, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: est.color, background: est.bg }}>{est.label}</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                  <Mini label="Ventas (subtotal)" v={euro(r.subtotal_total)} />
                  <Mini label="Comisión Pido" v={euro(r.comision_pido)} />
                  <Mini label="Cobrado efectivo" v={euro(r.efectivo_total)} />
                  <Mini label="Cobrado tarjeta" v={euro(r.tarjeta_total)} />
                  <Mini label="Envíos + propinas" v={euro(Number(r.envios_total || 0) + Number(r.propinas_total || 0))} />
                  {Math.abs(arr) >= 0.005 && <Mini label="Arrastre sem. anterior" v={euro(arr)} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Mini({ label, v }) {
  return (
    <div>
      <div style={{ fontSize: type.xxs, color: colors.stone, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    </div>
  )
}
