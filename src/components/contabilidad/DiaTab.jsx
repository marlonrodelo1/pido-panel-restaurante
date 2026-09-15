import { useState, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, ShoppingCart, Receipt, Wallet, Landmark, Vault, Smartphone,
  TriangleAlert, ChevronDown, ChevronUp, Plus, Undo2,
} from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, diaContable, deshacerPago, marcarPagado, salidaNoEsGasto, textoCajon,
  hoyCanariasIso, sumarDias, fechaLarga, tesoreria, sePuedeCambiarPago, PAGADO_CON,
} from '../../lib/stock'
import { VIAS } from '../../lib/jornada'
import CambiarFormaPago from '../CambiarFormaPago'

// EL DÍA: lo primero que se ve al entrar en Contabilidad.
//
// Marlon (15 sep 2026): «saber cuánto se gana por día, cuánto se pierde, cuál es el
// beneficio… compré el pan y quiero saber cuánto quedó». Tres preguntas, tres tarjetas:
//   VENDISTE  lo cobrado ese día (lo mismo que suman los cierres de caja)
//   PAGASTE   las compras y los gastos apuntados ese día
//   GANASTE   lo que dejan las ventas: vendido − repartidores − ingredientes − comisión
// Y debajo, sin mezclarlo con lo anterior, TU DINERO AHORA: cajón, caja mayor, banco y lo que
// debe Pidoo. El detalle (contar, llevar al banco, movimientos) vive en la pestaña «Tu dinero».
//
// La regla que la pantalla tiene que explicar: comprar el pan NO resta de la ganancia del
// día (el pan se va restando cuando se vende cada bocadillo), pero SÍ sale de tu dinero: de la
// caja mayor, del banco o del cajón, según con qué se pagó.
//
// Los números vienen de `contab_dia`, que usa `stock_resumen_negocio`: el mismo cálculo que
// «Cómo va» y la meta del mes. Una cifra, un sitio.

const redondo = (n) => Math.round(n * 100) / 100
const ETIQUETA_VIA = { ...VIAS, app: 'App Pidoo' }
const ETIQUETA_PAGO = { efectivo: 'Efectivo', pagado_local: 'Efectivo', datafono: 'Datáfono', tarjeta: 'Tarjeta (app)' }
// Con qué se pagó una compra o un gasto: el icono va con la etiqueta de `PAGADO_CON`.
const ICONO_PAGADO = { caja: Wallet, caja_mayor: Vault, banco: Landmark }
const PAGADO_TXT = { caja: 'con el cajón', caja_mayor: 'con la caja mayor', banco: 'por banco' }

