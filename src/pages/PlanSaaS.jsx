import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { ExternalLink, Copy, CheckCircle2, AlertCircle, CreditCard, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast, confirmar } from '../App'
import { colors, type, ds, chip } from '../lib/uiStyles'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null
const MONTO = 30.0

const cardElementOptions = {
  style: {
    base: {
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      fontSize: '15px',
      color: '#1A1815',
      '::placeholder': { color: '#6B6356' },
      iconColor: '#1A1815',
    },
    invalid: { color: '#B5564A', iconColor: '#B5564A' },
  },
}

const ESTADO_INFO = {
  active:   { label: 'Activo',        bg: colors.stateOkSoft,       color: colors.stateOk,       icon: CheckCircle2 },
  pending:  { label: 'Procesando',    bg: colors.statePrepSoft,     color: colors.statePrep,     icon: AlertCircle  },
  past_due: { label: 'Pago pendiente',bg: colors.dangerSoft,        color: colors.danger,        icon: AlertCircle  },
  unpaid:   { label: 'Impagado',      bg: colors.dangerSoft,        color: colors.danger,        icon: AlertCircle  },
  canceled: { label: 'Cancelado',     bg: colors.stateNeutralSoft,  color: colors.stateNeutral,  icon: AlertCircle  },
  inactive: { label: 'Inactivo',      bg: colors.stateNeutralSoft,  color: colors.stateNeutral,  icon: AlertCircle  },
}

