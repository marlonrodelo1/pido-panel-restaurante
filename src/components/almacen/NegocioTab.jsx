import { useState, useEffect } from 'react'
import { Trash2, CircleHelp } from 'lucide-react'
import { colors, ds, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, CATEGORIAS_GASTO, resumenNegocio, cargarGastos, crearGasto, borrarGasto,
} from '../../lib/stock'

// La pestaña Negocio: entró − salió = te quedó.
//
// "Entró" es lo que pasa por Pidoo — TPV, app, tienda pública, QR de mesa y
// teléfono — con la comisión ya descontada. Lo que se cobre fuera del TPV aquí no
// existe, y se dice en pantalla: una vista que calla sus puntos ciegos es una vista
// en la que no se puede confiar (mismo principio que el ResumenTab).
//
// "Salió" son las compras CONTABILIZADAS (por fecha de factura: criterio de caja,
// la compra cuenta cuando entra, no cuando se consume) más los gastos apuntados a
// mano: alquiler, luz, sueldos… La merma se enseña aparte y NO se suma: ya está
// dentro de las compras (se compró y se tiró), sumarla sería contarla dos veces.
//
// Todos los criterios viven comentados en `stock_resumen_negocio` en base de datos.

// El lunes como primer día, que es como corta la semana la liquidación de Pidoo.
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Nada de toISOString(): recorta en UTC y a medianoche canaria caería en el día
// anterior. Se formatea la fecha LOCAL del navegador, que es la de Canarias.
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
  // mes pasado
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

export default function NegocioTab({ estId, onIrA }) {
  const [periodo, setPeriodo] = useState('mes')
  const [datos, setDatos] = useState(null)
  const [gastos, setGastos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)
  const recargar = () => setRefresco(n => n + 1)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    const { desde, hasta } = rango(periodo)
    ;(async () => {
      try {
        const [res, gs] = await Promise.all([
          resumenNegocio(estId, desde, hasta),
          cargarGastos(estId, desde, hasta),
        ])
        if (!vivo) return
        setDatos(res)
        setGastos(gs)
      } catch (e) {
        if (vivo) toast('No se ha podido cargar el negocio: ' + e.message, 'error')
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, periodo, refresco])

  const v = datos?.ventas || {}
  const salio = Number(datos?.compras?.total || 0) + Number(datos?.gastos?.total || 0)
  const resultado = Number(datos?.resultado || 0)

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
          <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Grande label="Entró" valor={eur(v.neto)}
              pie={`${v.pedidos === 1 ? '1 pedido' : `${v.pedidos || 0} pedidos`}, comisión ya descontada`} />
            <Grande label="Salió" valor={eur(salio)} pie="Compras contabilizadas + gastos" />
            <Grande
              label="Te quedó" valor={eur(resultado)}
              tono={resultado > 0 ? 'sage' : resultado < 0 ? 'danger' : null}
              pie="Entró menos salió"
            />
          </div>

          <div style={{
            display: 'grid', gap: 14, marginTop: 14, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          }}>
            <div style={{ ...ds.card, padding: 18 }}>
              <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 10 }}>
                Lo que entró
              </div>
              <Linea label="Vendido (productos)" valor={eur(v.vendido)} />
              {Number(v.descuentos) > 0 && (
                <Linea label="Descuentos que regalaste" valor={'− ' + eur(v.descuentos)} />
              )}
              <Linea label="Comisión de Pidoo" valor={'− ' + eur(v.comision_pidoo)} />
              <Linea label="Tuyo" valor={eur(v.neto)} fuerte />
              <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 10, lineHeight: 1.5 }}>
                Cuenta lo que pasa por Pidoo: mostrador (TPV), app, tienda, mesa y teléfono.
                El envío y la propina no son tuyos (van al reparto) y no se cuentan.
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
                accion={onIrA ? () => onIrA('compras') : null}
              />
              {(datos?.gastos?.por_categoria || []).map(g => (
                <Linea key={g.categoria} label={`${g.categoria} (${g.apuntes})`} valor={eur(g.total)} />
              ))}
              <Linea label="Total" valor={eur(salio)} fuerte />
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

          <Gastos estId={estId} gastos={gastos} onCambio={recargar} />
        </>
      )}
    </div>
  )
}

/* ── Gastos: apuntar y ver ────────────────────────────────────────────────── */

