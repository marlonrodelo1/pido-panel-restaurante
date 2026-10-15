// TpvCobroLector — cobrar un pedido en el LECTOR de tarjetas (BBPOS WisePad 3), 15 oct 2026.
//
// Lo usan el mostrador (Tpv.jsx: la venta ya está grabada como datáfono) y la pestaña Pedidos
// (TpvPedidos.jsx: recogidas, kiosko, telefónicos que se pagan al entregar). Aquí solo se pide
// el cobro y se pregunta cómo va: quien lo pasa por el lector es el móvil del mostrador
// (pantalla «Lector de tarjetas»), y quien lo apunta es el servidor (edge tpv-cobro-lector →
// el pedido pasa a 'tarjeta').
//   - Cobrado → onCobrado(tarjeta).
//   - Fallo   → reintentar, u onOtraForma (p. ej. «Lo cobré con el datáfono del banco»).
// No se puede cerrar con un cobro a medias: cerrar = cancelarlo primero.
import { useEffect, useRef, useState } from 'react'
import { X, Loader2, AlertTriangle, CreditCard } from 'lucide-react'
import { T, FONT, cents, eur, btnAccion, btnSecundario } from '../lib/tpvTheme'
import { llamarLector, mensajeErrorLector } from '../lib/cobroLector'

const ESPERA_SONDEO_MS = 1500

function textoFalloLector(error) {
  const code = error?.decline_code || error?.code || ''
  if (/declin|insufficient|do_not_honor|card_declined|expired|incorrect_pin|pin/i.test(code)) return 'Tarjeta rechazada. Pide otra tarjeta o cobra de otra forma.'
  return 'Cobro cancelado. No se ha cobrado nada.'
}

export default function TpvCobroLector({
  pedidoId, total, establecimientoId, onCobrado, onOtraForma, onCerrar,
  textoOtraForma = 'Lo cobré con el datáfono del banco',
  notaFallo = 'La venta ya está apuntada. Si al final paga en efectivo, anúlala en «Tickets del día» y vuelve a cobrarla en efectivo.',
}) {
  const total_c = cents(total)
  const [fase, setFase] = useState('preparando')   // preparando | esperando | cancelando | fallo
  const [cobroId, setCobroId] = useState(null)
  const [aviso, setAviso] = useState('')
  const [intento, setIntento] = useState(0)
  const terminadoRef = useRef(false)

  // Pedir el cobro al lector (y otra vez al reintentar).
  useEffect(() => {
    let vivo = true
    terminadoRef.current = false
    setFase('preparando'); setAviso(''); setCobroId(null)
    ;(async () => {
      const r = await llamarLector('crear', establecimientoId, { pedido_id: pedidoId })
      if (!vivo) return
      if (r.ok && r.data?.ya_cobrado) { terminadoRef.current = true; onCobrado(null); return }
      if (!r.ok || !r.data?.cobro_id) { setAviso(mensajeErrorLector(r.error)); setFase('fallo'); return }
      setCobroId(r.data.cobro_id)
      setFase('esperando')
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento])

  // ¿Ha pagado? Se pregunta cada 1,5 s; una de cada cuatro, además a Stripe.
  useEffect(() => {
    if (!cobroId || fase !== 'esperando') return
    let vivo = true
    let n = 0
    const mirar = async () => {
      n++
      const r = await llamarLector('estado', establecimientoId, { cobro_id: cobroId, verificar: n % 4 === 0 })
      if (!vivo || terminadoRef.current || !r.ok) return
      if (r.data?.estado === 'cobrado') { terminadoRef.current = true; onCobrado(r.data.tarjeta || null) }
      else if (r.data?.estado === 'cancelado' || r.data?.estado === 'fallido') {
        setAviso(textoFalloLector(r.data?.error)); setFase('fallo')
      }
    }
    const t = setInterval(mirar, ESPERA_SONDEO_MS)
    return () => { vivo = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroId, fase])

  async function cancelar() {
    if (!cobroId) { setFase('fallo'); setAviso('Cobro cancelado. No se ha cobrado nada.'); return }
    setFase('cancelando')
    const r = await llamarLector('cancelar', establecimientoId, { cobro_id: cobroId })
    if (r.data?.ya_cobrado) { terminadoRef.current = true; onCobrado(null); return }
    if (!r.ok && r.error === 'cobro_en_curso') {
      setAviso('El cliente está pagando ahora mismo en el lector: espera unos segundos.')
      setFase('esperando')
      return
    }
    setAviso(r.ok ? 'Cobro cancelado. No se ha cobrado nada.' : mensajeErrorLector(r.error))
    setFase('fallo')
  }

  const esperando = fase === 'preparando' || fase === 'esperando' || fase === 'cancelando'
  // La X: con un cobro a medias, lo cancela; si ya falló, cierra (onCerrar o, si no hay,
  // la «otra forma», que es lo que hacía el mostrador).
  const cerrar = esperando ? cancelar : (onCerrar || onOtraForma)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 18,
        width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 17, color: T.text }}>{`Cobrar ${eur(total_c)} con tarjeta`}</strong>
          <button onClick={cerrar} aria-label="Cerrar" style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.muted }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 14, textAlign: 'center' }}>
          {esperando ? (
            <>
              <Loader2 size={40} color={T.accent} style={{ margin: '6px auto 0', animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: 34, fontWeight: 700, color: T.text }}>{eur(total_c)}</div>
              <div style={{ fontSize: 16, color: T.text, fontWeight: 600 }}>
                {fase === 'preparando' ? 'Mandando el importe al lector…'
                  : fase === 'cancelando' ? 'Cancelando…'
                    : 'El cliente ya puede pasar la tarjeta por el lector'}
              </div>
              {aviso && <div style={{ fontSize: 13, color: T.muted }}>{aviso}</div>}
              <button onClick={cancelar} disabled={fase !== 'esperando'}
                style={{ ...btnSecundario, height: 48, fontSize: 15, opacity: fase === 'esperando' ? 1 : 0.5 }}>
                Cancelar el cobro
              </button>
            </>
          ) : (
            <>
              <AlertTriangle size={36} color={T.danger} style={{ margin: '6px auto 0' }} />
              <div style={{ fontSize: 16, color: T.text, fontWeight: 600, lineHeight: 1.4 }}>{aviso || 'No se ha cobrado.'}</div>
              <button onClick={() => setIntento((n) => n + 1)} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
                <CreditCard size={18} style={{ marginRight: 8 }} /> Volver a intentarlo en el lector
              </button>
              {onOtraForma && (
                <button onClick={onOtraForma} style={{ ...btnSecundario, height: 48, fontSize: 14 }}>
                  {textoOtraForma}
                </button>
              )}
              {notaFallo && <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{notaFallo}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
