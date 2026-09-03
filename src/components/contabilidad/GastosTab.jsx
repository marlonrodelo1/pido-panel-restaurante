import { useState, useEffect } from 'react'
import { Trash2, Plus, CircleCheck } from 'lucide-react'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, CATEGORIAS_GASTO,
  cargarGastos, crearGasto, borrarGasto,
  cargarFijos, crearFijo, borrarFijo, apuntarFijo, apuntarFijosMes,
} from '../../lib/stock'

// La caja de gastos de Contabilidad: los FIJOS del mes (alquiler, sueldos, luz…)
// como plantilla con un botón "apuntar" por cada uno — un gasto se apunta CUANDO SE
// PAGA, y quien sabe si el recibo salió es el dueño, no un cron — y debajo los
// gastos sueltos de toda la vida (una reparación, la ferretería).
//
// Regla que se repite en pantalla porque se preguntó dos veces: las facturas de
// compra (comida, bebida, envases, aseo) NO van aquí — van en Facturas, y ya
// cuentan solas en el Resumen. Cada compra entra por UN solo sitio.

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default function GastosTab({ estId }) {
  const hoy = new Date()
  const desde = fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
  const hasta = fmt(hoy)
  const mesNombre = `${MESES[hoy.getMonth()]} ${hoy.getFullYear()}`

  const [gastos, setGastos] = useState([])
  const [fijos, setFijos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)
  const recargar = () => setRefresco(n => n + 1)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      try {
        const [gs, fs] = await Promise.all([cargarGastos(estId, desde, hasta), cargarFijos(estId)])
        if (!vivo) return
        setGastos(gs)
        setFijos(fs)
      } catch (e) {
        if (vivo) toast('No se han podido cargar los gastos: ' + e.message, 'error')
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, refresco])  // eslint-disable-line react-hooks/exhaustive-deps

  if (cargando) {
    return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Cargando los gastos…</div>
  }

  const apuntadosIds = new Set(gastos.map(g => g.fijo_id).filter(Boolean))
  const activos = fijos.filter(f => f.activo)
  const pendientes = activos.filter(f => !apuntadosIds.has(f.id))
  const totalFijos = activos.reduce((s, f) => s + Number(f.importe), 0)
  const totalPendiente = pendientes.reduce((s, f) => s + Number(f.importe), 0)
  const totalMes = gastos.reduce((s, g) => s + Number(g.importe), 0)

  return (
    <div style={{ display: 'grid', gap: 14, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
      <Fijos
        estId={estId} fijos={fijos} pendientes={pendientes} apuntadosIds={apuntadosIds}
        totalFijos={totalFijos} totalPendiente={totalPendiente} mesNombre={mesNombre}
        onCambio={recargar}
      />
      <Sueltos estId={estId} gastos={gastos} totalMes={totalMes} mesNombre={mesNombre} onCambio={recargar} />
    </div>
  )
}

/* ── Los fijos del mes ────────────────────────────────────────────────────── */

function Fijos({ estId, fijos, pendientes, apuntadosIds, totalFijos, totalPendiente, mesNombre, onCambio }) {
  const [alta, setAlta] = useState(false)
  const [v, setV] = useState({ categoria: '', concepto: '', importe: '' })
  const [guardando, setGuardando] = useState(false)

  const importe = Number(String(v.importe).replace(',', '.'))
  const valido = v.categoria.trim() && !Number.isNaN(importe) && importe > 0

  async function guardarFijo() {
    setGuardando(true)
    try {
      await crearFijo(estId, { ...v, importe })
      setV({ categoria: '', concepto: '', importe: '' })
      setAlta(false)
      toast('Fijo añadido', 'success')
      onCambio()
    } catch (e) { toast(e.message, 'error') }
    setGuardando(false)
  }

  async function apuntar(f) {
    try {
      await apuntarFijo(f.id)
      toast(`${f.categoria} apuntado: ${eur(f.importe)}`, 'success')
      onCambio()
    } catch (e) { toast(e.message, 'error') }
  }

  async function apuntarTodos() {
    if (!(await confirmar(
      `¿Apuntar los ${pendientes.length} fijos que faltan de ${mesNombre} (${eur(totalPendiente)})?\n\n` +
      `Hazlo solo si ya están pagados: un gasto se apunta cuando sale el dinero.`
    ))) return
    try {
      const r = await apuntarFijosMes(estId)
      toast(`${r.apuntados} fijos apuntados (${eur(r.total)})`, 'success')
      onCambio()
    } catch (e) { toast(e.message, 'error') }
  }

  async function borrar(f) {
    if (!(await confirmar(
      `¿Quitar "${f.categoria}" de la plantilla de fijos?\n\nLos meses ya apuntados no se tocan.`
    ))) return
    try {
      await borrarFijo(f.id)
      toast('Fijo quitado', 'success')
      onCambio()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>Gastos fijos</div>
        <div style={{ ...ds.muted }}>{eur(totalFijos)} al mes</div>
      </div>
      <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 2, marginBottom: 12, lineHeight: 1.5 }}>
        La plantilla de lo que pagas todos los meses. Cada uno se apunta{' '}
        <strong>cuando se paga</strong> — y apuntado dos veces no entra: un fijo solo
        cuenta una vez al mes.
      </div>

      {pendientes.length > 0 && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', borderRadius: radius.sm, marginBottom: 12, flexWrap: 'wrap',
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
        }}>
          <div style={{ fontSize: type.sm, color: colors.text }}>
            En {mesNombre} faltan <strong>{pendientes.length}</strong> por apuntar ({eur(totalPendiente)})
          </div>
          <button onClick={apuntarTodos} style={{ ...ds.miniBtn, flexShrink: 0 }}>
            Apuntar todos
          </button>
        </div>
      )}

      {fijos.length === 0 && (
        <div style={{ ...ds.muted, fontSize: type.sm, marginBottom: 10 }}>
          Todavía no tienes fijos. Añade el alquiler, la luz, los sueldos…
        </div>
      )}

      {fijos.map(f => {
        const hecho = apuntadosIds.has(f.id)
        return (
          <div key={f.id} style={{
            display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0',
            borderBottom: `1px solid ${colors.border}`,
            opacity: f.activo ? 1 : 0.5,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: type.sm, fontWeight: 600, color: colors.text }}>{f.categoria}</div>
              {f.concepto && (
                <div style={{ ...ds.muted, fontSize: type.xxs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.concepto}
                </div>
              )}
            </div>
            <div style={{ ...col(80), fontWeight: 700 }}>{eur(f.importe)}</div>
            <div style={{ ...col(104), display: 'inline-flex', justifyContent: 'flex-end', gap: 6 }}>
              {hecho ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: type.xxs, fontWeight: 700, color: colors.sage,
                }}>
                  <CircleCheck size={13} /> Este mes
                </span>
              ) : f.activo ? (
                <button onClick={() => apuntar(f)} title="Apuntarlo este mes (hazlo cuando esté pagado)"
                  style={{ ...ds.miniBtn, flexShrink: 0 }}>
                  Apuntar
                </button>
              ) : null}
              <button onClick={() => borrar(f)} title="Quitar de la plantilla"
                style={{ ...ds.miniBtnDanger, flexShrink: 0, padding: '4px 7px' }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )
      })}

      {alta ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
          <Campo label="Categoría">
            <input list="categorias-gasto-fijo" value={v.categoria} placeholder="Alquiler, Luz…" autoFocus
              onChange={e => setV(p => ({ ...p, categoria: e.target.value }))}
              style={{ ...ds.formInput, width: 140 }} />
            <datalist id="categorias-gasto-fijo">
              {CATEGORIAS_GASTO.map(c => <option key={c} value={c} />)}
            </datalist>
          </Campo>
          <Campo label="Nota (opcional)">
            <input value={v.concepto} placeholder="1.500 × 2 trabajadores"
              onChange={e => setV(p => ({ ...p, concepto: e.target.value }))}
              style={{ ...ds.formInput, width: 170 }} />
          </Campo>
          <Campo label="€ / mes">
            <input inputMode="decimal" value={v.importe} placeholder="750"
              onChange={e => setV(p => ({ ...p, importe: e.target.value }))}
              style={{ ...ds.formInput, width: 84, textAlign: 'right' }} />
          </Campo>
          <button onClick={guardarFijo} disabled={!valido || guardando}
            style={{ ...ds.primaryBtn, opacity: !valido || guardando ? 0.5 : 1 }}>
            Guardar
          </button>
          <button onClick={() => setAlta(false)} style={ds.secondaryBtn}>Cancelar</button>
        </div>
      ) : (
        <button onClick={() => setAlta(true)} style={{ ...ds.miniBtn, marginTop: 12 }}>
          <Plus size={12} /> Añadir fijo
        </button>
      )}
    </div>
  )
}

