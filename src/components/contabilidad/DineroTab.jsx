import { useState, useEffect } from 'react'
import {
  Wallet, Vault, Landmark, Smartphone, CreditCard, ShoppingCart, Receipt, ArrowLeftRight,
  TriangleAlert, Undo2, X, ChevronDown, ChevronUp,
} from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, tesoreria, contarBolsillo, moverDinero, borrarApunteDinero, hoyCanariasIso, sumarDias, fechaLarga,
} from '../../lib/stock'

// «TU DINERO»: dónde está cada euro del negocio, en cuatro bolsillos.
//
// Marlon (15 sep 2026): «del cierre se deja la base y lo demás pasa a la caja mayor; de ahí
// se pagan los gastos». Así que el dinero vive en cuatro sitios y la pantalla los enseña tal cual:
//   CAJÓN DEL TPV  (caja menor) lo que debería haber ahora en el cajón
//   CAJA MAYOR     los billetes que se sacan del cajón al cerrar; de aquí se paga
//   BANCO          datáfono + lo que ingresa Pidoo − lo que se paga por banco
//   TE DEBE PIDOO  la tarjeta de la app que cobró Pidoo y aún no ha pagado
//
// Casi todo lo calcula `contab_tesoreria` (cierres, compras, gastos, datáfono, liquidaciones).
// A mano solo se apunta lo que la base de datos no puede saber: cuánto hay de verdad
// (contar) y el dinero que se mueve sin ser venta ni gasto (llevarlo al banco, meter, sacar).
//
// Caja mayor y banco NO se cuentan solos: hasta el primer recuento parten de 0 y pueden salir
// en negativo (el pan de 13,20 se pagó de una caja mayor que nadie había contado). La pantalla
// lo dice en vez de enseñar un −13,20 € sin explicación.

