import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

export default function DisponibilidadProductos() {
  const { restaurante } = useRest()
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)

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

  const disponibles = productos.filter(p => p.disponible).length
  const noDisponibles = productos.length - disponibles

  // Agrupar por categoría
  const catsConProductos = categorias.filter(c => productos.some(p => p.categoria_id === c.id))
  const sinCategoria = productos.filter(p => !p.categoria_id)

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--c-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🍽️</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Cargando productos...</div>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>Disponibilidad</h2>
      <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 16 }}>
        Activa o desactiva productos para los clientes en tiempo real.
      </p>

      {/* Stats */}
      {productos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <div style={{
            flex: 1, background: 'rgba(34,197,94,0.1)', borderRadius: 12,
            padding: '12px 14px', border: '1px solid rgba(34,197,94,0.2)',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#4ADE80' }}>{disponibles}</div>
            <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.8)', fontWeight: 600 }}>Disponibles</div>
          </div>
          <div style={{
            flex: 1, background: 'rgba(239,68,68,0.1)', borderRadius: 12,
            padding: '12px 14px', border: '1px solid rgba(239,68,68,0.2)',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#EF4444' }}>{noDisponibles}</div>
            <div style={{ fontSize: 11, color: 'rgba(239,68,68,0.8)', fontWeight: 600 }}>No disponibles</div>
          </div>
        </div>
      )}

      {productos.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--c-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>No hay productos en la carta</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Añade productos desde el panel web</div>
        </div>
      )}

      {/* Por categoría */}
      {catsConProductos.map(cat => (
        <div key={cat.id} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--c-muted)',
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {cat.nombre}
          </div>
          {productos.filter(p => p.categoria_id === cat.id).map(p => (
            <ProductoRow key={p.id} p={p} toggle={toggleDisponible} />
          ))}
        </div>
      ))}

      {/* Sin categoría */}
      {sinCategoria.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--c-muted)',
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Sin categoría
          </div>
          {sinCategoria.map(p => (
            <ProductoRow key={p.id} p={p} toggle={toggleDisponible} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductoRow({ p, toggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--c-surface)', borderRadius: 12,
      padding: '12px 14px', marginBottom: 8,
      border: '1px solid var(--c-border)',
      opacity: p.disponible ? 1 : 0.5,
      transition: 'opacity 0.2s',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        background: 'var(--c-surface2)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
      }}>
        {p.imagen_url
          ? <img src={p.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : '🍽️'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.nombre}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: p.disponible ? '#4ADE80' : 'var(--c-muted)', marginTop: 2 }}>
          {p.disponible ? 'Disponible' : 'No disponible'}
        </div>
      </div>
      <button
        onClick={() => toggle(p.id, p.disponible)}
        style={{
          width: 48, height: 28, borderRadius: 14, border: 'none',
          background: p.disponible ? '#16A34A' : 'rgba(255,255,255,0.15)',
          cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
          minHeight: 44, minWidth: 48, display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: p.disponible ? 23 : 3,
          width: 22, height: 22, borderRadius: 11,
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  )
}
