import { useState, useEffect } from 'react'
import { TriangleAlert, TrendingDown, CircleHelp, Trash2, ClipboardCheck } from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { eur, cantidad, cargarMovimientos } from '../../lib/stock'

// El resumen del almacén de un vistazo.
//
// Enseña los puntos ciegos EN LUGAR de esconderlos: hay ventas que el sistema no puede
// descontar (pedidos telefónicos sin desglose, platos sin receta, líneas de importe
// libre del TPV). Un inventario que no dice dónde no llega es un inventario en el que
// nadie confía la segunda semana.
export default function ResumenTab({ estId, resumen, articulos, onIrA }) {
  const v = resumen?.valor || {}
  const c = resumen?.ciegos

  const negativos = articulos.filter(a => a.activo && Number(a.existencia) < 0)
  const bajos = articulos.filter(a =>
    a.activo && Number(a.minimo) > 0 && Number(a.existencia) <= Number(a.minimo) && Number(a.existencia) >= 0)

  const ciegasTotal = (c?.pedidos_telefonicos || 0) + (c?.lineas_sin_escandallo || 0) + (c?.lineas_sin_producto || 0)

  const mermas = resumen?.mermas
  const mes = resumen?.desdeMes
    ? resumen.desdeMes.toLocaleDateString('es-ES', { month: 'long' })
    : 'este mes'

  return (
    <div>
      <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Tarjeta label="Valor del inventario" valor={eur(v.valor)} />
        <Tarjeta label="Artículos de compra" valor={v.articulos || 0} />
        <Tarjeta label="Bajo mínimo" valor={v.bajo_minimo || 0} tono={v.bajo_minimo > 0 ? 'warning' : null} />
        <Tarjeta label="En negativo" valor={v.en_negativo || 0} tono={v.en_negativo > 0 ? 'danger' : null} />
        {mermas && mermas.total > 0 && (
          <Tarjeta label={`Perdido en ${mes}`} valor={eur(mermas.total)} tono="warning" />
        )}
      </div>

      {/* Rejilla, no bloques apilados: cada aviso ocupa lo que necesita y en un
          monitor ancho van de dos en dos, en vez de una columna de cajas de 1080 px
          con tres lineas dentro. `align-items: start` para que uno corto no se estire
          a la altura del de al lado. */}
      <div style={{
        display: 'grid', gap: 14, marginTop: 14, alignItems: 'start',
        gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
      }}>
      {negativos.length > 0 && (
        <Bloque
          tono="danger"
          icono={<TrendingDown size={16} color={colors.danger} />}
          titulo="Tienes existencias en negativo"
          texto="Significa que se ha vendido más de lo que el sistema creía que había. No es un fallo grave: el mostrador nunca frena una venta por falta de stock, a propósito. Se arregla con un recuento."
        >
          <Lista items={negativos.map(a => `${a.nombre} · ${cantidad(a.existencia, a.unidad)}`)} />
          <button onClick={() => onIrA('articulos')} style={{ ...ds.miniBtn, marginTop: 10 }}>
            Ir a corregirlo
          </button>
        </Bloque>
      )}

      {bajos.length > 0 && (
        <Bloque
          tono="warning"
          icono={<TriangleAlert size={16} color={colors.warning} />}
          titulo="Se te está acabando"
          texto="Estos artículos están en su mínimo o por debajo."
        >
          <Lista items={bajos.map(a => `${a.nombre} · quedan ${cantidad(a.existencia, a.unidad)}`)} />
        </Bloque>
      )}

      {ciegasTotal > 0 && (
        <Bloque
          tono="info"
          icono={<CircleHelp size={16} color={colors.info} />}
          titulo="Lo que el almacén no ha podido descontar"
          texto="Se cuadra solo con el recuento. Está aquí para que sepas de dónde viene la diferencia cuando cuentes, en vez de pensar que faltan cosas."
        >
          <ul style={{ ...listaGrid, gridTemplateColumns: '1fr', paddingLeft: 18, listStyle: 'disc' }}>
            {c.pedidos_telefonicos > 0 && (
              <li>
                <strong>{c.pedidos_telefonicos}</strong> pedido{c.pedidos_telefonicos === 1 ? '' : 's'} por
                teléfono este mes. Se cobran por importe, sin desglose de platos, así que
                no hay forma de saber qué salió de la cámara.
              </li>
            )}
            {c.lineas_sin_escandallo > 0 && (
              <li>
                <strong>{c.lineas_sin_escandallo}</strong> línea{c.lineas_sin_escandallo === 1 ? '' : 's'} de
                platos que todavía no tienen receta. Es lo normal al principio: solo
                descuentan del almacén los platos a los que ya les hayas escrito el
                escandallo.
              </li>
            )}
            {c.lineas_sin_producto > 0 && (
              <li>
                <strong>{c.lineas_sin_producto}</strong> cobro{c.lineas_sin_producto === 1 ? '' : 's'} de
                importe libre en el mostrador, sin producto de la carta detrás.
              </li>
            )}
          </ul>
        </Bloque>
      )}

      {mermas && mermas.apuntes > 0 && (
        <Bloque
          tono="warning"
          icono={<Trash2 size={16} color={colors.warning} />}
          titulo={`Lo que se ha perdido en ${mes}: ${eur(mermas.total)}`}
          texto={`${mermas.apuntes} apunte${mermas.apuntes === 1 ? '' : 's'} de merma. Cada vez que se rompe, caduca o se tira algo se va sumando aquí solo: no hay que cerrar nada ni hacer cortes.`}
        >
          <ul style={listaGrid}>
            {mermas.articulos.slice(0, 6).map(a => (
              <li key={a.nombre}>
                <strong>{a.nombre}</strong> · {cantidad(a.cantidad, a.unidad)}
                {a.euros > 0 && <> · <strong>{eur(a.euros)}</strong></>}
                <span style={{ color: colors.textMute }}>
                  {' '}({a.veces} {a.veces === 1 ? 'vez' : 'veces'})
                </span>
              </li>
            ))}
            {mermas.articulos.length > 6 && (
              <li style={{ color: colors.textMute }}>y {mermas.articulos.length - 6} más…</li>
            )}
          </ul>
        </Bloque>
      )}

      {v.sin_coste > 0 && (
        <Bloque
          tono="info"
          icono={<CircleHelp size={16} color={colors.info} />}
          titulo={`${v.sin_coste} artículo${v.sin_coste === 1 ? '' : 's'} sin precio de coste`}
          texto="Hasta que no metas una factura de compra o les pongas el coste al hacer un recuento, los platos que lleven esos artículos te saldrán con un margen del 100 %, que no es real."
        />
      )}

      <RecuentoBloque estId={estId} />
      </div>
    </div>
  )
}