export default function PlanSaaS() {
  const { restaurante, refetch } = useRest()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showPay, setShowPay] = useState(false)
  const [facturas, setFacturas] = useState([])

  useEffect(() => {
    if (!restaurante?.id) return
    load()
    const channel = supabase.channel(`susc-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suscripciones_tienda', filter: `establecimiento_id=eq.${restaurante.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [restaurante?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('suscripciones_tienda').select('*').eq('establecimiento_id', restaurante.id).maybeSingle()
    setSub(data || null)
    if (data?.stripe_customer_id) {
      // Cargar listado de facturas vía Stripe API? No expuesto al cliente — mostramos sólo la última + enlace a portal.
      // (no-op por ahora; podría implementarse con una función serverless para listar invoices)
    }
    setLoading(false)
  }

  async function cancelar() {
    const ok = await confirmar(`¿Cancelar tu Plan Pidoo SaaS? Seguirás activo hasta el próximo cobro y después se desactivará.`)
    if (!ok) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancelar-suscripcion-tienda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ establecimiento_id: restaurante.id }),
    })
    const json = await res.json()
    if (!res.ok) return toast('Error: ' + (json.error || 'no se pudo cancelar'), 'error')
    toast('Plan cancelado al final del periodo')
    load()
  }

  async function copiarURL() {
    const url = `https://pidoo.es/${restaurante.slug || ''}`
    try {
      await navigator.clipboard.writeText(url)
      toast('URL copiada', 'success')
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }

  if (loading) {
    return <div style={{ padding: 30, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
  }

  const estado = sub?.estado || 'inactive'
  const activo = estado === 'active' && restaurante.plan_pro
  const estadoInfo = ESTADO_INFO[estado] || ESTADO_INFO.inactive

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ ...ds.h1, margin: 0 }}>Suscripción</h1>
        <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
          30€/mes · 5% por pagos con tarjeta · Cancela cuando quieras
        </div>
      </div>

      {/* Card de estado */}
      <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ ...ds.sectionLabel, margin: 0 }}>Estado del plan</div>
          <span style={chip(estado === 'active' ? 'sage' : estado === 'past_due' || estado === 'unpaid' ? 'danger' : 'paper', { dot: true })}>
            <estadoInfo.icon size={11} /> {estadoInfo.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 28, fontWeight: 700, color: colors.ink }}>
            {MONTO.toFixed(2).replace('.', ',')} €
          </span>
          <span style={{ color: colors.stone, fontSize: 14 }}>/mes</span>
        </div>
        {sub?.fecha_proximo_pago && estado !== 'canceled' && (
          <div style={{ fontSize: type.sm, color: colors.stone }}>
            {estado === 'active' ? 'Próximo cobro:' : 'Vigente hasta:'}{' '}
            <b style={{ color: colors.ink }}>
              {new Date(sub.fecha_proximo_pago).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
            </b>
          </div>
        )}
      </div>

      {/* URL pública card */}
      {activo && (
        <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
          <div style={ds.sectionLabel}>Tu URL pública</div>
          {restaurante.slug ? (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'center',
              background: colors.cream2, borderRadius: 10, padding: '12px 14px',
              fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 600,
              flexWrap: 'wrap',
            }}>
              <span style={{ color: colors.stone }}>https://</span>
              <span style={{ color: colors.ink }}>pidoo.es/{restaurante.slug}</span>
              <div style={{ flex: 1 }} />
              <button onClick={copiarURL} style={ds.miniBtn}>
                <Copy size={11} /> Copiar
              </button>
              <a href={`https://pidoo.es/${restaurante.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...ds.miniBtn, textDecoration: 'none' }}>
                <ExternalLink size={11} /> Abrir
              </a>
            </div>
          ) : (
            <div style={{ fontSize: type.sm, color: colors.statePrep }}>
              Aún no tienes slug. Configúralo en <strong>Ajustes</strong> para generar tu URL pública.
            </div>
          )}
        </div>
      )}

      {/* Banner warning past_due/unpaid */}
      {(estado === 'past_due' || estado === 'unpaid') && (
        <div style={{
          padding: 14, borderRadius: 12, marginBottom: 14,
          background: colors.dangerSoft, border: `1px solid ${colors.danger}`,
          color: colors.dangerText, fontSize: type.sm, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, color: colors.danger, marginBottom: 4 }}>Pago fallido</div>
          No hemos podido cobrar tu suscripción ({sub?.intentos_fallidos || 1}/3 intentos). Actualiza tu método de pago para mantener tu plan activo.
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowPay(true)} style={ds.primaryBtn}>Actualizar método de pago</button>
          </div>
        </div>
      )}

      {/* Stripe Connect Express section */}
      {activo && (
        <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: colors.cream2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <CreditCard size={20} style={{ color: colors.stone }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...ds.h2, marginBottom: 0 }}>Conexión Stripe Connect Express</div>
              <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4, marginBottom: 12 }}>
                El dinero de tus pedidos llega directo a tu IBAN, sin pasar por Pidoo.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={chip('sage', { dot: true })}>
                  <CheckCircle2 size={11} /> Cuenta conectada
                </span>
                <a
                  href="https://dashboard.stripe.com/express/login"
                  target="_blank" rel="noopener noreferrer"
                  style={{ ...ds.ghostBtn, height: 30, padding: '0 12px', fontSize: 12, textDecoration: 'none' }}
                >
                  <ExternalLink size={12} /> Gestionar en Stripe
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CTA activar si inactivo/canceled */}
      {(!sub || estado === 'inactive' || estado === 'canceled') && (
        <div style={{ ...ds.card, padding: 28, textAlign: 'center', marginBottom: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: colors.terracottaSoft, color: colors.terracotta2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12,
          }}>
            <CreditCard size={28} strokeWidth={2} />
          </div>
          <h2 style={{ ...ds.h2, marginBottom: 6 }}>
            Activa el Plan Pidoo SaaS
          </h2>
          <div style={{ fontSize: type.sm, color: colors.stone, marginBottom: 18, lineHeight: 1.5 }}>
            Por <strong style={{ color: colors.ink }}>{MONTO.toFixed(2)}€/mes</strong> · <strong>5% por pagos con tarjeta</strong> · Cancela cuando quieras.
          </div>
          <button onClick={() => setShowPay(true)} style={{ ...ds.glossyBtn, height: 46, padding: '0 22px' }}>
            Activar plan {MONTO.toFixed(2).replace('.', ',')} €/mes
          </button>
        </div>
      )}

      {/* Última factura */}
      {sub?.ultima_factura_stripe_id && (
        <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
          <div style={ds.sectionLabel}>Última factura</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: type.sm, color: colors.ink, fontWeight: 600 }}>
                {sub.ultima_factura_stripe_id}
              </div>
              <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
                {MONTO.toFixed(2).replace('.', ',')} €
              </div>
            </div>
            <button style={ds.miniBtn}>
              <Download size={11}/> PDF
            </button>
          </div>
        </div>
      )}

      {/* Cancelar — zona peligrosa */}
      {estado === 'active' && (
        <div style={{
          background: colors.dangerSoft, border: 'none',
          borderRadius: 12, padding: 22, marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ ...ds.h2, color: colors.danger, marginBottom: 0 }}>Cancelar plan</div>
              <div style={{ fontSize: type.sm, color: colors.danger, opacity: 0.85, marginTop: 4 }}>
                Mantendrás acceso hasta el final del periodo facturado.
              </div>
            </div>
            <button onClick={cancelar} style={{
              ...ds.ghostBtn,
              color: colors.danger,
              borderColor: 'rgba(181,86,74,0.35)',
            }}>
              Cancelar plan
            </button>
          </div>
        </div>
      )}

      {/* Modal pago */}
      {showPay && stripePromise && (
        <Elements stripe={stripePromise}>
          <PayModal
            onClose={() => setShowPay(false)}
            onSuccess={async () => {
              setShowPay(false)
              await refetch?.()
              load()
              toast('Plan activado', 'success')
            }}
            establecimientoId={restaurante.id}
          />
        </Elements>
      )}
      {showPay && !stripePromise && (
        <div style={ds.modal} onClick={() => setShowPay(false)}>
          <div style={ds.modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{ ...ds.h2, marginBottom: 10 }}>Stripe no configurado</h2>
            <div style={{ fontSize: type.sm, color: colors.textDim }}>
              VITE_STRIPE_PUBLISHABLE_KEY no está definido. Contacta con soporte.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowPay(false)} style={ds.secondaryBtn}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PayModal({ onClose, onSuccess, establecimientoId }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    const card = elements.getElement(CardElement)
    // 1. Create PaymentMethod
    const { error: pmErr, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card,
    })
    if (pmErr) { setError(pmErr.message); setSubmitting(false); return }

    // 2. Call edge function
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crear-suscripcion-tienda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ establecimiento_id: establecimientoId, payment_method_id: paymentMethod.id }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error || 'Error al crear suscripción'); setSubmitting(false); return }

    if (json.status === 'requires_action' && json.client_secret) {
      const { error: confirmErr } = await stripe.confirmCardPayment(json.client_secret)
      if (confirmErr) { setError(confirmErr.message); setSubmitting(false); return }
      onSuccess()
      return
    }
    if (json.status === 'success') {
      onSuccess()
      return
    }
    setError('Estado inesperado: ' + json.status)
    setSubmitting(false)
  }

  return (
    <div style={ds.modal} onClick={() => !submitting && onClose()}>
      <div style={{ ...ds.modalContent, maxWidth: 480, padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ ...ds.h2, fontSize: 19, margin: 0 }}>Activar Suscripción</div>
        </div>

        {/* Body */}
        <form onSubmit={onSubmit}>
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Price highlight terracotta-soft */}
            <div style={{
              background: colors.terracottaSoft, borderRadius: 12,
              padding: 16, textAlign: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'center' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 36, color: colors.terracotta2, fontWeight: 800 }}>{Math.floor(MONTO)}</span>
                <span style={{ fontSize: 18, color: colors.terracotta2, fontWeight: 700 }}>€</span>
                <span style={{ color: colors.terracotta2, fontSize: 13, fontWeight: 600, marginLeft: 2 }}>/mes</span>
              </div>
              <div style={{ fontSize: 12, color: colors.terracotta2, textAlign: 'center', marginTop: 6, fontWeight: 600 }}>
                5% por pagos con tarjeta · Cancela cuando quieras
              </div>
            </div>

            <div>
              <label style={ds.label}>Datos de tarjeta</label>
              <div style={{
                background: colors.paper, border: `1px solid ${colors.border}`, borderRadius: 10,
                padding: '12px 14px', marginBottom: 6,
              }}>
                <CardElement options={cardElementOptions} />
              </div>
              <div style={{ fontSize: 11, color: colors.stone, display: 'flex', alignItems: 'center', gap: 6 }}>
                🔒 Stripe · cifrado SSL · PCI DSS
              </div>
            </div>

            {error && (
              <div style={{ padding: 12, borderRadius: 8, background: colors.dangerSoft, color: colors.danger, fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '14px 22px', borderTop: `1px solid ${colors.border}`,
            background: colors.cream,
            display: 'flex', justifyContent: 'flex-end', gap: 10,
          }}>
            <button type="button" onClick={onClose} disabled={submitting} style={ds.ghostBtn}>Cancelar</button>
            <button type="submit" disabled={submitting || !stripe} style={{ ...ds.glossyBtn, opacity: submitting ? 0.55 : 1 }}>
              {submitting ? 'Procesando...' : `Activar ${MONTO.toFixed(2).replace('.', ',')} €/mes`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
