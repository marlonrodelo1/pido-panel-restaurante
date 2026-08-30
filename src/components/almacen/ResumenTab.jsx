import { TriangleAlert, TrendingDown, CircleHelp } from 'lucide-react'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { eur, cantidad } from '../../lib/stock'

// El resumen del almacén de un vistazo.
//
// Enseña los puntos ciegos EN LUGAR de esconderlos: hay ventas que el sistema no puede
// descontar (pedidos telefónicos sin desglose, platos sin receta, líneas de importe
// libre del TPV). Un inventario que no dice dónde no llega es un inventario en el que
// nadie confía la segunda semana.
export default function ResumenTab({ resumen, articulos, onIrA }) {
  const v = resumen?.valor || {}
  const c = resumen?.ciegos

  const negativos = articulos.filter(a => a.activo && Number(a.existencia) < 0)
  const bajos = articulos.filter(a =>
    a.activo && Number(a.minimo) > 0 && Number(a.existencia) <= Number(a.minimo) && Number(a.existencia) >= 0)

  const ciegasTotal = (c?.pedidos_telefonicos || 0) + (c?.lineas_sin_escandallo || 0) + (c?.lineas_sin_producto || 0)

  return (
    <div>
      <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Tarjeta label="Valor del inventario" valor={eur(v.valor)} />
        <Tarjeta label="Artículos controlados" valor={v.articulos || 0} />
        <Tarjeta label="Bajo mínimo" valor={v.bajo_minimo || 0} tono={v.bajo_minimo > 0 ? 'warning' : null} />
        <Tarjeta label="En negativo" valor={v.en_negativo || 0} tono={v.en_negativo > 0 ? 'danger' : null} />
      </div>

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
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: type.sm, color: colors.textDim, lineHeight: 1.7 }}>
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
                productos que todavía no tienen receta. Es lo normal al principio: solo
                descuentan los que hayas escandallado.
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

      {v.sin_coste > 0 && (
        <Bloque
          tono="info"
          icono={<CircleHelp size={16} color={colors.info} />}
          titulo={`${v.sin_coste} artículo${v.sin_coste === 1 ? '' : 's'} sin precio de coste`}
          texto="Hasta que metas una factura de compra o le pongas el coste en un recuento, tus platos saldrán con un margen del 100 %, que no es real."
        />
      )}
    </div>
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
      marginTop: 14, padding: '14px 16px', borderRadius: radius.md,
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

function Lista({ items }) {
  return (
    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: type.sm, color: colors.textDim, lineHeight: 1.7 }}>
      {items.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
      {items.length > 8 && <li style={{ color: colors.textMute }}>y {items.length - 8} más…</li>}
    </ul>
  )
}
