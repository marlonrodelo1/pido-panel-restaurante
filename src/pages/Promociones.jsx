import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { confirmar, toast } from '../App'

const TIPOS = [
  { id: 'descuento_porcentaje', label: '% Descuento', icon: '🏷️', desc: 'Descuento en porcentaje sobre el total del carrito' },
  { id: 'descuento_fijo', label: '€ Descuento', icon: '💰', desc: 'Descuento de una cantidad fija en euros' },
  { id: 'producto_gratis', label: 'Producto gratis', icon: '🎁', desc: 'Un producto gratis al superar un monto mínimo' },
  { id: '2x1', label: '2x1', icon: '🔥', desc: 'Lleva 2 y paga 1 en un producto específico' },
]

export default function Promociones() {
  const { restaurante } = useRest()
  const [promos, setPromos] = useState([])
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPromo, setEditPromo] = useState(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [tipo, setTipo] = useState('descuento_porcentaje')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [valor, setValor] = useState('')
  const [minimoCompra, setMinimoCompra] = useState('')
  const [productoId, setProductoId] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  useEffect(() => {
    if (restaurante) fetchData()
  }, [restaurante?.id])

  async function fetchData() {
    setLoading(true)
    // Ocultar promos vencidas hace más de 30 días
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const [promosRes, prodsRes] = await Promise.all([
      supabase.from('promociones').select('*').eq('establecimiento_id', restaurante.id)
        .or('fecha_fin.is.null,fecha_fin.gt.' + hace30d)
        .order('created_at', { ascending: false }),
      supabase.from('productos').select('id, nombre, precio').eq('establecimiento_id', restaurante.id).eq('disponible', true).order('nombre'),
    ])
    setPromos(promosRes.data || [])
    setProductos(prodsRes.data || [])
    setLoading(false)
  }

  function resetForm() {
    setTipo('descuento_porcentaje')
    setTitulo('')
    setDescripcion('')
    setValor('')
    setMinimoCompra('')
    setProductoId('')
    setFechaFin('')
    setEditPromo(null)
  }

  function abrirCrear() {
    resetForm()
    setShowForm(true)
  }

  function abrirEditar(p) {
    setEditPromo(p)
    setTipo(p.tipo)
    setTitulo(p.titulo)
    setDescripcion(p.descripcion || '')
    setValor(p.valor?.toString() || '')
    setMinimoCompra(p.minimo_compra?.toString() || '')
    setProductoId(p.producto_id || '')
    setFechaFin(p.fecha_fin ? p.fecha_fin.split('T')[0] : '')
    setShowForm(true)
  }

  // Auto-generar título según tipo
  function autoTitulo(t, v, prodId) {
    const prod = productos.find(p => p.id === prodId)
    switch (t) {
      case 'descuento_porcentaje': return v ? `${v}% de descuento` : ''
      case 'descuento_fijo': return v ? `${v}€ de descuento` : ''
      case 'producto_gratis': return prod ? `${prod.nombre} gratis` : 'Producto gratis'
      case '2x1': return prod ? `2x1 en ${prod.nombre}` : '2x1'
      default: return ''
    }
  }

  const [errorForm, setErrorForm] = useState(null)

  async function guardar() {
    setErrorForm(null)
    if (!titulo.trim()) { setErrorForm('El título es obligatorio'); return }
    const necesitaVal = tipo === 'descuento_porcentaje' || tipo === 'descuento_fijo'
    if (necesitaVal && (!valor || Number(valor) <= 0)) { setErrorForm('El valor del descuento debe ser mayor a 0'); return }
    if (tipo === 'descuento_porcentaje' && Number(valor) > 100) { setErrorForm('El porcentaje no puede ser mayor a 100'); return }
    const necesitaProd = tipo === '2x1' || tipo === 'producto_gratis'
    if (necesitaProd && !productoId) { setErrorForm('Selecciona un producto'); return }

    setSaving(true)

    const prod = productos.find(p => p.id === productoId)
    const data = {
      establecimiento_id: restaurante.id,
      tipo,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      valor: valor ? Number(valor) : null,
      minimo_compra: minimoCompra ? Number(minimoCompra) : 0,
      producto_id: productoId || null,
      producto_nombre: prod?.nombre || null,
      fecha_fin: fechaFin ? new Date(fechaFin + 'T23:59:59').toISOString() : null,
      activa: true,
    }

    try {
      const { error } = editPromo
        ? await supabase.from('promociones').update(data).eq('id', editPromo.id)
        : await supabase.from('promociones').insert(data)
      if (error) throw error
      setShowForm(false)
      resetForm()
      fetchData()
    } catch (err) {
      setErrorForm('Error al guardar: ' + (err.message || 'Intenta de nuevo'))
    }
    setSaving(false)
  }

  async function toggleActiva(id, current) {
    const { error } = await supabase.from('promociones').update({ activa: !current }).eq('id', id)
    if (error) { toast('Error al cambiar estado'); return }
    setPromos(prev => prev.map(p => p.id === id ? { ...p, activa: !current } : p))
  }

  async function eliminar(id) {
    if (!await confirmar('¿Eliminar esta promoción?')) return
    const { error } = await supabase.from('promociones').delete().eq('id', id)
    if (error) { toast('Error al eliminar: ' + error.message); return }
    setPromos(prev => prev.filter(p => p.id !== id))
  }

  const tipoInfo = TIPOS.find(t => t.id === tipo)
  const necesitaProducto = tipo === '2x1' || tipo === 'producto_gratis'
  const necesitaValor = tipo === 'descuento_porcentaje' || tipo === 'descuento_fijo'

  const inp = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontFamily: 'inherit', background: 'rgba(0,0,0,0.06)', color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: 4, display: 'block' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Promociones</h2>
        <button onClick={abrirCrear} style={{
          padding: '8px 16px', borderRadius: 10, border: 'none',
          background: 'var(--c-primary)', color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>+ Nueva</button>
      </div>

      {/* Formulario crear/editar */}
      {showForm && (
        <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
            {editPromo ? 'Editar promoción' : 'Nueva promoción'}
          </h3>

          {/* Tipo */}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Tipo de promoción</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {TIPOS.map(t => (
                <button key={t.id} onClick={() => {
                  setTipo(t.id)
                  const auto = autoTitulo(t.id, valor, productoId)
                  if (!titulo || TIPOS.some(tt => autoTitulo(tt.id, valor, productoId) === titulo)) setTitulo(auto)
                }} style={{
                  padding: '12px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  border: tipo === t.id ? '2px solid var(--c-primary)' : '1px solid var(--c-border)',
                  background: tipo === t.id ? 'rgba(185,28,28,0.1)' : 'rgba(0,0,0,0.03)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{t.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: tipo === t.id ? 'var(--c-primary)' : 'var(--c-text)' }}>{t.label}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 8 }}>{tipoInfo?.desc}</div>
          </div>

          {/* Valor (para descuentos) */}
          {necesitaValor && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{tipo === 'descuento_porcentaje' ? 'Porcentaje de descuento' : 'Descuento en euros'}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" value={valor}
                  onChange={e => {
                    setValor(e.target.value)
                    const auto = autoTitulo(tipo, e.target.value, productoId)
                    if (!titulo || TIPOS.some(t => autoTitulo(t.id, valor, productoId) === titulo)) setTitulo(auto)
                  }}
                  placeholder={tipo === 'descuento_porcentaje' ? 'Ej: 15' : 'Ej: 3.00'}
                  style={{ ...inp, flex: 1 }}
                />
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-primary)' }}>
                  {tipo === 'descuento_porcentaje' ? '%' : '€'}
                </span>
              </div>
            </div>
          )}

          {/* Producto (para 2x1 y producto gratis) */}
          {necesitaProducto && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>{tipo === '2x1' ? 'Producto en 2x1' : 'Producto gratis'}</label>
              <select value={productoId} onChange={e => {
                setProductoId(e.target.value)
                const auto = autoTitulo(tipo, valor, e.target.value)
                if (!titulo || TIPOS.some(t => autoTitulo(t.id, valor, productoId) === titulo)) setTitulo(auto)
              }} style={inp}>
                <option value="">Seleccionar producto</option>
                {productos.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre} — {p.precio.toFixed(2)}€</option>
                ))}
              </select>
            </div>
          )}

          {/* Mínimo de compra */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Compra mínima (0 = sin mínimo)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" value={minimoCompra} onChange={e => setMinimoCompra(e.target.value)} placeholder="0" style={{ ...inp, flex: 1 }} />
              <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>€</span>
            </div>
          </div>

          {/* Título */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Título de la promoción</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej: 2x1 en Burgers" style={inp} />
          </div>

          {/* Descripción */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Descripción (opcional)</label>
            <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Válido todos los martes" style={inp} />
          </div>

          {/* Fecha fin */}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Fecha de fin (dejar vacío = sin límite)</label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={inp} />
          </div>

          {/* Error */}
          {errorForm && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 10, textAlign: 'center', background: 'rgba(220,38,38,0.1)', padding: '8px 12px', borderRadius: 8 }}>{errorForm}</div>}

          {/* Botones */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowForm(false); resetForm(); setErrorForm(null) }} style={{
              flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-border)',
              background: 'transparent', color: 'var(--c-muted)',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancelar</button>
            <button onClick={guardar} disabled={saving || !titulo.trim()} style={{
              flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
              background: saving ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>{saving ? 'Guardando...' : editPromo ? 'Actualizar' : 'Crear promoción'}</button>
          </div>
        </div>
      )}

      {/* Lista de promociones */}
      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>Cargando...</div>}

      {!loading && promos.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🏷️</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Sin promociones</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 16 }}>Crea tu primera promoción para atraer más clientes</div>
          <button onClick={abrirCrear} style={{
            padding: '10px 24px', borderRadius: 10, border: 'none',
            background: 'var(--c-primary)', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>Crear promoción</button>
        </div>
      )}

      {promos.map(p => {
        const tipoData = TIPOS.find(t => t.id === p.tipo)
        const vencida = p.fecha_fin && new Date(p.fecha_fin) < new Date()
        return (
          <div key={p.id} style={{
            background: 'var(--c-surface)', borderRadius: 14, padding: 16,
            border: p.activa && !vencida ? '1px solid rgba(185,28,28,0.3)' : '1px solid var(--c-border)',
            marginBottom: 10, opacity: p.activa && !vencida ? 1 : 0.6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{tipoData?.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.titulo}</div>
                  {p.descripcion && <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{p.descripcion}</div>}
                </div>
              </div>
              <button onClick={() => toggleActiva(p.id, p.activa)} style={{
                width: 48, height: 28, borderRadius: 14, border: 'none',
                background: p.activa ? '#16A34A' : 'rgba(0,0,0,0.15)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                minHeight: 44, minWidth: 48, display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
              }}>
                <span style={{
                  position: 'absolute', top: 3, left: p.activa ? 23 : 3,
                  width: 22, height: 22, borderRadius: 11, background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {/* Detalles */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'var(--c-primary-light)', color: 'var(--c-primary)' }}>
                {tipoData?.label}
              </span>
              {p.valor && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', color: 'var(--c-text)' }}>
                  {p.tipo === 'descuento_porcentaje' ? `${p.valor}%` : `${p.valor}€`}
                </span>
              )}
              {p.minimo_compra > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', color: 'var(--c-muted)' }}>
                  Min. {p.minimo_compra}€
                </span>
              )}
              {p.producto_nombre && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', color: 'var(--c-muted)' }}>
                  {p.producto_nombre}
                </span>
              )}
              {vencida && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#DC2626' }}>
                  Vencida
                </span>
              )}
              {p.fecha_fin && !vencida && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', color: 'var(--c-muted)' }}>
                  Hasta {new Date(p.fecha_fin).toLocaleDateString('es')}
                </span>
              )}
            </div>

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => abrirEditar(p)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--c-border)',
                background: 'transparent', color: 'var(--c-text)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>Editar</button>
              <button onClick={() => eliminar(p.id)} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)',
                background: 'transparent', color: '#DC2626',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>Eliminar</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