// El RESULTADO del recuento, en euros: cuando se cuenta lo que hay de verdad, la
// diferencia con lo que el sistema creía queda apuntada (tipo 'recuento'). Aquí se
// suman los últimos 60 días y se valoran — negativo = faltaba género (se vendió sin
// descontar, se tiró sin apuntar… o se fue por la puerta). Es donde el inventario
// cuadra o descubre el agujero. Solo aparece si ha habido recuentos.
function RecuentoBloque({ estId }) {
  const [movs, setMovs] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    cargarMovimientos(estId, { tipo: 'recuento', limite: 500 })
      .then(ms => {
        if (!vivo) return
        const corte = Date.now() - 60 * 24 * 3600 * 1000
        setMovs(ms.filter(m => new Date(m.created_at).getTime() >= corte && Number(m.cantidad) !== 0))
      })
      .catch(() => { if (vivo) setMovs([]) })
    return () => { vivo = false }
  }, [estId])

  if (!movs || movs.length === 0) return null

  const porArticulo = {}
  let total = 0
  for (const m of movs) {
    const euros = Number(m.cantidad) * Number(m.coste_unitario || 0)
    total += euros
    const nombre = m.stock_articulos?.nombre || '—'
    porArticulo[nombre] = porArticulo[nombre] || { nombre, unidad: m.stock_articulos?.unidad || 'ud', cant: 0, euros: 0 }
    porArticulo[nombre].cant += Number(m.cantidad)
    porArticulo[nombre].euros += euros
  }
  const top = Object.values(porArticulo).sort((a, b) => Math.abs(b.euros) - Math.abs(a.euros)).slice(0, 6)

  return (
    <Bloque
      tono={total < -1 ? 'danger' : 'info'}
      icono={<ClipboardCheck size={16} color={total < -1 ? colors.danger : colors.info} />}
      titulo={`Resultado de tus recuentos (últimos 60 días): ${total > 0 ? '+' : ''}${eur(total)}`}
      texto={total < -1
        ? 'Al contar había MENOS de lo que el sistema creía. Ahí dentro están las ventas que no descontaron (platos sin receta), lo tirado sin apuntar como merma… o lo que se fue por la puerta. Cuantas más recetas tengas, más pequeño será este número.'
        : 'La diferencia entre lo que el sistema creía y lo que contaste, ya valorada. Cerca de cero = el almacén dice la verdad.'}
    >
      <Lista items={top.map(a =>
        `${a.nombre} · ${a.cant > 0 ? '+' : ''}${cantidad(a.cant, a.unidad)} · ${a.euros > 0 ? '+' : ''}${eur(a.euros)}`)} />
    </Bloque>
  )
}

function Tarjeta({ label, valor, tono }) {
  const bg = tono === 'danger' ? colors.dangerSoft : tono === 'warning' ? colors.warningSoft : colors.paper
  const bd = tono === 'danger' ? colors.danger : tono === 'warning' ? colors.warning : colors.border
  const fg = tono === 'danger' ? colors.danger : colors.text
  return (
    <div style={{ ...ds.card, background: bg, borderColor: bd, padding: '14px 16px' }}>
      <div style={{ ...ds.label, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: fg, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function Bloque({ tono, icono, titulo, texto, children }) {
  const bd = tono === 'danger' ? colors.danger : tono === 'warning' ? colors.warning : colors.info
  const bg = tono === 'danger' ? colors.dangerSoft : tono === 'warning' ? colors.warningSoft : colors.infoSoft
  return (
    <div style={{
      padding: '14px 16px', borderRadius: radius.md,
      border: `1px solid ${bd}`, background: bg,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {icono}
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>{titulo}</div>
      </div>
      <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.6 }}>{texto}</div>
      {children}
    </div>
  )
}

// Si el bloque queda ancho (porque va solo en su fila), la lista se reparte en
// columnas en vez de dejar medio bloque en blanco.
const listaGrid = {
  margin: '10px 0 0', padding: 0, listStyle: 'none',
  display: 'grid', gap: '4px 18px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
  fontSize: type.sm, color: colors.textDim, lineHeight: 1.6,
}

function Lista({ items }) {
  return (
    <ul style={listaGrid}>
      {items.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
      {items.length > 8 && <li style={{ color: colors.textMute }}>y {items.length - 8} más…</li>}
    </ul>
  )
}
