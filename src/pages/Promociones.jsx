import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { confirmar, toast } from '../App'
import { colors, type, ds, chip } from '../lib/uiStyles'

const TIPOS = [
  { id: 'descuento_porcentaje', label: '% sobre total', icon: '🏷️', desc: 'Descuento en porcentaje sobre el total del carrito' },
  { id: 'descuento_fijo', label: '€ de descuento', icon: '💰', desc: 'Descuento de una cantidad fija en euros' },
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

  const necesitaProducto = tipo === '2x1' || tipo === 'producto_gratis'
  const necesitaValor = tipo === 'descuento_porcentaje' || tipo === 'descuento_fijo'

  const promosActivas = promos.filter(p => p.activa && (!p.fecha_fin || new Date(p.fecha_fin) >= new Date()))

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ ...ds.h1, margin: 0 }}>Promociones</h2>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
            Crea descuentos y ofertas para tus clientes
          </div>
        </div>
        <button onClick={abrirCrear} style={ds.glossyBtn}>
          <Plus size={15} strokeWidth={2.2} /> Nueva
        </button>
      </div>

      {/* Formulario inline */}
      {showForm && (
        <div style={{ ...ds.card, padding: 22, marginBottom: 18 }}>
          <div style={{ ...ds.h2, marginBottom: 16 }}>
            {editPromo ? 'Editar promoción' : 'Nueva promoción'}
          </div>

          {/* Selector tipo — 4 cards */}
          <label style={ds.label}>Tipo</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
            {TIPOS.map(t => {
              const activo = tipo === t.id
              return (
                <button key={t.id} onClick={() => {
                  setTipo(t.id)
                  const auto = autoTitulo(t.id, valor, productoId)
                  if (!titulo || TIPOS.some(tt => autoTitulo(tt.id, valor, productoId) === titulo)) setTitulo(auto)
                }} style={{
                  padding: 18, borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                  border: activo ? `1.5px solid ${colors.terracotta}` : `1px solid ${colors.borderStrong}`,
                  background: activo ? colors.terracottaSoft : colors.paper,
                  fontFamily: 'inherit',
                }}>
                  <div style={{ fontSize: 28 }}>{t.icon}</div>
                  <div style={{
                    fontSize: 13, fontWeight: 700, marginTop: 8,
                    color: activo ? colors.terracotta2 : colors.ink,
                  }}>{t.label}</div>
                </button>
              )
            })}
          </div>

          {/* Campos dinámicos */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={ds.label}>Nombre</label>
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej: 10% descuento fines de semana" style={ds.formInput} />
            </div>
            {necesitaValor && (
              <div>
                <label style={ds.label}>{tipo === 'descuento_porcentaje' ? 'Descuento (%)' : 'Descuento (€)'}</label>
                <input
                  type="number" value={valor}
                  onChange={e => {
                    setValor(e.target.value)
                    const auto = autoTitulo(tipo, e.target.value, productoId)
                    if (!titulo || TIPOS.some(t => autoTitulo(t.id, valor, productoId) === titulo)) setTitulo(auto)
                  }}
                  placeholder={tipo === 'descuento_porcentaje' ? 'Ej: 15' : 'Ej: 3.00'}
                  style={ds.formInput}
                />
              </div>
            )}
            {necesitaProducto && (
              <div>
                <label style={ds.label}>{tipo === '2x1' ? 'Producto en 2x1' : 'Producto gratis'}</label>
                <select value={productoId} onChange={e => {
                  setProductoId(e.target.value)
                  const auto = autoTitulo(tipo, valor, e.target.value)
                  if (!titulo || TIPOS.some(t => autoTitulo(t.id, valor, productoId) === titulo)) setTitulo(auto)
                }} style={ds.select}>
                  <option value="">Seleccionar</option>
                  {productos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} — {p.precio.toFixed(2)}€</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={ds.label}>Compra mínima</label>
              <input type="number" value={minimoCompra} onChange={e => setMinimoCompra(e.target.value)} placeholder="0" style={ds.formInput} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={ds.label}>Descripción (opcional)</label>
              <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Válido todos los martes" style={ds.formInput} />
            </div>
            <div>
              <label style={ds.label}>Válida hasta</label>
              <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={ds.formInput} />
            </div>
          </div>

          {errorForm && (
            <div style={{ color: colors.danger, fontSize: 12, marginBottom: 12, textAlign: 'center', background: colors.dangerSoft, padding: '8px 12px', borderRadius: 8 }}>
              {errorForm}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => { setShowForm(false); resetForm(); setErrorForm(null) }} style={ds.ghostBtn}>
              Cancelar
            </button>
            <button onClick={guardar} disabled={saving || !titulo.trim()} style={{ ...ds.glossyBtn, opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Guardando...' : editPromo ? 'Actualizar' : 'Crear promoción'}
            </button>
          </div>
        </div>
      )}

      {/* Section label */}
      {!loading && promos.length > 0 && (
        <div style={ds.sectionLabel}>Promociones activas ({promosActivas.length})</div>
      )}

      {/* Lista */}
      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: colors.stone, fontSize: type.sm }}>Cargando...</div>}

      {!loading && promos.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🏷️</div>
          <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 4, color: colors.ink }}>Sin promociones</div>
          <div style={{ fontSize: type.xs, color: colors.stone, marginBottom: 16 }}>Crea tu primera promoción para atraer más clientes</div>
          <button onClick={abrirCrear} style={ds.glossyBtn}>
            <Plus size={15} strokeWidth={2.2} /> Crear promoción
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {promos.map(p => {
          const tipoData = TIPOS.find(t => t.id === p.tipo)
          const vencida = p.fecha_fin && new Date(p.fecha_fin) < new Date()
          return (
            <div key={p.id} style={{ ...ds.card, padding: 16, opacity: p.activa && !vencida ? 1 : 0.65 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                {/* Emoji avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: colors.cream2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, flexShrink: 0,
                }}>{tipoData?.icon}</div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink }}>{p.titulo}</div>
                  {p.descripcion && (
                    <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 2 }}>{p.descripcion}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {p.valor && (
                      <span style={chip('terracotta')}>
                        {p.tipo === 'descuento_porcentaje' ? `${p.valor}%` : `${p.valor}€`}
                      </span>
                    )}
                    {p.minimo_compra > 0 && (
                      <span style={chip('paper')}>Mínimo {p.minimo_compra} €</span>
                    )}
                    {p.producto_nombre && (
                      <span style={chip('paper')}>{p.producto_nombre}</span>
                    )}
                    {vencida ? (
                      <span style={chip('danger')}>Vencida</span>
                    ) : p.fecha_fin ? (
                      <span style={chip('sage')}>Hasta {new Date(p.fecha_fin).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}</span>
                    ) : null}
                  </div>
                </div>

                {/* Toggle */}
                <button onClick={() => toggleActiva(p.id, p.activa)} style={{
                  width: 48, height: 28, borderRadius: 14, border: 'none',
                  background: p.activa ? colors.sage : colors.cream2,
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                  display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
                }}>
                  <span style={{
                    position: 'absolute', top: 3, left: p.activa ? 23 : 3,
                    width: 22, height: 22, borderRadius: 11, background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(26,24,21,0.2)',
                  }} />
                </button>

                {/* Mini buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => abrirEditar(p)} style={ds.miniBtn} title="Editar">
                    <Edit2 size={11} strokeWidth={2.2}/>
                  </button>
                  <button onClick={() => eliminar(p.id)} style={ds.miniBtnDanger} title="Eliminar">
                    <Trash2 size={11} strokeWidth={2.2}/>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
