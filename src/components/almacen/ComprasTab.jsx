import { useState, useEffect } from 'react'
import { Plus, FileText, CircleCheck, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { eur } from '../../lib/stock'
import FacturaEditor from './FacturaEditor'

// Las facturas de los proveedores.
//
// Una factura es un BORRADOR hasta que se pulsa «Contabilizar»: hasta entonces no
// mueve ni una unidad del almacén, así que se puede teclear con calma y corregir.
// Al contabilizar entra la mercancía y se recalcula el coste medio de cada artículo,
// que es de donde salen los márgenes de los escandallos.
export default function ComprasTab({ estId, articulos, onCambio }) {
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
          .eq('establecimiento_id', estId).order('fecha', { ascending: false }).limit(80),
        supabase.from('stock_proveedores').select('*')
          .eq('establecimiento_id', estId).order('nombre'),
      ])
      if (!vivo) return
      setFacturas(f.data || [])
      setProveedores(p.data || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, refresco])

  const recargar = () => { setRefresco(n => n + 1); onCambio?.() }

  if (cargando) return <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, ...ds.muted }}>
          Mete aquí lo que te traen tus proveedores. Al contabilizar la factura, la
          mercancía entra en el almacén y se recalcula lo que te cuesta cada cosa.
        </div>
        <button onClick={() => setAbierta({})} style={ds.primaryBtn}>
          <Plus size={15} /> Factura
        </button>
      </div>

      {!articulos.length && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
          fontSize: type.sm, lineHeight: 1.6, color: colors.text,
        }}>
          Todavía no tienes artículos. Créalos en la pestaña <strong>Artículos</strong>:
          una factura se compone de artículos de tu almacén.
        </div>
      )}

      <div style={ds.table}>
        <div style={ds.tableHeader}>
          <div style={{ width: 26 }}></div>
          <div style={{ width: 100 }}>Fecha</div>
          <div style={{ flex: 1 }}>Proveedor</div>
          <div style={{ width: 120 }}>Número</div>
          <div style={{ width: 90, textAlign: 'right' }}>Líneas</div>
          <div style={{ width: 110, textAlign: 'right' }}>Total</div>
        </div>

        {facturas.map(f => (
          <button key={f.id} onClick={() => setAbierta(f)} style={{
            ...ds.tableRow, width: '100%', textAlign: 'left', cursor: 'pointer',
            background: colors.paper, fontFamily: 'inherit',
            borderLeft: 'none', borderRight: 'none', borderTop: 'none',
          }}>
            <div style={{ width: 26, display: 'flex' }}>
              {f.contabilizada
                ? <CircleCheck size={16} color={colors.sage2} />
                : <Circle size={16} color={colors.warning} />}
            </div>
            <div style={{ width: 100, color: colors.textMute }}>
              {new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </div>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 600, color: colors.text }}>
              {f.stock_proveedores?.nombre || 'Sin proveedor'}
              <div style={{ ...ds.muted, fontWeight: 400, marginTop: 1 }}>
                {f.contabilizada ? 'Contabilizada' : 'Borrador · no ha entrado en el almacén'}
              </div>
            </div>
            <div style={{ width: 120, color: colors.textMute }}>{f.numero || '—'}</div>
            <div style={{ width: 90, textAlign: 'right', color: colors.textMute }}>
              {f.stock_factura_lineas?.length || 0}
            </div>
            <div style={{ width: 110, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {eur(f.total)}
            </div>
          </button>
        ))}

        {!facturas.length && (
          <div style={{ ...ds.muted, padding: 34, textAlign: 'center' }}>
            <FileText size={22} color={colors.borderStrong} style={{ marginBottom: 8 }} />
            <div>Todavía no has metido ninguna factura.</div>
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
