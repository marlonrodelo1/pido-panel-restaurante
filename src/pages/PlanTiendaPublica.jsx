import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { ExternalLink, Copy, CheckCircle2, AlertCircle, CreditCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast, confirmar } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
const stripePromise = STRIPE_KEY ? loadStripe(STRIPE_KEY) : null
const MONTO = 39.0

const cardElementOptions = {
  style: {
    base: {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '15px',
      color: '#F5F5F5',
      '::placeholder': { color: 'rgba(245,245,245,0.40)' },
      iconColor: '#F5F5F5',
    },
    invalid: { color: '#EF4444', iconColor: '#EF4444' },
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

export default function PlanTiendaPublica() {
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
    const ok = await confirmar(`¿Cancelar tu plan tienda pública? Seguirás activo hasta el próximo cobro y después se desactivará.`)
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
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ ...ds.h1, margin: 0 }}>Plan Tienda Pública</h1>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          Por 39€/mes tu tienda aparece en <strong>pidoo.es</strong> con tu URL pública propia y recibes pedidos sin comisión Pidoo sobre el subtotal. Los pedidos que lleguen desde el listado general siguen con la comisión estándar.
        </div>
      </div>

      {/* Card de estado */}
      <div style={{ ...ds.card, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 6 }}>Estado del plan</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7,
              background: estadoInfo.bg, color: estadoInfo.color,
              fontSize: type.xs, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              <estadoInfo.icon size={14} /> {estadoInfo.label}
            </div>
          </div>
          {sub?.fecha_proximo_pago && estado !== 'canceled' && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {estado === 'active' ? 'Próximo cobro' : 'Vigente hasta'}
              </div>
              <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600, marginTop: 4 }}>
                {new Date(sub.fecha_proximo_pago).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>
          )}
        </div>

        {/* URL pública */}
        {activo && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: colors.elev, border: `1px solid ${colors.border}` }}>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Tu URL pública
            </div>
            {restaurante.slug ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{
                  flex: '1 1 200px', minWidth: 0, padding: '8px 10px', borderRadius: 8,
                  background: colors.surface2, color: colors.text, fontSize: type.sm,
                  fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>https://pidoo.es/{restaurante.slug}</code>
                <button onClick={copiarURL} style={{ ...ds.secondaryBtn, gap: 6 }}>
                  <Copy size={13} /> Copiar
                </button>
                <a href={`https://pidoo.es/${restaurante.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...ds.primaryBtn, textDecoration: 'none' }}>
                  <ExternalLink size={13} /> Abrir
                </a>
              </div>
            ) : (
              <div style={{ fontSize: type.sm, color: colors.statePrep }}>
                Aún no tienes slug. Configúralo en <strong>Ajustes</strong> para generar tu URL pública.
              </div>
            )}
          </div>
        )}
      </div>

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

      {/* CTA activar si inactivo/canceled */}
      {(!sub || estado === 'inactive' || estado === 'canceled') && (
        <div style={{ ...ds.card, padding: 24, textAlign: 'center', marginBottom: 14 }}>
          <CreditCard size={38} color={colors.primary} style={{ marginBottom: 8 }} />
          <h2 style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
            Activa tu tienda pública
          </h2>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 18, lineHeight: 1.5 }}>
            Por <strong style={{ color: colors.text }}>{MONTO.toFixed(2)}€/mes</strong> apareces en pidoo.es y recibes pedidos sin comisión sobre el subtotal en ese canal.
          </div>
          <button onClick={() => setShowPay(true)} style={{ ...ds.primaryBtn, fontSize: type.sm, height: 42, padding: '0 22px' }}>
            Activar plan {MONTO.toFixed(2)}€/mes
          </button>
        </div>
      )}

      {/* Cancelar */}
      {estado === 'active' && (
        <div style={{ ...ds.card, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 700 }}>Cancelar plan</div>
              <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 3 }}>
                Seguirá activo hasta el próximo cobro.
              </div>
            </div>
            <button onClick={cancelar} style={{ ...ds.secondaryBtn, color: colors.danger, borderColor: 'rgba(239,68,68,0.35)' }}>
              Cancelar plan
            </button>
          </div>
        </div>
      )}

      {/* Última factura */}
      {sub?.ultima_factura_stripe_id && (
        <div style={{ ...ds.card }}>
          <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Última factura</div>
          <div style={{ fontSize: type.sm, color: colors.text }}>
            {sub.ultima_factura_stripe_id} · {MONTO.toFixed(2)}€
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
      <div style={{ ...ds.modalContent, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...ds.h2, marginBottom: 6 }}>Activar plan tienda pública</h2>
        <div style={{ fontSize: type.xs, color: colors.textDim, marginBottom: 16 }}>
          {MONTO.toFixed(2)}€/mes · Puedes cancelar cuando quieras.
        </div>
        <form onSubmit={onSubmit}>
          <label style={ds.label}>Tarjeta</label>
          <div style={{ padding: '12px 14px', borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.surface, marginBottom: 12 }}>
            <CardElement options={cardElementOptions} />
          </div>
          {error && (
            <div style={{ padding: 10, borderRadius: 8, background: colors.dangerSoft, color: colors.dangerText, fontSize: type.xs, marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={submitting} style={ds.secondaryBtn}>Cancelar</button>
            <button type="submit" disabled={submitting || !stripe} style={{ ...ds.primaryBtn }}>
              {submitting ? 'Procesando...' : `Activar ${MONTO.toFixed(2)}€/mes`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