function Gastos({ estId, gastos, onCambio }) {
  const [v, setV] = useState({ fecha: fmt(new Date()), categoria: '', concepto: '', importe: '' })
  const [guardando, setGuardando] = useState(false)

  const importe = Number(String(v.importe).replace(',', '.'))
  const valido = v.categoria.trim() && !Number.isNaN(importe) && importe > 0

  async function guardar() {
    setGuardando(true)
    try {
      await crearGasto(estId, { ...v, importe })
      setV({ fecha: fmt(new Date()), categoria: '', concepto: '', importe: '' })
      toast('Gasto apuntado', 'success')
      onCambio()
    } catch (e) {
      toast(e.message, 'error')
    }
    setGuardando(false)
  }

  async function borrar(g) {
    if (!(await confirmar(`¿Borrar el gasto de ${eur(g.importe)} en "${g.categoria}"?`))) return
    try {
      await borrarGasto(g.id)
      toast('Gasto borrado', 'success')
      onCambio()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div style={{ ...ds.card, padding: 18, marginTop: 14 }}>
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
        Gastos
      </div>
      <div style={{ ...ds.muted, fontSize: type.xs, marginBottom: 12, lineHeight: 1.5 }}>
        Lo que pagas y no es una compra de artículos: alquiler, luz, agua, gestoría,
        sueldos… Las facturas de comida y consumibles NO van aquí: van en{' '}
        <strong>Compras</strong>, que ya cuentan solas.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Campo label="Día">
          <input type="date" value={v.fecha} max={fmt(new Date())}
            onChange={e => setV(p => ({ ...p, fecha: e.target.value }))}
            style={{ ...ds.formInput, width: 140 }} />
        </Campo>
        <Campo label="Categoría">
          <input list="categorias-gasto" value={v.categoria} placeholder="Luz, Alquiler…"
            onChange={e => setV(p => ({ ...p, categoria: e.target.value }))}
            style={{ ...ds.formInput, width: 150 }} />
          <datalist id="categorias-gasto">
            {CATEGORIAS_GASTO.map(c => <option key={c} value={c} />)}
          </datalist>
        </Campo>
        <Campo label="Concepto (opcional)">
          <input value={v.concepto} placeholder="Recibo de agosto"
            onChange={e => setV(p => ({ ...p, concepto: e.target.value }))}
            style={{ ...ds.formInput, width: 200 }} />
        </Campo>
        <Campo label="Importe (€)">
          <input inputMode="decimal" value={v.importe} placeholder="45,50"
            onChange={e => setV(p => ({ ...p, importe: e.target.value }))}
            style={{ ...ds.formInput, width: 100, textAlign: 'right' }} />
        </Campo>
        <button onClick={guardar} disabled={!valido || guardando}
          style={{ ...ds.primaryBtn, opacity: !valido || guardando ? 0.5 : 1 }}>
          Apuntar
        </button>
      </div>

      {gastos.length === 0 ? (
        <div style={{ ...ds.muted, fontSize: type.sm }}>
          Ningún gasto apuntado en este periodo.
        </div>
      ) : (
        <div style={tablaScroll}>
          <div style={{ ...ds.tableHeader, ...filaMin(560) }}>
            <span style={col(90, 'left')}>Día</span>
            <span style={col(140, 'left')}>Categoría</span>
            <span style={{ flex: 1, minWidth: 0 }}>Concepto</span>
            <span style={col(90)}>Importe</span>
            <span style={col(52)} />
          </div>
          {gastos.map(g => (
            <div key={g.id} style={{ ...ds.tableRow, ...filaMin(560) }}>
              <span style={{ ...col(90, 'left'), color: colors.textMute, fontSize: type.sm }}>
                {new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </span>
              <span style={{ ...col(140, 'left'), fontWeight: 600 }}>{g.categoria}</span>
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: colors.textMute, fontSize: type.sm,
              }}>
                {g.concepto || '—'}
              </span>
              <span style={{ ...col(90), fontWeight: 700 }}>{eur(g.importe)}</span>
              <span style={{ ...col(52), display: 'inline-flex', justifyContent: 'flex-end' }}>
                <button onClick={() => borrar(g)} title="Borrar gasto"
                  style={{ ...ds.miniBtnDanger, padding: '4px 8px' }}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */

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

function Campo({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </span>
      {children}
    </label>
  )
}
