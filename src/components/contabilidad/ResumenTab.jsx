import { useState, useEffect } from 'react'
import { CircleHelp, Target, ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import { colors, ds, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast } from '../../App'
import { eur, resumenNegocio, puntoEquilibrio, diasContables } from '../../lib/stock'

// «CÓMO VA»: la semana o el mes de un vistazo (pestaña Resumen de Contabilidad).
//
// Arriba solo tres cifras (15 sep 2026, Marlon: «lo veo muy enredado»):
//   VENDISTE          lo cobrado, lo mismo que suman los cierres de caja
//   GANASTE           vendido − repartidores − ingredientes − comisión
//   BENEFICIO LIMPIO  lo ganado − la parte del periodo de alquiler, sueldos… − gastos sueltos
// Debajo, la meta del mes y el DÍA A DÍA (un renglón por día; se toca y se abre ese día).
//
// El «entró − salió = te quedó» de siempre sigue, plegado en «Ver de dónde sale cada euro»:
// sirve para cuadrar con los cierres de caja, no para saber si se gana dinero.
//
// Todos los criterios viven comentados en `stock_resumen_negocio` en base de datos. Lo que
// no se vende por Pidoo (TPV, app, tienda, mesa, teléfono) aquí no existe, y se dice.

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fechaLarga(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
}
// HOY es el día de Canarias, el mismo que usa la base de datos: con el reloj del navegador,
// un móvil en hora peninsular pediría entre las 23:00 y las 24:00 el día (o el mes) siguiente
// y las tarjetas dejarían de cuadrar con la meta. Nada de toISOString(): recorta en UTC.
// El lunes abre la semana, como el corte de Pidoo.
function hoyCanarias() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Atlantic/Canary', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date())
      .map(x => [x.type, x.value])
  )
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day))
}
function rango(periodo) {
  const hoy = hoyCanarias()
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

// «Hoy» vive en la pestaña El día.
const PERIODOS = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesPasado', label: 'Mes pasado' },
]

