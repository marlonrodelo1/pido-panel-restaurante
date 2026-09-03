import { useState, useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast } from '../../App'
import { eur, eurCoste, rentabilidadPlatos } from '../../lib/stock'

// Rentabilidad por plato: en cuáles ganas y en cuáles casi pierdes. El coste sale
// de la receta (escandallo) al coste medio ACTUAL de los artículos; los vendidos,
// de los pedidos reales del periodo (todas las puertas). Un plato sin receta no
// tiene margen que enseñar — y se dice, no se disimula con un cero.

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function rango(periodo) {
  const hoy = new Date()
  if (periodo === 'mes') return { desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fmt(hoy) }
  return {
    desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
    hasta: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
  }
}

const ORDENES = [
  { id: 'vendidos', label: 'Más vendidos' },
  { id: 'margen', label: 'Más margen' },
  { id: 'peor', label: 'Peor margen' },
]

export default function PlatosTab({ estId }) {
  const [periodo, setPeriodo] = useState('mes')
  const [orden, setOrden] = useState('vendidos')
  const [platos, setPlatos] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    const { desde, hasta } = rango(periodo)
    rentabilidadPlatos(estId, desde, hasta)
      .then(r => { if (vivo) setPlatos(r) })
      .catch(e => { if (vivo) { toast(e.message, 'error'); setPlatos([]) } })
    return () => { vivo = false }
  }, [estId, periodo])

  if (platos === null) {
    return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Echando cuentas…</div>
  }

  const sinReceta = platos.filter(p => p.coste == null)
  const filas = platos.map(p => {
    const precio = Number(p.precio)
    const coste = p.coste == null ? null : Number(p.coste)
    const margen = coste == null ? null : precio - coste
    const pct = coste == null || precio <= 0 ? null : margen / precio
    // Lo que ese plato ha aportado de verdad: sus ingresos reales menos su coste.
    const aporte = coste == null ? null : Number(p.ingresos) - Number(p.vendidos) * coste
    return { ...p, precio, coste, margen, pct, aporte }
  })

  const ordenadas = [...filas].sort((a, b) => {
    if (orden === 'vendidos') return b.vendidos - a.vendidos || a.nombre.localeCompare(b.nombre)
    if (orden === 'margen') return (b.margen ?? -1e9) - (a.margen ?? -1e9)
    return (a.margen ?? 1e9) - (b.margen ?? 1e9)
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[{ id: 'mes', label: 'Este mes' }, { id: 'mesPasado', label: 'Mes pasado' }].map(p => (
          <button key={p.id} onClick={() => setPeriodo(p.id)} style={{
            ...ds.filterBtn, height: 32,
            background: periodo === p.id ? colors.primary : colors.paper,
            color: periodo === p.id ? colors.cream : colors.textDim,
            borderColor: periodo === p.id ? colors.primary : colors.border,
            fontWeight: periodo === p.id ? 700 : 600,
          }}>{p.label}</button>
        ))}
        <span style={{ width: 10 }} />
        {ORDENES.map(o => (
          <button key={o.id} onClick={() => setOrden(o.id)} style={{
            ...ds.filterBtn, height: 32,
            background: orden === o.id ? colors.ink : colors.paper,
            color: orden === o.id ? colors.cream : colors.textDim,
            borderColor: orden === o.id ? colors.ink : colors.border,
            fontWeight: orden === o.id ? 700 : 600,
          }}>{o.label}</button>
        ))}
      </div>

      {sinReceta.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14,
          padding: '10px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
        }}>
          <TriangleAlert size={16} color={colors.warning} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5 }}>
            <strong>{sinReceta.length} de {platos.length} platos sin receta</strong>: de esos
            no se puede saber el margen. Se arregla en Almacén → Escandallos, plato a plato.
          </div>
        </div>
      )}

      <div style={{ ...ds.table, ...tablaScroll }}>
        <div style={{ ...ds.tableHeader, ...filaMin(760) }}>
          <div style={{ flex: 1, minWidth: 0 }}>Plato</div>
          <div style={col(76)}>Vendidos</div>
          <div style={col(84)}>Precio</div>
          <div style={col(90)}>Te cuesta</div>
          <div style={col(90)}>Margen</div>
          <div style={col(64)}>%</div>
          <div style={col(110)}>Te ha dejado</div>
        </div>
        {ordenadas.map(p => (
          <div key={p.id} style={{ ...ds.tableRow, ...filaMin(760), opacity: p.disponible ? 1 : 0.5 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontSize: type.sm, fontWeight: 600, color: colors.text,
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.nombre}
              </span>
              {(!p.disponible || p.coste == null) && (
                <span style={{ ...ds.muted, fontSize: type.xxs }}>
                  {[!p.disponible && 'apagado', p.coste == null && 'sin receta'].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <div style={{ ...col(76), fontWeight: 700 }}>{p.vendidos}</div>
            <div style={col(84)}>{eur(p.precio)}</div>
            <div style={{ ...col(90), color: colors.textMute }}>{p.coste == null ? '—' : eurCoste(p.coste)}</div>
            <div style={{
              ...col(90), fontWeight: 700,
              color: p.margen == null ? colors.textMute : p.margen <= 0 ? colors.danger : colors.text,
            }}>
              {p.margen == null ? '—' : eur(p.margen)}
            </div>
            <div style={{
              ...col(64), fontWeight: 600,
              color: p.pct == null ? colors.textMute : p.pct < 0.5 ? colors.warning : colors.sage,
            }}>
              {p.pct == null ? '—' : Math.round(p.pct * 100) + '%'}
            </div>
            <div style={{ ...col(110), fontWeight: 600 }}>{p.aporte == null ? '—' : eur(p.aporte)}</div>
          </div>
        ))}
      </div>

      <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 10, lineHeight: 1.5 }}>
        "Te cuesta" es la receta del plato al precio actual de tus artículos. "Te ha
        dejado" son sus ventas reales del periodo menos su coste. La comisión de Pidoo
        (solo en lo que entra por la app) no está restada aquí: se resta en el Resumen.
      </div>
    </div>
  )
}
