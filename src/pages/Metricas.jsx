import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? 'var(--c-primary)' : 'var(--c-surface)', borderRadius: 14, padding: '14px 16px', border: accent ? 'none' : '1px solid var(--c-border)', flex: '1 1 120px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: accent ? 'rgba(255,255,255,0.7)' : 'var(--c-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: accent ? '#fff' : 'var(--c-text)', letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: accent ? 'rgba(255,255,255,0.5)' : 'var(--c-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export default function Metricas() {
  const { restaurante } = useRest()
  const [periodo, setPeriodo] = useState('hoy')
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [resenas, setResenas] = useState([])

  useEffect(() => { if (restaurante) fetchStats() }, [restaurante?.id, periodo])

  async function fetchStats() {
    setLoading(true)
    setError(null)
    const now = new Date()
    let desde
    if (periodo === 'hoy') { desde = new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
    else if (periodo === 'semana') { desde = new Date(now); desde.setDate(desde.getDate() - 7) }
    else { desde = new Date(now); desde.setMonth(desde.getMonth() - 1) }

    try {
      const { data: pedidos, error: pedErr } = await supabase.from('pedidos').select('total, subtotal, metodo_pago, estado, minutos_preparacion')
        .eq('establecimiento_id', restaurante.id).gte('created_at', desde.toISOString())
      if (pedErr) throw pedErr

      const all = pedidos || []
      const entregados = all.filter(p => p.estado === 'entregado')

      const ventasTarjeta = entregados.filter(p => p.metodo_pago === 'tarjeta').reduce((s, p) => s + (p.total || 0), 0)
      const ventasEfectivo = entregados.filter(p => p.metodo_pago === 'efectivo').reduce((s, p) => s + (p.total || 0), 0)
      const tiempos = entregados.filter(p => p.minutos_preparacion).map(p => p.minutos_preparacion)
      const tiempoMedio = tiempos.length > 0 ? Math.round(tiempos.reduce((s, t) => s + t, 0) / tiempos.length) : 0

      setStats({
        pedidos: all.length,
        ventas: ventasTarjeta + ventasEfectivo,
        ventasTarjeta, ventasEfectivo,
        pedidosTarjeta: entregados.filter(p => p.metodo_pago === 'tarjeta').length,
        pedidosEfectivo: entregados.filter(p => p.metodo_pago === 'efectivo').length,
        ticketMedio: entregados.length > 0 ? (entregados.reduce((s, p) => s + (p.total || 0), 0) / entregados.length) : 0,
        tiempoMedio,
        cancelados: all.filter(p => p.estado === 'cancelado').length,
        entregados: entregados.length,
      })

      // Reseñas siempre (últimas 15)
      const { data: resenasData } = await supabase.from('resenas').select('*').eq('establecimiento_id', restaurante.id).order('created_at', { ascending: false }).limit(15)
      setResenas(resenasData || [])
    } catch (err) {
      console.error('[Metricas] Error:', err)
      setError('No se pudieron cargar las métricas.')
    }
    setLoading(false)
  }

  const periodoLabel = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Métricas</h2>
        <div style={{ display: 'flex', gap: 4, background: 'var(--c-surface2)', borderRadius: 10, padding: 3 }}>
          {['hoy', 'semana', 'mes'].map(p => (
            <button key={p} onClick={() => setPeriodo(p)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: periodo === p ? 'var(--c-primary)' : 'transparent', color: periodo === p ? '#fff' : 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{p}</button>
          ))}
        </div>
      </div>

      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F5F5', marginBottom: 4 }}>Error al cargar</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 20 }}>{error}</div>
          <button onClick={fetchStats} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--c-primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Reintentar</button>
        </div>
      )}
      {loading ? <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>Cargando...</div> : !error && (
        <>
          {/* Ventas */}
          <div style={{ background: 'linear-gradient(135deg, #B91C1C, #DC2626)', borderRadius: 16, padding: '20px 22px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>Ventas {periodoLabel[periodo].toLowerCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: -1 }}>{stats.ventas?.toFixed(2)} €</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.6)', flexWrap: 'wrap' }}>
              <span>💳 {stats.ventasTarjeta?.toFixed(2)} € ({stats.pedidosTarjeta})</span>
              <span>💵 {stats.ventasEfectivo?.toFixed(2)} € ({stats.pedidosEfectivo})</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <StatCard label="Pedidos" value={stats.pedidos} sub={`${stats.entregados} entregados`} />
            <StatCard label="Ticket medio" value={`${stats.ticketMedio?.toFixed(2)} €`} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <StatCard label="Tiempo medio prep." value={`${stats.tiempoMedio} min`} />
            <StatCard label="Cancelados" value={stats.cancelados} />
          </div>

          {/* Reseñas */}
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 14px' }}>Reseñas de clientes</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--c-text)' }}>{restaurante?.rating?.toFixed(1) || '—'}</span>
            <div style={{ display: 'flex', gap: 1 }}>{[1,2,3,4,5].map(i => <span key={i} style={{ color: i <= Math.round(restaurante?.rating || 0) ? '#FBBF24' : 'rgba(255,255,255,0.15)', fontSize: 16 }}>★</span>)}</div>
            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>({restaurante?.total_resenas || 0} reseñas)</span>
          </div>
          {resenas.map(r => (
            <div key={r.id} style={{ background: 'var(--c-surface)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--c-border)', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 1 }}>{[1,2,3,4,5].map(i => <span key={i} style={{ color: i <= r.rating ? '#FBBF24' : 'rgba(255,255,255,0.15)', fontSize: 12 }}>★</span>)}</div>
                <span style={{ fontSize: 10, color: 'var(--c-muted)' }}>{new Date(r.created_at).toLocaleDateString('es-ES')}</span>
              </div>
              {r.texto && <div style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>{r.texto}</div>}
              {!r.texto && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Sin comentario</div>}
            </div>
          ))}
          {resenas.length === 0 && <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--c-muted)', fontSize: 13 }}>Aún no tienes reseñas</div>}
        </>
      )}
    </div>
  )
}
