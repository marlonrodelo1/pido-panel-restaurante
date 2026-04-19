import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

// Rangos soportados
const RANGOS = [
  { id: 'semana_actual', label: 'Esta semana' },
  { id: 'semana_pasada', label: 'Semana pasada' },
  { id: 'mes_actual', label: 'Mes actual' },
  { id: 'ultimos_30', label: 'Últimos 30 días' },
]

// Devuelve [desde, hasta] como Date en zona local, cubriendo el periodo seleccionado.
// La semana arranca en lunes.
function rangoFechas(id) {
  const ahora = new Date()
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  if (id === 'ultimos_30') {
    const desde = new Date(hoyInicio); desde.setDate(desde.getDate() - 29)
    const hasta = new Date(hoyInicio); hasta.setDate(hasta.getDate() + 1)
    return [desde, hasta]
  }
  if (id === 'mes_actual') {
    const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
    const hasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1)
    return [desde, hasta]
  }
  // semanales: lunes 00:00 - lunes siguiente 00:00
  const dow = hoyInicio.getDay() // 0 dom .. 6 sab
  const offsetLunes = dow === 0 ? 6 : dow - 1
  const lunesActual = new Date(hoyInicio); lunesActual.setDate(lunesActual.getDate() - offsetLunes)
  if (id === 'semana_actual') {
    const hasta = new Date(lunesActual); hasta.setDate(hasta.getDate() + 7)
    return [lunesActual, hasta]
  }
  if (id === 'semana_pasada') {
    const desde = new Date(lunesActual); desde.setDate(desde.getDate() - 7)
    return [desde, lunesActual]
  }
  return [hoyInicio, new Date(hoyInicio.getTime() + 86400000)]
}

function fmtMoney(n) {
  return `${Number(n || 0).toFixed(2)} €`
}

