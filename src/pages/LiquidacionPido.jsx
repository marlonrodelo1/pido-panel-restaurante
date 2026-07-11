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

export default function LiquidacionPido() {
  const { restaurante } = useRest()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

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
  }, [restaurante?.id])

  const pendientePido = rows.filter(r => r.direccion === 'pido_paga' && r.estado === 'pendiente').reduce((s, r) => s + Number(r.neto_a_pagar || 0), 0)
  const pendienteDebes = rows.filter(r => r.direccion === 'restaurante_paga' && r.estado === 'pendiente').reduce((s, r) => s + Math.abs(Number(r.neto_a_pagar || 0)), 0)

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ ...ds.h1, margin: 0 }}>Liquidación con Pido</h2>
        <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4, lineHeight: 1.5, maxWidth: 680 }}>
          Cada lunes calculamos tu corte: te enviamos el 90% de tus ventas (descontando lo cobrado en efectivo) y nuestra comisión del 10%. Si cobraste mucho en efectivo, la diferencia la pagas tú.
        </div>
      </div>

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
