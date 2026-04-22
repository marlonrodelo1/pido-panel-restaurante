import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const SUPABASE_URL = 'https://rmrbxrabngdmpgpfmjbo.supabase.co'

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function fmtFecha(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtFechaCorta(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

const ESTADO_CONNECT = {
  pendiente:  { color: colors.statePrep,    bg: colors.statePrepSoft,    label: 'Pendiente' },
  onboarding: { color: colors.statePrep,    bg: colors.statePrepSoft,    label: 'Onboarding en curso' },
  activa:     { color: colors.stateOk,      bg: colors.stateOkSoft,      label: 'Cuenta conectada' },
  rechazada:  { color: colors.danger,       bg: colors.dangerSoft,       label: 'Rechazada' },
  suspendida: { color: colors.danger,       bg: colors.dangerSoft,       label: 'Suspendida' },
}

const ESTADO_FACTURA = {
  created:        { color: colors.stateOk,      bg: colors.stateOkSoft,      label: 'Transferido' },
  rollover_deuda: { color: colors.statePrep,    bg: colors.statePrepSoft,    label: 'Deuda arrastrada' },
  failed:         { color: colors.danger,       bg: colors.dangerSoft,       label: 'Fallido' },
  skip_minimo:    { color: colors.stateNeutral, bg: colors.stateNeutralSoft, label: 'Sin movimiento' },
}

export default function Finanzas({ onBack }) {
  const { restaurante } = useRest()
  const [data, setData] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [conectando, setConectando] = useState(false)

  const cargar = useCallback(async () => {
    if (!restaurante?.id) return
    try {
      const { data: est, error: e1 } = await supabase
        .from('establecimientos')
        .select('id, stripe_connect_account_id, stripe_connect_status, stripe_connect_onboarded_at, balance_card_acumulado, deuda_cash_acumulada, cash_bloqueado_por_deuda, limite_deuda_cash, ultima_liquidacion_at')
        .eq('id', restaurante.id)
        .maybeSingle()
      if (e1) throw e1
      setData(est)

      const { data: facs, error: e2 } = await supabase
        .from('facturas_semanales')
        .select('*')
        .eq('establecimiento_id', restaurante.id)
        .order('periodo_inicio', { ascending: false })
        .limit(24)
      if (e2) throw e2
      setFacturas(facs || [])
    } catch (err) {
      toast('Error cargando finanzas: ' + (err.message || err), 'error')
    } finally {
      setLoading(false)
    }
  }, [restaurante?.id])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    if (!restaurante?.id) return
    const id = setInterval(cargar, 30000)
    return () => clearInterval(id)
  }, [cargar, restaurante?.id])

  // Refresh tras volver de onboarding Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('onboarded') === '1' || params.get('refresh') === '1') {
      cargar()
      // limpiar query params
      const url = new URL(window.location.href)
      url.searchParams.delete('onboarded')
      url.searchParams.delete('refresh')
      window.history.replaceState({}, '', url.toString())
    }
  }, [cargar])

  async function conectarStripe() {
    if (!restaurante?.id) return
    setConectando(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/stripe-connect-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          establecimiento_id: restaurante.id,
          return_url: window.location.origin + '/finanzas?onboarded=1',
          refresh_url: window.location.origin + '/finanzas?refresh=1',
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body?.url) {
        throw new Error(body?.error || 'No se pudo iniciar el onboarding')
      }
      window.location.href = body.url
    } catch (err) {
      toast('Error conectando Stripe: ' + (err.message || err), 'error')
      setConectando(false)
    }
  }

  const connectStatus = data?.stripe_connect_status
  const connectInfo = connectStatus ? ESTADO_CONNECT[connectStatus] : null
  const necesitaOnboarding = !connectStatus || connectStatus === 'pendiente' || connectStatus === 'onboarding' || connectStatus === 'rechazada' || connectStatus === 'suspendida'

  const balanceCard = Number(data?.balance_card_acumulado || 0)
  const deudaCash = Number(data?.deuda_cash_acumulada || 0)
  const neto = balanceCard - deudaCash
  const netoColor = neto >= 0 ? colors.info : colors.danger

  const limiteDeuda = Number(data?.limite_deuda_cash ?? 150)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button onClick={onBack} style={{ ...ds.backBtn, marginBottom: 0 }}>← Volver</button>
          )}
          <div>
            <h1 style={{ ...ds.h1, margin: 0 }}>Finanzas con Pidoo</h1>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
              Cuenta bancaria, balance y facturas semanales con la plataforma.
            </div>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ padding: 32, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
      ) : (
        <>
          {/* Tarjeta Stripe Connect */}
          <div style={{ ...ds.card, padding: '18px 20px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Cuenta bancaria · Stripe
                </div>
                {connectInfo && connectStatus === 'activa' ? (
                  <>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '4px 10px', borderRadius: 999,
                        background: connectInfo.bg, color: connectInfo.color,
                        fontSize: type.xs, fontWeight: 700,
                      }}>
                        ✓ {connectInfo.label}
                      </span>
                      {data?.stripe_connect_onboarded_at && (
                        <span style={{ fontSize: type.xs, color: colors.textMute }}>
                          desde {fmtFecha(data.stripe_connect_onboarded_at)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 10, lineHeight: 1.5 }}>
                      Las liquidaciones semanales se transfieren automáticamente a tu cuenta bancaria los lunes.
                    </div>
                  </>
                ) : connectInfo ? (
                  <>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '4px 10px', borderRadius: 999,
                      background: connectInfo.bg, color: connectInfo.color,
                      fontSize: type.xs, fontWeight: 700,
                    }}>
                      {connectInfo.label}
                    </span>
                    <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 10, lineHeight: 1.5 }}>
                      Necesario para recibir las liquidaciones semanales de tus ventas por tarjeta.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5, marginTop: 4 }}>
                    Necesario para recibir las liquidaciones semanales de tus ventas por tarjeta.
                  </div>
                )}
              </div>
              {necesitaOnboarding && (
                <button
                  onClick={conectarStripe}
                  disabled={conectando}
                  style={{
                    ...ds.primaryBtn,
                    height: 44, padding: '0 22px',
                    fontSize: type.sm, fontWeight: 700,
                    opacity: conectando ? 0.6 : 1,
                    cursor: conectando ? 'default' : 'pointer',
                  }}
                >
                  {conectando ? 'Conectando...' : (connectStatus === 'rechazada' || connectStatus === 'suspendida' ? 'Reintentar onboarding' : 'Conectar cuenta bancaria')}
                </button>
              )}
            </div>
          </div>

          {/* Tarjeta balance */}
          <div style={{ ...ds.card, padding: '20px 22px', marginBottom: 18 }}>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
              Balance actual
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div style={{ padding: '14px 16px', borderRadius: 10, background: colors.stateOkSoft, border: `1px solid ${colors.stateOk}22` }}>
                <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  A favor (card)
                </div>
                <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.stateOk, marginTop: 4 }}>
                  {fmtMoney(balanceCard)}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4 }}>
                  Pidoo te debe
                </div>
              </div>

              <div style={{ padding: '14px 16px', borderRadius: 10, background: colors.primarySoft, border: `1px solid ${colors.primaryBorder}` }}>
                <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Debo a Pidoo (efectivo)
                </div>
                <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.primary, marginTop: 4 }}>
                  {fmtMoney(deudaCash)}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4 }}>
                  Comisión pedidos efectivo
                </div>
              </div>

              <div style={{ padding: '14px 16px', borderRadius: 10, background: neto >= 0 ? colors.infoSoft : colors.dangerSoft, border: `1px solid ${neto >= 0 ? colors.info : colors.danger}33` }}>
                <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Balance neto
                </div>
                <div style={{ fontSize: type.xl, fontWeight: 800, color: netoColor, marginTop: 4 }}>
                  {fmtMoney(neto)}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4 }}>
                  {neto >= 0 ? 'A tu favor' : 'Debes compensar'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5 }}>
              El <strong style={{ color: colors.text }}>lunes</strong> cada semana se liquida automáticamente: si es positivo, transferimos a tu cuenta; si es negativo, se arrastra a la siguiente semana.
            </div>

            {data?.cash_bloqueado_por_deuda && (
              <div style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 10,
                background: colors.dangerSoft, border: `1px solid ${colors.danger}55`,
                color: colors.dangerText, fontSize: type.xs, fontWeight: 600, lineHeight: 1.5,
              }}>
                ⚠ <strong>Efectivo bloqueado por deuda acumulada.</strong> Se desbloqueará automáticamente cuando entren pedidos con tarjeta que compensen la deuda. Límite: {fmtMoney(limiteDeuda)}.
              </div>
            )}

            {data?.ultima_liquidacion_at && (
              <div style={{ marginTop: 12, fontSize: type.xxs, color: colors.textMute }}>
                Última liquidación: <strong style={{ color: colors.textDim }}>{fmtFecha(data.ultima_liquidacion_at)}</strong>
              </div>
            )}
          </div>

          {/* Historial */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Historial de liquidaciones</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>
                {facturas.length} semana{facturas.length === 1 ? '' : 's'}
              </span>
            </div>

            {facturas.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
                Aún no hay liquidaciones generadas.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', ...ds.table }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
                  <thead>
                    <tr style={{ background: colors.elev2 }}>
                      {['Periodo', 'Pedidos card', 'Pedidos cash', 'A favor', 'Debo', 'Neto', 'Estado', 'Acciones'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.map(f => {
                      const info = ESTADO_FACTURA[f.estado] || { color: colors.stateNeutral, bg: colors.stateNeutralSoft, label: f.estado || '—' }
                      const inicio = f.periodo_inicio || f.semana_inicio
                      const fin = f.periodo_fin || f.semana_fin
                      const pedidosCard = f.pedidos_card ?? f.num_pedidos_card ?? 0
                      const pedidosCash = f.pedidos_cash ?? f.num_pedidos_cash ?? 0
                      const aFavor = Number(f.total_card ?? f.balance_card ?? f.a_favor ?? 0)
                      const debo = Number(f.total_cash_comision ?? f.deuda_cash ?? f.debo ?? 0)
                      const netoF = Number(f.neto ?? (aFavor - debo))
                      const transferUrl = f.stripe_transfer_url || (f.stripe_transfer_id ? `https://dashboard.stripe.com/transfers/${f.stripe_transfer_id}` : null)
                      return (
                        <tr key={f.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.textDim }}>
                            {fmtFechaCorta(inicio)} → {fmtFechaCorta(fin)}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{pedidosCard}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{pedidosCash}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.stateOk, fontWeight: 700 }}>{fmtMoney(aFavor)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.primary, fontWeight: 700 }}>{fmtMoney(debo)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: netoF >= 0 ? colors.info : colors.danger, fontWeight: 800 }}>{fmtMoney(netoF)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                              background: info.bg, color: info.color,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>{info.label}</span>
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            {transferUrl ? (
                              <a href={transferUrl} target="_blank" rel="noopener noreferrer" style={{ color: colors.primary, fontSize: type.xs, fontWeight: 700, textDecoration: 'none' }}>
                                Ver transfer →
                              </a>
                            ) : (
                              <span style={{ fontSize: type.xs, color: colors.textFaint }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