function fmtFecha(d) {
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtFechaCorta(d) {
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

function fmtFechaHora(d) {
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FinanzasRestaurante() {
  const { restaurante } = useRest()
  const [rango, setRango] = useState('semana_actual')
  const [pedidos, setPedidos] = useState([])
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [comisionPct, setComisionPct] = useState(10)

  const [desde, hasta] = useMemo(() => rangoFechas(rango), [rango])

  useEffect(() => {
    if (!restaurante?.id) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurante?.id, rango])

  async function cargar() {
    setLoading(true)
    try {
      // 1) Comisión Pidoo desde config global (fallback 10)
      const { data: cfg } = await supabase
        .from('configuracion_plataforma')
        .select('valor')
        .eq('clave', 'comision_pidoo_pct')
        .maybeSingle()
      if (cfg?.valor) setComisionPct(Number(cfg.valor) || 10)

      // 2) Pedidos entregados del restaurante en el rango
      const { data: peds, error: e1 } = await supabase
        .from('pedidos')
        .select('id, codigo, subtotal, coste_envio, propina, total, metodo_pago, estado, entregado_at, canal, modo_entrega')
        .eq('establecimiento_id', restaurante.id)
        .eq('canal', 'pido')
        .eq('estado', 'entregado')
        .gte('entregado_at', desde.toISOString())
        .lt('entregado_at', hasta.toISOString())
        .order('entregado_at', { ascending: false })
      if (e1) throw e1
      setPedidos(peds || [])

      // 3) Historial de facturas / balances (últimas 12)
      const { data: facs } = await supabase
        .from('facturas_semanales')
        .select('id, semana_inicio, semana_fin, total_ventas, total_comisiones, total_ganado, estado, numero_factura, created_at')
        .eq('establecimiento_id', restaurante.id)
        .order('semana_inicio', { ascending: false })
        .limit(12)
      setFacturas(facs || [])
    } catch (err) {
      toast('Error cargando finanzas: ' + (err.message || err), 'error')
    } finally {
      setLoading(false)
    }
  }

  // Cálculos agregados
  const comisionFactor = (Number(comisionPct) || 10) / 100
  const netoFactor = 1 - comisionFactor
  const stats = useMemo(() => {
    let ventas = 0, comision = 0, neto = 0, pendiente = 0, cobrado = 0
    for (const p of pedidos) {
      const sub = Number(p.subtotal || 0)
      const c = sub * comisionFactor
      const n = sub * netoFactor
      ventas += sub
      comision += c
      neto += n
      // Si pago en tarjeta: Pidoo cobra y debe al restaurante el neto.
      // Si pago en efectivo: el restaurante ya tiene la pasta, pero debe la comisión a Pidoo.
      if (p.metodo_pago === 'tarjeta') pendiente += n
      else cobrado += n
    }
    return { ventas, comision, neto, pendiente, cobrado }
  }, [pedidos, comisionFactor, netoFactor])

  // Agrupado por día para el gráfico
  const porDia = useMemo(() => {
    const map = new Map()
    for (const p of pedidos) {
      const d = new Date(p.entregado_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), pedidos: 0, ventas: 0 })
      const g = map.get(key)
      g.pedidos += 1
      g.ventas += Number(p.subtotal || 0)
    }
    // rellenar días vacíos dentro del rango si el rango es razonable (<=31 días)
    const diffDias = Math.round((hasta - desde) / 86400000)
    const arr = []
    if (diffDias <= 31) {
      for (let i = 0; i < diffDias; i++) {
        const d = new Date(desde); d.setDate(d.getDate() + i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (map.has(key)) arr.push(map.get(key))
        else arr.push({ key, date: d, pedidos: 0, ventas: 0 })
      }
    } else {
      arr.push(...Array.from(map.values()).sort((a, b) => a.date - b.date))
    }
    return arr
  }, [pedidos, desde, hasta])

  const maxVentasDia = Math.max(1, ...porDia.map(d => d.ventas))

  function descargarCSV() {
    if (pedidos.length === 0) return toast('No hay pedidos para exportar', 'error')
    const cabecera = ['Fecha', 'Código', 'Método pago', 'Subtotal', 'Envío', 'Propina', 'Total cobrado', 'Comisión Pidoo', 'Neto restaurante', 'Estado cobro']
    const filas = pedidos.map(p => {
      const sub = Number(p.subtotal || 0)
      const com = sub * comisionFactor
      const net = sub * netoFactor
      const estadoCobro = p.metodo_pago === 'tarjeta' ? 'Pendiente' : 'Cobrado en caja'
      return [
        fmtFechaHora(p.entregado_at),
        p.codigo,
        p.metodo_pago || '',
        Number(p.subtotal || 0).toFixed(2),
        Number(p.coste_envio || 0).toFixed(2),
        Number(p.propina || 0).toFixed(2),
        Number(p.total || 0).toFixed(2),
        com.toFixed(2),
        net.toFixed(2),
        estadoCobro,
      ]
    })
    const csv = [cabecera, ...filas]
      .map(row => row.map(v => {
        const s = String(v ?? '')
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(';'))
      .join('\r\n')
    const bom = '\uFEFF'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ini = `${desde.getFullYear()}${String(desde.getMonth() + 1).padStart(2, '0')}${String(desde.getDate()).padStart(2, '0')}`
    const fin = `${hasta.getFullYear()}${String(hasta.getMonth() + 1).padStart(2, '0')}${String(hasta.getDate()).padStart(2, '0')}`
    a.download = `finanzas_${ini}_${fin}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const hastaVisible = new Date(hasta.getTime() - 1) // mostrar inclusivo

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Finanzas</h1>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.4 }}>
            Resumen de ventas, comisiones y liquidaciones de tu restaurante.
          </div>
        </div>
        <button onClick={descargarCSV} disabled={pedidos.length === 0} style={{ ...ds.primaryBtn, opacity: pedidos.length === 0 ? 0.5 : 1 }}>
          Descargar factura (CSV)
        </button>
      </div>

      {/* Selector de periodo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {RANGOS.map(r => {
          const active = r.id === rango
          return (
            <button key={r.id} onClick={() => setRango(r.id)} style={{
              padding: '7px 14px', borderRadius: 999,
              border: `1px solid ${active ? colors.primaryBorder : colors.border}`,
              background: active ? colors.primarySoft : colors.surface,
              color: active ? colors.primary : colors.textDim,
              fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {r.label}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14 }}>
        Periodo: <span style={{ color: colors.text, fontWeight: 700 }}>{fmtFecha(desde)}</span> — <span style={{ color: colors.text, fontWeight: 700 }}>{fmtFecha(hastaVisible)}</span>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 18 }}>
        <Stat label="Ventas (subtotal)" value={fmtMoney(stats.ventas)} color={colors.text} sub={`${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'}`} />
        <Stat label={`Comisión Pidoo (${comisionPct}%)`} value={fmtMoney(stats.comision)} color={colors.stateNew} />
        <Stat label={`Neto restaurante (${100 - comisionPct}%)`} value={fmtMoney(stats.neto)} color={colors.stateOk} />
        <Stat label="Pendiente de cobro" value={fmtMoney(stats.pendiente)} color={colors.statePrep} sub="Pagos con tarjeta" />
        <Stat label="Cobrado en caja" value={fmtMoney(stats.cobrado)} color={colors.stateNeutral} sub="Pagos en efectivo" />
      </div>

      {/* Gráfico ventas por día */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Ventas por día</h2>
          <span style={{ fontSize: type.xxs, color: colors.textMute }}>Subtotal diario</span>
        </div>
        {porDia.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.xs }}>
            Sin datos en el periodo seleccionado.
          </div>
        ) : (
          <div style={{
            padding: '14px 12px', background: colors.surface, borderRadius: 12,
            border: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'flex-end', gap: 6, overflowX: 'auto',
            minHeight: 160,
          }}>
            {porDia.map(d => {
              const pct = d.ventas > 0 ? (d.ventas / maxVentasDia) * 100 : 0
              const h = Math.max(pct * 1.1, d.ventas > 0 ? 6 : 2)
              return (
                <div key={d.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '1 0 32px', minWidth: 32 }}>
                  <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {d.ventas > 0 ? fmtMoney(d.ventas).replace(' €', '€') : ''}
                  </div>
                  <div style={{
                    width: '70%', height: `${h}px`,
                    background: d.ventas > 0 ? colors.primary : colors.border,
                    borderRadius: 4, transition: 'height 0.2s',
                  }} />
                  <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtFechaCorta(d.date)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tabla pedidos */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Pedidos del periodo</h2>
          <span style={{ fontSize: type.xxs, color: colors.textMute }}>{pedidos.length} resultado{pedidos.length === 1 ? '' : 's'}</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
        ) : pedidos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
            Sin pedidos entregados en este periodo.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', ...ds.table }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
              <thead>
                <tr style={{ background: colors.elev }}>
                  {['Fecha', 'Código', 'Pago', 'Total', 'Comisión', 'Neto', 'Estado cobro'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pedidos.map(p => {
                  const sub = Number(p.subtotal || 0)
                  const com = sub * comisionFactor
                  const net = sub * netoFactor
                  const esTarjeta = p.metodo_pago === 'tarjeta'
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.textMute }}>{fmtFechaHora(p.entregado_at)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.codigo}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                          background: esTarjeta ? colors.infoSoft : colors.stateNeutralSoft,
                          color: esTarjeta ? colors.info : colors.stateNeutral,
                          textTransform: 'capitalize', letterSpacing: '0.04em',
                        }}>{p.metodo_pago || '—'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(p.total)}</td>
                      <td style={{ padding: '10px 12px', color: colors.stateNew, whiteSpace: 'nowrap' }}>− {fmtMoney(com)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: colors.stateOk, whiteSpace: 'nowrap' }}>{fmtMoney(net)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {esTarjeta ? (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.statePrepSoft, color: colors.statePrep, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pendiente</span>
                        ) : (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateNeutralSoft, color: colors.stateNeutral, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cobrado caja</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historial de pagos */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Historial de facturas semanales</h2>
          <span style={{ fontSize: type.xxs, color: colors.textMute }}>Últimas 12</span>
        </div>
        {facturas.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
            Aún no hay facturas semanales generadas.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', ...ds.table }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
              <thead>
                <tr style={{ background: colors.elev }}>
                  {['Factura', 'Periodo', 'Ventas', 'Comisión', 'Neto', 'Estado'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => {
                  const pagada = f.estado === 'pagada' || f.estado === 'pagado'
                  return (
                    <tr key={f.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.numero_factura || '—'}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.textMute }}>{fmtFechaCorta(f.semana_inicio)} — {fmtFechaCorta(f.semana_fin)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(f.total_ventas)}</td>
                      <td style={{ padding: '10px 12px', color: colors.stateNew, whiteSpace: 'nowrap' }}>{fmtMoney(f.total_comisiones)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: colors.stateOk, whiteSpace: 'nowrap' }}>{fmtMoney(f.total_ganado)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                          background: pagada ? colors.stateOkSoft : colors.statePrepSoft,
                          color: pagada ? colors.stateOk : colors.statePrep,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>{f.estado || 'pendiente'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5, marginTop: 18, padding: '12px 14px', borderRadius: 10, background: colors.surface, border: `1px solid ${colors.border}` }}>
        ⓘ Pidoo retiene el <strong style={{ color: colors.text }}>{comisionPct}%</strong> del subtotal de cada pedido entregado.
        El neto ({100 - comisionPct}%) se liquida semanalmente mediante factura.
        Los pagos en efectivo ya quedan en tu caja; los pagos con tarjeta los abona Pidoo.
      </div>
    </div>
  )
}

function Stat({ label, value, color: statColor, sub }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: colors.surface, border: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: type.xl, fontWeight: 800, color: statColor, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