const redondo = (n) => Math.round(n * 100) / 100
// El saldo del banco se copia tal cual de su app: «1.234,50». Los puntos que van antes de una
// coma son de miles y se quitan; si no, «1.234.50» daba NaN y Guardar se quedaba apagado sin
// decir por qué. Devuelve NaN si no es un número (para poder avisar).
// Sin coma también hay miles: «1.500» o «12.000» es como se escribe en España, y se leían
// 1,50 € y 12,00 € sin ningún aviso. Un número que empieza por «0.» nunca lleva miles
// («0.500» es 0,5), por eso el primer grupo no puede empezar por 0.
const leer = (v) => {
  let s = String(v ?? '').replace(/\s/g, '')
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  return Number(s.replace(/\.(?=.*,)/g, '').replace(',', '.'))
}
const num = (v) => {
  const n = leer(v)
  return Number.isFinite(n) ? n : 0
}
const soloImporte = (v) => v.replace(/[^\d.,]/g, '')
const soloFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// Día de Canarias de un instante, como 'AAAA-MM-DD' (nada de toISOString: recorta en UTC).
function isoCanarias(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Atlantic/Canary', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}
function hora(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' })
}
// «hoy a las 14:32», «ayer a las 9:05», «12 de septiembre a las 20:10». Si solo hay fecha, sin hora.
function cuandoCorto(v, hoy) {
  if (!v) return ''
  if (soloFecha(v)) return v === hoy ? 'hoy' : v === sumarDias(hoy, -1) ? 'ayer' : `el ${fechaLarga(v, { diaSemana: false })}`
  const dia = isoCanarias(v)
  const d = dia === hoy ? 'hoy' : dia === sumarDias(hoy, -1) ? 'ayer' : `el ${fechaLarga(dia, { diaSemana: false })}`
  return `${d} a las ${hora(v)}`
}
// «15/09 · 14:32» para la lista de movimientos.
function fechaHoraCorta(v) {
  if (!v) return ''
  const dia = soloFecha(v) ? v : isoCanarias(v)
  const dm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
  return soloFecha(v) ? dm : `${dm} · ${hora(v)}`
}
const ddmm = (v) => (v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}` : '')

// Qué se puede mover desde cada bolsillo. Llevar al banco y sacar del banco son la misma
// operación vista desde un lado u otro; la base de datos apunta las dos patas a la vez.
const MOVIMIENTOS = {
  caja_mayor: [
    { id: 'caja_mayor_a_banco', titulo: 'Llevar al banco', texto: 'Sacas billetes de la caja mayor y los ingresas en tu cuenta.' },
    { id: 'entrada_caja_mayor', titulo: 'Meter dinero', texto: 'Pones dinero en la caja mayor que no viene de una venta.' },
    { id: 'salida_caja_mayor', titulo: 'Sacar dinero', texto: 'Te lo llevas, pero no es un pago del negocio.' },
  ],
  banco: [
    { id: 'banco_a_caja_mayor', titulo: 'Sacar a la caja mayor', texto: 'Lo sacas del banco (del cajero) y lo guardas en la caja mayor.' },
    { id: 'entrada_banco', titulo: 'Meter dinero', texto: 'Un ingreso en la cuenta que no viene de una venta.' },
    { id: 'salida_banco', titulo: 'Sacar dinero', texto: 'Una transferencia a tu cuenta personal… No es un pago del negocio.' },
  ],
}

const ICONO_MOV = {
  cierre: Wallet, apertura: Wallet, compra: ShoppingCart, gasto: Receipt,
  apunte: ArrowLeftRight, datafono: CreditCard, pidoo: Smartphone,
}

export default function DineroTab({ estId, recarga, onApuntar, onIrA, onIrADia }) {
  const hoy = hoyCanariasIso()
  const [t, setT] = useState(null)
  const [error, setError] = useState(null)
  const [vuelta, setVuelta] = useState(0)
  const recargar = () => setVuelta(n => n + 1)
  // La ventana abierta: { tipo: 'contar', bolsillo } o { tipo: 'mover', bolsillo, movimiento }.
  const [ventana, setVentana] = useState(null)

  // «Cargando» sale de comparar qué se pidió con qué llegó, no de un setState dentro del efecto
  // (la regla de React lo prohíbe: provoca renders en cascada).
  const clave = `${estId}|${recarga}|${vuelta}`
  const [cargadoCon, setCargadoCon] = useState(null)
  const cargando = cargadoCon !== clave

  useEffect(() => {
    if (!estId) return
    let vivo = true
    tesoreria(estId)
      .then(r => { if (vivo) { setT(r); setError(null) } })
      .catch(e => { if (vivo) setError(e.message) })
      .finally(() => { if (vivo) setCargadoCon(clave) })
    return () => { vivo = false }
  }, [estId, clave])

  if (error && !t) {
    return (
      <div style={{ ...ds.card, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 6 }}>No se ha podido cargar tu dinero</div>
        <div style={{ ...ds.muted, marginBottom: 12 }}>{error}</div>
        <button onClick={recargar} style={ds.secondaryBtn}>Reintentar</button>
      </div>
    )
  }

  if (!t) return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Contando tu dinero…</div>

  const cm = t.caja_menor || {}
  const cma = t.caja_mayor || {}
  const bco = t.banco || {}
  const pid = t.pidoo || {}
  const total = Number(t.total || 0)
  // Contar, mover y deshacer los toca solo el dueño (o Pidoo): la base de datos se lo rechaza al
  // equipo con PD285. El equipo puede ver la pantalla, pero sin botones que acaban en error
  // después de haber contado los billetes. `puede_editar` lo manda `contab_tesoreria`.
  const puede = t.puede_editar === true
  // Las frases van en segunda persona para el dueño y en tercera para el equipo
  // («falta que cuentes…» / «falta que el dueño cuente…»).
  const sinContar = puede
    ? [!cma.contada && 'cuentes la caja mayor', !bco.contado && 'pongas el saldo del banco'].filter(Boolean)
    : [!cma.contada && 'cuente la caja mayor', !bco.contado && 'ponga el saldo del banco'].filter(Boolean)
  const debesPidoo = Number(pid.saldo || 0) < -0.005

  // Las ventanas van FUERA del bloque que se aclara al recargar: tras «Guardar» en Contar se
  // recarga con el resultado abierto, y dentro parpadeaba medio transparente (y la opacidad
  // crea un contexto de apilamiento que deja que otra capa de la página lo tape).
  return (
    <>
    <div style={{ opacity: cargando ? 0.55 : 1, transition: 'opacity .15s' }}>
      {error && (
        <div style={{ ...ds.card, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <TriangleAlert size={15} color={colors.warning} />
          <span style={{ flex: '1 1 200px', fontSize: type.sm, color: colors.textDim }}>No se ha podido actualizar: {error}</span>
          <button onClick={recargar} style={{ ...ds.miniBtn, height: 30 }}>Reintentar</button>
        </div>
      )}

      {/* ── La cifra de arriba ──────────────────────────────────────────── */}
      <div style={{ ...ds.card, padding: 20, marginBottom: 12 }}>
        <div style={{ fontSize: type.xs, fontWeight: 800, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Tu dinero
        </div>
        <div style={{
          fontSize: 38, fontWeight: 800, lineHeight: 1.15, marginTop: 2, fontVariantNumeric: 'tabular-nums',
          color: total < 0 ? colors.danger : colors.text, overflowWrap: 'anywhere',
        }}>
          Tienes {eur(total)}
        </div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4, lineHeight: 1.5 }}>
          {debesPidoo
            ? 'Sumando el cajón, la caja mayor y el banco, y restando lo que le debes a Pidoo.'
            : 'Sumando el cajón, la caja mayor, el banco y lo que te debe Pidoo.'}
        </div>
        {sinContar.length > 0 && (
          <Nota aviso>
            Todavía no es exacto: falta que {puede ? '' : 'el dueño '}{sinContar.join(' y que ')}.
          </Nota>
        )}
        {t.contabilidad_desde && (
          <div style={{ ...ds.muted, marginTop: 6 }}>Tus cuentas empiezan el {fechaLarga(t.contabilidad_desde)}.</div>
        )}
      </div>

      {/* ── Los cuatro bolsillos ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
        <TarjetaCajon cm={cm} hoy={hoy} onIrA={onIrA} onIrADia={onIrADia} />

        <Bolsillo icono={<Vault size={17} />} titulo="Caja mayor" saldo={cma.saldo}
          frase="Los billetes que se sacan del cajón al cerrar. De aquí pagas.">
          {!cma.contada ? (
            <Aviso
              texto={puede
                ? 'Todavía no la has contado: cuenta los billetes y pon cuánto hay.'
                : 'Todavía no la ha contado el dueño: hasta entonces esta cifra no es exacta.'}
              boton={puede ? 'Contar' : null} onBoton={() => setVentana({ tipo: 'contar', bolsillo: 'caja_mayor' })} />
          ) : (
            // `desde` = momento del último recuento (`recuento` es el importe contado, no una fecha).
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8 }}>
              {puede ? 'La contaste' : 'La contó el dueño'} {cuandoCorto(cma.desde, hoy)}.
            </div>
          )}
          {Number(cma.saldo) < 0 && (
            <Nota aviso>
              {cma.contada
                ? (puede
                  ? 'Sale en negativo: se han apuntado más pagos de los billetes que había. Vuelve a contarla.'
                  : 'Sale en negativo: se han apuntado más pagos de los billetes que había. Avísale al dueño para que la vuelva a contar.')
                : (puede
                  ? 'Sale en negativo porque aún no has puesto cuánto había: cuéntala.'
                  : 'Sale en negativo porque el dueño aún no ha puesto cuánto había.')}
            </Nota>
          )}
          {puede && (
            <Acciones>
              {cma.contada && (
                <button onClick={() => setVentana({ tipo: 'contar', bolsillo: 'caja_mayor' })} style={botonTarjeta}>Contar</button>
              )}
              <button onClick={() => setVentana({ tipo: 'mover', bolsillo: 'caja_mayor', movimiento: 'caja_mayor_a_banco' })} style={botonTarjeta}>
                Llevar al banco
              </button>
              <button onClick={() => setVentana({ tipo: 'mover', bolsillo: 'caja_mayor', movimiento: null })} style={botonTarjeta}>
                Meter o sacar dinero
              </button>
            </Acciones>
          )}
        </Bolsillo>

        <Bolsillo icono={<Landmark size={17} />} titulo="Banco" saldo={bco.saldo}
          frase="El datáfono y lo que te paga Pidoo, menos lo que pagas por banco.">
          {!bco.contado ? (
            <Aviso
              texto={puede
                ? 'Todavía no has puesto cuánto tienes: mira el saldo de tu cuenta del banco y ponlo aquí.'
                : 'Todavía no ha puesto el dueño el saldo del banco: hasta entonces esta cifra no es exacta.'}
              boton={puede ? 'Poner saldo del banco' : null} onBoton={() => setVentana({ tipo: 'contar', bolsillo: 'banco' })} />
          ) : (
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8 }}>
              {puede ? 'Pusiste el saldo' : 'El dueño puso el saldo'} {cuandoCorto(bco.desde, hoy)}.
            </div>
          )}
          {Number(bco.saldo) < 0 && (
            <Nota aviso>
              {bco.contado
                ? (puede
                  ? 'Sale en negativo: revisa el saldo de tu cuenta y vuelve a ponerlo.'
                  : 'Sale en negativo: avísale al dueño para que revise el saldo del banco.')
                : (puede
                  ? 'Sale en negativo porque aún no has puesto cuánto había en la cuenta: ponlo.'
                  : 'Sale en negativo porque el dueño aún no ha puesto el saldo del banco.')}
            </Nota>
          )}
          {puede && (
            <Acciones>
              {bco.contado && (
                <button onClick={() => setVentana({ tipo: 'contar', bolsillo: 'banco' })} style={botonTarjeta}>Poner saldo del banco</button>
              )}
              <button onClick={() => setVentana({ tipo: 'mover', bolsillo: 'banco', movimiento: 'banco_a_caja_mayor' })} style={botonTarjeta}>
                Sacar a la caja mayor
              </button>
              <button onClick={() => setVentana({ tipo: 'mover', bolsillo: 'banco', movimiento: null })} style={botonTarjeta}>
                Meter o sacar dinero
              </button>
            </Acciones>
          )}
        </Bolsillo>

        <TarjetaPidoo pid={pid} />
      </div>

      {/* ── Movimientos ─────────────────────────────────────────────────── */}
      <Movimientos cma={cma} bco={bco} hoy={hoy} puede={puede} onDeshecho={recargar} />

      <Nota arriba={10}>
        Los pagos (compras y gastos) se apuntan con el botón «Apuntar un pago» de arriba y salen de la caja mayor o del banco.
      </Nota>
    </div>

    {/* `puede` también aquí: si una recarga dice que ya no es el dueño, no se queda una ventana abierta. */}
    {puede && ventana?.tipo === 'contar' && (
      <VentanaContar
        estId={estId} bolsillo={ventana.bolsillo}
        calculado={ventana.bolsillo === 'banco' ? bco.saldo : cma.saldo}
        yaContado={ventana.bolsillo === 'banco' ? !!bco.contado : !!cma.contada}
        onGuardado={recargar}
        onCerrar={() => setVentana(null)}
      />
    )}
    {puede && ventana?.tipo === 'mover' && (
      <VentanaMover
        estId={estId} bolsillo={ventana.bolsillo} inicial={ventana.movimiento}
        saldos={{ caja_mayor: Number(cma.saldo || 0), banco: Number(bco.saldo || 0) }}
        contados={{ caja_mayor: !!cma.contada, banco: !!bco.contado }}
        onApuntar={onApuntar}
        onCerrar={() => setVentana(null)}
        onHecho={() => { setVentana(null); recargar() }}
      />
    )}
    </>
  )
}

/* ── Las tarjetas ─────────────────────────────────────────────────────────── */

function TarjetaCajon({ cm, hoy, onIrA, onIrADia }) {
  const cajon = cm.cajon
  const base = Number(cm.fondo_base || 0)
  const abiertaDia = cajon?.abierta && cajon.abierta_at ? isoCanarias(cajon.abierta_at) : null
  // Con la caja cerrada, el saldo es lo que quedó al cerrar MÁS el efectivo de los repartos
  // entregados después (`contab_tesoreria` los suma). Sin enseñarlo, «Quedó en el cajón al cerrar»
  // con 75 € cuando quedaron 50 € no cuadraba con nada. Lo que quedó sale del mismo coalesce que
  // la función (`fondo_siguiente`, y en cierres antiguos `contado_final`); si la caja no trae
  // `fondo_siguiente`, se saca restando, que es lo mismo y así las dos filas suman la cifra grande.
  const cerrada = cajon && !cajon.abierta
  const despues = cerrada ? Number(cajon.efectivo_despues_cierre || 0) : 0
  const conDespues = despues > 0.005
  const quedo = !conDespues ? 0
    : 'fondo_siguiente' in cajon
      ? Number(cajon.fondo_siguiente ?? cajon.contado_final ?? 0)
      : redondo(Number(cm.saldo || 0) - despues)

  return (
    <Bolsillo icono={<Wallet size={17} />} titulo="Cajón del TPV" saldo={cm.saldo}
      frase={cerrada
        ? (conDespues ? 'Lo que quedó al cerrar, más el efectivo cobrado después.' : 'Quedó en el cajón al cerrar.')
        : 'Lo que debería haber ahora en el cajón.'}>
      {cajon?.abierta && (
        <>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
            Caja abierta desde {cuandoCorto(cajon.abierta_at, hoy)}{cajon.abierta_por_nombre ? ` por ${cajon.abierta_por_nombre}` : ''}.
          </div>
          <div style={{ marginTop: 6 }}>
            <Fila label="Empezó con" valor={eur(cajon.fondo_inicial)} />
            <Fila label="+ Cobrado en efectivo" valor={eur(cajon.ventas_efectivo)} />
            {Number(cajon.entradas) > 0 && <Fila label="+ Dinero que metiste" valor={eur(cajon.entradas)} />}
            {Number(cajon.salidas) > 0 && <Fila label="− Pagado con el cajón" valor={'− ' + eur(cajon.salidas)} />}
          </div>
          {abiertaDia && abiertaDia < hoy && (
            <Aviso texto={
              `Sigue abierta desde ${abiertaDia === sumarDias(hoy, -1) ? 'ayer' : `el ${fechaLarga(abiertaDia, { diaSemana: false })}`}: ` +
              `ciérrala en el TPV cuando cuentes. Al cerrar, lo que pase de la base (${eur(base)}) pasa a la caja mayor.`
            } />
          )}
        </>
      )}
      {cerrada && (
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
          Cerraste la caja {cuandoCorto(cajon.cerrada_at, hoy)} y contaste {eur(cajon.contado_final)}.
          {Number(cajon.retirado_caja_mayor) > 0 && (
            <> Pasaron <strong style={{ color: colors.text }}>{eur(cajon.retirado_caja_mayor)}</strong> a la caja mayor.</>
          )}
        </div>
      )}
      {cerrada && conDespues && (
        <div style={{ marginTop: 6 }}>
          <Fila label="Quedó en el cajón al cerrar" valor={eur(quedo)} />
          <Fila label="+ Cobrado en efectivo después de cerrar" valor={eur(despues)} />
        </div>
      )}
      {!cajon && (
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
          Todavía no has abierto la caja en el TPV.
        </div>
      )}
      <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
        La base del cajón es <strong style={{ color: colors.text }}>{eur(base)}</strong>: es lo que se queda dentro al cerrar, para dar cambio.
      </div>
      {/* «El día» guarda la fecha que se miró la última vez: sin onIrADia llevaría a ese día
          y no a hoy, así que se pone la fecha de hoy antes de cambiar de pestaña. */}
      {(onIrADia || onIrA) && (
        <Acciones>
          <button onClick={() => (onIrADia ? onIrADia(hoy) : onIrA('dia'))} style={botonTarjeta}>
            {onIrADia ? 'Ver lo vendido hoy' : 'Ver el día'}
          </button>
        </Acciones>
      )}
    </Bolsillo>
  )
}

function TarjetaPidoo({ pid }) {
  const semanas = pid.semanas || []
  // `semana_en_curso` es un importe; se acepta también { importe } por si la función crece.
  const enCurso = pid.semana_en_curso && typeof pid.semana_en_curso === 'object'
    ? Number(pid.semana_en_curso.importe || 0)
    : Number(pid.semana_en_curso || 0)
  const saldo = Number(pid.saldo || 0)
  const nada = Math.abs(saldo) < 0.005 && !semanas.length
  // En negativo NO es que Pidoo te deba menos: es que tú le debes a Pidoo (cobraste mucho en
  // efectivo o datáfono y la comisión se queda pendiente). Hay semanas así en producción; decir
  // «Te debe Pidoo» con una cifra en rojo y «te lo paga los lunes» era mentira.
  const debes = saldo < -0.005
  // Cada fila se enseña con el signo de la tarjeta, para que las filas sumen la cifra de arriba:
  // en «Te debe Pidoo», una semana en la que le debes sale con «−», y al revés.
  const importeFila = (n) => {
    const v = Number(n || 0) * (debes ? -1 : 1)
    return (v < -0.005 ? '− ' : '') + eur(Math.abs(v))
  }
  const quien = (n) => (Number(n || 0) < -0.005 ? 'le debes' : debes ? 'Pidoo te debe' : 'sin pagar')

  return (
    <Bolsillo icono={<Smartphone size={17} />} titulo={debes ? 'Le debes a Pidoo' : 'Te debe Pidoo'} saldo={Math.abs(saldo)}
      frase={debes
        ? 'Es la comisión de los pedidos que cobraste tú (efectivo o datáfono). Se descuenta en la liquidación del lunes.'
        : 'Lo que cobró Pidoo con tarjeta en la app y aún no te ha pagado. Te lo paga los lunes.'}>
      {nada ? (
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8 }}>Ahora mismo Pidoo no te debe nada.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {semanas.map((s, i) => (
            <Fila key={`${s.periodo_inicio}-${i}`}
              label={`Del ${ddmm(s.periodo_inicio)} al ${ddmm(s.periodo_fin)} · ${quien(s.importe)}`}
              valor={importeFila(s.importe)} />
          ))}
          <Fila
            label={`Esta semana (aún sin cerrar)${pid.desde_corte ? ` · desde el ${ddmm(pid.desde_corte)}` : ''}${enCurso < -0.005 ? ' · le debes' : ''}`}
            valor={importeFila(enCurso)} />
        </div>
      )}
    </Bolsillo>
  )
}

function Movimientos({ cma, bco, hoy, puede, onDeshecho }) {
  const [cual, setCual] = useState('caja_mayor')
  const [todos, setTodos] = useState(false)
  const b = cual === 'banco' ? bco : cma
  const contado = cual === 'banco' ? !!bco.contado : !!cma.contada
  const lista = [...(b.movimientos || [])].sort((x, y) => String(y.momento || '').localeCompare(String(x.momento || '')))
  const visibles = todos ? lista : lista.slice(0, 30)
  // `desde` = momento del último recuento (o el inicio de las cuentas si nunca se contó).
  const cuandoDesde = cuandoCorto(b.desde, hoy)
  // `contab_tesoreria` manda como mucho 60 movimientos, pero el saldo los suma todos.
  const recortada = lista.length >= 60
  // El equipo no cuenta ni pone el saldo: lo hace el dueño, y así se le dice.
  const verbo = cual === 'banco'
    ? (puede ? 'pusiste el saldo' : 'el dueño puso el saldo')
    : (puede ? 'la contaste' : 'el dueño la contó')
  const loQue = cual === 'banco' ? (puede ? 'pusiste' : 'puso') : (puede ? 'contaste' : 'contó')
  // Sin recuento, `desde` es la medianoche en que empezaron las cuentas: la hora sobra.
  const diaInicio = b.desde ? fechaLarga(soloFecha(b.desde) ? b.desde : isoCanarias(b.desde), { diaSemana: false }) : ''

  async function deshacer(m) {
    const cuanto = eur(Math.abs(Number(m.importe || 0)))
    if (!(await confirmar(
      `¿Deshacer «${m.concepto || 'este movimiento'}» de ${cuanto}? Si era dinero que pasó entre la caja mayor y el banco, se deshacen los dos lados.`
    ))) return
    try {
      await borrarApunteDinero(m.ref_id)
      toast('Movimiento deshecho.', 'success')
      onDeshecho()
    } catch (e) { toast(e.message, 'error') }
  }

  const pestana = (id, label, n) => (
    <button key={id} onClick={() => { setCual(id); setTodos(false) }} style={{
      ...ds.filterBtn, height: 32,
      background: cual === id ? colors.ink : colors.paper,
      color: cual === id ? colors.cream : colors.textDim,
      borderColor: cual === id ? colors.ink : colors.border,
      fontWeight: cual === id ? 700 : 600,
    }}>
      {label}{n ? ` (${n})` : ''}
    </button>
  )

  return (
    <div style={{ ...ds.card, padding: 18, marginTop: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>Movimientos</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pestana('caja_mayor', 'Caja mayor', (cma.movimientos || []).length)}
          {pestana('banco', 'Banco', (bco.movimientos || []).length)}
        </div>
      </div>

      {/* Por qué la lista no empieza en el primer día: el saldo parte del último recuento, y lo
          de antes ya va dentro de lo que se contó. Sin esta línea parece que faltan cosas. */}
      <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5, marginBottom: 8 }}>
        {contado
          ? (recortada
            ? `Se ven los 60 más recientes, pero el saldo suma también los anteriores desde que ${verbo}${cuandoDesde ? ` ${cuandoDesde}` : ''}.`
            : `Se ven desde que ${verbo}${cuandoDesde ? ` ${cuandoDesde}` : ''}: lo de antes ya está dentro de lo que ${loQue}.`)
          : `${recortada
            ? `Se ven los 60 más recientes, pero el saldo suma también los anteriores desde que empezaron tus cuentas${diaInicio ? `, el ${diaInicio}` : ''}.`
            : `Se ven desde que empezaron tus cuentas${diaInicio ? `, el ${diaInicio}` : ''}.`} ${puede
            ? `Cuando ${cual === 'banco' ? 'pongas el saldo' : 'la cuentes'}, se empieza desde ahí.`
            : `Cuando el dueño ${cual === 'banco' ? 'ponga el saldo' : 'la cuente'}, se empieza desde ahí.`}`}
      </div>

      {lista.length === 0 ? (
        <div style={{ fontSize: type.sm, color: colors.textMute, padding: '6px 0' }}>
          {contado
            ? `Todavía no hay movimientos desde que ${verbo}.`
            : 'Todavía no hay movimientos.'}
        </div>
      ) : (
        <>
          {visibles.map((m, i) => {
            const imp = Number(m.importe || 0)
            const Icono = ICONO_MOV[m.tipo] || ArrowLeftRight
            return (
              <div key={`${m.tipo}-${m.ref_id || i}-${m.momento}`} style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                padding: '8px 0', borderBottom: `1px solid ${colors.border}`,
              }}>
                <span style={{
                  width: 30, height: 30, borderRadius: radius.sm, background: colors.surface2, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: colors.textDim,
                }}>
                  <Icono size={14} />
                </span>
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.concepto || '—'}
                  </div>
                  <div style={{ fontSize: type.xs, color: colors.textMute, fontVariantNumeric: 'tabular-nums' }}>{fechaHoraCorta(m.momento)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                  <span style={{
                    fontSize: type.base, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    color: imp > 0 ? colors.sage2 : imp < 0 ? colors.danger : colors.text,
                  }}>
                    {imp > 0 ? '+ ' : imp < 0 ? '− ' : ''}{eur(Math.abs(imp))}
                  </span>
                  {/* Deshacer solo el dueño: al equipo `contab_tesoreria_borrar` se lo rechaza (PD285). */}
                  {puede && m.borrable && m.ref_id && (
                    <button onClick={() => deshacer(m)} title="Deshacer este movimiento" style={{ ...ds.miniBtn, height: 28 }}>
                      <Undo2 size={12} /> Deshacer
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {lista.length > visibles.length && (
            <button onClick={() => setTodos(true)} style={{ ...ds.miniBtn, height: 30, marginTop: 10 }}>
              <ChevronDown size={13} /> Ver los {lista.length}
            </button>
          )}
          {todos && lista.length > 30 && (
            <button onClick={() => setTodos(false)} style={{ ...ds.miniBtn, height: 30, marginTop: 10 }}>
              <ChevronUp size={13} /> Ver menos
            </button>
          )}
        </>
      )}
    </div>
  )
}

/* ── Ventanas ─────────────────────────────────────────────────────────────── */
// No se cierran al pulsar fuera (igual que «Apuntar un pago»): con el importe tecleado, un
// clic perdido lo borraba.

function VentanaContar({ estId, bolsillo, calculado, yaContado: yaContadoAlAbrir, onGuardado, onCerrar }) {
  const banco = bolsillo === 'banco'
  // Se congela al abrir: tras «Guardar» se recarga la tesorería y el bolsillo ya sale contado,
  // así que la primera vez acabaría enseñando la «diferencia» que se quería evitar.
  const [yaContado] = useState(!!yaContadoAlAbrir)
  const [importe, setImporte] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const malEscrito = importe !== '' && !Number.isFinite(leer(importe))
  const valido = importe !== '' && !malEscrito && num(importe) >= 0

  async function guardar() {
    if (!valido || guardando) return
    setGuardando(true)
    try {
      const r = await contarBolsillo(estId, bolsillo, redondo(num(importe)), nota.trim() || null)
      setResultado(r || {})
      onGuardado?.()
    } catch (e) {
      toast(e.message, 'error')
    }
    setGuardando(false)
  }

  const titulo = banco ? 'Poner el saldo del banco' : 'Contar la caja mayor'

  if (resultado) {
    const calc = Number(resultado.calculado ?? calculado ?? 0)
    const cont = Number(resultado.contado ?? num(importe))
    const dif = resultado.diferencia != null ? Number(resultado.diferencia) : redondo(cont - calc)
    const cuadra = Math.abs(dif) < 0.005
    const quien = banco ? 'el banco' : 'la caja mayor'

    // La primera vez no hay descuadre que enseñar: lo «calculado» salía de partir de 0 (el
    // −13,20 € del pan) y «diferencia + 213,20 €» parecía un error grave. Solo se confirma.
    if (!yaContado) {
      return (
        <Ventana titulo={titulo} onCerrar={onCerrar} pie={
          <button onClick={onCerrar} style={{ ...ds.primaryBtn, height: 42, fontSize: type.base }}>Listo</button>
        }>
          <div style={{ fontSize: type.base, color: colors.textDim, lineHeight: 1.6 }}>
            Apuntado: desde ahora {quien} parte de <strong style={{ color: colors.text }}>{eur(cont)}</strong>.
          </div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 10, lineHeight: 1.5 }}>
            A partir de aquí se suma y se resta solo lo que vaya pasando.
          </div>
        </Ventana>
      )
    }

    return (
      <Ventana titulo={titulo} onCerrar={onCerrar} pie={
        <button onClick={onCerrar} style={{ ...ds.primaryBtn, height: 42, fontSize: type.base }}>Listo</button>
      }>
        <div style={{ fontSize: type.base, color: colors.textDim, lineHeight: 1.6 }}>
          Había calculado <strong style={{ color: colors.text }}>{eur(calc)}</strong>, has {banco ? 'puesto' : 'contado'}{' '}
          <strong style={{ color: colors.text }}>{eur(cont)}</strong>: diferencia{' '}
          {/* Rojo solo si FALTA dinero; si sobra, otro tono: no es una alarma. */}
          <strong style={{ color: cuadra ? colors.sage2 : dif < 0 ? colors.danger : colors.info }}>
            {cuadra ? '0,00 €' : `${dif > 0 ? '+' : '−'} ${eur(Math.abs(dif))}`}
          </strong>.
        </div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 10, lineHeight: 1.5 }}>
          {cuadra
            ? 'Cuadra. '
            : dif > 0 ? `Hay ${eur(dif)} más de lo calculado. ` : `Hay ${eur(-dif)} menos de lo calculado. `}
          Desde ahora {quien} parte de {eur(cont)}.
        </div>
      </Ventana>
    )
  }

  return (
    <Ventana titulo={titulo} onCerrar={onCerrar} pie={
      <>
        <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
        {/* Con la cifra en el botón se ve lo que se va a apuntar antes de pulsar (como en «Mover»). */}
        <button onClick={guardar} disabled={!valido || guardando}
          style={{ ...ds.primaryBtn, height: 42, fontSize: type.base, opacity: !valido || guardando ? 0.5 : 1 }}>
          {guardando ? 'Guardando…' : `Guardar${valido ? ' ' + eur(redondo(num(importe))) : ''}`}
        </button>
      </>
    }>
      <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
        {banco
          ? 'Mira en la app de tu banco cuánto hay en la cuenta del negocio y ponlo aquí.'
          : 'Cuenta los billetes y las monedas de la caja mayor y pon cuánto hay.'}
      </div>
      <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
        {/* Sin contar nunca, la cifra calculada parte de 0 y puede salir en negativo: no ayuda. */}
        {yaContado
          ? `Ahora mismo calculamos ${eur(calculado)}.`
          : 'Es la primera vez: lo que pongas será el punto de partida.'}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={ds.label}>{banco ? '¿Cuánto hay en el banco?' : '¿Cuánto has contado?'}</label>
        <InputEuros value={importe} onChange={setImporte} grande autoFocus onEnter={guardar} />
        {malEscrito && <AvisoImporte />}
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={ds.label}>Nota (opcional)</label>
        <input value={nota} onChange={e => setNota(e.target.value)} maxLength={140}
          placeholder={banco ? 'Saldo de la app del banco' : 'Contado por la noche'} style={ds.formInput} />
      </div>
      <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 12, lineHeight: 1.5 }}>
        Desde ese momento {banco ? 'el banco' : 'la caja mayor'} parte de lo que pongas.
      </div>
    </Ventana>
  )
}

function VentanaMover({ estId, bolsillo, inicial, saldos, contados = {}, onApuntar, onCerrar, onHecho }) {
  const opciones = MOVIMIENTOS[bolsillo] || []
  const [movimiento, setMovimiento] = useState(inicial || null)
  const [importe, setImporte] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const malEscrito = importe !== '' && !Number.isFinite(leer(importe))
  const cuanto = redondo(num(importe))
  const valido = !!movimiento && cuanto > 0

  async function guardar() {
    if (!valido || guardando) return
    setGuardando(true)
    try {
      await moverDinero(estId, movimiento, cuanto, nota.trim() || null)
      toast('Apuntado.', 'success')
      onHecho?.()
    } catch (e) {
      toast(e.message, 'error')
      setGuardando(false)
    }
  }

  // Lo que va a pasar, antes de pulsar. Cada movimiento sube o baja uno o dos bolsillos.
  const cambios = {
    caja_mayor_a_banco: { caja_mayor: -1, banco: 1 },
    banco_a_caja_mayor: { caja_mayor: 1, banco: -1 },
    entrada_caja_mayor: { caja_mayor: 1 },
    salida_caja_mayor: { caja_mayor: -1 },
    entrada_banco: { banco: 1 },
    salida_banco: { banco: -1 },
  }[movimiento] || {}
  const nombre = { caja_mayor: 'la caja mayor', banco: 'el banco' }
  // Mismo criterio que el resumen de «Apuntar un pago»: de un bolsillo sin contar no se da la
  // cifra que queda (parte de 0 y saldría «quedarán −113,20 €», que no es real).
  const puntos = cuanto > 0
    ? Object.entries(cambios).map(([b, s]) => {
      const Nombre = nombre[b].charAt(0).toUpperCase() + nombre[b].slice(1)
      const mueve = `${Nombre} ${s > 0 ? 'sube' : 'baja'} ${eur(cuanto)}`
      if (!contados[b]) {
        return `${mueve}. Todavía no ${b === 'banco' ? 'has puesto su saldo' : 'la has contado'}, así que no sabemos cuánto quedará.`
      }
      const quedan = redondo(saldos[b] + s * cuanto)
      if (s < 0 && quedan < -0.005) {
        return saldos[b] <= 0.005
          ? `${mueve}, pero según lo apuntado ya no queda nada. ¿Seguro?`
          : `${mueve}, pero según lo apuntado solo hay ${eur(saldos[b])}. ¿Seguro?`
      }
      return `${mueve}: quedarán ${eur(quedan)}.`
    })
    : []
  const esSalida = movimiento === 'salida_caja_mayor' || movimiento === 'salida_banco'
  const esEntrada = movimiento === 'entrada_caja_mayor' || movimiento === 'entrada_banco'

  return (
    <Ventana titulo={bolsillo === 'banco' ? 'Mover dinero del banco' : 'Mover dinero de la caja mayor'} onCerrar={onCerrar} pie={
      <>
        <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
        <button onClick={guardar} disabled={!valido || guardando}
          style={{ ...ds.primaryBtn, height: 42, fontSize: type.base, opacity: !valido || guardando ? 0.5 : 1 }}>
          {guardando ? 'Apuntando…' : `Apuntar${cuanto > 0 ? ' ' + eur(cuanto) : ''}`}
        </button>
      </>
    }>
      <label style={ds.label}>¿Qué haces?</label>
      <div style={{ display: 'grid', gap: 8 }}>
        {opciones.map(o => {
          const activo = movimiento === o.id
          return (
            <button key={o.id} onClick={() => setMovimiento(o.id)} style={{
              textAlign: 'left', padding: '10px 14px', borderRadius: radius.md, cursor: 'pointer', fontFamily: 'inherit',
              background: activo ? colors.primarySoft : colors.paper,
              border: `2px solid ${activo ? colors.primary : colors.border}`,
              color: activo ? colors.primaryDark : colors.text,
            }}>
              <span style={{ display: 'block', fontSize: type.base, fontWeight: 700 }}>{o.titulo}</span>
              <span style={{ display: 'block', fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>{o.texto}</span>
            </button>
          )
        })}
      </div>

      {esSalida && onApuntar && (
        <div style={{ fontSize: type.xs, color: colors.textDim, marginTop: 8, lineHeight: 1.5 }}>
          Si fue un pago (el pan, la luz…), no lo apuntes aquí:{' '}
          <button onClick={() => { onCerrar(); onApuntar() }} style={enlace}>apúntalo como pago</button>.
        </div>
      )}
      {esEntrada && (
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
          No cuenta como venta: solo cambia dónde está el dinero.
        </div>
      )}

      <div style={{ marginTop: 16, maxWidth: 260 }}>
        <label style={ds.label}>¿Cuánto?</label>
        <InputEuros value={importe} onChange={setImporte} grande onEnter={guardar} />
        {malEscrito && <AvisoImporte />}
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={ds.label}>Nota (opcional)</label>
        <input value={nota} onChange={e => setNota(e.target.value)} maxLength={140}
          placeholder="Ingreso en el cajero, cambio para el fin de semana…" style={ds.formInput} />
      </div>

      {puntos.length > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: radius.md,
          background: colors.surface2, border: `1px solid ${colors.border}`,
        }}>
          <span style={{ ...ds.label, marginBottom: 4 }}>Lo que va a pasar</span>
          {puntos.map((p, i) => (
            <div key={i} style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5, marginTop: 2 }}>{p}</div>
          ))}
        </div>
      )}
    </Ventana>
  )
}

/* ── Piezas pequeñas ──────────────────────────────────────────────────────── */

const botonTarjeta = { ...ds.secondaryBtn, height: 34, padding: '0 12px', fontSize: type.xs }

const enlace = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  color: colors.primary, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 'inherit',
}

function Bolsillo({ icono, titulo, saldo, frase, children }) {
  const n = Number(saldo || 0)
  return (
    <div style={{ ...ds.card, padding: 18, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textMute }}>
        {icono}
        <span style={{ fontSize: type.xs, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</span>
      </div>
      <div style={{
        fontSize: 32, fontWeight: 800, marginTop: 2, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums',
        color: n < 0 ? colors.danger : colors.text,
      }}>
        {eur(n)}
      </div>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4, lineHeight: 1.45 }}>{frase}</div>
      {children}
    </div>
  )
}

function Acciones({ children }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>{children}</div>
}

function Aviso({ texto, boton, onBoton }) {
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: radius.sm,
      background: colors.warningSoft, border: `1px solid ${colors.warning}`,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: type.xs, color: colors.text, lineHeight: 1.5 }}>
        <TriangleAlert size={13} color={colors.warning} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{texto}</span>
      </div>
      {boton && (
        <button onClick={onBoton} style={{ ...ds.primaryBtn, height: 34, marginTop: 8, fontSize: type.xs }}>{boton}</button>
      )}
    </div>
  )
}

function Fila({ label, valor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ fontSize: type.xs, color: colors.textDim, minWidth: 0 }}>{label}</span>
      <span style={{ fontSize: type.xs, fontWeight: 600, color: colors.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
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

function Ventana({ titulo, onCerrar, pie, children }) {
  return (
    <div style={ds.modal}>
      <div style={{ ...ds.modalContent, maxWidth: 480, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: type.lg, fontWeight: 800, color: colors.text }}>{titulo}</div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ ...ds.miniBtn, height: 30, width: 30, padding: 0 }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap',
          padding: '14px 20px', borderTop: `1px solid ${colors.border}`,
        }}>
          {pie}
        </div>
      </div>
    </div>
  )
}

// Si el importe no se entiende, Guardar se apaga: sin esta línea no se sabía por qué.
function AvisoImporte() {
  return (
    <div style={{ fontSize: type.xs, color: colors.danger, marginTop: 6, lineHeight: 1.5 }}>
      No entendemos ese importe. Escríbelo así: 1234,50
    </div>
  )
}

function InputEuros({ value, onChange, grande, autoFocus, onEnter }) {
  return (
    <div style={{ position: 'relative' }}>
      <input inputMode="decimal" value={value} autoFocus={autoFocus} placeholder="0,00"
        onChange={e => onChange(soloImporte(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }}
        style={{
          ...ds.formInput, paddingRight: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800,
          height: grande ? 52 : 38, fontSize: grande ? 24 : type.base,
        }} />
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: colors.textMute, fontSize: grande ? type.lg : type.sm }}>€</span>
    </div>
  )
}
