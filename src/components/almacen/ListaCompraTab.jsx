import { useState } from 'react'
import { ShoppingCart, Copy } from 'lucide-react'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast } from '../../App'
import { cantidad, eur } from '../../lib/stock'

// La lista de la compra: qué reponer antes de que se acabe. Sale de los MÍNIMOS que
// el dueño le pone a cada artículo (botón Editar): todo lo que esté por debajo entra
// aquí, con la cantidad sugerida REDONDEADA a envases de compra (si el pan viene en
// paquetes de 12, se sugieren paquetes, no 7 panes sueltos) y su coste estimado.
// Sin backend: se calcula de los artículos que ya están cargados.

export default function ListaCompraTab({ articulos, onIrA }) {
  const [marcados, setMarcados] = useState({})   // id -> excluido

  const conMinimo = articulos.filter(a => a.activo && Number(a.minimo) > 0)
  const filas = conMinimo
    .filter(a => Number(a.existencia) <= Number(a.minimo))
    .map(a => {
      const falta = Math.max(Number(a.minimo) - Number(a.existencia), 0)
      const factor = Number(a.factor_compra) || 1
      const packs = Math.max(Math.ceil(falta / factor), 1)
      return {
        ...a,
        falta,
        packs,
        entra: packs * factor,
        coste: packs * factor * Number(a.coste_medio),
      }
    })
    .sort((x, y) => y.coste - x.coste)

  const incluidas = filas.filter(f => !marcados[f.id])
  const total = incluidas.reduce((s, f) => s + f.coste, 0)

  async function copiar() {
    const lineas = incluidas.map(f =>
      `- ${f.nombre}: ${f.packs > 1 || (f.unidad_compra && f.unidad_compra !== f.unidad) ? `${f.packs} × ${f.unidad_compra || 'ud'}` : cantidad(f.entra, f.unidad)}`)
    const texto = `Compra pendiente:\n${lineas.join('\n')}\n(estimado ${eur(total)})`
    try {
      await navigator.clipboard.writeText(texto)
      toast('Lista copiada: pégala donde quieras', 'success')
    } catch {
      toast('No se ha podido copiar', 'error')
    }
  }

  if (conMinimo.length === 0) {
    return (
      <div style={{ ...ds.card, padding: 30, maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <ShoppingCart size={20} color={colors.textMute} />
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
            Ponles mínimo a tus artículos y esta lista se hace sola
          </div>
        </div>
        <div style={{ ...ds.muted, fontSize: type.sm, lineHeight: 1.6 }}>
          En <strong>Artículos de compra → Editar</strong>, cada artículo tiene
          "Avísame cuando queden menos de". En cuanto algo baje de su mínimo, aparece
          aquí con la cantidad a comprar ya redondeada a cajas y paquetes, y el coste
          estimado de la compra.
        </div>
        {onIrA && (
          <button onClick={() => onIrA('articulos')} style={{ ...ds.miniBtn, marginTop: 14 }}>
            Ir a ponerlos
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ ...ds.muted, fontSize: type.sm }}>
          {filas.length === 0
            ? <>Vigilando {conMinimo.length} artículos con mínimo: ninguno necesita compra.</>
            : <>{incluidas.length} artículos por reponer · compra estimada <strong style={{ color: colors.text }}>{eur(total)}</strong></>}
        </div>
        {filas.length > 0 && (
          <button onClick={copiar} style={ds.miniBtn} title="Copiar la lista para mandarla por WhatsApp">
            <Copy size={13} /> Copiar lista
          </button>
        )}
      </div>

      {filas.length === 0 ? (
        <div style={{
          padding: '14px 16px', borderRadius: radius.md, maxWidth: 640,
          border: `1px solid ${colors.sageSoft}`, background: colors.sageSoft,
          fontSize: type.sm, color: colors.text,
        }}>
          Todo por encima del mínimo. Cuando algo baje, aparecerá aquí solo.
        </div>
      ) : (
        <div style={{ ...ds.table, ...tablaScroll }}>
          <div style={{ ...ds.tableHeader, ...filaMin(720) }}>
            <div style={col(40, 'left')} />
            <div style={{ flex: 1, minWidth: 0 }}>Artículo</div>
            <div style={col(96)}>Quedan</div>
            <div style={col(80)}>Mínimo</div>
            <div style={col(150)}>Compra sugerida</div>
            <div style={col(96)}>Estimado</div>
          </div>
          {filas.map(f => {
            const fuera = !!marcados[f.id]
            return (
              <div key={f.id} style={{ ...ds.tableRow, ...filaMin(720), opacity: fuera ? 0.4 : 1 }}>
                <div style={col(40, 'left')}>
                  <input type="checkbox" checked={!fuera}
                    onChange={() => setMarcados(m => ({ ...m, [f.id]: !fuera }))}
                    title="Quitar o volver a poner en la lista"
                    style={{ width: 16, height: 16, accentColor: colors.primary, cursor: 'pointer' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: type.sm, fontWeight: 600, color: colors.text, display: 'block',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{f.nombre}</span>
                  {f.familia && <span style={{ ...ds.muted, fontSize: type.xxs }}>{f.familia}</span>}
                </div>
                <div style={{ ...col(96), fontWeight: 700, color: Number(f.existencia) < 0 ? colors.danger : colors.text }}>
                  {cantidad(f.existencia, f.unidad)}
                </div>
                <div style={{ ...col(80), color: colors.textMute }}>{cantidad(f.minimo, f.unidad)}</div>
                <div style={{ ...col(150), fontWeight: 700 }}>
                  {f.unidad_compra && f.unidad_compra !== f.unidad
                    ? `${f.packs} × ${f.unidad_compra}`
                    : cantidad(f.entra, f.unidad)}
                </div>
                <div style={{ ...col(96), color: colors.textMute }}>
                  {f.coste > 0 ? eur(f.coste) : '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
