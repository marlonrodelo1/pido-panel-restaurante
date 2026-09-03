import { useState, useEffect } from 'react'
import { CircleHelp } from 'lucide-react'
import { colors, ds, type } from '../../lib/uiStyles'
import { toast } from '../../App'
import { eur, resumenNegocio } from '../../lib/stock'

// El resumen de Contabilidad: entró − salió = te quedó.
//
// "Entró" es lo que pasa por Pidoo — TPV, app, tienda pública, QR de mesa y
// teléfono — con la comisión ya descontada. Lo que se cobre fuera del TPV aquí no
// existe, y se dice en pantalla: una vista que calla sus puntos ciegos es una vista
// en la que no se puede confiar.
//
// "Salió" son las compras CONTABILIZADAS (por fecha de factura: criterio de caja)
// desglosadas por familia — cuánto en comida, cuánto en envases, cuánto en aseo —
// más los gastos apuntados (fijos y sueltos, por categoría). La merma se enseña
// aparte y NO se suma: ya está dentro de las compras.
//
// Todos los criterios viven comentados en `stock_resumen_negocio` en base de datos.

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Nada de toISOString(): recorta en UTC y a medianoche canaria caería en el día
// anterior. El lunes abre la semana, como el corte de Pidoo.
function rango(periodo) {
  const hoy = new Date()
  if (periodo === 'hoy') return { desde: fmt(hoy), hasta: fmt(hoy) }
  if (periodo === 'semana') {
    const d = new Date(hoy)
    d.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
    return { desde: fmt(d), hasta: fmt(hoy) }
  }
  if (periodo === 'mes') {
    return { desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fmt(hoy) }
  }
  return {
    desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
    hasta: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
  }
}

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesPasado', label: 'Mes pasado' },
]

export default function ResumenTab({ estId, onIrA }) {
  const [periodo, setPeriodo] = useState('mes')
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    const { desde, hasta } = rango(periodo)
    resumenNegocio(estId, desde, hasta)
      .then(res => { if (vivo) setDatos(res) })
      .catch(e => { if (vivo) toast('No se ha podido cargar el resumen: ' + e.message, 'error') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [estId, periodo])

  const v = datos?.ventas || {}
  const salio = Number(datos?.compras?.total || 0) + Number(datos?.gastos?.total || 0)
  const resultado = Number(datos?.resultado || 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PERIODOS.map(p => (
          <button key={p.id} onClick={() => setPeriodo(p.id)} style={{
            ...ds.filterBtn, height: 32,
            background: periodo === p.id ? colors.primary : colors.paper,
            color: periodo === p.id ? colors.cream : colors.textDim,
            borderColor: periodo === p.id ? colors.primary : colors.border,
            fontWeight: periodo === p.id ? 700 : 600,
          }}>
            {p.label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Echando cuentas…</div>
      ) : (
        <>
          <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Grande label="Entró" valor={eur(v.neto)}
              pie={`${v.pedidos === 1 ? '1 pedido' : `${v.pedidos || 0} pedidos`}, comisión ya descontada`} />
            <Grande label="Salió" valor={eur(salio)} pie="Compras contabilizadas + gastos" />
            <Grande
              label="Te quedó" valor={eur(resultado)}
              tono={resultado > 0 ? 'sage' : resultado < 0 ? 'danger' : null}
              pie="Entró menos salió"
            />
          </div>

          <div style={{
            display: 'grid', gap: 14, marginTop: 14, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          }}>
            <div style={{ ...ds.card, padding: 18 }}>
              <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 10 }}>
                Lo que entró
              </div>
              <Linea label="Vendido (productos)" valor={eur(v.vendido)} />
              {Number(v.descuentos) > 0 && (
                <Linea label="Descuentos que regalaste" valor={'− ' + eur(v.descuentos)} />
              )}
              <Linea label="Comisión de Pidoo" valor={'− ' + eur(v.comision_pidoo)} />
              <Linea label="Tuyo" valor={eur(v.neto)} fuerte />
              <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 10, lineHeight: 1.5 }}>
                Cuenta lo que pasa por Pidoo: mostrador (TPV), app, tienda, mesa y teléfono.
                El envío y la propina no son tuyos (van al reparto) y no se cuentan.
                Lo que se cobre fuera del TPV, aquí no existe.
              </div>
            </div>

            <div style={{ ...ds.card, padding: 18 }}>
              <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 10 }}>
                Lo que salió
              </div>
              <Linea
                label={`Compras a proveedor (${datos?.compras?.facturas || 0} facturas)`}
                valor={eur(datos?.compras?.total)}
                accion={onIrA ? () => onIrA('facturas') : null}
              />
              {/* El desglose por familia responde a "¿cuánto se me fue en comida, en
                  envases, en aseo?" sin sacar los desechables del almacén. */}
              {(datos?.compras?.por_familia || []).map(f => (
                <div key={f.familia} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12,
                  padding: '3px 0 3px 16px', fontSize: type.xs, color: colors.textMute,
                }}>
                  <span>{f.familia}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{eur(f.total)}</span>
                </div>
              ))}
              <Linea
                label="Gastos (fijos y sueltos)"
                valor={eur(datos?.gastos?.total)}
                accion={onIrA ? () => onIrA('gastos') : null}
              />
              {(datos?.gastos?.por_categoria || []).map(g => (
                <div key={g.categoria} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12,
                  padding: '3px 0 3px 16px', fontSize: type.xs, color: colors.textMute,
                }}>
                  <span>{g.categoria}{g.apuntes > 1 ? ` (${g.apuntes})` : ''}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{eur(g.total)}</span>
                </div>
              ))}
              <Linea label="Total" valor={eur(salio)} fuerte />
              {Number(datos?.merma?.total) > 0 && (
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10,
                  fontSize: type.xs, color: colors.textMute, lineHeight: 1.5,
                }}>
                  <CircleHelp size={14} color={colors.warning} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    Además tiraste <strong>{eur(datos.merma.total)}</strong> en mermas.
                    No se suman aquí: ese dinero ya está dentro de las compras.
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Grande({ label, valor, pie, tono }) {
  const color = tono === 'sage' ? colors.sage : tono === 'danger' ? colors.danger : colors.text
  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ fontSize: type.xs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </div>
      {pie && <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 4 }}>{pie}</div>}
    </div>
  )
}

function Linea({ label, valor, fuerte, accion }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0',
      borderTop: fuerte ? `1px solid ${colors.border}` : 'none',
      marginTop: fuerte ? 6 : 0,
    }}>
      {accion ? (
        <button onClick={accion} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: colors.primary, fontSize: type.sm, fontWeight: 600, textAlign: 'left',
          fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3,
        }}>
          {label}
        </button>
      ) : (
        <span style={{ fontSize: type.sm, color: fuerte ? colors.text : colors.textDim, fontWeight: fuerte ? 700 : 500 }}>
          {label}
        </span>
      )}
      <span style={{
        fontSize: type.sm, fontWeight: fuerte ? 800 : 600, color: colors.text,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {valor}
      </span>
    </div>
  )
}
