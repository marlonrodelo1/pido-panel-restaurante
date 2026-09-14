import { useState, useEffect } from 'react'
import { CircleHelp, Target } from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast } from '../../App'
import { eur, resumenNegocio, puntoEquilibrio } from '../../lib/stock'

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
function fechaLarga(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
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
  // El reparto es un gasto de cada pedido: lo que se le paga al socio menos el envío y la
  // propina que ya pagó el cliente (ver `stock_resumen_negocio`).
  const reparto = datos?.reparto || {}
  const salio = Number(datos?.compras?.total || 0) + Number(datos?.gastos?.total || 0) + Number(reparto.neto || 0)
  const resultado = Number(datos?.resultado || 0)
  // La utilidad real del periodo: comida neta − género que salió del almacén − reparto que asume
  // el local. «Te quedó» no descuenta el género (las compras cuentan el día que se pagan).
  const g = datos?.ganancia || {}
  const ganancia = Number(g.total || 0)
  // Lo que queda de verdad: ganancia − fijos repartidos por días − gastos sueltos del periodo.
  const b = datos?.beneficio || {}
  const beneficio = Number(b.total || 0)

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
          {/* La contabilidad puede empezar un día concreto (`stock_config.contabilidad_desde`):
              lo anterior no suma en ningún periodo. Se dice arriba para que nadie lo busque. */}
          {datos?.contabilidad_desde && (
            <div style={{ ...ds.muted, fontSize: type.xs, marginBottom: 12 }}>
              Contando desde el {fechaLarga(datos.contabilidad_desde)}: lo anterior no suma aquí.
            </div>
          )}
          <MetaMes estId={estId} />

          <div className="ds-cards" style={{ display: 'grid', gap: 12, marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Grande label="Entró" valor={eur(v.neto)}
              pie={`${v.pedidos === 1 ? '1 pedido' : `${v.pedidos || 0} pedidos`}, comisión ya descontada`} />
            <Grande label="Salió" valor={eur(salio)} pie="Compras + gastos + reparto" />
            <Grande
              label="Te quedó" valor={eur(resultado)}
              tono={resultado > 0 ? 'sage' : resultado < 0 ? 'danger' : null}
              pie="Entró menos salió (no descuenta el género)"
            />
            <Grande
              label="Ganancia" valor={eur(ganancia)}
              tono={ganancia > 0 ? 'sage' : ganancia < 0 ? 'danger' : null}
              pie="Comida − género − reparto"
            />
            <Grande
              label="Beneficio" valor={eur(beneficio)}
              tono={beneficio > 0 ? 'sage' : beneficio < 0 ? 'danger' : null}
              pie="Ganancia − gastos fijos y sueltos"
            />
          </div>

          {datos?.ganancia && (
            <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.5 }}>
              Ganancia: comida neta {eur(g.comida_neta)} − género que salió del almacén {eur(g.genero)}
              {' '}− reparto que asumes {eur(g.reparto)} = <strong>{eur(ganancia)}</strong>.
              {Number(g.genero_estimado) > 0 && ` ${eur(g.genero_estimado)} del género se ha calculado con la receta de hoy (ventas de antes de contar el inventario).`}
              {Number(g.vendido_sin_coste) > 0 && ` Ojo: ${eur(g.vendido_sin_coste)} vendidos no tienen receta y cuentan sin coste.`}
            </div>
          )}
          {datos?.beneficio && (
            <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 4, lineHeight: 1.5 }}>
              Beneficio: ganancia {eur(b.ganancia)} − gastos fijos de {b.dias === 1 ? '1 día' : `${b.dias || 0} días`} {eur(b.fijos_periodo)}
              {' '}− gastos sueltos {eur(b.gastos_sueltos)} = <strong>{eur(beneficio)}</strong>.
              {' '}Los fijos ({eur(b.fijos_mes)} al mes) se reparten por días para que ningún día cargue con el alquiler o los sueldos enteros.
            </div>
          )}

          <div style={{
            display: 'grid', gap: 14, marginTop: 14, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          }}>
            <div style={{ ...ds.card, padding: 18 }}>
              <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 10 }}>
                Lo que entró
              </div>
              <Linea label="Vendido (productos)" valor={eur(v.vendido)} />
              {/* Por dónde entró cada euro: mostrador, web, teléfono, mesa. */}
              {(v.por_via || []).map(x => (
                <Sub key={x.via} label={`${x.via} (${x.pedidos})`} valor={eur(x.vendido)} />
              ))}
              {Number(v.descuentos) > 0 && (
                <Linea label="Descuentos que regalaste" valor={'− ' + eur(v.descuentos)} />
              )}
              <Linea label="Comisión de Pidoo" valor={'− ' + eur(v.comision_pidoo)} />
              <Linea label="Tuyo" valor={eur(v.neto)} fuerte />
              {(v.por_pago || []).length > 0 && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                  {v.por_pago.map(x => (
                    <span key={x.pago} style={{ ...ds.badge, background: colors.surface2, color: colors.textDim, border: `1px solid ${colors.border}` }}>
                      {x.pago}: {eur(x.vendido)}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 10, lineHeight: 1.5 }}>
                Cobrado en total, con envíos y propinas: <strong>{eur(v.cobrado_total)}</strong>.
                Tiene que coincidir con la suma de tus cierres de caja (Z) del periodo.
              </div>
              <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 6, lineHeight: 1.5 }}>
                Cuenta lo que pasa por Pidoo: mostrador (TPV), app, tienda, mesa y teléfono.
                Aquí va la comida; el envío y la propina se descuentan en el reparto.
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
              {/* Fijos y pagos de una vez, SEPARADOS: el depósito del local parecía
                  un fijo más y Marlon preguntó (con razón) por qué. */}
              <Linea
                label="Gastos fijos del mes"
                valor={eur(datos?.gastos?.fijos)}
                accion={onIrA ? () => onIrA('gastos') : null}
              />
              {(datos?.gastos?.por_categoria || []).filter(g => g.fijo).map(g => (
                <Sub key={'f' + g.categoria} label={g.categoria + (g.apuntes > 1 ? ` (${g.apuntes})` : '')} valor={eur(g.total)} />
              ))}
              {Number(datos?.gastos?.sueltos) > 0 && (
                <>
                  <Linea label="Pagos de una sola vez" valor={eur(datos?.gastos?.sueltos)} />
                  {(datos?.gastos?.por_categoria || []).filter(g => !g.fijo).map(g => (
                    <Sub key={'s' + g.categoria} label={g.categoria + (g.apuntes > 1 ? ` (${g.apuntes})` : '')} valor={eur(g.total)} />
                  ))}
                </>
              )}
              {Number(reparto.repartos) > 0 && (
                <>
                  <Linea label={`Reparto del socio (${reparto.repartos} repartos)`} valor={eur(reparto.neto)} />
                  <Sub label="Le pagas al socio" valor={eur(reparto.pagado_socio)} />
                  <Sub label="Envíos y propinas que pagó el cliente"
                    valor={'− ' + eur(Number(reparto.envios_cliente || 0) + Number(reparto.propinas_cliente || 0))} />
                </>
              )}
              <Linea label="Total" valor={eur(salio)} fuerte />
              {(datos?.gastos?.fuera_resultado || []).map((g, i) => (
                <div key={'fuera' + i} style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.5 }}>
                  {g.categoria} de {eur(g.importe)}: apuntado, pero no cuenta como gasto (es dinero que se recupera).
                </div>
              ))}
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

