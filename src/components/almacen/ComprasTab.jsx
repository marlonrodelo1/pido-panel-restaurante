import { useState, useEffect } from 'react'
import { Plus, FileText, CircleCheck, Circle, ShoppingCart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { eur } from '../../lib/stock'
import FacturaEditor from './FacturaEditor'

// Las compras a los proveedores.
//
// Dos puertas, según lo que tengas en la mano:
//   - «Compra rápida»: el pan de hoy, una caja de refrescos. Qué, cuántos y cuánto pagaste;
//     entra en el almacén y, si salió del cajón, sale de la caja en el mismo paso.
//   - «Nueva factura»: la factura larga del proveedor, con cajas, packs y total del papel.
//     Es un BORRADOR hasta que se pulsa «Contabilizar»: hasta entonces no mueve ni una
//     unidad del almacén, así que se puede teclear con calma y corregir.
// Las dos son la misma tabla y cuentan igual en las cuentas.
export default function ComprasTab({ estId, articulos, onCambio, recarga, onApuntar }) {
  const [facturas, setFacturas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [abierta, setAbierta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      const [f, p] = await Promise.all([
        supabase.from('stock_facturas')
          .select('*, stock_proveedores(nombre), stock_factura_lineas(id)')
          .eq('establecimiento_id', estId).order('fecha', { ascending: false })
          .order('created_at', { ascending: false }).limit(80),
        supabase.from('stock_proveedores').select('*')
          .eq('establecimiento_id', estId).order('nombre'),
      ])
      if (!vivo) return
      setFacturas(f.data || [])
      setProveedores(p.data || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, refresco, recarga])

  const recargar = () => { setRefresco(n => n + 1); onCambio?.() }

  if (cargando) return <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 300px', fontSize: type.sm, color: colors.textMute, lineHeight: 1.5 }}>
          <strong style={{ color: colors.text }}>Compra rápida</strong> para lo de todos los días (el pan, una caja
          de refrescos). <strong style={{ color: colors.text }}>Nueva factura</strong> para la factura larga del
          proveedor. Las dos entran en el almacén y cada artículo se queda con el precio que pagaste.
        </div>
        {onApuntar && (
          <button onClick={() => onApuntar({ modo: 'compra' })} style={ds.primaryBtn}>
            <ShoppingCart size={15} /> Compra rápida
          </button>
        )}
        <button onClick={() => setAbierta({})} style={onApuntar ? ds.secondaryBtn : ds.primaryBtn}>
          <Plus size={15} /> Nueva factura
        </button>
      </div>

      {!articulos.length && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
          fontSize: type.sm, lineHeight: 1.6, color: colors.text,
        }}>
          Todavía no tienes artículos. En una compra solo entra lo que le compras al
          proveedor —el pan, la carne, el aceite, los refrescos—, no los platos de tu carta.
          Puedes crearlos sin salir de aquí: en la compra, escribe el nombre y dale a <strong>Crear</strong>.
        </div>
      )}

      <div style={{ ...ds.table, ...tablaScroll }}>
        <div style={{ ...ds.tableHeader, ...filaMin(700) }}>
          <div style={col(22, 'left')}></div>
          <div style={col(88, 'left')}>Fecha</div>
          <div style={{ flex: 1, minWidth: 0 }}>Proveedor</div>
          <div style={col(104, 'left')}>Número</div>
          <div style={col(72)}>Líneas</div>
          <div style={col(96)}>Total</div>
        </div>

        {facturas.map(f => (
          <button key={f.id} onClick={() => setAbierta(f)} style={{
            ...ds.tableRow, ...filaMin(700), width: '100%', textAlign: 'left', cursor: 'pointer',
            background: colors.paper, fontFamily: 'inherit',
            borderLeft: 'none', borderRight: 'none', borderTop: 'none',
          }}>
            <div style={{ ...col(22, 'left'), display: 'flex' }}>
              {f.contabilizada
                ? <CircleCheck size={16} color={colors.sage2} />
                : <Circle size={16} color={colors.warning} />}
            </div>
            <div style={{ ...col(88, 'left'), color: colors.textMute }}>
              {new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </div>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 600, color: colors.text }}>
              {f.stock_proveedores?.nombre || (f.origen === 'rapida' ? 'Compra rápida' : 'Sin proveedor')}
              <div style={{ ...ds.muted, fontWeight: 400, marginTop: 1 }}>
                {[
                  f.contabilizada
                    ? (f.origen === 'rapida' && !f.stock_proveedores?.nombre ? 'Ya en tu almacén'
                      : f.origen === 'rapida' ? 'Compra rápida · ya en tu almacén' : 'Contabilizada · ya en tu almacén')
                    : 'Borrador · no ha entrado en el almacén',
                  f.pagado_con === 'caja' ? 'pagada con el cajón' : f.pagado_con === 'banco' ? 'pagada por banco' : null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ ...col(104, 'left'), color: colors.textMute,
              overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.numero || '—'}</div>
            <div style={{ ...col(72), color: colors.textMute }}>
              {f.stock_factura_lineas?.length || 0}
            </div>
            <div style={{ ...col(96), fontWeight: 700 }}>
              {eur(f.total)}
            </div>
          </button>
        ))}

        {!facturas.length && (
          <div style={{ ...ds.muted, padding: 34, textAlign: 'center' }}>
            <FileText size={22} color={colors.borderStrong} style={{ marginBottom: 8 }} />
            <div>Todavía no has apuntado ninguna compra. Cada una pone al día lo que te cuesta cada artículo.</div>
          </div>
        )}
      </div>

      {abierta && (
        <FacturaEditor
          estId={estId}
          factura={abierta.id ? abierta : null}
          articulos={articulos}
          proveedores={proveedores}
          onCerrar={() => setAbierta(null)}
          onGuardado={() => { setAbierta(null); recargar() }}
        />
      )}
    </div>
  )
}
