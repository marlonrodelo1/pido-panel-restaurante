import { useState, useEffect, useRef } from 'react'
import { Download, Search, Calendar, ChevronRight, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds, stateBadge, chip, chipDot } from '../lib/uiStyles'

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
      let query = supabase.from('pedidos').select('*')
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

      const BOM = '﻿'
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

  const inp = { ...ds.formInput }

  function fechaFormat(iso) {
    const d = new Date(iso)
    const day = d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
    const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    return `${day} · ${hora}`
  }

  function borderColor(estado) {
    if (estado === 'entregado') return colors.sage
    if (estado === 'fallido') return colors.danger
    return colors.stone2
  }

  return (
    <div>
      {/* Header + Export glossy ink */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ ...ds.h1, margin: 0 }}>Historial</h2>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
            Todos tus pedidos completados, cancelados o fallidos
          </div>
        </div>
        <button
          onClick={exportarCSV}
          disabled={exportando || pedidos.length === 0}
          style={{
            ...ds.glossyBtn,
            opacity: exportando || pedidos.length === 0 ? 0.55 : 1,
            cursor: exportando || pedidos.length === 0 ? 'default' : 'pointer',
          }}
        >
          <Download size={15} strokeWidth={2.2} />
          {exportando ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>

      {/* Card filtros */}
      <div style={{ ...ds.card, padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Buscador */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.stone2 }} />
            <input
              value={busquedaInput}
              onChange={e => handleBusqueda(e.target.value)}
              placeholder="Buscar por código o cliente…"
              style={{ ...inp, paddingLeft: 34 }}
            />
            {busquedaInput && (
              <button onClick={() => { setBusquedaInput(''); setBusqueda('') }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: colors.stone, padding: 4 }}>
                <X size={14} />
              </button>
            )}
          </div>
          {/* Desde */}
          <div style={{ position: 'relative' }}>
            <Calendar size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.stone2, pointerEvents: 'none' }} />
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={{ ...inp, paddingLeft: 34 }} />
          </div>
          {/* Hasta */}
          <div style={{ position: 'relative' }}>
            <Calendar size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.stone2, pointerEvents: 'none' }} />
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={{ ...inp, paddingLeft: 34 }} />
          </div>
        </div>

        {/* Pills estado */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['todos', 'entregado', 'cancelado', 'fallido'].map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: filtro === f ? 'none' : `1px solid ${colors.borderStrong}`,
                background: filtro === f ? colors.terracotta : colors.paper,
                color: filtro === f ? '#fff' : colors.stone,
                fontSize: type.xs,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                textTransform: 'capitalize',
                whiteSpace: 'nowrap',
              }}
            >{f}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '30px 0', color: colors.stone, fontSize: type.sm }}>Cargando...</div>}

      {error && (
        <button onClick={() => fetchPedidos(true)} style={{ width: '100%', textAlign: 'center', padding: '30px 20px', color: colors.danger, fontSize: type.sm, background: colors.dangerSoft, borderRadius: 12, border: `1px solid ${colors.dangerSoft}`, cursor: 'pointer', fontFamily: 'inherit' }}>
          {error}
        </button>
      )}

      {!loading && !error && pedidos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: colors.cream2, color: colors.stone2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}>
            <Search size={28} strokeWidth={1.7} />
          </div>
          <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 4, color: colors.text }}>Sin pedidos</div>
          <div style={{ fontSize: type.xs, color: colors.stone }}>
            {busqueda ? `No se encontró "${busqueda}"` : `No hay pedidos entre ${new Date(desde + 'T12:00:00').toLocaleDateString('es')} y ${new Date(hasta + 'T12:00:00').toLocaleDateString('es')}`}
          </div>
        </div>
      )}

      {/* Lista cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pedidos.map(p => {
          const sb = stateBadge(p.estado)
          const { _label, ...sbStyle } = sb
          const cardLeft = borderColor(p.estado)
          return (
            <div key={p.id} style={{
              background: colors.paper,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${cardLeft}`,
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              {/* Código + fecha */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: type.sm, color: colors.ink, fontWeight: 700, letterSpacing: '0.02em' }}>
                  {p.codigo}
                </span>
                <span style={{ fontSize: type.xs, color: colors.stone }}>{fechaFormat(p.created_at)}</span>
              </div>

              {/* Cliente */}
              <div style={{ flex: 1, minWidth: 100, fontSize: type.sm, color: colors.ink, fontWeight: 600 }}>
                {p.cliente_nombre || p.nombre_cliente || '—'}
              </div>

              {/* Estado */}
              <span style={sbStyle}>{_label}</span>

              {/* Pago */}
              <span style={chip(p.metodo_pago === 'tarjeta' ? 'paper' : 'warning', { dot: true })}>
                <span style={chipDot} />
                {p.metodo_pago === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}
              </span>

              {/* Total */}
              <div style={{ width: 100, textAlign: 'right' }}>
                <span style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: type.lg,
                  fontWeight: 700,
                  color: colors.ink,
                  letterSpacing: '-0.01em',
                }}>
                  {(p.total || 0).toFixed(2)} €
                </span>
              </div>

              <ChevronRight size={16} style={{ color: colors.stone2 }} />
            </div>
          )
        })}
      </div>

      {/* Footer paginación */}
      {pedidos.length > 0 && (
        <div style={{
          marginTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: type.sm,
          color: colors.stone,
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span>
            Mostrando {pedidos.length} pedidos · {new Date(desde + 'T12:00:00').toLocaleDateString('es')} — {new Date(hasta + 'T12:00:00').toLocaleDateString('es')}
          </span>
          {hayMas && (
            <button onClick={cargarMas} disabled={cargandoMas} style={ds.ghostBtn}>
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
