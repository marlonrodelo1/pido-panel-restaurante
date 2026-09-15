import { useState, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, ShoppingCart, Receipt, Wallet, Landmark,
  TriangleAlert, ChevronDown, ChevronUp, Plus, Undo2,
} from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, diaContable, deshacerPago, marcarPagado, salidaNoEsGasto, textoCajon,
  hoyCanariasIso, sumarDias, fechaLarga,
} from '../../lib/stock'
import { VIAS } from '../../lib/jornada'

// EL DÍA: lo primero que se ve al entrar en Contabilidad.
//
// Marlon (15 sep 2026): «saber cuánto se gana por día, cuánto se pierde, cuál es el
// beneficio… compré el pan y quiero saber cuánto quedó». Tres preguntas, tres tarjetas:
//   VENDISTE  lo cobrado ese día (lo mismo que suman los cierres de caja)
//   PAGASTE   las compras y los gastos apuntados ese día
//   GANASTE   lo que dejan las ventas: vendido − repartidores − ingredientes − comisión
// Y debajo, sin mezclarlo con lo anterior, el DINERO: cuánto hay en el cajón ahora.
//
// La regla que la pantalla tiene que explicar: comprar el pan NO resta de la ganancia del
// día (el pan se va restando cuando se vende cada bocadillo), pero SÍ sale del cajón.
//
// Los números vienen de `contab_dia`, que usa `stock_resumen_negocio`: el mismo cálculo que
// «Cómo va» y la meta del mes. Una cifra, un sitio.

const redondo = (n) => Math.round(n * 100) / 100
const ETIQUETA_VIA = { ...VIAS, app: 'App Pidoo' }
const ETIQUETA_PAGO = { efectivo: 'Efectivo', pagado_local: 'Efectivo', datafono: 'Datáfono', tarjeta: 'Tarjeta (app)' }

