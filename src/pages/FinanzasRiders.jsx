import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { colors, type, ds } from '../lib/uiStyles'

const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana_actual', label: 'Esta semana' },
  { id: 'semana_pasada', label: 'Semana pasada' },
  { id: 'mes_actual', label: 'Mes actual' },
  { id: 'ultimos_30', label: 'Últimos 30 días' },
]

function rangoFechas(id) {
  const ahora = new Date()
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  if (id === 'hoy') {
    const hasta = new Date(hoyInicio); hasta.setDate(hasta.getDate() + 1)
    return [hoyInicio, hasta]
  }
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
  const dow = hoyInicio.getDay()
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

export default function FinanzasRiders() {
  const { restaurante } = useRest()
  const [rango, setRango] = useState('semana_actual')
  const [pedidos, setPedidos] = useState([])
  const [riderEarnings, setRiderEarnings] = useState([])
  const [resenas, setResenas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [desde, hasta] = useMemo(() => rangoFechas(rango), [rango])

  useEffect(() => {
    if (!restaurante?.id) return
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurante?.id, rango])

  async function cargar() {
    setLoading(true)
    setError(null)
    try {
      const { data: peds, error: e1 } = await supabase
        .from('pedidos')
        .select('id, codigo, subtotal, coste_envio, propina, total, metodo_pago, estado, entregado_at, created_at, minutos_preparacion, canal, modo_entrega, rider_account_id')
        .eq('establecimiento_id', restaurante.id)
        .eq('canal', 'pido')
        .gte('created_at', desde.toISOString())
        .lt('created_at', hasta.toISOString())
        .order('created_at', { ascending: false })
      if (e1) throw e1
      setPedidos(peds || [])

      const { data: earnings } = await supabase
        .from('rider_earnings')
        .select('*, rider_accounts(nombre)')
        .eq('establecimiento_id', restaurante.id)
        .gte('created_at', desde.toISOString())
        .lt('created_at', hasta.toISOString())
      setRiderEarnings(earnings || [])

      const { data: resenasData } = await supabase
        .from('resenas').select('*')
        .eq('establecimiento_id', restaurante.id)
        .order('created_at', { ascending: false })
        .limit(15)
      setResenas(resenasData || [])
    } catch (err) {
      console.error('[FinanzasRiders] Error:', err)
      setError('No se pudieron cargar los datos.')
      toast('Error cargando finanzas: ' + (err.message || err), 'error')
    } finally {
      setLoading(false)
    }
  }

  const entregados = useMemo(() => pedidos.filter(p => p.estado === 'entregado'), [pedidos])
  const cancelados = useMemo(() => pedidos.filter(p => p.estado === 'cancelado').length, [pedidos])

  const stats = useMemo(() => {
    const ventas = entregados.reduce((s, p) => s + Number(p.total || 0), 0)
    const ventasTarjeta = entregados.filter(p => p.metodo_pago === 'tarjeta').reduce((s, p) => s + Number(p.total || 0), 0)
    const ventasEfectivo = entregados.filter(p => p.metodo_pago === 'efectivo').reduce((s, p) => s + Number(p.total || 0), 0)
    const pedTarjeta = entregados.filter(p => p.metodo_pago === 'tarjeta').length
    const pedEfectivo = entregados.filter(p => p.metodo_pago === 'efectivo').length
    const ticketMedio = entregados.length > 0 ? (entregados.reduce((s, p) => s + Number(p.total || 0), 0) / entregados.length) : 0
    const tiempos = entregados.filter(p => p.minutos_preparacion).map(p => p.minutos_preparacion)
    const tiempoMedio = tiempos.length > 0 ? Math.round(tiempos.reduce((s, t) => s + t, 0) / tiempos.length) : 0
    const propinas = entregados.reduce((s, p) => s + Number(p.propina || 0), 0)
    return { ventas, ventasTarjeta, ventasEfectivo, pedTarjeta, pedEfectivo, ticketMedio, tiempoMedio, propinas }
  }, [entregados])

  const riderRows = useMemo(() => {
    const grouped = {}
    for (const e of riderEarnings) {
      const id = e.rider_account_id
      if (!grouped[id]) {
        grouped[id] = {
          rider_id: id,
          nombre: e.rider_accounts?.nombre || '—',
          pedidos: 0,
          total_envios: 0,
          total_comision_rider: 0,
          total_propinas: 0,
          total_neto: 0,
          pendiente: 0,
        }
      }
      const g = grouped[id]
      g.pedidos += 1
      g.total_envios += Number(e.coste_envio || 0)
      g.total_comision_rider += Number(e.comision_rider_sobre_subtotal || 0)
      g.total_propinas += Number(e.propina || 0)
      g.total_neto += Number(e.neto_rider || 0)
      if (e.estado_pago === 'pendiente') g.pendiente += Number(e.neto_rider || 0)
    }
    return Object.values(grouped).sort((a, b) => b.total_neto - a.total_neto)
  }, [riderEarnings])

  const porDia = useMemo(() => {
    const map = new Map()
    for (const p of entregados) {
      const d = new Date(p.entregado_at || p.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), pedidos: 0, ventas: 0 })
      const g = map.get(key)
      g.pedidos += 1
      g.ventas += Number(p.total || 0)
    }
    const diffDias = Math.round((hasta - desde) / 86400000)
    const arr = []
    if (diffDias <= 31) {
      for (let i = 0; i < diffDias; i++) {
        const d = new Date(desde); d.setDate(d.getDate() + i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        arr.push(map.get(key) || { key, date: d, pedidos: 0, ventas: 0 })
      }
    } else {
      arr.push(...Array.from(map.values()).sort((a, b) => a.date - b.date))
    }
    return arr
  }, [entregados, desde, hasta])

  const maxVentasDia = Math.max(1, ...porDia.map(d => d.ventas))

  function descargarCSV() {
    if (entregados.length === 0) return toast('No hay pedidos para exportar', 'error')
    const cabecera = ['Fecha', 'Código', 'Método pago', 'Subtotal', 'Envío', 'Propina', 'Total cobrado', 'Rider']
    const riderMap = {}
    for (const e of riderEarnings) riderMap[e.pedido_id] = e.rider_accounts?.nombre || ''
    const filas = entregados.map(p => [
      fmtFechaHora(p.entregado_at || p.created_at),
      p.codigo,
      p.metodo_pago || '',
      Number(p.subtotal || 0).toFixed(2),
      Number(p.coste_envio || 0).toFixed(2),
      Number(p.propina || 0).toFixed(2),
      Number(p.total || 0).toFixed(2),
      riderMap[p.id] || '',
    ])
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
    a.download = `finanzas_rider_${ini}_${fin}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const hastaVisible = new Date(hasta.getTime() - 1)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Finanzas con el repartidor</h1>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, lineHeight: 1.4 }}>
            Ventas, métricas y pagos a tus riders en el periodo elegido.
          </div>
        </div>
        <button onClick={descargarCSV} disabled={entregados.length === 0} style={{ ...ds.primaryBtn, opacity: entregados.length === 0 ? 0.5 : 1 }}>
          Descargar CSV
        </button>
      </div>

      {/* Selector rango */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
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

      <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 16 }}>
        Periodo: <span style={{ color: colors.text, fontWeight: 700 }}>{fmtFecha(desde)}</span> — <span style={{ color: colors.text, fontWeight: 700 }}>{fmtFecha(hastaVisible)}</span>
      </div>

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Error al cargar</div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 20 }}>{error}</div>
          <button onClick={cargar} style={ds.primaryBtn}>Reintentar</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Cargando...</div>
      ) : !error && (
        <>
          {/* Card principal ventas */}
          <div style={{ background: 'linear-gradient(135deg, #FF6B2C, #E85A1F)', borderRadius: 14, padding: '20px 22px', marginBottom: 16 }}>
            <div style={{ fontSize: type.xs, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>Ventas entregadas</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: -1 }}>{fmtMoney(stats.ventas)}</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: type.xs, color: 'rgba(255,255,255,0.9)', flexWrap: 'wrap' }}>
              <span>💳 {fmtMoney(stats.ventasTarjeta)} ({stats.pedTarjeta})</span>
              <span>💵 {fmtMoney(stats.ventasEfectivo)} ({stats.pedEfectivo})</span>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
            <Stat label="Pedidos entregados" value={entregados.length} color={colors.text} />
            <Stat label="Ticket medio" value={fmtMoney(stats.ticketMedio)} color={colors.text} />
            <Stat label="Tiempo prep. medio" value={`${stats.tiempoMedio} min`} color={colors.text} />
            <Stat label="Propinas a riders" value={fmtMoney(stats.propinas)} color={colors.stateOk} />
            <Stat label="Cancelados" value={cancelados} color={cancelados > 0 ? colors.danger : colors.textMute} />
          </div>

          {/* Gráfico ventas por día */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Ventas por día</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>Total diario</span>
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

          {/* Pagos a riders */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Pagos a repartidores</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>
                {riderRows.length} rider{riderRows.length === 1 ? '' : 's'} con actividad
              </span>
            </div>
            {riderRows.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
                Sin pedidos entregados por riders en este periodo.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', ...ds.table }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
                  <thead>
                    <tr style={{ background: colors.elev2 }}>
                      {['Rider', 'Pedidos', 'Envíos', 'Comisión 10%', 'Propinas', 'Neto rider', 'Estado'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {riderRows.map(r => (
                      <tr key={r.rider_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.nombre}</td>
                        <td style={{ padding: '10px 12px' }}>{r.pedidos}</td>
                        <td style={{ padding: '10px 12px' }}>{fmtMoney(r.total_envios)}</td>
                        <td style={{ padding: '10px 12px' }}>{fmtMoney(r.total_comision_rider)}</td>
                        <td style={{ padding: '10px 12px' }}>{fmtMoney(r.total_propinas)}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 800, color: colors.stateOk }}>{fmtMoney(r.total_neto)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          {r.pendiente > 0 ? (
                            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.statePrepSoft, color: colors.statePrep, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Pendiente {fmtMoney(r.pendiente)}
                            </span>
                          ) : (
                            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700, background: colors.stateOkSoft, color: colors.stateOk, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Pagado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tabla pedidos */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Pedidos del periodo</h2>
              <span style={{ fontSize: type.xxs, color: colors.textMute }}>{entregados.length} entregado{entregados.length === 1 ? '' : 's'}</span>
            </div>
            {entregados.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
                Sin pedidos entregados en este periodo.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', ...ds.table }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: type.sm, color: colors.text }}>
                  <thead>
                    <tr style={{ background: colors.elev2 }}>
                      {['Fecha', 'Código', 'Pago', 'Envío', 'Propina', 'Total'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: type.xxs, color: colors.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entregados.slice(0, 50).map(p => {
                      const esTarjeta = p.metodo_pago === 'tarjeta'
                      return (
                        <tr key={p.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: colors.textMute }}>{fmtFechaHora(p.entregado_at || p.created_at)}</td>
                          <td style={{ padding: '10px 12px', fontWeight: 700 }}>{p.codigo}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 6, fontSize: type.xxs, fontWeight: 700,
                              background: esTarjeta ? colors.infoSoft : colors.stateNeutralSoft,
                              color: esTarjeta ? colors.info : colors.stateNeutral,
                              textTransform: 'capitalize', letterSpacing: '0.04em',
                            }}>{p.metodo_pago || '—'}</span>
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(p.coste_envio)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtMoney(p.propina)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>{fmtMoney(p.total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {entregados.length > 50 && (
                  <div style={{ padding: '10px 12px', textAlign: 'center', fontSize: type.xxs, color: colors.textMute, borderTop: `1px solid ${colors.border}` }}>
                    Mostrando los primeros 50 pedidos. Descarga el CSV para ver el listado completo.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reseñas */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>Reseñas de clientes</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: type.xs, color: colors.textMute }}>
                <span style={{ fontSize: type.base, fontWeight: 800, color: colors.text }}>{restaurante?.rating?.toFixed(1) || '—'}</span>
                <div style={{ display: 'flex', gap: 1 }}>{[1,2,3,4,5].map(i => <span key={i} style={{ color: i <= Math.round(restaurante?.rating || 0) ? '#FBBF24' : colors.border, fontSize: 14 }}>★</span>)}</div>
                <span>({restaurante?.total_resenas || 0})</span>
              </div>
            </div>
            {resenas.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.textMute, fontSize: type.sm }}>
                Aún no tienes reseñas.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {resenas.map(r => (
                  <div key={r.id} style={{ background: colors.surface, borderRadius: 12, padding: '12px 14px', border: `1px solid ${colors.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ display: 'flex', gap: 1 }}>{[1,2,3,4,5].map(i => <span key={i} style={{ color: i <= r.rating ? '#FBBF24' : colors.border, fontSize: 13 }}>★</span>)}</div>
                      <span style={{ fontSize: type.xxs, color: colors.textMute }}>{new Date(r.created_at).toLocaleDateString('es-ES')}</span>
                    </div>
                    {r.texto ? (
                      <div style={{ fontSize: type.xs, color: colors.textDim, lineHeight: 1.5 }}>{r.texto}</div>
                    ) : (
                      <div style={{ fontSize: type.xxs, color: colors.textFaint, fontStyle: 'italic' }}>Sin comentario</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ fontSize: type.xs, color: colors.textMute, lineHeight: 1.5, padding: '12px 14px', borderRadius: 10, background: colors.surface, border: `1px solid ${colors.border}` }}>
            ⓘ Recomendación Pidoo: paga al rider <strong style={{ color: colors.text }}>10% del subtotal + 100% del envío + propina</strong>. Puedes pactar otra cifra libremente con él.
          </div>
        </>
      )}
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
