import { useState, useEffect } from 'react'
import { colors, ds, type } from '../../lib/uiStyles'
import { cargarMovimientos, cantidad, eurCoste, TIPOS_MOV } from '../../lib/stock'

// El libro de movimientos. SOLO LECTURA, sin excepción: en base de datos es
// append-only (PD248) y un error se corrige apuntando el movimiento contrario, no
// borrando el anterior. Por eso aquí no hay ni un botón de editar.
export default function MovimientosTab({ estId, articulos }) {
  const [movs, setMovs] = useState([])
  const [articuloId, setArticuloId] = useState('')
  const [tipo, setTipo] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      try {
        const filas = await cargarMovimientos(estId, { articuloId: articuloId || null, tipo: tipo || null })
        if (!vivo) return
        setMovs(filas)
        setError(null)
      } catch (e) {
        if (vivo) setError(e.message)
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, articuloId, tipo])

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={articuloId} onChange={e => { setCargando(true); setArticuloId(e.target.value) }}
          style={{ ...ds.select, width: 'auto', minWidth: 200 }}>
          <option value="">Todos los artículos</option>
          {articulos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select value={tipo} onChange={e => { setCargando(true); setTipo(e.target.value) }}
          style={{ ...ds.select, width: 'auto', minWidth: 160 }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS_MOV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {error && <div style={{ ...ds.muted, color: colors.danger }}>{error}</div>}

      <div style={ds.table}>
        <div style={ds.tableHeader}>
          <div style={{ width: 120 }}>Cuándo</div>
          <div style={{ flex: 1 }}>Artículo</div>
          <div style={{ width: 110 }}>Tipo</div>
          <div style={{ width: 110, textAlign: 'right' }}>Cantidad</div>
          <div style={{ width: 100, textAlign: 'right' }}>Coste ud.</div>
          <div style={{ flex: 1 }}>Motivo</div>
        </div>

        {cargando && <div style={{ ...ds.muted, padding: 24, textAlign: 'center' }}>Cargando…</div>}

        {!cargando && !movs.length && (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>
            Todavía no hay movimientos con estos filtros.
          </div>
        )}

        {movs.map(m => {
          const u = m.stock_articulos?.unidad || 'ud'
          const entra = Number(m.cantidad) > 0
          return (
            <div key={m.id} style={ds.tableRow}>
              <div style={{ width: 120, color: colors.textMute, fontSize: type.xs }}>
                {new Date(m.created_at).toLocaleString('es-ES', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </div>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.stock_articulos?.nombre || '—'}
              </div>
              <div style={{ width: 110 }}>
                <span style={{ ...ds.badge }}>{TIPOS_MOV[m.tipo]?.label || m.tipo}</span>
              </div>
              <div style={{
                width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                fontWeight: 700, color: entra ? colors.sage2 : colors.danger,
              }}>
                {entra ? '+' : '−'}{cantidad(Math.abs(Number(m.cantidad)), u)}
              </div>
              <div style={{ width: 100, textAlign: 'right', color: colors.textMute, fontVariantNumeric: 'tabular-nums' }}>
                {Number(m.coste_unitario) > 0 ? eurCoste(m.coste_unitario) : '—'}
              </div>
              <div style={{ flex: 1, minWidth: 0, color: colors.textMute, fontSize: type.xs,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.motivo || '—'}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.5 }}>
        Los movimientos no se editan ni se borran: si algo está mal, se corrige con un
        recuento. Así el libro siempre cuenta lo que pasó de verdad.
      </div>
    </div>
  )
}
