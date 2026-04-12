import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

const LIMIT = 50

function fechaDefault(diasAtras) {
  const d = new Date()
  d.setDate(d.getDate() - diasAtras)
  return d.toISOString().split('T')[0]
}

export default function Historial() {
  const { restaurante } = useRest()
  const [pedidos, setPedidos] = useState([])
  const [filtro, setFiltro] = useState('todos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [desde, setDesde] = useState(() => fechaDefault(30))
  const [hasta, setHasta] = useState(() => fechaDefault(0))
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [exportando, setExportando] = useState(false)
  const busquedaTimer = useRef(null)

  useEffect(() => { if (restaurante) fetchPedidos(true) }, [restaurante?.id, filtro, desde, hasta, busqueda])

  function handleBusqueda(val) {
    setBusquedaInput(val)
    clearTimeout(busquedaTimer.current)
    busquedaTimer.current = setTimeout(() => setBusqueda(val), 500)
  }

  function buildQuery(query) {
    query = query
      .eq('establecimiento_id', restaurante.id)
      .in('estado', filtro === 'todos' ? ['entregado', 'cancelado', 'fallido'] : [filtro])
      .order('created_at', { ascending: false })

    if (desde) query = query.gte('created_at', desde + 'T00:00:00')
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59')
    if (busqueda.trim()) {
      const sanitized = busqueda.trim().replace(/[%_\\]/g, '')
      if (sanitized) query = query.ilike('codigo', '%' + sanitized + '%')
    }
    return query
  }

  async function fetchPedidos(reset = false) {
    if (reset) setLoading(true)
    setError(null)
    const offset = reset ? 0 : pedidos.length

    try {
      let query = supabase.from('pedidos')
        .select('*')
      query = buildQuery(query).range(offset, offset + LIMIT - 1)

      const { data, error: queryError } = await query
      if (queryError) throw queryError
      const items = data || []
      if (reset) setPedidos(items)
      else setPedidos(prev => [...prev, ...items])
      setHayMas(items.length === LIMIT)
    } catch (err) {
      console.error('[Historial] Error:', err)
      setError('Error al cargar el historial. Toca para reintentar.')
    }
    setLoading(false)
    setCargandoMas(false)
  }

  function cargarMas() {
    setCargandoMas(true)
    fetchPedidos(false)
  }

  async function exportarCSV() {
    setExportando(true)
    try {
      let query = supabase.from('pedidos')
        .select('codigo, estado, canal, metodo_pago, subtotal, coste_envio, total, created_at')
      query = buildQuery(query)

      const { data, error: err } = await query
      if (err) throw err
      if (!data?.length) { setExportando(false); return }

      const headers = ['Codigo', 'Estado', 'Canal', 'Metodo Pago', 'Subtotal', 'Envio', 'Total', 'Fecha']
      const rows = data.map(p => [
        p.codigo,
        p.estado,
        'PIDO',
        p.metodo_pago || '',
        (p.subtotal || 0).toFixed(2),
        (p.coste_envio || 0).toFixed(2),
        (p.total || 0).toFixed(2),
        new Date(p.created_at).toLocaleString('es-ES'),
      ])

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')

      const BOM = '\uFEFF'
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `historial_${desde}_${hasta}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Historial] Export error:', err)
    }
    setExportando(false)
  }

  const colors = { entregado: { bg: '#DCFCE7', c: '#166534' }, cancelado: { bg: '#FEE2E2', c: '#991B1B' }, fallido: { bg: '#FEF3C7', c: '#92400E' } }

  const inp = { padding: '10px 14px', borderRadius: 10, border: '1px solid var(--c-border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 4, display: 'block' }

  return (
    <div>
      {/* Header + Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Historial</h2>
        <button onClick={exportarCSV} disabled={exportando || pedidos.length === 0} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: pedidos.length > 0 ? 'var(--c-primary)' : 'var(--c-surface2)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: pedidos.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit', opacity: exportando ? 0.6 : 1 }}>
          {exportando ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>

      {/* Búsqueda por código */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 14, top: 10, fontSize: 14, opacity: 0.4 }}>&#128269;</span>
        <input
          value={busquedaInput}
          onChange={e => handleBusqueda(e.target.value)}
          placeholder="Buscar por código..."
          style={{ ...inp, width: '100%', paddingLeft: 38 }}
        />
        {busquedaInput && (
          <button onClick={() => { setBusquedaInput(''); setBusqueda('') }} style={{ position: 'absolute', right: 12, top: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-muted)', fontSize: 16, padding: 0 }}>&times;</button>
        )}
      </div>

      {/* Filtro por fechas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={{ ...inp, width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={{ ...inp, width: '100%' }} />
        </div>
      </div>

      {/* Filtro por estado */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20 }}>
        {['todos', 'entregado', 'cancelado', 'fallido'].map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{ padding: '7px 16px', borderRadius: 50, border: 'none', background: filtro === f ? 'var(--c-primary)' : 'var(--c-surface2)', color: filtro === f ? '#fff' : 'var(--c-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{f}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--c-muted)' }}>Cargando...</div>}

      {error && (
        <button onClick={() => fetchPedidos(true)} style={{ width: '100%', textAlign: 'center', padding: '30px 20px', color: '#EF4444', fontSize: 13, background: 'rgba(239,68,68,0.08)', borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {error}
        </button>
      )}

      {!loading && !error && pedidos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Sin pedidos</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>
            {busqueda ? `No se encontró "${busqueda}"` : `No hay pedidos entre ${new Date(desde + 'T12:00:00').toLocaleDateString('es')} y ${new Date(hasta + 'T12:00:00').toLocaleDateString('es')}`}
          </div>
        </div>
      )}

      {pedidos.map(p => {
        const col = colors[p.estado] || colors.entregado
        return (
          <div key={p.id} style={{ background: 'var(--c-surface)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--c-border)', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{p.codigo}</span>
                <span style={{ background: col.bg, color: col.c, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, textTransform: 'capitalize' }}>{p.estado}</span>
                <span style={{ background: p.metodo_pago === 'tarjeta' ? '#DBEAFE' : '#DCFCE7', color: p.metodo_pago === 'tarjeta' ? '#1E40AF' : '#166534', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{p.metodo_pago === 'tarjeta' ? '💳' : '💵'}</span>
                <span style={{ background: '#FFF7ED', color: '#C2410C', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>PIDO</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-muted)' }}>
              <span>Shipday</span>
              <span style={{ fontWeight: 700, color: 'var(--c-text)' }}>{(p.total || 0).toFixed(2)} €</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{new Date(p.created_at).toLocaleString('es')}</div>
          </div>
        )
      })}

      {hayMas && !loading && (
        <button onClick={cargarMas} disabled={cargandoMas} style={{ width: '100%', padding: '14px 0', borderRadius: 12, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-text)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
          {cargandoMas ? 'Cargando...' : 'Cargar más pedidos'}
        </button>
      )}

      {pedidos.length > 0 && (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)', marginTop: 12 }}>
          {new Date(desde + 'T12:00:00').toLocaleDateString('es')} — {new Date(hasta + 'T12:00:00').toLocaleDateString('es')}
        </div>
      )}
    </div>
  )
}