/* ── Gastos sueltos del mes ───────────────────────────────────────────────── */

function Sueltos({ estId, gastos, totalMes, mesNombre, onCambio }) {
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
    } catch (e) { toast(e.message, 'error') }
    setGuardando(false)
  }

  async function borrar(g) {
    if (!(await confirmar(`¿Borrar el gasto de ${eur(g.importe)} en "${g.categoria}"?`))) return
    try {
      await borrarGasto(g.id)
      toast('Gasto borrado', 'success')
      onCambio()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
          Gastos de {mesNombre}
        </div>
        <div style={{ ...ds.muted }}>{eur(totalMes)}</div>
      </div>
      <div style={{ ...ds.muted, fontSize: type.xs, marginTop: 2, marginBottom: 12, lineHeight: 1.5 }}>
        Pagos sueltos: una reparación, la ferretería, un recibo fuera de plantilla.
        Las facturas de compra (comida, bebida, envases, aseo) NO van aquí: van en{' '}
        <strong>Facturas</strong> y ya cuentan solas.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Campo label="Día">
          <input type="date" value={v.fecha} max={fmt(new Date())}
            onChange={e => setV(p => ({ ...p, fecha: e.target.value }))}
            style={{ ...ds.formInput, width: 138 }} />
        </Campo>
        <Campo label="Categoría">
          <input list="categorias-gasto" value={v.categoria} placeholder="Reparaciones…"
            onChange={e => setV(p => ({ ...p, categoria: e.target.value }))}
            style={{ ...ds.formInput, width: 136 }} />
          <datalist id="categorias-gasto">
            {CATEGORIAS_GASTO.map(c => <option key={c} value={c} />)}
          </datalist>
        </Campo>
        <Campo label="Concepto (opcional)">
          <input value={v.concepto} placeholder="Bombilla cocina"
            onChange={e => setV(p => ({ ...p, concepto: e.target.value }))}
            style={{ ...ds.formInput, width: 150 }} />
        </Campo>
        <Campo label="Importe (€)">
          <input inputMode="decimal" value={v.importe} placeholder="45,50"
            onChange={e => setV(p => ({ ...p, importe: e.target.value }))}
            style={{ ...ds.formInput, width: 90, textAlign: 'right' }} />
        </Campo>
        <button onClick={guardar} disabled={!valido || guardando}
          style={{ ...ds.primaryBtn, opacity: !valido || guardando ? 0.5 : 1 }}>
          Apuntar
        </button>
      </div>

      {gastos.length === 0 ? (
        <div style={{ ...ds.muted, fontSize: type.sm }}>Ningún gasto apuntado este mes.</div>
      ) : (
        <div style={tablaScroll}>
          <div style={{ ...ds.tableHeader, ...filaMin(520) }}>
            <span style={col(64, 'left')}>Día</span>
            <span style={col(130, 'left')}>Categoría</span>
            <span style={{ flex: 1, minWidth: 0 }}>Concepto</span>
            <span style={col(84)}>Importe</span>
            <span style={col(48)} />
          </div>
          {gastos.map(g => (
            <div key={g.id} style={{ ...ds.tableRow, ...filaMin(520) }}>
              <span style={{ ...col(64, 'left'), color: colors.textMute, fontSize: type.sm }}>
                {new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </span>
              <span style={{ ...col(130, 'left'), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.categoria}
              </span>
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: colors.textMute, fontSize: type.sm,
              }}>
                {g.concepto || '—'}{g.fijo_id ? ' · fijo' : ''}
              </span>
              <span style={{ ...col(84), fontWeight: 700 }}>{eur(g.importe)}</span>
              <span style={{ ...col(48), display: 'inline-flex', justifyContent: 'flex-end' }}>
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