function capitalizar(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function isoCanarias(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Atlantic/Canary', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
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
      toast([`Apuntado: pagado ${PAGADO_TXT[con] || ''}.`, textoCajon(r.cajon, p.total)].filter(Boolean).join(' '), 'success')
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
              estId={estId} recargaDinero={`${recarga}-${vuelta}`} onRecargar={recargar}
              onApuntar={onApuntar} onIrA={onIrA}
              onDeshacer={deshacer} onMarcar={marcar} onNoEsGasto={noEsGasto}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ContenidoDia({ d, fecha, hoy, esHoy, estId, recargaDinero, onRecargar, onApuntar, onIrA, onDeshacer, onMarcar, onNoEsGasto }) {
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
  // ¿Es el dueño (o Pidoo)? Lo manda `contab_tesoreria`, que ya carga «Tu dinero ahora».
  // null mientras no ha llegado: entonces no se quita ningún botón y la base de datos manda.
  const [puedeEditar, setPuedeEditar] = useState(null)

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
        cuando se vende cada plato. Donde sí se nota el pago es en tu dinero: sale de la caja mayor, del banco o del cajón.
      </Nota>

      {/* ── El dinero ───────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, marginTop: 14, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
        <TuDineroAhora estId={estId} recarga={recargaDinero} hoy={hoy} esHoy={esHoy} cajonDia={d.cajon} onIrA={onIrA}
          onPuedeEditar={setPuedeEditar} />
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
                <FilaPago key={p.tipo + p.id} p={p} esHoy={esHoy} cajaAbierta={!!d.cajon?.abierta}
                  onDeshacer={onDeshacer} onMarcar={onMarcar} onIrA={onIrA} />
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

        <Ventas pedidos={d.pedidos || []} cobro={c} fecha={fecha} hoy={hoy} cajon={d.cajon} cajas={d.cajas_dia || []}
          puedeEditar={puedeEditar} onRecargar={onRecargar} />
      </div>
    </>
  )
}

/* ── Tu dinero ahora ──────────────────────────────────────────────────────── */

// La foto de HOY de los cuatro bolsillos, aunque se esté mirando otro día: el dinero no es
// «de un día», es lo que hay. Sale de `contab_tesoreria`, lo mismo que la pestaña «Tu dinero»
// (una cifra, un sitio); aquí solo el resumen y el botón para ir allí.
function TuDineroAhora({ estId, recarga, hoy, esHoy, cajonDia, onIrA, onPuedeEditar }) {
  const [t, setT] = useState(null)
  const [error, setError] = useState(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    tesoreria(estId)
      .then(r => { if (vivo) { setT(r); setError(null); onPuedeEditar?.(r?.puede_editar ?? null) } })
      .catch(e => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [estId, recarga, vuelta, onPuedeEditar]) // `onPuedeEditar` es un setState: no cambia ni recarga

  // El aviso de caja olvidada abierta se conserva aunque falle la tesorería: el día ya trae el cajón.
  const cajon = t?.caja_menor?.cajon ?? cajonDia
  const abiertaDia = cajon?.abierta && cajon.abierta_at ? isoCanarias(cajon.abierta_at) : null
  const base = Number(t?.caja_menor?.fondo_base || 0)
  const total = Number(t?.total || 0)
  // En negativo es al revés: le debes tú a Pidoo (la comisión de lo que cobraste en efectivo o
  // datáfono). Se enseña en positivo con su nombre, igual que en la pestaña «Tu dinero».
  const saldoPidoo = Number(t?.pidoo?.saldo || 0)
  const debesPidoo = saldoPidoo < -0.005
  // Caja mayor y banco parten de 0 hasta el primer recuento: el total no es exacto hasta entonces.
  // Mismas frases que la pestaña «Tu dinero»: segunda persona al dueño, tercera al equipo.
  const puede = t?.puede_editar === true
  const sinContar = !t ? [] : puede
    ? [!t.caja_mayor?.contada && 'cuentes la caja mayor', !t.banco?.contado && 'pongas el saldo del banco'].filter(Boolean)
    : [!t.caja_mayor?.contada && 'cuente la caja mayor', !t.banco?.contado && 'ponga el saldo del banco'].filter(Boolean)
  // Si falla la tesorería, el cajón se enseña con lo que ya trae el día (`contab_dia`).
  const cajonSolo = !t && error ? cajonDelDia(cajonDia) : null

  return (
    <Seccion titulo="Tu dinero ahora">
      {!t && !error && (
        <div style={{ fontSize: type.sm, color: colors.textMute }}>Contando tu dinero…</div>
      )}
      {!t && error && (
        <>
          {cajonSolo && (
            <Destino icono={<Wallet size={16} />} label="Cajón del TPV" valor={cajonSolo.valor} donde={cajonSolo.donde} />
          )}
          <div style={{ fontSize: type.sm, color: colors.textMute, margin: cajonSolo ? '8px 0' : '0 0 8px' }}>
            No se ha podido cargar {cajonSolo ? 'el resto de tu dinero' : 'tu dinero'}: {error}
          </div>
          <button onClick={() => setVuelta(n => n + 1)} style={{ ...ds.miniBtn, height: 30 }}>Reintentar</button>
        </>
      )}
      {t && (
        <>
          <Destino icono={<Wallet size={16} />} label="Cajón del TPV" valor={t.caja_menor?.saldo} donde="Lo que debería haber en el cajón" />
          <Destino icono={<Vault size={16} />} label="Caja mayor" valor={t.caja_mayor?.saldo}
            donde={t.caja_mayor?.contada ? 'Lo que retiras al cerrar la caja' : 'Todavía sin contar'} />
          <Destino icono={<Landmark size={16} />} label="Banco" valor={t.banco?.saldo}
            donde={t.banco?.contado ? 'Datáfono y lo que te paga Pidoo' : 'Todavía sin poner el saldo'} />
          {debesPidoo ? (
            <Destino icono={<Smartphone size={16} />} label="Le debes a Pidoo" valor={Math.abs(saldoPidoo)}
              donde="Es la comisión de los pedidos que cobraste tú (efectivo o datáfono). Se descuenta en la liquidación del lunes." />
          ) : (
            <Destino icono={<Smartphone size={16} />} label="Te debe Pidoo" valor={saldoPidoo} donde="Te lo paga los lunes" />
          )}
          <Fila fuerte label="Tienes en total" valor={eur(total)} color={total < 0 ? colors.danger : null} />
          {sinContar.length > 0 && (
            <Nota aviso>
              Todavía no es exacto: falta que {puede ? '' : 'el dueño '}{sinContar.join(' y que ')}.
              {puede ? ' Hazlo en «Tu dinero».' : ''}
            </Nota>
          )}
          {!esHoy && <Nota>Es lo que tienes hoy, no lo que tenías ese día.</Nota>}
          {/* Una recarga que falla no borra las cifras de antes: se avisa de que pueden estar viejas. */}
          {error && (
            <Nota aviso>
              No se han podido actualizar estas cifras: {error}{' '}
              <button onClick={() => setVuelta(n => n + 1)} style={enlace}>Reintentar</button>
            </Nota>
          )}
        </>
      )}
      {abiertaDia && abiertaDia < hoy && (
        <Nota aviso>
          La caja sigue abierta desde {abiertaDia === sumarDias(hoy, -1) ? 'ayer' : fechaLarga(abiertaDia)}.
          Ciérrala en el TPV cuando cuentes el dinero{base > 0 ? `: lo que pase de la base (${eur(base)}) pasará a la caja mayor` : ''}.
        </Nota>
      )}
      <button onClick={() => onIrA('dinero')} style={{ ...ds.secondaryBtn, height: 34, marginTop: 12 }}>
        Ver tu dinero <ChevronRight size={14} />
      </button>
    </Seccion>
  )
}

// El cajón con lo que trae `contab_dia`, para cuando falla la tesorería. Con la caja cerrada,
// `esperado_apertura` (lo que quedó más el efectivo cobrado después) es lo que debería haber;
// si no viene, solo se sabe lo que quedó o lo que se contó al cerrar, y se dice así.
function cajonDelDia(c) {
  if (!c) return null
  if (c.abierta) return c.esperado != null ? { valor: c.esperado, donde: 'Lo que debería haber en el cajón' } : null
  if (c.esperado_apertura != null) return { valor: c.esperado_apertura, donde: 'Lo que debería haber en el cajón' }
  const quedo = c.quedo_al_cerrar ?? c.fondo_siguiente
  if (quedo != null) return { valor: quedo, donde: 'Lo que quedó en el cajón al cerrar la caja' }
  if (c.contado_final != null) return { valor: c.contado_final, donde: 'Lo que contaste al cerrar la caja' }
  return null
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
            const retirado = Number(k.retirado_caja_mayor || 0)
            return (
              <div key={i} style={{ fontSize: type.xs, color: colors.textDim, lineHeight: 1.6, marginBottom: 6 }}>
                De {hora(k.abierta_at)} a {hora(k.cerrada_at)}: empezó con {eur(k.fondo)}, cobrado en efectivo {eur(k.efectivo)}
                {Number(k.salidas) > 0 ? `, pagado del cajón ${eur(k.salidas)}` : ''}. Contaste <strong>{eur(k.contado)}</strong>
                {' '}—{' '}
                <span style={{ fontWeight: 700, color: Math.abs(desc) < 0.005 ? colors.sage2 : colors.danger }}>
                  {Math.abs(desc) < 0.005 ? 'cuadró' : desc < 0 ? `faltaban ${eur(-desc)}` : `sobraban ${eur(desc)}`}
                </span>.
                {/* Lo que pasó del cajón a la caja mayor al cerrar (lo que pasaba de la base). */}
                {retirado > 0 && (
                  <> Pasaron <strong>{eur(retirado)}</strong> a la caja mayor
                    {k.fondo_siguiente != null ? ` y quedaron ${eur(k.fondo_siguiente)} en el cajón` : ''}.</>
                )}
                {/* Se cambió la forma de pago de un pedido después de cerrar: la foto se rehízo. */}
                {k.recalculada_at && (
                  <span style={{ color: colors.textMute }}> (corregido después del cierre)</span>
                )}
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
      {/* En rojo si sale en negativo (una caja mayor sin contar de la que ya se ha pagado algo). */}
      <span style={{
        fontSize: type.sm, fontWeight: 700, color: Number(valor) < -0.005 ? colors.danger : colors.text,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {eur(valor)}
      </span>
    </div>
  )
}

/* ── Pagos y ventas ───────────────────────────────────────────────────────── */

function FilaPago({ p, esHoy, cajaAbierta, onDeshacer, onMarcar, onIrA }) {
  const compra = p.tipo === 'compra'
  const titulo = compra
    ? (p.detalle || (p.numero ? `Factura ${p.numero}` : 'Factura'))
    : p.categoria + (p.concepto ? ` · ${p.concepto}` : '')
  const sub = compra
    ? ['Compra', p.proveedor, p.origen === 'factura' ? (p.numero ? `factura ${p.numero}` : 'factura') : null, p.hora].filter(Boolean).join(' · ')
    : [p.fijo ? 'Gasto fijo' : 'Gasto', p.cuenta === false ? 'no cuenta como gasto (se recupera)' : null, p.hora].filter(Boolean).join(' · ')
  const sePuedeDeshacer = !compra || p.origen === 'rapida'
  const donde = PAGADO_CON[p.pagado_con]
  const IconoDonde = ICONO_PAGADO[p.pagado_con]

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
      {/* Con qué se pagó. Si no se dijo, se pregunta: caja mayor o banco, que es lo normal; el
          cajón del TPV solo el mismo día y con la caja abierta en el TPV, porque la caja de otro
          día ya se contó y cerró, y sin caja abierta no hay cajón del que sacarlo (PD284). */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {p.pagado_con && (
          <Etiqueta icono={IconoDonde ? <IconoDonde size={12} /> : null} texto={donde?.corto || p.pagado_con} />
        )}
        {!p.pagado_con && (
          <>
            <span style={{ fontSize: type.xs, color: colors.warning, fontWeight: 700 }}>¿Con qué?</span>
            <button onClick={() => onMarcar(p, 'caja_mayor')} style={ds.miniBtn}>{PAGADO_CON.caja_mayor.corto}</button>
            <button onClick={() => onMarcar(p, 'banco')} style={ds.miniBtn}>{PAGADO_CON.banco.corto}</button>
            {esHoy && cajaAbierta && <button onClick={() => onMarcar(p, 'caja')} style={ds.miniBtn}>{PAGADO_CON.caja.corto}</button>}
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

function Ventas({ pedidos, cobro, fecha, hoy, cajon, cajas, puedeEditar, onRecargar }) {
  const [ver, setVer] = useState(false)
  // El pedido al que se le cambia la forma de pago (null = ventana cerrada). Es para el cliente
  // que pidió en efectivo y al final pagó con datáfono (o al revés): el cajón se corrige solo.
  const [cambiando, setCambiando] = useState(null)

  // «Cambiar pago» solo donde la base de datos lo va a dejar: los 14 días y, para el equipo, la
  // caja cerrada (las reglas viven en `sePuedeCambiarPago`). Para saber en qué caja cayó cada
  // cobro se compara 'AAAA-MM-DD HH:MM' en hora de Canarias: `p.hora` sale como 'HH:MM' y
  // `hora()` da lo mismo. `cajon` es la caja de AHORA, aunque se mire otro día.
  //
  // «Caja cerrada» son dos casos, los mismos que mira la RPC (PD282):
  //   - el cobro cae dentro de una caja ya cerrada;
  //   - se cobró con la caja cerrada y la primera caja que se abrió después también está
  //     cerrada (turno partido: cierra a las 16:00, reparto a las 16:20, caja de 19:00 a 23:30).
  // Para lo segundo basta con que haya UNA caja cerrada abierta después del cobro: solo hay una
  // caja abierta a la vez, así que la que sigue abierta es posterior a todas las cerradas y la
  // primera tras el cobro también está cerrada. Lo que cae en la caja abierta no cambia:
  // `enCajaAbierta` manda.
  const momento = (ts) => `${isoCanarias(ts)} ${hora(ts)}`
  const abiertaDesde = cajon?.abierta && cajon.abierta_at ? momento(cajon.abierta_at) : null
  const sePuedeCambiar = (p) => {
    const m = p.hora ? `${fecha} ${p.hora}` : null
    return sePuedeCambiarPago(p, {
      fecha, hoy, puedeEditar,
      enCajaAbierta: !!(m && abiertaDesde && m > abiertaDesde),
      enCajaCerrada: !!m && cajas.some(k => k.abierta_at && k.cerrada_at && (
        momento(k.abierta_at) > m
        || (momento(k.abierta_at) <= m && m <= momento(k.cerrada_at))
      )),
    })
  }
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
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0',
                  borderBottom: `1px solid ${colors.border}`, fontSize: type.xs, color: colors.textDim,
                }}>
                  <span style={{ width: 40, flexShrink: 0, color: colors.textMute, fontVariantNumeric: 'tabular-nums' }}>{p.hora}</span>
                  <span style={{ flex: '1 1 120px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: colors.text }}>{p.codigo || '—'}</strong>
                    {' '}· {ETIQUETA_VIA[p.via] || p.via}
                    {p.via !== 'tpv' && p.modo ? ` · ${p.modo === 'delivery' ? 'domicilio' : 'recogida'}` : ''}
                    {' '}· {ETIQUETA_PAGO[p.pago] || p.pago}
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                    <span style={{ fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{eur(p.total)}</span>
                    {sePuedeCambiar(p) && (
                      <button onClick={() => setCambiando(p)} title="El cliente pagó de otra forma" style={{ ...ds.miniBtn, height: 26 }}>
                        Cambiar pago
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {cambiando && (
        <CambiarFormaPago
          pedido={cambiando}
          onCerrar={() => setCambiando(null)}
          onHecho={() => { setCambiando(null); onRecargar?.() }}
        />
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