function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function isoCanarias(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Atlantic/Canary', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
function cuando(ts) {
  return new Date(ts).toLocaleString('es-ES', {
    timeZone: 'Atlantic/Canary', weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function hora(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' })
}

export default function DiaTab({ estId, fecha, onFecha, recarga, onApuntar, onIrA }) {
  const hoy = hoyCanariasIso()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [vuelta, setVuelta] = useState(0)
  const recargar = () => setVuelta(n => n + 1)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    setCargando(true)
    diaContable(estId, fecha)
      .then(r => { if (vivo) { setD(r); setError(null) } })
      .catch(e => { if (vivo) setError(e.message) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [estId, fecha, recarga, vuelta])

  const esHoy = fecha === hoy
  const esAyer = fecha === sumarDias(hoy, -1)

  async function deshacer(p) {
    const texto = p.tipo === 'compra'
      ? `¿Deshacer la compra de ${eur(p.total)} (${p.detalle})?\n\nSale del almacén y el artículo vuelve a su coste de antes. Si el dinero salió del cajón y la caja sigue abierta, vuelve a contar en el cajón.`
      : `¿Borrar el gasto de ${eur(p.total)} en ${p.categoria}?${p.cajon ? '\n\nSi salió del cajón y la caja sigue abierta, el dinero vuelve a contar en el cajón.' : ''}`
    if (!(await confirmar(texto))) return
    try {
      const r = await deshacerPago(p.tipo, p.id)
      const cajonTxt = r.cajon === 'se_queda'
        ? 'Esa caja ya estaba cerrada: la salida del cajón se queda y te avisará para que digas qué fue.'
        : textoCajon(r.cajon)
      toast([p.tipo === 'compra' ? 'Compra deshecha.' : 'Gasto borrado.', cajonTxt].filter(Boolean).join(' '), 'success')
      recargar()
    } catch (e) { toast(e.message, 'error') }
  }

  async function marcar(p, con) {
    try {
      const r = await marcarPagado(p.tipo, p.id, con)
      toast([`Apuntado: pagado ${con === 'caja' ? 'con el cajón' : 'por banco'}.`, textoCajon(r.cajon, p.total)].filter(Boolean).join(' '), 'success')
      recargar()
    } catch (e) { toast(e.message, 'error') }
  }

  async function noEsGasto(s) {
    if (!(await confirmar(
      `¿Los ${eur(s.importe)} que salieron del cajón NO fueron un gasto?\n\n` +
      'Por ejemplo: los llevaste al banco o eran cambio. No contarán en las cuentas y dejará de avisarte.'
    ))) return
    try {
      await salidaNoEsGasto(s.id)
      toast('Hecho: esa salida no cuenta como gasto.', 'success')
      recargar()
    } catch (e) { toast(e.message, 'error') }
  }

  const navBtn = { ...ds.secondaryBtn, width: 38, height: 38, padding: 0 }

  return (
    <div>
      {/* ── Qué día se está mirando ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button onClick={() => onFecha(sumarDias(fecha, -1))} aria-label="Día anterior" style={navBtn}>
          <ChevronLeft size={18} />
        </button>
        <div style={{ minWidth: 150, textAlign: 'center', padding: '0 4px' }}>
          <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, lineHeight: 1.15 }}>
            {esHoy ? 'Hoy' : esAyer ? 'Ayer' : capitalizar(fechaLarga(fecha))}
          </div>
          {(esHoy || esAyer) && <div style={{ ...ds.muted }}>{capitalizar(fechaLarga(fecha))}</div>}
        </div>
        <button onClick={() => onFecha(sumarDias(fecha, 1))} disabled={fecha >= hoy} aria-label="Día siguiente"
          style={{ ...navBtn, opacity: fecha >= hoy ? 0.35 : 1, cursor: fecha >= hoy ? 'default' : 'pointer' }}>
          <ChevronRight size={18} />
        </button>
        {!esHoy && (
          <button onClick={() => onFecha(hoy)} style={{ ...ds.miniBtn, height: 32 }}>Volver a hoy</button>
        )}
        <input type="date" value={fecha} max={hoy} aria-label="Elegir día"
          onChange={e => e.target.value && onFecha(e.target.value > hoy ? hoy : e.target.value)}
          style={{ ...ds.formInput, width: 150, height: 34, marginLeft: 'auto' }} />
      </div>

      {error && (
        <div style={{ ...ds.card, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 6 }}>No se ha podido cargar el día</div>
          <div style={{ ...ds.muted, marginBottom: 12 }}>{error}</div>
          <button onClick={recargar} style={ds.secondaryBtn}>Reintentar</button>
        </div>
      )}

      {!error && !d && <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Echando cuentas…</div>}

      {!error && d && (
        <div style={{ opacity: cargando ? 0.55 : 1, transition: 'opacity .15s' }}>
          {d.antes_de_empezar ? (
            <div style={{ ...ds.card, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                Tus cuentas empiezan el {fechaLarga(d.contabilidad_desde)}
              </div>
              <div style={{ ...ds.muted, marginBottom: 12 }}>Lo de antes de ese día no cuenta aquí.</div>
              <button onClick={() => onFecha(d.contabilidad_desde)} style={ds.secondaryBtn}>Ir a ese día</button>
            </div>
          ) : (
            <ContenidoDia
              d={d} fecha={fecha} hoy={hoy} esHoy={esHoy}
              onApuntar={onApuntar} onIrA={onIrA}
              onDeshacer={deshacer} onMarcar={marcar} onNoEsGasto={noEsGasto}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ContenidoDia({ d, fecha, hoy, esHoy, onApuntar, onIrA, onDeshacer, onMarcar, onNoEsGasto }) {
  const res = d.resumen || {}
  const c = d.cobro || {}
  const g = res.ganancia || {}
  const b = res.beneficio || {}

  const vendido = Number(c.total || 0)
  const repartidor = Number(c.repartidor || 0)
  const ingredientes = Number(g.genero || 0)
  const comision = Number(res.ventas?.comision_pidoo || 0)
  const ganancia = Number(g.total || 0)
  // Lo que no encaja en las cuatro líneas de arriba (un envío sin socio, un redondeo).
  // Casi siempre es 0 y no se pinta; si no, se enseña para que la cuenta sume exacta.
  const ajuste = redondo(vendido - repartidor - ingredientes - comision - ganancia)

  const pagos = [...(d.compras || []), ...(d.gastos || [])]
    .sort((x, y) => String(x.hora || '').localeCompare(String(y.hora || '')))
  const pagado = redondo(pagos.reduce((s, p) => s + Number(p.total || 0), 0))

  const fijosMes = Number(b.fijos_mes || 0)
  const fijosDia = Number(b.fijos_periodo || 0)
  const sueltos = Number(b.gastos_sueltos || 0)
  const beneficio = Number(b.total || 0)

  const pendientes = d.pendientes_cajon || []

  return (
    <>
      {/* ── Dinero que salió del cajón sin decir en qué ─────────────────── */}
      {pendientes.length > 0 && (
        <div style={{
          ...ds.card, padding: 16, marginBottom: 14,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <TriangleAlert size={17} color={colors.warning} />
            <div style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>
              Salió dinero del cajón sin decir en qué
            </div>
          </div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
            Dinos qué fue para que cuente en las cuentas.
          </div>
          {pendientes.map(s => (
            <div key={s.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              padding: '8px 0', borderTop: `1px solid ${colors.warning}`,
            }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <span style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>{eur(s.importe)}</span>
                <span style={{ fontSize: type.sm, color: colors.textDim }}>
                  {' '}· {s.fecha === hoy ? 'hoy' : fechaLarga(s.fecha, { diaSemana: false })} a las {s.hora}
                  {' '}· {s.motivo ? `«${s.motivo}»` : 'sin motivo'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => onApuntar({ modo: 'compra', salida: s, fecha: s.fecha })} style={{ ...ds.miniBtn, height: 30 }}>
                  Fue una compra
                </button>
                <button onClick={() => onApuntar({ modo: 'gasto', salida: s, fecha: s.fecha })} style={{ ...ds.miniBtn, height: 30 }}>
                  Fue un gasto
                </button>
                <button onClick={() => onNoEsGasto(s)} style={{ ...ds.miniBtn, height: 30 }}>
                  No es un gasto
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Las tres cifras ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <Tarjeta etiqueta="Vendiste" valor={eur(vendido)}
          pie={c.pedidos === 1 ? '1 pedido' : `${c.pedidos || 0} pedidos`} />
        <Tarjeta etiqueta="Pagaste" valor={eur(pagado)}
          pie={pagos.length
            ? [cuenta(d.compras.length, 'compra', 'compras'), cuenta(d.gastos.length, 'gasto', 'gastos')].filter(Boolean).join(' · ')
            : 'Nada apuntado'} />
        <Tarjeta etiqueta={ganancia < 0 ? 'Perdiste' : 'Ganaste'} valor={eur(Math.abs(ganancia))}
          tono={ganancia > 0 ? 'bien' : ganancia < 0 ? 'mal' : null}
          pie="Lo que te dejan las ventas" />
      </div>

      {/* ── Cómo ha ido: la cuenta y los fijos ──────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, marginTop: 12, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
        <Seccion titulo="La cuenta de lo que ganaste">
          <Fila label="Vendiste" valor={eur(vendido)} />
          {repartidor > 0 && (
            <Fila label={`Repartidores (${cuenta(c.repartos, 'reparto', 'repartos')})`} valor={'− ' + eur(repartidor)} />
          )}
          <Fila label="Ingredientes que se gastaron" valor={'− ' + eur(ingredientes)} />
          {comision > 0 && <Fila label="Comisión de Pidoo" valor={'− ' + eur(comision)} />}
          {Math.abs(ajuste) >= 0.01 && (
            <Fila label="Otros ajustes" valor={(ajuste > 0 ? '− ' : '+ ') + eur(Math.abs(ajuste))} />
          )}
          <Fila fuerte label={ganancia < 0 ? 'Perdiste' : 'Ganaste'} valor={eur(ganancia)}
            color={ganancia > 0 ? colors.sage2 : ganancia < 0 ? colors.danger : colors.text} />

          <Nota>
            A los repartidores se les paga el envío y la propina que dejó el cliente, más lo que pones tú.
            Los ingredientes son los que salieron del almacén con cada plato vendido.
          </Nota>
          {Number(g.vendido_sin_coste) > 0 && (
            <Nota aviso>
              {eur(g.vendido_sin_coste)} vendidos son de platos sin receta: cuentan como si no llevaran ingredientes,
              así que la ganancia real es algo menor.
            </Nota>
          )}
        </Seccion>

        <Seccion titulo="¿Te llega para los gastos fijos?">
          {fijosMes > 0 ? (
            <>
              <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
                Alquiler, sueldos, luz y demás te cuestan <strong style={{ color: colors.text }}>{eur(fijosDia)}</strong> cada día
                {sueltos > 0 && <>, y este día además pagaste <strong style={{ color: colors.text }}>{eur(sueltos)}</strong> en gastos sueltos</>}.
              </div>
              <BarraFijos ganancia={ganancia} meta={fijosDia + sueltos} />
              <div style={{ fontSize: 24, fontWeight: 800, color: beneficio >= 0 ? colors.sage2 : colors.danger, fontVariantNumeric: 'tabular-nums' }}>
                {beneficio >= 0 ? `Sobran ${eur(beneficio)}` : `Faltan ${eur(-beneficio)}`}
              </div>
              <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 2, lineHeight: 1.5 }}>
                {beneficio >= 0
                  ? 'Eso es beneficio limpio: lo que ganas de verdad este día.'
                  : 'Es lo que este día no llegó a cubrir de tus gastos fijos.'}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5, marginBottom: 10 }}>
                Apunta tus gastos fijos (alquiler, sueldos, luz…) y aquí verás si cada día llega para pagarlos.
              </div>
              <button onClick={() => onIrA('gastos')} style={ds.secondaryBtn}>Poner mis gastos fijos</button>
            </>
          )}
        </Seccion>
      </div>

      <Nota arriba={10}>
        Lo que compras (el pan, la carne) no resta de la ganancia del día en que lo pagas: se va restando
        cuando se vende cada plato. Donde sí se nota el pago es en tu dinero, aquí abajo.
      </Nota>

      {/* ── El dinero ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, marginTop: 14, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
        <Cajon cajon={d.cajon} hoy={hoy} />
        <DondeEstaLoVendido cobro={c} esHoy={esHoy} cajas={d.cajas_dia || []} />
      </div>

      {/* ── Todo lo que pasó ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, marginTop: 12, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))' }}>
        <Seccion titulo="Pagos del día" accion={
          <button onClick={() => onApuntar({ fecha })} style={{ ...ds.miniBtn, height: 30 }}>
            <Plus size={13} /> Apuntar
          </button>
        }>
          {pagos.length === 0 ? (
            <div style={{ fontSize: type.sm, color: colors.textMute, padding: '6px 0' }}>
              No has apuntado ningún pago este día.
            </div>
          ) : (
            <>
              {pagos.map(p => (
                <FilaPago key={p.tipo + p.id} p={p} onDeshacer={onDeshacer} onMarcar={onMarcar} onIrA={onIrA} />
              ))}
              <Fila fuerte label="Total pagado" valor={eur(pagado)} />
            </>
          )}
          {d.borradores > 0 && (
            <Nota aviso>
              Tienes {cuenta(d.borradores, 'factura', 'facturas')} en borrador: no cuentan hasta que las contabilices.{' '}
              <button onClick={() => onIrA('facturas')} style={enlace}>Ir a Compras</button>
            </Nota>
          )}
        </Seccion>

        <Ventas pedidos={d.pedidos || []} cobro={c} />
      </div>
    </>
  )
}

/* ── El cajón ─────────────────────────────────────────────────────────────── */

function Cajon({ cajon, hoy }) {
  if (!cajon) return null
  if (!cajon.abierta) {
    return (
      <Seccion titulo="El cajón">
        <div style={{ fontSize: 30, fontWeight: 800, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>
          {eur(cajon.contado_final)}
        </div>
        <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5, marginTop: 2 }}>
          Es lo que contaste al cerrar la caja el {cuando(cajon.cerrada_at)}.
        </div>
        <Nota>Ahora no hay caja abierta. Ábrela en el TPV para vender y para que lo que pagues con el cajón se descuente solo.</Nota>
      </Seccion>
    )
  }
  const entradas = Number(cajon.entradas || 0)
  const salidas = Number(cajon.salidas || 0)
  const abiertaDia = isoCanarias(cajon.abierta_at)
  return (
    <Seccion titulo="En el cajón ahora">
      <div style={{ fontSize: 34, fontWeight: 800, color: colors.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {eur(cajon.esperado)}
      </div>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 8 }}>
        Lo que debería haber si cuentas los billetes.
      </div>
      <Fila pequena label="Empezó con" valor={eur(cajon.fondo_inicial)} />
      <Fila pequena label="+ Cobrado en efectivo" valor={eur(cajon.ventas_efectivo)} />
      {entradas > 0 && <Fila pequena label="+ Dinero que metiste" valor={eur(entradas)} />}
      {salidas > 0 && <Fila pequena label="− Pagado con dinero del cajón" valor={'− ' + eur(salidas)} />}
      <Nota>
        Caja abierta el {cuando(cajon.abierta_at)}{cajon.abierta_por_nombre ? ` por ${cajon.abierta_por_nombre}` : ''}.
        El efectivo de los repartos cuenta: lo trae el repartidor.
      </Nota>
      {abiertaDia < hoy && (
        <Nota aviso>
          La caja sigue abierta desde {abiertaDia === sumarDias(hoy, -1) ? 'ayer' : fechaLarga(abiertaDia)}.
          Ciérrala en el TPV cuando cuentes el dinero: así cada día empieza limpio.
        </Nota>
      )}
    </Seccion>
  )
}

function DondeEstaLoVendido({ cobro, esHoy, cajas }) {
  const efectivo = Number(cobro.efectivo || 0)
  const datafono = Number(cobro.datafono || 0)
  const tarjeta = Number(cobro.tarjeta || 0)
  const otros = Number(cobro.otros || 0)
  const nada = efectivo + datafono + tarjeta + otros === 0
  return (
    <Seccion titulo={esHoy ? 'Dónde está lo vendido hoy' : 'Dónde está lo vendido ese día'}>
      {nada ? (
        <div style={{ fontSize: type.sm, color: colors.textMute }}>Todavía no hay ventas este día.</div>
      ) : (
        <>
          {efectivo > 0 && <Destino icono={<Wallet size={16} />} label="Efectivo" valor={efectivo} donde="Va al cajón" />}
          {datafono > 0 && <Destino icono={<Landmark size={16} />} label="Datáfono" valor={datafono} donde="Va a tu banco" />}
          {tarjeta > 0 && <Destino icono={<Landmark size={16} />} label="Tarjeta (app)" valor={tarjeta} donde="Te lo ingresa Pidoo en la liquidación del lunes" />}
          {otros > 0 && <Destino icono={<Landmark size={16} />} label="Otras formas de pago" valor={otros} donde="" />}
        </>
      )}
      {cajas.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.border}` }}>
          <div style={{ ...ds.label, marginBottom: 6 }}>Cierre de caja de ese día</div>
          {cajas.map((k, i) => {
            const desc = Number(k.descuadre || 0)
            return (
              <div key={i} style={{ fontSize: type.xs, color: colors.textDim, lineHeight: 1.6, marginBottom: 6 }}>
                De {hora(k.abierta_at)} a {hora(k.cerrada_at)}: empezó con {eur(k.fondo)}, cobrado en efectivo {eur(k.efectivo)}
                {Number(k.salidas) > 0 ? `, pagado del cajón ${eur(k.salidas)}` : ''}. Contaste <strong>{eur(k.contado)}</strong>
                {' '}—{' '}
                <span style={{ fontWeight: 700, color: Math.abs(desc) < 0.005 ? colors.sage2 : colors.danger }}>
                  {Math.abs(desc) < 0.005 ? 'cuadró' : desc < 0 ? `faltaban ${eur(-desc)}` : `sobraban ${eur(desc)}`}
                </span>.
              </div>
            )
          })}
        </div>
      )}
    </Seccion>
  )
}

function Destino({ icono, label, valor, donde }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ color: colors.textMute, display: 'flex', flexShrink: 0 }}>{icono}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: type.sm, fontWeight: 600, color: colors.text }}>{label}</div>
        {donde && <div style={{ fontSize: type.xs, color: colors.textMute }}>{donde}</div>}
      </div>
      <span style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {eur(valor)}
      </span>
    </div>
  )
}

/* ── Pagos y ventas ───────────────────────────────────────────────────────── */

function FilaPago({ p, onDeshacer, onMarcar, onIrA }) {
  const compra = p.tipo === 'compra'
  const titulo = compra
    ? (p.detalle || (p.numero ? `Factura ${p.numero}` : 'Factura'))
    : p.categoria + (p.concepto ? ` · ${p.concepto}` : '')
  const sub = compra
    ? ['Compra', p.proveedor, p.origen === 'factura' ? (p.numero ? `factura ${p.numero}` : 'factura') : null, p.hora].filter(Boolean).join(' · ')
    : [p.fijo ? 'Gasto fijo' : 'Gasto', p.cuenta === false ? 'no cuenta como gasto (se recupera)' : null, p.hora].filter(Boolean).join(' · ')
  const sePuedeDeshacer = !compra || p.origen === 'rapida'

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '9px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{
        width: 32, height: 32, borderRadius: radius.sm, background: colors.surface2, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.textDim,
      }}>
        {compra ? <ShoppingCart size={15} /> : <Receipt size={15} />}
      </span>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {titulo}
        </div>
        <div style={{ fontSize: type.xs, color: colors.textMute }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {p.pagado_con === 'caja' && <Etiqueta icono={<Wallet size={12} />} texto="Cajón" />}
        {p.pagado_con === 'banco' && <Etiqueta icono={<Landmark size={12} />} texto="Banco" />}
        {!p.pagado_con && (
          <>
            <span style={{ fontSize: type.xs, color: colors.warning, fontWeight: 700 }}>¿Con qué?</span>
            <button onClick={() => onMarcar(p, 'caja')} style={ds.miniBtn}>Cajón</button>
            <button onClick={() => onMarcar(p, 'banco')} style={ds.miniBtn}>Banco</button>
          </>
        )}
      </div>
      <span style={{ fontSize: type.base, fontWeight: 800, color: colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 76, textAlign: 'right' }}>
        {eur(p.total)}
      </span>
      {sePuedeDeshacer ? (
        <button onClick={() => onDeshacer(p)} title={compra ? 'Deshacer esta compra' : 'Borrar este gasto'}
          style={{ ...ds.miniBtn, height: 28 }}>
          <Undo2 size={12} /> Deshacer
        </button>
      ) : (
        <button onClick={() => onIrA('facturas')} title="Las facturas completas se tocan en Compras" style={{ ...ds.miniBtn, height: 28 }}>
          Ver
        </button>
      )}
    </div>
  )
}

function Ventas({ pedidos, cobro }) {
  const [ver, setVer] = useState(false)
  const porVia = new Map()
  for (const p of pedidos) {
    const x = porVia.get(p.via) || { n: 0, total: 0 }
    x.n += 1; x.total += Number(p.total || 0)
    porVia.set(p.via, x)
  }
  const vias = [...porVia.entries()].sort((a, b) => b[1].total - a[1].total)

  return (
    <Seccion titulo="Ventas del día">
      {pedidos.length === 0 ? (
        <div style={{ fontSize: type.sm, color: colors.textMute, padding: '6px 0' }}>Sin ventas este día.</div>
      ) : (
        <>
          {vias.map(([via, x]) => (
            <Fila key={via} label={`${ETIQUETA_VIA[via] || via} (${x.n})`} valor={eur(x.total)} />
          ))}
          <Fila fuerte label="Total vendido" valor={eur(cobro.total)} />
          <button onClick={() => setVer(v => !v)} style={{ ...ds.miniBtn, height: 30, marginTop: 10 }}>
            {ver ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {ver ? 'Ocultar los pedidos' : `Ver los ${pedidos.length} pedidos`}
          </button>
          {ver && (
            <div style={{ marginTop: 8 }}>
              {pedidos.map(p => (
                <div key={p.id} style={{
                  display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0',
                  borderBottom: `1px solid ${colors.border}`, fontSize: type.xs, color: colors.textDim,
                }}>
                  <span style={{ width: 40, flexShrink: 0, color: colors.textMute, fontVariantNumeric: 'tabular-nums' }}>{p.hora}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: colors.text }}>{p.codigo || '—'}</strong>
                    {' '}· {ETIQUETA_VIA[p.via] || p.via}
                    {p.via !== 'tpv' && p.modo ? ` · ${p.modo === 'delivery' ? 'domicilio' : 'recogida'}` : ''}
                    {' '}· {ETIQUETA_PAGO[p.pago] || p.pago}
                  </span>
                  <span style={{ fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{eur(p.total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Seccion>
  )
}

/* ── Piezas pequeñas ──────────────────────────────────────────────────────── */

function cuenta(n, uno, varios) {
  if (!n) return null
  return n === 1 ? `1 ${uno}` : `${n} ${varios}`
}

const enlace = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  color: colors.primary, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 'inherit',
}

function Tarjeta({ etiqueta, valor, pie, tono }) {
  const color = tono === 'bien' ? colors.sage2 : tono === 'mal' ? colors.danger : colors.text
  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ fontSize: type.xs, fontWeight: 800, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {etiqueta}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color, marginTop: 2, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
        {valor}
      </div>
      {pie && <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>{pie}</div>}
    </div>
  )
}

function Seccion({ titulo, accion, children }) {
  return (
    <div style={{ ...ds.card, padding: 18, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>{titulo}</div>
        {accion}
      </div>
      {children}
    </div>
  )
}

function Fila({ label, valor, fuerte, color, pequena }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12,
      padding: pequena ? '3px 0' : '6px 0',
      borderTop: fuerte ? `1px solid ${colors.borderStrong}` : 'none',
      marginTop: fuerte ? 6 : 0,
    }}>
      <span style={{ fontSize: pequena ? type.xs : type.sm, color: fuerte ? colors.text : colors.textDim, fontWeight: fuerte ? 800 : 500 }}>
        {label}
      </span>
      <span style={{
        fontSize: fuerte ? type.base : pequena ? type.xs : type.sm, fontWeight: fuerte ? 800 : 600,
        color: color || colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {valor}
      </span>
    </div>
  )
}

function Nota({ children, aviso, arriba = 8 }) {
  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: arriba,
      fontSize: type.xs, color: aviso ? colors.text : colors.textMute, lineHeight: 1.5,
    }}>
      {aviso && <TriangleAlert size={13} color={colors.warning} style={{ flexShrink: 0, marginTop: 2 }} />}
      <div>{children}</div>
    </div>
  )
}

function Etiqueta({ icono, texto }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999,
      background: colors.surface2, border: `1px solid ${colors.border}`,
      fontSize: type.xxs, fontWeight: 700, color: colors.textDim,
    }}>
      {icono}{texto}
    </span>
  )
}

function BarraFijos({ ganancia, meta }) {
  const pct = meta > 0 ? Math.max(0, Math.min(ganancia / meta, 1)) : 0
  const ok = ganancia >= meta
  return (
    <div style={{
      height: 14, borderRadius: 999, background: colors.surface2, border: `1px solid ${colors.border}`,
      overflow: 'hidden', margin: '12px 0 10px',
    }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: ok ? colors.sage : colors.danger, transition: 'width .3s' }} />
    </div>
  )
}
