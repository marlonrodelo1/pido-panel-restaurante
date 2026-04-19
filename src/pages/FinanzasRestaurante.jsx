import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'

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
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Finanzas</h1>
          <div style={{ fontSize: 11.5, color: '#ab8985', marginTop: 3, lineHeight: 1.4 }}>
            Resumen de ventas, comisiones y liquidaciones de tu restaurante.
          </div>
        </div>
        <button onClick={descargarCSV} disabled={pedidos.length === 0} style={{ ...btnPrimary, fontSize: 11.5, padding: '8px 12px', whiteSpace: 'nowrap', flexShrink: 0, opacity: pedidos.length === 0 ? 0.5 : 1 }}>
          Descargar factura (CSV)
        </button>
      </div>

      {/* Selector de periodo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {RANGOS.map(r => {
          const active = r.id === rango
          return (
            <button key={r.id} onClick={() => setRango(r.id)} style={{
              padding: '7px 12px', borderRadius: 10,
              border: active ? '1px solid rgba(185,28,28,0.6)' : '1px solid rgba(255,255,255,0.12)',
              background: active ? 'rgba(185,28,28,0.18)' : 'transparent',
              color: active ? '#F87171' : '#ab8985',
              fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {r.label}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 11, color: '#ab8985', marginBottom: 14 }}>
        Periodo: <span style={{ color: '#E5E2E1', fontWeight: 700 }}>{fmtFecha(desde)}</span> — <span style={{ color: '#E5E2E1', fontWeight: 700 }}>{fmtFecha(hastaVisible)}</span>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 18 }}>
        <Stat label="Ventas (subtotal)" value={fmtMoney(stats.ventas)} color="#E5E2E1" sub={`${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'}`} />
        <Stat label={`Comisión Pidoo (${comisionPct}%)`} value={fmtMoney(stats.comision)} color="#F87171" />
        <Stat label={`Neto restaurante (${100 - comisionPct}%)`} value={fmtMoney(stats.neto)} color="#4ade80" />
        <Stat label="Pendiente de cobro" value={fmtMoney(stats.pendiente)} color="#FBBF24" sub="Pagos con tarjeta" />
        <Stat label="Cobrado en caja" value={fmtMoney(stats.cobrado)} color="#94A3B8" sub="Pagos en efectivo" />
      </div>

      {/* Gráfico ventas por día */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Ventas por día</h2>
          <span style={{ fontSize: 10.5, color: '#ab8985' }}>Subtotal diario</span>
        </div>
        {porDia.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#ab8985', fontSize: 12 }}>
            Sin datos en el periodo seleccionado.
          </div>
        ) : (
          <div style={{
            padding: '14px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'flex-end', gap: 6, overflowX: 'auto',
            minHeight: 160,
          }}>
            {porDia.map(d => {
              const pct = d.ventas > 0 ? (d.ventas / maxVentasDia) * 100 : 0
              const h = Math.max(pct * 1.1, d.ventas > 0 ? 6 : 2)
              return (
                <div key={d.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '1 0 32px', minWidth: 32 }}>
                  <div style={{ fontSize: 9, color: '#ab8985', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {d.ventas > 0 ? fmtMoney(d.ventas).replace(' €', '€') : ''}
                  </div>
                  <div style={{
                    width: '70%', height: `${h}px`,
                    background: d.ventas > 0 ? 'linear-gradient(180deg, #B91C1C 0%, #93000b 100%)' : 'rgba(255,255,255,0.04)',
                    borderRadius: 4, transition: 'height 0.2s',
                  }} />
                  <div style={{ fontSize: 9.5, color: '#ab8985', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtFechaCorta(d.date)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tabla pedidos */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Pedidos del periodo</h2>
          <span style={{ fontSize: 10.5, color: '#ab8985' }}>{pedidos.length} resultado{pedidos.length === 1 ? '' : 's'}</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#ab8985', fontSize: 12 }}>Cargando...</div>
        ) : pedidos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#ab8985', fontSize: 12 }}>
            Sin pedidos entregados en este periodo.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#E5E2E1' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Fecha', 'Código', 'Pago', 'Total', 'Comisión', 'Neto', 'Estado cobro'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, color: '#ab8985', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
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
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#ab8985' }}>{fmtFechaHora(p.entregado_at)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.codigo}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          background: esTarjeta ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.15)',
                          color: esTarjeta ? '#93C5FD' : '#CBD5E1',
                          textTransform: 'capitalize',
                        }}>{p.metodo_pago || '—'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(p.total)}</td>
                      <td style={{ padding: '10px 12px', color: '#F87171', whiteSpace: 'nowrap' }}>− {fmtMoney(com)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: '#4ade80', whiteSpace: 'nowrap' }}>{fmtMoney(net)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {esTarjeta ? (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: '#FBBF24' }}>Pendiente</span>
                        ) : (
                          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(148,163,184,0.15)', color: '#CBD5E1' }}>Cobrado caja</span>
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
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#E5E2E1', margin: 0, letterSpacing: '-0.01em' }}>Historial de facturas semanales</h2>
          <span style={{ fontSize: 10.5, color: '#ab8985' }}>Últimas 12</span>
        </div>
        {facturas.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#ab8985', fontSize: 12 }}>
            Aún no hay facturas semanales generadas.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#E5E2E1' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Factura', 'Periodo', 'Ventas', 'Comisión', 'Neto', 'Estado'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, color: '#ab8985', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => {
                  const pagada = f.estado === 'pagada' || f.estado === 'pagado'
                  return (
                    <tr key={f.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.numero_factura || '—'}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#ab8985' }}>{fmtFechaCorta(f.semana_inicio)} — {fmtFechaCorta(f.semana_fin)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(f.total_ventas)}</td>
                      <td style={{ padding: '10px 12px', color: '#F87171', whiteSpace: 'nowrap' }}>{fmtMoney(f.total_comisiones)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 800, color: '#4ade80', whiteSpace: 'nowrap' }}>{fmtMoney(f.total_ganado)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          background: pagada ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                          color: pagada ? '#4ade80' : '#FBBF24',
                          textTransform: 'capitalize',
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

      <div style={{ fontSize: 10.5, color: '#ab8985', lineHeight: 1.5, marginTop: 18, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
        ⓘ Pidoo retiene el <strong>{comisionPct}%</strong> del subtotal de cada pedido entregado.
        El neto ({100 - comisionPct}%) se liquida semanalmente mediante factura.
        Los pagos en efectivo ya quedan en tu caja; los pagos con tarjeta los abona Pidoo.
      </div>
    </div>
  )
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 9.5, color: '#ab8985', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 2, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#ab8985', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

const btnPrimary = {
  padding: '10px 16px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #B91C1C 0%, #93000b 100%)',
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
}
