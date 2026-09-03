// LOS TICKETS DEL DÍA del mostrador: ver, REIMPRIMIR cualquiera y ANULAR.
//
// Hasta hoy solo se podía reimprimir "la última venta" (y vivía en memoria: al
// recargar la tablet, adiós), y un cobro equivocado se quedaba cobrado para
// siempre. Anular emite un ticket RECTIFICATIVO en serie propia (la original +
// 'R') con los importes en negativo — la serie fiscal no pierde números — y
// cancela el pedido de la venta, con lo que el almacén devuelve los
// ingredientes y la pestaña Negocio deja de contarla. Todo eso lo hace la RPC
// `tpv_anular_ticket` en el servidor; aquí solo se pide y se imprime.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { imprimirTicketTpv, impresoraConfigurada } from '../lib/printService'
import { Printer, Ban, RotateCcw } from 'lucide-react'

export default function TpvTickets({ establecimientoId, restaurante, tpvConfig, onCerrarModal }) {
  const [tickets, setTickets] = useState([])
  const [anulados, setAnulados] = useState({})   // id del original -> rectificativa
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  // Anular pide confirmación con motivo: se guarda QUÉ ticket está en ese paso.
  const [anulando, setAnulando] = useState(null)
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(async () => {
    // El día comercial empieza a las 5:00, igual que Pedidos y el informe.
    const desde = new Date()
    if (desde.getHours() < 5) desde.setDate(desde.getDate() - 1)
    desde.setHours(5, 0, 0, 0)

    const { data, error } = await supabase.from('tpv_tickets')
      .select('id, serie, numero, total, metodo_pago, emitido_at, pedido_id, rectifica_ticket_id')
      .eq('establecimiento_id', establecimientoId)
      .gte('emitido_at', desde.toISOString())
      .order('emitido_at', { ascending: false })
    if (error) { toast('No se pudieron leer los tickets: ' + error.message, 'error'); setCargando(false); return }
    const lista = data || []
    setTickets(lista)

    // Qué originales del día están anulados. La rectificativa puede ser de otro
    // día (se anula hoy lo de ayer), así que se pregunta por los ids listados.
    const ids = lista.filter((t) => !t.rectifica_ticket_id).map((t) => t.id)
    if (ids.length) {
      const { data: rects } = await supabase.from('tpv_tickets')
        .select('id, serie, numero, rectifica_ticket_id')
        .in('rectifica_ticket_id', ids)
      const m = {}
      for (const r of rects || []) m[r.rectifica_ticket_id] = r
      setAnulados(m)
    } else {
      setAnulados({})
    }
    setCargando(false)
  }, [establecimientoId])

  useEffect(() => { cargar() }, [cargar])

  // Reúne lo que hace falta para imprimir un ticket cualquiera: el pedido y sus
  // líneas. Una rectificativa no tiene pedido propio — se llega por el original.
  async function datosDeImpresion(t) {
    let pedidoId = t.pedido_id
    let anula = null
    if (t.rectifica_ticket_id) {
      const { data: orig } = await supabase.from('tpv_tickets')
        .select('serie, numero, pedido_id')
        .eq('id', t.rectifica_ticket_id).maybeSingle()
      if (orig) {
        pedidoId = orig.pedido_id
        anula = `${orig.serie}-${String(orig.numero).padStart(6, '0')}`
      }
    }
    if (!pedidoId) return { pedido: null, items: [], anula }
    const [{ data: pedido }, { data: items }] = await Promise.all([
      supabase.from('pedidos').select('id, codigo, subtotal, total, metodo_pago, created_at').eq('id', pedidoId).maybeSingle(),
      supabase.from('pedido_items').select('nombre_producto, tamano, extras, precio_unitario, cantidad, notas').eq('pedido_id', pedidoId),
    ])
    return { pedido, items: items || [], anula }
  }

  async function reimprimir(t) {
    if (!impresoraConfigurada()) { toast('No hay impresora configurada', 'error'); return }
    setOcupado(true)
    try {
      const { pedido, items, anula } = await datosDeImpresion(t)
      const r = await imprimirTicketTpv(t, pedido, items, restaurante, {
        pieTicket: tpvConfig?.pie_ticket, anula,
      })
      toast(r.ticket ? 'Ticket reimpreso' : 'La impresora no responde', r.ticket ? 'success' : 'error')
    } finally {
      setOcupado(false)
    }
  }

  async function anular() {
    const t = anulando
    if (!t || ocupado) return
    setOcupado(true)
    try {
      const { data: rect, error } = await supabase.rpc('tpv_anular_ticket', {
        p_ticket_id: t.id, p_motivo: motivo.trim() || null,
      })
      if (error) { toast(error.message, 'error'); return }
      const num = `${t.serie}-${String(t.numero).padStart(6, '0')}`
      toast(`Anulado ${num} · rectificativa ${rect.serie}-${rect.numero}`, 'success')
      setAnulando(null); setMotivo('')
      // El papel de la anulación, para grapar al original o dárselo al cliente.
      // Si la impresora falla, el ticket queda en la lista para reimprimirlo.
      if (impresoraConfigurada()) {
        const { pedido, items } = await datosDeImpresion({ ...rect, rectifica_ticket_id: t.id })
        imprimirTicketTpv(rect, pedido, items, restaurante, {
          pieTicket: tpvConfig?.pie_ticket, anula: num,
        }).catch(() => {})
      }
      cargar()
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <div style={{ padding: 20, textAlign: 'center', color: T.muted }}>Leyendo los tickets…</div>

  if (!tickets.length) {
    return (
      <div style={{ display: 'grid', gap: 10, textAlign: 'center', padding: 16 }}>
        <div style={{ color: T.muted, fontSize: 14 }}>Hoy todavía no hay ningún ticket.</div>
        {onCerrarModal && <button onClick={onCerrarModal} style={{ ...btnSecundario, height: 44 }}>Volver</button>}
      </div>
    )
  }

  // ── Paso de confirmación de la anulación ──────────────────────────────────
  if (anulando) {
    const num = `${anulando.serie}-${String(anulando.numero).padStart(6, '0')}`
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 15, color: T.text }}>Anular el ticket {num}</strong>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          Se emite una rectificativa de {eur(-cents(anulando.total))} en la serie {anulando.serie}R,
          la venta sale de las cuentas del día y, si tienes el almacén, los ingredientes vuelven.
          Si el cliente pagó en efectivo, acuérdate de devolvérselo del cajón.
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 }}>Motivo (opcional)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120}
            placeholder="Me equivoqué de importe, el cliente lo devolvió…" autoFocus style={inputOscuro} />
        </div>
        <button onClick={anular} disabled={ocupado}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: ocupado ? 0.5 : 1 }}>
          <Ban size={17} style={{ marginRight: 8 }} />
          {ocupado ? 'Anulando…' : `Anular ${num}`}
        </button>
        <button onClick={() => { setAnulando(null); setMotivo('') }} style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── La lista del día ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {tickets.map((t) => {
        const esRect = !!t.rectifica_ticket_id
        const rect = anulados[t.id]
        const num = `${t.serie}-${String(t.numero).padStart(6, '0')}`
        const hora = new Date(t.emitido_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 12, background: T.surface2,
            opacity: rect ? 0.6 : 1,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14, color: T.text, fontVariantNumeric: 'tabular-nums' }}>{num}</strong>
                <span style={{ fontSize: 12, color: T.muted }}>{hora}</span>
                <span style={{ fontSize: 12, color: T.muted }}>{t.metodo_pago === 'datafono' ? 'Tarjeta' : 'Efectivo'}</span>
                {esRect && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.danger }}>RECTIFICATIVA</span>
                )}
                {rect && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.danger }}>
                    ANULADO ({rect.serie}-{rect.numero})
                  </span>
                )}
              </div>
            </div>
            <div style={{
              fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: Number(t.total) < 0 ? T.danger : T.text, flexShrink: 0,
            }}>
              {eur(cents(t.total))}
            </div>
            <button onClick={() => reimprimir(t)} disabled={ocupado} title="Reimprimir"
              style={{ ...btnSecundario, height: 40, width: 44, padding: 0, flexShrink: 0 }}>
              <Printer size={16} />
            </button>
            {!esRect && !rect && (
              <button onClick={() => setAnulando(t)} disabled={ocupado} title="Anular"
                style={{ ...btnSecundario, height: 40, width: 44, padding: 0, flexShrink: 0, color: T.danger }}>
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        )
      })}
      {onCerrarModal && (
        <button onClick={onCerrarModal} style={{ ...btnSecundario, height: 44, marginTop: 4 }}>Seguir vendiendo</button>
      )}
    </div>
  )
}