export default function ResumenTab({ estId, onIrA, onIrADia, recarga }) {
  const [periodo, setPeriodo] = useState('mes')
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [verDetalle, setVerDetalle] = useState(false)
  const { desde, hasta } = rango(periodo)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    const r = rango(periodo)
    resumenNegocio(estId, r.desde, r.hasta)
      .then(res => { if (vivo) setDatos(res) })
      .catch(e => { if (vivo) toast('No se ha podido cargar el resumen: ' + e.message, 'error') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [estId, periodo, recarga])

  const v = datos?.ventas || {}
  // El reparto es un gasto de cada pedido: lo que se le paga al socio menos el envío y la
  // propina que ya pagó el cliente (ver `stock_resumen_negocio`).
  const reparto = datos?.reparto || {}
  const salio = Number(datos?.compras?.total || 0) + Number(datos?.gastos?.total || 0) + Number(reparto.neto || 0)
  const resultado = Number(datos?.resultado || 0)
  const g = datos?.ganancia || {}
  const ganancia = Number(g.total || 0)
  const b = datos?.beneficio || {}
  const beneficio = Number(b.total || 0)

  // La cuenta de «Ganaste» con cifras que se reconocen: lo cobrado (lo del cierre de caja),
  // lo que se le paga al repartidor entero, los ingredientes y la comisión. Da lo mismo que
  // «comida neta − género − reparto neto»; si algo no encaja (un envío sin socio, un
  // redondeo) sale como «otros» para que la cuenta sume exacta a la vista.
  const vendido = Number(v.cobrado_total || 0)
  const repartidor = Number(reparto.pagado_socio || 0)
  const ingredientes = Number(g.genero || 0)
  const comision = Number(v.comision_pidoo || 0)
  const otros = Math.round((vendido - repartidor - ingredientes - comision - ganancia) * 100) / 100

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PERIODOS.map(p => (
          <button key={p.id} onClick={() => setPeriodo(p.id)} style={{
            ...ds.filterBtn, height: 34,
            background: periodo === p.id ? colors.ink : colors.paper,
            color: periodo === p.id ? colors.cream : colors.textDim,
            borderColor: periodo === p.id ? colors.ink : colors.border,
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

          <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <Grande label="Vendiste" valor={eur(vendido)}
              pie={`${v.pedidos === 1 ? '1 pedido' : `${v.pedidos || 0} pedidos`} · lo que suman tus cierres de caja`} />
            <Grande
              label={ganancia < 0 ? 'Perdiste' : 'Ganaste'} valor={eur(Math.abs(ganancia))}
              tono={ganancia > 0 ? 'sage' : ganancia < 0 ? 'danger' : null}
              pie="Lo vendido menos repartidores, ingredientes y comisión"
            />
            <Grande
              label={beneficio < 0 ? 'Te faltó' : 'Beneficio limpio'} valor={eur(Math.abs(beneficio))}
              tono={beneficio > 0 ? 'sage' : beneficio < 0 ? 'danger' : null}
              pie={beneficio < 0
                ? 'Lo que no llegó a cubrir alquiler, sueldos y demás gastos'
                : 'Lo que queda después de alquiler, sueldos y demás gastos'}
            />
          </div>

          {datos?.ganancia && (
            <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.6 }}>
              <strong>Ganaste:</strong> vendiste {eur(vendido)}
              {repartidor > 0 && <> − repartidores {eur(repartidor)}</>}
              {' '}− ingredientes {eur(ingredientes)}
              {comision > 0 && <> − comisión {eur(comision)}</>}
              {Math.abs(otros) >= 0.01 && <> {otros > 0 ? '−' : '+'} otros {eur(Math.abs(otros))}</>}
              {' '}= <strong style={{ whiteSpace: 'nowrap' }}>{eur(ganancia)}</strong>.
              {Number(g.vendido_sin_coste) > 0 && ` Ojo: ${eur(g.vendido_sin_coste)} vendidos no tienen receta y cuentan sin ingredientes.`}
            </div>
          )}
          {datos?.beneficio && (
            <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 2, lineHeight: 1.6 }}>
              <strong>Beneficio:</strong> ganaste {eur(b.ganancia)} − gastos fijos de {b.dias === 1 ? '1 día' : `${b.dias || 0} días`} {eur(b.fijos_periodo)}
              {Number(b.gastos_sueltos) > 0 && <> − gastos sueltos {eur(b.gastos_sueltos)}</>}
              {' '}= <strong style={{ whiteSpace: 'nowrap' }}>{eur(beneficio)}</strong>. Tus fijos ({eur(b.fijos_mes)} al mes) se reparten entre los días del mes.
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <MetaMes estId={estId} recarga={`${periodo}-${recarga}`} />
          </div>

          <DiaADia estId={estId} desde={desde} hasta={hasta} recarga={recarga} onIrADia={onIrADia} />

          <button onClick={() => setVerDetalle(x => !x)} style={{ ...ds.secondaryBtn, marginTop: 14, height: 36 }}>
            {verDetalle ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {verDetalle ? 'Ocultar el detalle' : 'Ver de dónde sale cada euro'}
          </button>

          {verDetalle && (
            <>
              <div style={{ ...ds.card, padding: 16, marginTop: 12, fontSize: type.sm, color: colors.textDim, lineHeight: 1.6 }}>
                <strong style={{ color: colors.text }}>El dinero que entró y salió:</strong> entró {eur(v.neto)} − salió {eur(salio)}
                {' '}= <strong style={{ color: resultado < 0 ? colors.danger : colors.text }}>te quedó {eur(resultado)}</strong>.
                {' '}Aquí las compras cuentan el día que se pagan (no cuando se gastan), así que un mes con una compra grande
                puede salir en negativo aunque estés ganando.
              </div>

              <div style={{
                display: 'grid', gap: 14, marginTop: 12, alignItems: 'start',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))',
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
                    label={`Compras a proveedor (${datos?.compras?.facturas || 0})`}
                    valor={eur(datos?.compras?.total)}
                    accion={onIrA ? () => onIrA('facturas') : null}
                  />
                  {/* El desglose por familia responde a "¿cuánto se me fue en comida, en
                      envases, en aseo?" sin sacar los desechables del almacén. */}
                  {(datos?.compras?.por_familia || []).map(f => (
                    <Sub key={f.familia} label={f.familia} valor={eur(f.total)} />
                  ))}
                  {/* Fijos y pagos de una vez, SEPARADOS: el depósito del local parecía
                      un fijo más y Marlon preguntó (con razón) por qué. */}
                  <Linea
                    label="Gastos fijos apuntados"
                    valor={eur(datos?.gastos?.fijos)}
                    accion={onIrA ? () => onIrA('gastos') : null}
                  />
                  {(datos?.gastos?.por_categoria || []).filter(x => x.fijo).map(x => (
                    <Sub key={'f' + x.categoria} label={x.categoria + (x.apuntes > 1 ? ` (${x.apuntes})` : '')} valor={eur(x.total)} />
                  ))}
                  {Number(datos?.gastos?.sueltos) > 0 && (
                    <>
                      <Linea label="Pagos de una sola vez" valor={eur(datos?.gastos?.sueltos)} />
                      {(datos?.gastos?.por_categoria || []).filter(x => !x.fijo).map(x => (
                        <Sub key={'s' + x.categoria} label={x.categoria + (x.apuntes > 1 ? ` (${x.apuntes})` : '')} valor={eur(x.total)} />
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
                  {(datos?.gastos?.fuera_resultado || []).map((x, i) => (
                    <div key={'fuera' + i} style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.5 }}>
                      {x.categoria} de {eur(x.importe)}: apuntado, pero no cuenta como gasto (es dinero que se recupera).
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
        </>
      )}
    </div>
  )
}

// EL DÍA A DÍA: un renglón por día con lo vendido, lo ganado y lo que quedó tras la parte del
// día de los gastos fijos. Responde a «¿cuánto gano cada día?» sin abrir día por día, y un
// toque abre ese día entero en la pestaña El día.
function DiaADia({ estId, desde, hasta, recarga, onIrADia }) {
  const [dias, setDias] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    setDias(null)
    diasContables(estId, desde, hasta)
      .then(r => { if (vivo) setDias(r || []) })
      .catch(() => { if (vivo) setDias(false) })
    return () => { vivo = false }
  }, [estId, desde, hasta, recarga])

  if (dias === null) {
    return <div style={{ ...ds.card, padding: 18, marginTop: 14, ...ds.muted }}>Cargando el día a día…</div>
  }
  if (dias === false) {
    return <div style={{ ...ds.card, padding: 18, marginTop: 14, ...ds.muted }}>No se ha podido cargar el día a día. Recarga la página.</div>
  }
  if (!dias.length) return null

  const tope = Math.max(1, ...dias.map(x => Number(x.vendido)), ...dias.map(x => Number(x.fijos) + Number(x.sueltos)))
  const buenos = dias.filter(x => Number(x.beneficio) >= 0).length
  const filas = [...dias].reverse()

  return (
    <div style={{ ...ds.card, padding: 18, marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>Día a día</div>
        <div style={{ fontSize: type.sm, color: colors.textMute }}>
          {buenos} de {dias.length} {dias.length === 1 ? 'día pagó' : 'días pagaron'} sus gastos fijos
        </div>
      </div>

      <div style={tablaScroll}>
        {/* Estrecho a propósito: en el móvil «Ganaste» y «Tras fijos» son lo que importa y no
            pueden quedar escondidos a la derecha. La barra es la que cede sitio. */}
        <div style={{ ...ds.tableHeader, ...filaMin(320), background: 'transparent', padding: '6px 4px', gap: 8 }}>
          <span style={col(50, 'left')}>Día</span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <span style={col(70)}>Vendiste</span>
          <span style={col(70)}>Ganaste</span>
          <span style={col(80)}>Tras fijos</span>
        </div>
        {filas.map(x => {
          const vendido = Number(x.vendido)
          const ganancia = Number(x.ganancia)
          const meta = Number(x.fijos) + Number(x.sueltos)
          const benef = Number(x.beneficio)
          return (
            <button key={x.fecha} onClick={() => onIrADia?.(x.fecha)} title="Ver este día entero" style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', ...filaMin(320),
              padding: '8px 4px', border: 'none', borderBottom: `1px solid ${colors.border}`,
              background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}>
              <span style={{ ...col(50, 'left'), fontSize: type.sm, fontWeight: 600, color: colors.text, textTransform: 'capitalize' }}>
                {new Date(x.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}
              </span>
              <span style={{ flex: 1, minWidth: 0, position: 'relative', height: 14 }}>
                <span style={{ position: 'absolute', inset: '3px 0', borderRadius: 999, background: colors.surface2 }} />
                <span style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${Math.min(vendido / tope, 1) * 100}%`, borderRadius: 999, background: colors.borderStrong }} />
                {ganancia > 0 && (
                  <span style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${Math.min(ganancia / tope, 1) * 100}%`, borderRadius: 999, background: colors.sage }} />
                )}
                {meta > 0 && (
                  <span title="Gastos fijos del día" style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${Math.min(meta / tope, 1) * 100}% - 1px)`, width: 2, background: colors.ink }} />
                )}
              </span>
              <span style={{ ...col(70), fontSize: type.sm, color: colors.textDim }}>{eur(vendido)}</span>
              <span style={{ ...col(70), fontSize: type.sm, fontWeight: 700, color: ganancia < 0 ? colors.danger : colors.text }}>{eur(ganancia)}</span>
              <span style={{ ...col(80), fontSize: type.sm, fontWeight: 800, color: benef >= 0 ? colors.sage2 : colors.danger }}>
                {benef >= 0 ? '+' : '−'}{eur(Math.abs(benef))}
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 10, lineHeight: 1.5 }}>
        Barra gris: lo vendido. Verde: lo ganado. La rayita negra: lo que cuestan ese día tus gastos fijos
        (si lo verde la pasa, el día se pagó solo). «Tras fijos» es el beneficio limpio del día. Toca un día para verlo entero.
      </div>
    </div>
  )
}

// LA META DEL MES: los fijos del mes (desde que empezó la contabilidad) más los gastos
// sueltos ya pagados. Lo que la llena no es lo vendido sino LO QUE LA VENTA DEJA: la
// ganancia (comida neta − género − reparto del socio). En rojo mientras falte, en verde
// cuando esté cubierta.
//
// Todo lo que ya pasó lo calcula `stock_punto_equilibrio` con `stock_resumen_negocio`, el
// mismo cálculo que las tarjetas Ganaste y Beneficio de «Este mes», así que cuadra siempre:
//   te faltan = fijos de los días que quedan − beneficio del mes
// y el último día del mes lo que sobre de la meta ES el beneficio del mes.
function MetaMes({ estId, recarga }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(false)

  // Se recarga con cada cambio de periodo, a la vez que las tarjetas: si no, tras una venta
  // nueva la meta se quedaba vieja y ya no cuadraba con el Beneficio de «Este mes».
  useEffect(() => {
    if (!estId) return
    let vivo = true
    puntoEquilibrio(estId)
      .then(r => { if (vivo) { setD(r); setError(false) } })
      .catch(() => { if (vivo) setError(true) })
    return () => { vivo = false }
  }, [estId, recarga])

  if (!d) {
    return error ? (
      <div style={{ ...ds.muted, fontSize: type.xs }}>No se ha podido cargar la meta del mes. Recarga la página.</div>
    ) : null
  }

  const fijos = Number(d.fijos_mes)
  const fijosCompletos = Number(d.fijos_mes_completo ?? d.fijos_mes)
  const sueltos = Number(d.gastos_sueltos_mes || 0)
  const meta = Number(d.meta_mes ?? fijos)
  const diaDesde = d.desde ? Number(String(d.desde).slice(8, 10)) : 1
  const periodoTxt = !d.fin_mes || diaDesde <= 1
    ? 'del mes'
    : d.desde === d.fin_mes ? `del ${fechaLarga(d.fin_mes)}` : `del ${diaDesde} al ${fechaLarga(d.fin_mes)}`
  const vendido = Number(d.vendido_mes)
  const sinCoste = Number(d.vendido_sin_coste_mes || 0)
  // Con un servidor anterior (sin `ganancia_mes`) se calcula aquí como antes.
  const ganancia = d.ganancia_mes != null
    ? Number(d.ganancia_mes)
    : Number(d.neto_mes) - Number(d.coste_vendido_mes || 0) - Number(d.reparto_neto_mes || 0)
  const margen = vendido > 0 ? ganancia / vendido : 0
  const beneficio = d.beneficio_mes != null ? Number(d.beneficio_mes) : null
  const fijosQuedan = Number(d.fijos_quedan || 0)
  const diasQuedan = Number(d.dias_quedan || 0)
  // La preposición va dentro: «fijos del día que queda», nunca «fijos de el día».
  const diasTxt = diasQuedan === 1 ? 'del día que queda' : `de los ${diasQuedan} días que quedan`
  const faltan = d.faltan != null ? Number(d.faltan) : Math.round((meta - ganancia) * 100) / 100

  if (!Number.isFinite(meta) || !Number.isFinite(ganancia)) return null

  // La contabilidad empieza en un mes que aún no ha llegado: no hay meta todavía.
  if (meta <= 0 && fijosCompletos > 0) {
    return d.desde ? (
      <div style={{ ...ds.muted, fontSize: type.xs }}>La meta empieza a contar el {fechaLarga(d.desde)}.</div>
    ) : null
  }

  if (meta <= 0) {
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

  const cubierta = faltan <= 0
  const pct = Math.max(0, Math.min(ganancia / meta, 1))
  const color = cubierta ? colors.sage : colors.danger
  const tonoBeneficio = beneficio > 0 ? colors.sage : beneficio < 0 ? colors.danger : colors.text

  // La cuenta que une la meta con la tarjeta Beneficio («Este mes»), corta y siempre exacta:
  // te faltan = fijos de los días que quedan − beneficio del mes.
  let cuadre = null
  if (beneficio != null) {
    if (diasQuedan === 0) {
      cuadre = cubierta
        ? 'Último día: lo que sobra es tu beneficio del mes.'
        : 'Último día: lo que falta es lo que llevas en negativo este mes.'
    } else if (cubierta) {
      cuadre = `Tu beneficio (${eur(beneficio)}) ya paga los fijos ${diasTxt} (${eur(fijosQuedan)}).`
    } else if (beneficio < 0) {
      cuadre = `Son ${eur(fijosQuedan)} de fijos ${diasTxt} + ${eur(-beneficio)} que llevas en negativo.`
    } else {
      cuadre = `Son ${eur(fijosQuedan)} de fijos ${diasTxt} − ${eur(beneficio)} de beneficio.`
    }
  }

  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={16} color={colors.primary} />
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
            La meta del mes: {eur(meta)}
            <span style={{ ...ds.muted, fontSize: type.xs, fontWeight: 500, marginLeft: 6 }}>
              (tus fijos {periodoTxt}{sueltos > 0 ? ` + ${eur(sueltos)} de gastos sueltos` : ''})
            </span>
          </div>
        </div>
        <div style={{ fontSize: type.sm, fontWeight: 800, color }}>
          {cubierta ? `Meta cubierta · sobran ${eur(-faltan)}` : `Te faltan ${eur(faltan)}`}
        </div>
      </div>

      <div style={{ marginTop: 12, height: 14, borderRadius: 999, background: colors.surface2, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, transition: 'width .3s' }} />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: type.sm, color: colors.textDim }}>
        <span>Ganancia del mes: <strong style={{ color: colors.text }}>{eur(ganancia)}</strong></span>
        {beneficio != null && (
          <span>Beneficio del mes: <strong style={{ color: tonoBeneficio }}>{eur(beneficio)}</strong></span>
        )}
        {/* Con un margen ridículo (primeros días, un reparto caro) la división da cifras absurdas. */}
        {!cubierta && margen >= 0.15 && (
          <span style={{ color: colors.textMute }}>
            ≈ te faltan {eur(faltan / margen)} en ventas
          </span>
        )}
      </div>

      {cuadre && (
        <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 8, lineHeight: 1.5 }}>{cuadre}</div>
      )}
      {sinCoste > 0 && (
        <div style={{ display: 'flex', gap: 6, ...ds.muted, fontSize: type.xs, marginTop: 4, lineHeight: 1.5 }}>
          <TriangleAlert size={13} color={colors.warning} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {eur(sinCoste)} vendidos no tienen receta (platos sin receta o importes libres del TPV):
            cuentan como si no costaran nada.
          </span>
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
  const color = tono === 'sage' ? colors.sage2 : tono === 'danger' ? colors.danger : colors.text
  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ fontSize: type.xs, fontWeight: 800, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </div>
      {pie && <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4, lineHeight: 1.4 }}>{pie}</div>}
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