// LA META DEL MES, como la pidió Marlon: los fijos son la meta, y lo que la llena
// no es lo vendido sino LO QUE LA VENTA DEJA — la ganancia según escandallo (lo
// vendido neto menos el género y menos el reparto del socio). En rojo mientras falte,
// en verde cuando los fijos estén cubiertos y empiece el beneficio. El género es el
// coste real del almacén; lo vendido antes de tener receta se valora con la receta de
// hoy y se dice cuánto es estimado. Lo que no tiene receta cuenta sin coste, avisando.
function MetaMes({ estId }) {
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    puntoEquilibrio(estId)
      .then(r => { if (vivo) setD(r) })
      .catch(() => { if (vivo) setD(false) })
    return () => { vivo = false }
  }, [estId])

  if (!d) return null

  const fijos = Number(d.fijos_mes)
  // Si la contabilidad empezó a mitad de mes, la meta es la parte proporcional de los fijos.
  const fijosCompletos = Number(d.fijos_mes_completo ?? d.fijos_mes)
  const desdeMitad = !!d.desde && Number(String(d.desde).slice(8, 10)) > 1
  const desdeTxt = d.desde ? fechaLarga(d.desde) : ''
  const vendido = Number(d.vendido_mes)
  const neto = Number(d.neto_mes)
  const costeVendido = Number(d.coste_vendido_mes || 0)
  const costeEstimado = Number(d.coste_estimado_mes || 0)
  const sinCoste = Number(d.vendido_sin_coste_mes || 0)
  const repartoNeto = Number(d.reparto_neto_mes || 0)

  // La ganancia del mes = lo que entró (sin comisión) − el género − el reparto del socio.
  const ganancia = neto - costeVendido - repartoNeto
  const gananciaEtiqueta = 'comida neta − género − reparto'

  if (fijos <= 0) {
    return (
      <div style={{ ...ds.card, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={16} color={colors.primary} />
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>La meta del mes</div>
        </div>
        <div style={{ ...ds.muted, fontSize: type.sm, marginTop: 8, lineHeight: 1.5 }}>
          Añade tus gastos fijos (pestaña Gastos) y aquí verás cuánto te falta cada día
          para cubrirlos.
        </div>
      </div>
    )
  }

  const pct = Math.max(0, Math.min(ganancia / fijos, 1))
  const cubierta = ganancia >= fijos
  const color = cubierta ? colors.sage : colors.danger

  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={16} color={colors.primary} />
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
            {desdeMitad
              ? `La meta desde el ${desdeTxt}: ${eur(fijos)} de ganancia`
              : `La meta del mes: ${eur(fijos)} de ganancia (tus fijos)`}
            {desdeMitad && fijosCompletos > fijos && (
              <span style={{ ...ds.muted, fontSize: type.xs, fontWeight: 500, marginLeft: 6 }}>
                (la parte de los días que quedan; el mes entero son {eur(fijosCompletos)})
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: type.sm, fontWeight: 800, color }}>
          {cubierta
            ? `Meta cubierta · +${eur(ganancia - fijos)} de beneficio`
            : `Te faltan ${eur(fijos - ganancia)}`}
        </div>
      </div>

      <div style={{ marginTop: 12, height: 14, borderRadius: 999, background: colors.surface2, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, transition: 'width .3s' }} />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: type.sm, color: colors.textDim }}>
        <span>{desdeMitad ? `Vendido desde el ${desdeTxt}` : 'Vendido este mes'}: <strong style={{ color: colors.text }}>{eur(vendido)}</strong> brutos ({d.pedidos_mes} pedidos)</span>
        <span>→ ganancia: <strong style={{ color: colors.text }}>{eur(ganancia)}</strong> <span style={{ color: colors.textMute }}>({gananciaEtiqueta})</span></span>
        {!cubierta && vendido > 0 && ganancia > 0 && (
          <span style={{ color: colors.textMute }}>
            ≈ te queda por vender {eur((fijos - ganancia) / (ganancia / vendido))} brutos
          </span>
        )}
      </div>

      <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.5 }}>
        Comida neta {eur(neto)} − género {eur(costeVendido)} − reparto del socio {eur(repartoNeto)} = {eur(ganancia)}.
        {costeEstimado > 0 && ` De ese género, ${eur(costeEstimado)} es de ventas de antes de tener las recetas y se ha calculado con la receta de hoy.`}
      </div>
      {sinCoste > 0 && (
        <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 4, lineHeight: 1.5 }}>
          ⚠️ {eur(sinCoste)} vendidos no tienen receta (platos sin receta o importes libres del TPV):
          cuentan como si no costaran nada.
        </div>
      )}
    </div>
  )
}

function Sub({ label, valor }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12,
      padding: '3px 0 3px 16px', fontSize: type.xs, color: colors.textMute,
    }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{valor}</span>
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
