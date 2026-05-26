import { useState, useEffect, useMemo } from 'react'
import { Search, Package } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'
import { FoodChip } from '../lib/food'

export default function DisponibilidadProductos() {
  const { restaurante } = useRest()
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (restaurante?.id) fetchProductos()
  }, [restaurante?.id])

  async function fetchProductos() {
    const [prodRes, catRes] = await Promise.all([
      supabase
        .from('productos')
        .select('id, nombre, disponible, imagen_url, categoria_id')
        .eq('establecimiento_id', restaurante.id)
        .order('orden'),
      supabase.from('categorias').select('id, nombre').eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden'),
    ])
    setProductos(prodRes.data || [])
    setCategorias(catRes.data || [])
    setLoading(false)
  }

  async function toggleDisponible(id, current) {
    await supabase.from('productos').update({ disponible: !current }).eq('id', id)
    setProductos(prev => prev.map(p => p.id === id ? { ...p, disponible: !current } : p))
  }

  // Filtro por búsqueda (case-insensitive).
  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos
    return productos.filter(p => p.nombre?.toLowerCase().includes(q))
  }, [productos, busqueda])

  const disponibles = productosFiltrados.filter(p => p.disponible).length
  const noDisponibles = productosFiltrados.length - disponibles

  // Agrupar por categoría (sobre la lista filtrada).
  const catsConProductos = categorias.filter(c => productosFiltrados.some(p => p.categoria_id === c.id))
  const sinCategoria = productosFiltrados.filter(p => !p.categoria_id)

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: colors.textMute }}>
        <div style={{ fontSize: type.sm, fontWeight: 600 }}>Cargando productos…</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ ...ds.h1, margin: 0 }}>Disponibilidad</h2>
        <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 4 }}>
          Activa o desactiva productos sin tocar la carta.
        </div>
      </div>

      {/* Buscador */}
      {productos.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search
            size={15} strokeWidth={2.2} color={colors.stone}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          />
          <input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            style={{
              ...ds.input, height: 40, paddingLeft: 36, fontSize: type.sm,
            }}
          />
        </div>
      )}

      {/* Stats (sage / danger según bundle s1-apk) */}
      {productosFiltrados.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div style={{
            background: colors.sageSoft,
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: type.xxs, color: colors.sage2, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              Disponibles
            </div>
            <div style={{
              fontSize: 32, color: colors.sage2, marginTop: 4,
              fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>
              {disponibles}
            </div>
          </div>
          <div style={{
            background: colors.dangerSoft,
            borderRadius: 12,
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: type.xxs, color: colors.danger, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              No disponibles
            </div>
            <div style={{
              fontSize: 32, color: colors.danger, marginTop: 4,
              fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>
              {noDisponibles}
            </div>
          </div>
        </div>
      )}

      {productos.length === 0 && (
        <div style={{ textAlign: 'center', padding: '50px 16px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: colors.cream2, color: colors.stone2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12,
          }}>
            <Package size={28} strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
            Sin productos en la carta
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute }}>
            Añade productos desde el panel web.
          </div>
        </div>
      )}

      {productos.length > 0 && productosFiltrados.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: colors.textMute, fontSize: type.sm }}>
          Sin resultados para «{busqueda}».
        </div>
      )}

      {/* Categorías */}
      {catsConProductos.map(cat => (
        <div key={cat.id} style={{ marginBottom: 22 }}>
          <div style={{
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>
            {cat.nombre}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {productosFiltrados.filter(p => p.categoria_id === cat.id).map(p => (
              <ProductoRow key={p.id} p={p} cat={cat.nombre} toggle={toggleDisponible} />
            ))}
          </div>
        </div>
      ))}

      {/* Sin categoría */}
      {sinCategoria.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>
            Sin categoría
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sinCategoria.map(p => (
              <ProductoRow key={p.id} p={p} cat={null} toggle={toggleDisponible} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProductoRow({ p, cat, toggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      background: colors.paper,
      borderRadius: 12,
      padding: 12,
      border: `1px solid ${colors.border}`,
      opacity: p.disponible ? 1 : 0.6,
      transition: 'opacity 0.2s',
    }}>
      {/* Thumbnail: imagen real si hay, sino FoodChip ilustración */}
      {p.imagen_url ? (
        <div style={{
          width: 56, height: 56, borderRadius: 10, flexShrink: 0,
          background: colors.cream2, overflow: 'hidden',
        }}>
          <img src={p.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : (
        <FoodChip cat={cat || 'general'} size={56} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700, color: colors.ink, fontSize: type.sm,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {p.nombre}
        </div>
        <div style={{
          fontSize: type.xxs, fontWeight: 600,
          color: p.disponible ? colors.sage2 : colors.textMute,
          marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: p.disponible ? colors.sage : colors.stone2,
          }} />
          {p.disponible ? 'Disponible' : 'No disponible'}
        </div>
      </div>

      {/* Toggle 48×28 estilo cream world (track sage cuando on) */}
      <button
        onClick={() => toggle(p.id, p.disponible)}
        aria-label={p.disponible ? 'Marcar no disponible' : 'Marcar disponible'}
        style={{
          width: 48, height: 28, borderRadius: 14, border: 'none',
          background: p.disponible ? colors.sage : colors.cream2,
          cursor: 'pointer', position: 'relative',
          transition: 'background 0.2s',
          minHeight: 44, minWidth: 48,
          display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: p.disponible ? 23 : 3,
          width: 22, height: 22, borderRadius: 11,
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(26,24,21,0.2)',
        }} />
      </button>
    </div>
  )
}
