import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, ds, type } from '../lib/uiStyles'
import { Star, MessageSquare } from 'lucide-react'

// Estrellas rellenas según la valoración (1-5)
function Estrellas({ n, size = 15 }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
          strokeWidth={2}
          color={i <= n ? colors.warning : colors.border}
          fill={i <= n ? colors.warning : 'none'}
        />
      ))}
    </span>
  )
}

export default function Resenas() {
  const { restaurante } = useRest()
  const [resenas, setResenas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { if (restaurante?.id) cargar() }, [restaurante?.id])

  async function cargar() {
    setLoading(true); setError(null)
    // La RLS de resenas es SELECT público; usuarios/pedidos se embeben respetando
    // sus propias policies (restaurante ve a sus clientes y sus pedidos). Si algún
    // embed no fuera legible, cae a null y se muestra "Cliente" / se omite el código.
    const { data, error: e } = await supabase
      .from('resenas')
      .select('id, rating, texto, created_at, usuarios(nombre, apellido), pedidos(codigo)')
      .eq('establecimiento_id', restaurante.id)
      .order('created_at', { ascending: false })
    if (e) { setError('No se pudieron cargar las reseñas'); setLoading(false); return }
    setResenas(data || [])
    setLoading(false)
  }

  const total = resenas.length
  const media = total ? resenas.reduce((s, r) => s + (r.rating || 0), 0) / total : 0

  function fecha(f) {
    return new Date(f).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  function nombreCliente(r) {
    const n = [r.usuarios?.nombre, r.usuarios?.apellido].filter(Boolean).join(' ').trim()
    return n || 'Cliente'
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={ds.h1}>Reseñas</h1>
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: colors.ink, lineHeight: 1 }}>{media.toFixed(1)}</span>
            <div>
              <Estrellas n={Math.round(media)} />
              <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
                {total} reseña{total !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: colors.stone, fontWeight: 600 }}>Cargando...</div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <div style={{ fontSize: type.sm, color: colors.danger, fontWeight: 600, marginBottom: 12 }}>{error}</div>
          <button onClick={cargar} style={ds.secondaryBtn}>Reintentar</button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div style={{ ...ds.card, textAlign: 'center', padding: '48px 20px' }}>
          <MessageSquare size={34} color={colors.stone2} strokeWidth={1.6} />
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginTop: 12 }}>Aún no tienes reseñas</div>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 6, maxWidth: 360, margin: '6px auto 0', lineHeight: 1.5 }}>
            Cuando un cliente valore un pedido entregado, su reseña (estrellas y comentario) aparecerá aquí.
          </div>
        </div>
      )}

      {!loading && total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {resenas.map(r => (
            <div key={r.id} style={ds.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: r.texto ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Estrellas n={r.rating} />
                  <span style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nombreCliente(r)}
                  </span>
                </div>
                <div style={{ fontSize: type.xxs, color: colors.stone2, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {r.pedidos?.codigo && <span style={{ fontFamily: type.mono }}>{r.pedidos.codigo}</span>}
                  <span>{fecha(r.created_at)}</span>
                </div>
              </div>
              {r.texto && (
                <div style={{ fontSize: type.sm, color: colors.ink2, lineHeight: 1.5 }}>{r.texto}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
