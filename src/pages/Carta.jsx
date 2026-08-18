import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Edit2, Trash2, X, Upload, Camera, ChevronDown, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { confirmar, toast } from '../App'
import { colors, type, ds, chip } from '../lib/uiStyles'
import { FoodChip } from '../lib/food.jsx'
import QrCartaLocal from '../components/QrCartaLocal'
import MesasPanel from '../components/MesasPanel'

// Subida de imágenes vía Edge Function: Storage no valida el JWT de sesión actual
// (claves asimétricas), así que la subida se hace en el servidor con permisos de
// admin tras validar que el usuario es el dueño del establecimiento.
async function subirImagenViaFuncion(file, path) {
  if (!file.type.startsWith('image/')) throw new Error('Solo se permiten imágenes')
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen no puede superar los 5 MB')
  const { data: { session } } = await supabase.auth.getSession()
  const fd = new FormData()
  fd.append('bucket', 'productos')
  fd.append('path', path)
  fd.append('file', file)
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/subir-imagen-producto`, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: fd,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'No se pudo subir la imagen')
  return out.publicUrl
}

/** Precio de local a enseñar en el listado, o null si no lo han diferenciado. */
function precioLocalListado(p, tamanos) {
  if (tamanos && tamanos.length > 0) {
    if (!tamanos.some(t => t.precio_local !== null && t.precio_local !== undefined)) return null
    return Math.min(...tamanos.map(t =>
      t.precio_local !== null && t.precio_local !== undefined ? Number(t.precio_local) : Number(t.precio)))
  }
  return (p.precio_local !== null && p.precio_local !== undefined) ? Number(p.precio_local) : null
}

export default function Carta() {
  const { restaurante } = useRest()
  // Lo enciende Pidoo desde el super-admin (el trigger
  // guard_establecimientos_protected_fields impide activarlo desde aquí).
  const cartaLocal = !!restaurante?.carta_local_activa
  const [categoriasRest, setCategoriasRest] = useState([])
  const [productos, setProductos] = useState([])
  const [gruposExtras, setGruposExtras] = useState([])
  const [catFiltro, setCatFiltro] = useState(null)
  const [gestionExtras, setGestionExtras] = useState(false)
  const [gestionCats, setGestionCats] = useState(false)
  const [nuevaCat, setNuevaCat] = useState('')
  const [loading, setLoading] = useState(true)

  // Crear/editar producto
  const [showAddProd, setShowAddProd] = useState(false)
  const [editProd, setEditProd] = useState(null)
  const [prodForm, setProdForm] = useState({ nombre: '', descripcion: '', precio: '', precio_local: '', categoria_id: '', imagen_url: '' })
  const [saving, setSaving] = useState(false)
  const [extrasAsignados, setExtrasAsignados] = useState([])
  const [tamanos, setTamanos] = useState([])
  const [prodTamanosMap, setProdTamanosMap] = useState({})
  const [busqueda, setBusqueda] = useState('')
  const [pctRelleno, setPctRelleno] = useState('10')
  const [rellenando, setRellenando] = useState(false)
  const imgRef = useRef()
  const imgTargetRef = useRef(null)

  useEffect(() => { if (restaurante) fetchCarta() }, [restaurante?.id])

  const [prodExtrasMap, setProdExtrasMap] = useState({})

  async function fetchCarta() {
    setLoading(true)
    const [catRes, prodRes, grpRes] = await Promise.all([
      supabase.from('categorias').select('*').eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden'),
      supabase.from('productos').select('*').eq('establecimiento_id', restaurante.id).order('orden'),
      supabase.from('grupos_extras').select('*, extras_opciones(*)').eq('establecimiento_id', restaurante.id),
    ])
    setCategoriasRest(catRes.data || [])
    setProductos(prodRes.data || [])
    setGruposExtras(grpRes.data || [])
    const productIds = (prodRes.data || []).map(p => p.id)
    let peData = []
    if (productIds.length > 0) {
      const { data } = await supabase.from('producto_extras').select('producto_id, grupo_id').in('producto_id', productIds)
      peData = data || []
    }
    const map = {}
    for (const pe of peData) {
      map[pe.producto_id] = (map[pe.producto_id] || 0) + 1
    }
    setProdExtrasMap(map)
    if (productIds.length > 0) {
      // `precio_local` es obligatorio en este select: guardarProducto() borra y
      // reinserta los tamaños, así que lo que no se lea aquí se pierde al
      // guardar el producto por cualquier otro motivo.
      const { data: tamData } = await supabase.from('producto_tamanos').select('id, producto_id, nombre, precio, precio_local, orden').in('producto_id', productIds).order('orden')
      const tamMap = {}
      for (const t of (tamData || [])) {
        if (!tamMap[t.producto_id]) tamMap[t.producto_id] = []
        tamMap[t.producto_id].push(t)
      }
      setProdTamanosMap(tamMap)
    } else {
      setProdTamanosMap({})
    }
    setLoading(false)
  }

  const [errorCarta, setErrorCarta] = useState(null)

  async function addCatRest() {
    if (!nuevaCat.trim()) return
    const { error } = await supabase.from('categorias').insert({ establecimiento_id: restaurante.id, nombre: nuevaCat.trim(), orden: categoriasRest.length, activa: true })
    if (error) { toast('Error al crear categoría: ' + error.message); return }
    setNuevaCat('')
    fetchCarta()
  }

  async function removeCatRest(id) {
    if (!await confirmar('¿Eliminar esta categoría? Los productos se quedarán sin categoría.')) return
    await supabase.from('productos').update({ categoria_id: null }).eq('categoria_id', id)
    await supabase.from('categorias').delete().eq('id', id)
    fetchCarta()
  }

  async function toggleDisponible(id, current) {
    await supabase.from('productos').update({ disponible: !current }).eq('id', id)
    setProductos(prev => prev.map(p => p.id === id ? { ...p, disponible: !current } : p))
  }

  async function subirImagenProducto(file, productoId) {
    const ext = file.name.split('.').pop()
    const path = `${restaurante.id}/${productoId || 'new'}_${Date.now()}.${ext}`
    const publicUrl = await subirImagenViaFuncion(file, path)
    if (productoId) {
      await supabase.from('productos').update({ imagen_url: publicUrl }).eq('id', productoId)
      setProductos(prev => prev.map(p => p.id === productoId ? { ...p, imagen_url: publicUrl } : p))
    }
    return publicUrl
  }

  function abrirCrearProducto() {
    setProdForm({ nombre: '', descripcion: '', precio: '', precio_local: '', categoria_id: catFiltro || categoriasRest[0]?.id || '', imagen_url: '' })
    setEditProd(null)
    setExtrasAsignados([])
    setTamanos([])
    setShowAddProd(true)
  }

  async function abrirEditarProducto(p) {
    setProdForm({
      nombre: p.nombre, descripcion: p.descripcion || '', precio: p.precio,
      // vacío (no 0) cuando no hay precio de local: el vacío significa
      // "el mismo precio", y un 0 sería un producto regalado.
      precio_local: p.precio_local ?? '',
      categoria_id: p.categoria_id || '', imagen_url: p.imagen_url || '',
    })
    setEditProd(p)
    const { data } = await supabase.from('producto_extras').select('grupo_id').eq('producto_id', p.id)
    setExtrasAsignados((data || []).map(d => d.grupo_id))
    setTamanos((prodTamanosMap[p.id] || []).map(t => ({
      id: t.id, nombre: t.nombre, precio: t.precio, precio_local: t.precio_local ?? '',
    })))
    setShowAddProd(true)
  }

  function toggleExtraAsignado(grupoId) {
    setExtrasAsignados(prev =>
      prev.includes(grupoId) ? prev.filter(id => id !== grupoId) : [...prev, grupoId]
    )
  }

  function parsePrecio(raw) {
    if (raw === '' || raw === null || raw === undefined) return null
    const n = Number(String(raw).replace(',', '.'))
    return Number.isFinite(n) ? n : NaN
  }

  async function guardarProducto() {
    if (!prodForm.nombre.trim()) { setErrorCarta('El nombre es obligatorio'); return }
    const precio = parsePrecio(prodForm.precio)
    if (precio === null || Number.isNaN(precio) || precio < 0) {
      setErrorCarta('Precio inválido. Usa punto como decimal (ej: 0.50)')
      return
    }
    // Precio de la carta del local (QR de mesa). Vacío = null = usa el precio
    // normal. NUNCA se usa para cobrar: solo lo lee pidoo.es/<slug>/carta.
    const precioLocal = parsePrecio(prodForm.precio_local)
    if (precioLocal !== null && (Number.isNaN(precioLocal) || precioLocal < 0)) {
      setErrorCarta('Precio de local inválido. Déjalo vacío si es el mismo precio.')
      return
    }
    setSaving(true)
    setErrorCarta(null)
    const baseData = {
      nombre: prodForm.nombre.trim(),
      descripcion: prodForm.descripcion.trim() || null,
      precio,
      precio_local: precioLocal,
      categoria_id: prodForm.categoria_id || null,
      imagen_url: prodForm.imagen_url || null,
    }
    let productoId
    if (editProd) {
      const { error } = await supabase.from('productos').update(baseData).eq('id', editProd.id)
      if (error) { setErrorCarta('Error al guardar: ' + error.message); setSaving(false); return }
      productoId = editProd.id
    } else {
      const insertData = { ...baseData, establecimiento_id: restaurante.id, disponible: true, orden: productos.length }
      const { data: nuevo, error } = await supabase.from('productos').insert(insertData).select().single()
      if (error) { setErrorCarta('Error al crear producto: ' + error.message); setSaving(false); return }
      productoId = nuevo?.id
    }
    if (productoId) {
      await supabase.from('producto_extras').delete().eq('producto_id', productoId)
      if (extrasAsignados.length > 0) {
        await supabase.from('producto_extras').insert(
          extrasAsignados.map(grupoId => ({ producto_id: productoId, grupo_id: grupoId }))
        )
      }
      await supabase.from('producto_tamanos').delete().eq('producto_id', productoId)
      const tamanosValidos = tamanos.filter(t => t.nombre.trim() && t.precio !== '' && Number(t.precio) >= 0)
      if (tamanosValidos.length > 0) {
        await supabase.from('producto_tamanos').insert(
          tamanosValidos.map((t, i) => {
            const pl = parsePrecio(t.precio_local)
            return {
              producto_id: productoId,
              nombre: t.nombre.trim(),
              precio: Number(t.precio),
              precio_local: (pl === null || Number.isNaN(pl) || pl < 0) ? null : pl,
              orden: i,
            }
          })
        )
      }
    }
    setShowAddProd(false)
    setEditProd(null)
    setSaving(false)
    fetchCarta()
  }

  /* Relleno masivo del precio de local. Con 100+ productos, rellenar a mano es
     lo que hace que la carta del local se quede a medias — y una carta a medias
     enseña precios de domicilio en la mesa, que es justo lo que no se quiere. */
  async function rellenarPreciosLocal() {
    const pct = Number(pctRelleno)
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      toast('Pon un porcentaje entre 1 y 99')
      return
    }
    const factor = 1 - pct / 100
    // Redondeo a 5 céntimos: un 8,4735 € en una carta impresa queda fatal.
    const calcular = (base) => Math.max(0, Math.round(Number(base) * factor * 20) / 20)

    const conTamanos = new Set(Object.keys(prodTamanosMap).filter(id => (prodTamanosMap[id] || []).length > 0))
    const prodsVacios = productos.filter(p => p.precio_local === null || p.precio_local === undefined)
      .filter(p => !conTamanos.has(p.id))
    const tamsVacios = Object.values(prodTamanosMap).flat()
      .filter(t => t.precio_local === null || t.precio_local === undefined)

    if (prodsVacios.length === 0 && tamsVacios.length === 0) {
      toast('Todos los productos ya tienen precio de local', 'success')
      return
    }
    const ok = await confirmar(
      `Se pondrá un precio de local un ${pct}% más barato en ${prodsVacios.length} productos` +
      (tamsVacios.length ? ` y ${tamsVacios.length} tamaños` : '') +
      '. Los que ya tienen precio propio no se tocan. ¿Seguir?'
    )
    if (!ok) return

    setRellenando(true)
    try {
      const tareas = [
        ...prodsVacios.map(p => () => supabase.from('productos')
          .update({ precio_local: calcular(p.precio) }).eq('id', p.id)),
        ...tamsVacios.map(t => () => supabase.from('producto_tamanos')
          .update({ precio_local: calcular(t.precio) }).eq('id', t.id)),
      ]
      let fallos = 0
      for (let i = 0; i < tareas.length; i += 10) {
        const res = await Promise.all(tareas.slice(i, i + 10).map(f => f()))
        fallos += res.filter(r => r?.error).length
      }
      if (fallos > 0) toast(`${fallos} no se pudieron guardar. Revisa e inténtalo de nuevo.`)
      else toast('Precios del local rellenados', 'success')
      await fetchCarta()
    } finally {
      setRellenando(false)
    }
  }

  async function eliminarProducto(id) {
    if (!await confirmar('¿Eliminar este producto?')) return
    await supabase.from('productos').delete().eq('id', id)
    fetchCarta()
  }

  async function handleImagenForm(file) {
    if (!file) return
    try {
      if (editProd) {
        const url = await subirImagenProducto(file, editProd.id)
        setProdForm(prev => ({ ...prev, imagen_url: url }))
      } else {
        const ext = file.name.split('.').pop()
        const path = `${restaurante.id}/temp_${Date.now()}.${ext}`
        const publicUrl = await subirImagenViaFuncion(file, path)
        setProdForm(prev => ({ ...prev, imagen_url: publicUrl }))
      }
      toast('Imagen subida', 'success')
    } catch (e) {
      toast('No se pudo subir la imagen: ' + e.message)
    }
  }

  // Cuántos tienen precio propio de local (contando por tamaños si los tiene).
  const conPrecioLocal = productos.filter(p =>
    precioLocalListado(p, prodTamanosMap[p.id]) !== null).length

  const filtrados = productos.filter(p => {
    if (catFiltro && p.categoria_id !== catFiltro) return false
    if (busqueda && !p.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false
    return true
  })

  const catLabel = (id) => {
    const cat = categoriasRest.find(c => c.id === id)
    return cat ? `${cat.emoji || ''} ${cat.nombre}` : 'Sin categoría'
  }

  // --- CRUD Extras ---
  const [editGrupo, setEditGrupo] = useState(null)
  const [grupoForm, setGrupoForm] = useState({ nombre: '', tipo: 'multiple', max_selecciones: 3 })
  const [opcionesForm, setOpcionesForm] = useState([])
  const [savingGrupo, setSavingGrupo] = useState(false)

  function abrirCrearGrupo() {
    setGrupoForm({ nombre: '', tipo: 'multiple', max_selecciones: 3 })
    setOpcionesForm([{ nombre: '', precio: '' }])
    setEditGrupo('new')
  }

  function abrirEditarGrupo(g) {
    setGrupoForm({ nombre: g.nombre, tipo: g.tipo, max_selecciones: g.max_selecciones })
    setOpcionesForm((g.extras_opciones || []).map(o => ({ id: o.id, nombre: o.nombre, precio: o.precio })))
    setEditGrupo(g)
  }

  async function guardarGrupo() {
    if (!grupoForm.nombre.trim()) return
    const opcionesValidas = opcionesForm.filter(o => o.nombre.trim() && o.precio !== '' && Number(o.precio) >= 0)
    if (opcionesValidas.length === 0) return
    setSavingGrupo(true)

    let grupoId
    if (editGrupo === 'new') {
      const { data } = await supabase.from('grupos_extras').insert({
        establecimiento_id: restaurante.id,
        nombre: grupoForm.nombre.trim(),
        tipo: grupoForm.tipo,
        max_selecciones: grupoForm.tipo === 'single' ? 1 : Number(grupoForm.max_selecciones),
      }).select().single()
      grupoId = data?.id
    } else {
      await supabase.from('grupos_extras').update({
        nombre: grupoForm.nombre.trim(),
        tipo: grupoForm.tipo,
        max_selecciones: grupoForm.tipo === 'single' ? 1 : Number(grupoForm.max_selecciones),
      }).eq('id', editGrupo.id)
      grupoId = editGrupo.id
      await supabase.from('extras_opciones').delete().eq('grupo_id', grupoId)
    }

    if (grupoId) {
      await supabase.from('extras_opciones').insert(
        opcionesValidas.map((o, i) => ({ grupo_id: grupoId, nombre: o.nombre.trim(), precio: Number(o.precio), orden: i }))
      )
    }

    setSavingGrupo(false)
    setEditGrupo(null)
    fetchCarta()
  }

  async function eliminarGrupo(id) {
    if (!await confirmar('¿Eliminar este grupo de extras y todas sus opciones?')) return
    await supabase.from('extras_opciones').delete().eq('grupo_id', id)
    await supabase.from('producto_extras').delete().eq('grupo_id', id)
    await supabase.from('grupos_extras').delete().eq('id', id)
    fetchCarta()
  }

  // ─────────────────────────────────────────────────────────────────
  // Sub-vista: GESTIÓN EXTRAS
  // ─────────────────────────────────────────────────────────────────
  if (gestionExtras) {
    if (editGrupo) {
      return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
          <button onClick={() => setEditGrupo(null)} style={ds.backBtn}>← Volver a extras</button>
          <h2 style={{ ...ds.h1, marginBottom: 20 }}>{editGrupo === 'new' ? 'Nuevo grupo de extras' : 'Editar grupo'}</h2>

          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>Nombre del grupo</label>
            <input value={grupoForm.nombre} onChange={e => setGrupoForm({ ...grupoForm, nombre: e.target.value })} placeholder="Ej: Extras de queso" style={ds.formInput} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>Tipo de selección</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ id: 'single', l: 'Elige 1' }, { id: 'multiple', l: 'Múltiple' }].map(t => (
                <button key={t.id} onClick={() => setGrupoForm({ ...grupoForm, tipo: t.id })} style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                  border: grupoForm.tipo === t.id ? `1.5px solid ${colors.terracotta}` : `1px solid ${colors.border}`,
                  background: grupoForm.tipo === t.id ? colors.terracottaSoft : colors.paper,
                  color: grupoForm.tipo === t.id ? colors.terracotta2 : colors.ink,
                }}>{t.l}</button>
              ))}
            </div>
          </div>

          {grupoForm.tipo === 'multiple' && (
            <div style={{ marginBottom: 16 }}>
              <label style={ds.label}>Máximo de selecciones</label>
              <input type="number" min="1" max="10" value={grupoForm.max_selecciones} onChange={e => setGrupoForm({ ...grupoForm, max_selecciones: e.target.value })} style={{ ...ds.formInput, width: 100 }} />
            </div>
          )}

          <label style={ds.label}>Opciones</label>
          {opcionesForm.map((op, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={op.nombre} onChange={e => { const n = [...opcionesForm]; n[i].nombre = e.target.value; setOpcionesForm(n) }} placeholder="Nombre" style={{ ...ds.formInput, flex: 2 }} />
              <input type="number" step="0.10" value={op.precio} onChange={e => { const n = [...opcionesForm]; n[i].precio = e.target.value; setOpcionesForm(n) }} placeholder="€" style={{ ...ds.formInput, flex: 1 }} />
              <button onClick={() => setOpcionesForm(prev => prev.filter((_, idx) => idx !== i))} style={ds.miniBtnDanger}><X size={12}/></button>
            </div>
          ))}
          <button onClick={() => setOpcionesForm(prev => [...prev, { nombre: '', precio: '' }])} style={{
            width: '100%', padding: '10px 0', borderRadius: 10,
            border: `1px dashed ${colors.borderStrong}`,
            background: 'transparent', color: colors.stone,
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20,
          }}>+ Añadir opción</button>

          <button onClick={guardarGrupo} disabled={savingGrupo || !grupoForm.nombre.trim()} style={{
            ...ds.glossyBtn, width: '100%', opacity: savingGrupo ? 0.5 : 1,
          }}>
            {savingGrupo ? 'Guardando...' : editGrupo === 'new' ? 'Crear grupo' : 'Guardar cambios'}
          </button>
        </div>
      )
    }

    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <button onClick={() => setGestionExtras(false)} style={ds.backBtn}>← Volver a carta</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ ...ds.h1, margin: 0 }}>Grupos de extras</h2>
          <button onClick={abrirCrearGrupo} style={ds.glossyBtn}>
            <Plus size={15} strokeWidth={2.2} /> Grupo
          </button>
        </div>
        {gruposExtras.map(g => (
          <div key={g.id} style={{ ...ds.card, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: type.base, color: colors.ink }}>{g.nombre}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => abrirEditarGrupo(g)} style={ds.miniBtn}><Edit2 size={11}/> Editar</button>
                <button onClick={() => eliminarGrupo(g.id)} style={ds.miniBtnDanger}><Trash2 size={11}/> Eliminar</button>
              </div>
            </div>
            <div style={{ fontSize: type.xs, color: colors.stone, marginBottom: 10 }}>
              {g.tipo === 'multiple' ? `Múltiple · máx. ${g.max_selecciones}` : 'Selección única'}
            </div>
            {(g.extras_opciones || []).map(op => (
              <div key={op.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `1px solid ${colors.border}`, fontSize: type.sm, color: colors.ink2 }}>
                <span>{op.nombre}</span>
                <span style={{ fontWeight: 700, color: colors.terracotta }}>+{op.precio.toFixed(2)} €</span>
              </div>
            ))}
          </div>
        ))}
        {gruposExtras.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: colors.stone, fontSize: 13 }}>Sin extras configurados. Pulsa "+ Grupo" para crear uno.</div>}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Sub-vista: GESTIÓN CATEGORÍAS
  // ─────────────────────────────────────────────────────────────────
  if (gestionCats) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <button onClick={() => setGestionCats(false)} style={ds.backBtn}>← Volver a carta</button>
        <h2 style={{ ...ds.h1, marginBottom: 16 }}>Categorías de mi carta</h2>
        <p style={{ fontSize: type.xs, color: colors.stone, marginBottom: 16 }}>
          Organiza tus productos en categorías (ej: Pizzas, Entrantes, Bebidas)
        </p>

        {categoriasRest.map(c => {
          const count = productos.filter(p => p.categoria_id === c.id).length
          return (
            <div key={c.id} style={{ ...ds.card, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: type.base, color: colors.ink }}>{c.nombre}</div>
                <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>{count} productos</div>
              </div>
              <button onClick={() => removeCatRest(c.id)} style={ds.miniBtnDanger}><Trash2 size={11}/> Eliminar</button>
            </div>
          )
        })}

        {categoriasRest.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: colors.stone, fontSize: 13 }}>Sin categorías. Añade una para organizar tu carta.</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} placeholder="Nueva categoría..." onKeyDown={e => e.key === 'Enter' && addCatRest()} style={ds.formInput} />
          <button onClick={addCatRest} style={ds.glossyBtn}>Añadir</button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Vista principal: LISTA DE CARTA
  // ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ ...ds.h1, margin: 0 }}>Mi carta</h2>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>Gestiona productos, extras y categorías</div>
        </div>
        <button onClick={abrirCrearProducto} style={ds.glossyBtn}>
          <Plus size={15} strokeWidth={2.2} /> Producto
        </button>
      </div>

      {/* Botones secundarios */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => setGestionExtras(true)} style={ds.ghostBtn}>
          Extras ({gruposExtras.length})
        </button>
        <button onClick={() => setGestionCats(true)} style={ds.ghostBtn}>
          Categorías ({categoriasRest.length})
        </button>
      </div>

      {/* Carta del local (QR de mesa) — solo si Pidoo se lo ha activado */}
      {cartaLocal && (
        <>
          <QrCartaLocal restaurante={restaurante} />
          <MesasPanel restaurante={restaurante} />
          <div style={{ ...ds.card, marginBottom: 18 }}>
            <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
              Precios del local
            </div>
            <p style={{ fontSize: type.sm, color: colors.stone, margin: '0 0 12px', lineHeight: 1.45 }}>
              <strong>{conPrecioLocal}</strong> de {productos.length} productos tienen precio propio para el
              local. El resto se muestra en el QR con el precio de domicilio.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: type.sm, color: colors.stone }}>Rellenar los vacíos un</span>
              <input
                type="number" min="1" max="99" step="1"
                value={pctRelleno}
                onChange={e => setPctRelleno(e.target.value)}
                style={{ ...ds.formInput, width: 74 }}
              />
              <span style={{ fontSize: type.sm, color: colors.stone }}>% más barato</span>
              <button onClick={rellenarPreciosLocal} disabled={rellenando} style={{ ...ds.ghostBtn, opacity: rellenando ? 0.5 : 1 }}>
                {rellenando ? 'Aplicando…' : 'Aplicar'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: colors.stone2, margin: '8px 0 0' }}>
              Solo toca los que están vacíos. Luego puedes ajustar cualquiera a mano.
            </p>
          </div>
        </>
      )}

      {/* Buscador */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.stone2 }} />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto…" style={{ ...ds.formInput, paddingLeft: 34 }} />
          {busqueda && (
            <button onClick={() => setBusqueda('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: colors.stone, padding: 4 }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Chips categorías */}
      <div style={{ display: 'flex', gap: 6, overflow: 'auto', marginBottom: 20, paddingBottom: 4 }}>
        <button onClick={() => setCatFiltro(null)} style={catChipStyle(!catFiltro)}>
          Todos ({productos.length})
        </button>
        {categoriasRest.map(c => {
          const count = productos.filter(p => p.categoria_id === c.id).length
          return (
            <button key={c.id} onClick={() => setCatFiltro(c.id)} style={catChipStyle(catFiltro === c.id)}>
              {c.nombre} ({count})
            </button>
          )
        })}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '30px 0', color: colors.stone, fontSize: type.sm }}>Cargando...</div>}

      {/* Lista productos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtrados.map(p => {
          const minPrecio = prodTamanosMap[p.id]?.length > 0
            ? Math.min(...(prodTamanosMap[p.id] || []).map(t => t.precio))
            : p.precio
          const desdeFlag = prodTamanosMap[p.id]?.length > 0
          const catName = categoriasRest.find(c => c.id === p.categoria_id)?.nombre
          return (
            <div key={p.id} style={{
              ...ds.card,
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              opacity: p.disponible ? 1 : 0.7,
              flexWrap: 'wrap',
            }}>
              {/* Thumbnail circular sage-soft / imagen */}
              <div
                onClick={() => { imgTargetRef.current = p; imgRef.current?.click() }}
                style={{
                  width: 80, height: 80, borderRadius: 16,
                  background: colors.sageSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, cursor: 'pointer', overflow: 'hidden',
                }}
              >
                {p.imagen_url
                  ? <img src={p.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <FoodChip cat={catName || ''} size={68} bg={colors.sageSoft} />
                }
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink }}>{p.nombre}</div>
                {catName && (
                  <div style={{ fontSize: type.xxs, color: colors.stone2, marginTop: 2, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {catName}
                  </div>
                )}
                {p.descripcion && (
                  <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 6, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.descripcion}
                  </div>
                )}
                {prodExtrasMap[p.id] > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={chip('paper')}>Extras: {prodExtrasMap[p.id]}</span>
                  </div>
                )}
              </div>

              {/* Precio + Toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <span style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: type.lg,
                  fontWeight: 800,
                  color: colors.terracotta,
                  letterSpacing: '-0.01em',
                }}>
                  {desdeFlag ? 'Desde ' : ''}{(minPrecio || 0).toFixed(2)} €
                </span>
                {cartaLocal && precioLocalListado(p, prodTamanosMap[p.id]) !== null && (
                  <span style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: type.xs, fontWeight: 700, color: colors.stone,
                    marginTop: -4,
                  }}>
                    local {precioLocalListado(p, prodTamanosMap[p.id]).toFixed(2)} €
                  </span>
                )}
                <button onClick={() => toggleDisponible(p.id, p.disponible)} style={{
                  width: 48, height: 28, borderRadius: 14, border: 'none',
                  background: p.disponible ? colors.sage : colors.cream2,
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                  display: 'flex', alignItems: 'center', padding: 0,
                }}>
                  <span style={{
                    position: 'absolute', top: 3, left: p.disponible ? 23 : 3,
                    width: 22, height: 22, borderRadius: 11, background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(26,24,21,0.2)',
                  }} />
                </button>
              </div>

              {/* Mini buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => abrirEditarProducto(p)} style={ds.miniBtn}>
                  <Edit2 size={11} strokeWidth={2.2}/> Editar
                </button>
                <button onClick={() => eliminarProducto(p.id)} style={ds.miniBtnDanger}>
                  <Trash2 size={11} strokeWidth={2.2}/> Eliminar
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {!loading && filtrados.length === 0 && (
        <div style={{ textAlign: 'center', padding: 50, color: colors.stone, fontSize: type.sm }}>
          Sin productos. Pulsa "+ Producto" para añadir.
        </div>
      )}

      {/* Input oculto subir imagen */}
      <input ref={imgRef} type="file" accept="image/*" hidden onChange={async e => {
        const target = imgTargetRef.current
        const file = e.target.files[0]
        imgTargetRef.current = null
        e.target.value = ''
        if (file && target) {
          try { await subirImagenProducto(file, target.id); toast('Imagen actualizada', 'success') }
          catch (err) { toast('No se pudo subir la imagen: ' + err.message) }
        }
      }} />

      {/* Modal crear/editar producto — bundle style centrado */}
      {showAddProd && (
        <div style={ds.modal} onClick={() => setShowAddProd(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            ...ds.modalContent,
            maxWidth: 640, padding: 0, overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '18px 22px', borderBottom: `1px solid ${colors.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ ...ds.h2, margin: 0 }}>{editProd ? 'Editar producto' : 'Nuevo producto'}</div>
              <button onClick={() => setShowAddProd(false)} style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: colors.cream2, cursor: 'pointer', color: colors.stone,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={16} />
              </button>
            </div>

            {/* Body scroll */}
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>
              <div>
                <label style={ds.label}>Categoría</label>
                <select value={prodForm.categoria_id} onChange={e => setProdForm({ ...prodForm, categoria_id: e.target.value })} style={ds.select}>
                  <option value="">Sin categoría</option>
                  {categoriasRest.map(c => <option key={c.id} value={c.id}>{c.emoji || ''} {c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={ds.label}>Nombre</label>
                <input value={prodForm.nombre} onChange={e => setProdForm({ ...prodForm, nombre: e.target.value })} placeholder="Ej: Pizza Margarita" style={ds.formInput} />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={ds.label}>{cartaLocal ? 'Precio a domicilio (€)' : 'Precio (€)'}</label>
                  <input type="number" step="0.01" value={prodForm.precio} onChange={e => setProdForm({ ...prodForm, precio: e.target.value })} placeholder="9.50" style={ds.formInput} />
                </div>
                {cartaLocal && (
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <label style={ds.label}>Precio en el local (€)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={prodForm.precio_local}
                      onChange={e => setProdForm({ ...prodForm, precio_local: e.target.value })}
                      placeholder="El mismo"
                      style={ds.formInput}
                    />
                  </div>
                )}
              </div>
              {cartaLocal && (
                <p style={{ fontSize: 11, color: colors.stone, margin: '-6px 0 0' }}>
                  El precio del local solo se ve en el QR de las mesas. Déjalo vacío si cobras lo mismo.
                </p>
              )}
              <div>
                <label style={ds.label}>Descripción</label>
                <textarea value={prodForm.descripcion} onChange={e => setProdForm({ ...prodForm, descripcion: e.target.value })} placeholder="Descripción opcional…" rows={3} style={{ ...ds.formInput, height: 'auto', padding: '12px 14px', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={ds.label}>Imagen</label>
                <label style={{
                  width: 200, height: 200, borderRadius: 12,
                  border: `2px dashed ${colors.borderStrong}`,
                  background: colors.cream2,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 8, color: colors.stone2, cursor: 'pointer', overflow: 'hidden',
                }}>
                  {prodForm.imagen_url
                    ? <img src={prodForm.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (<>
                      <Upload size={28} strokeWidth={1.7} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Subir imagen</span>
                    </>)
                  }
                  <input type="file" accept="image/*" hidden onChange={e => handleImagenForm(e.target.files[0])} />
                </label>
              </div>

              {/* Grupos extras */}
              {gruposExtras.length > 0 && (
                <div>
                  <label style={ds.label}>Grupos de extras</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {gruposExtras.map(g => {
                      const activo = extrasAsignados.includes(g.id)
                      return (
                        <button key={g.id} onClick={() => toggleExtraAsignado(g.id)} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', background: colors.cream2, borderRadius: 8,
                          border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        }}>
                          <span style={{
                            width: 18, height: 18, borderRadius: 5,
                            border: `2px solid ${activo ? colors.terracotta : colors.borderStrong}`,
                            background: activo ? colors.terracotta : '#fff',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', flexShrink: 0,
                          }}>{activo && <Check size={10} strokeWidth={3} />}</span>
                          <span style={{ fontSize: 13, color: colors.ink, fontWeight: 500 }}>
                            {g.nombre} ({(g.extras_opciones || []).length} opciones)
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Tamaños */}
              <div>
                <label style={ds.label}>Tamaños</label>
                <p style={{ fontSize: 11, color: colors.stone, margin: '0 0 10px' }}>
                  Si añades tamaños, el cliente <strong>debe elegir uno</strong>.
                </p>
                {cartaLocal && tamanos.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 10.5, color: colors.stone2, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                    <span style={{ flex: 2 }}>Nombre</span>
                    <span style={{ flex: 1 }}>Domicilio</span>
                    <span style={{ flex: 1 }}>Local</span>
                    <span style={{ width: 34 }} />
                  </div>
                )}
                {tamanos.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input value={t.nombre} onChange={e => { const n = [...tamanos]; n[i] = { ...n[i], nombre: e.target.value }; setTamanos(n) }} placeholder="Ej: Mediano" style={{ ...ds.formInput, flex: 2 }} />
                    <input type="number" step="0.01" min="0" value={t.precio} onChange={e => { const n = [...tamanos]; n[i] = { ...n[i], precio: e.target.value }; setTamanos(n) }} placeholder="€" style={{ ...ds.formInput, flex: 1 }} />
                    {cartaLocal && (
                      <input type="number" step="0.01" min="0" value={t.precio_local ?? ''} onChange={e => { const n = [...tamanos]; n[i] = { ...n[i], precio_local: e.target.value }; setTamanos(n) }} placeholder="El mismo" style={{ ...ds.formInput, flex: 1 }} />
                    )}
                    <button onClick={() => setTamanos(prev => prev.filter((_, idx) => idx !== i))} style={ds.miniBtnDanger}><X size={12}/></button>
                  </div>
                ))}
                <button onClick={() => setTamanos(prev => [...prev, { nombre: '', precio: '', precio_local: '' }])} style={{
                  width: '100%', padding: '10px 0', borderRadius: 10,
                  border: `1px dashed ${colors.borderStrong}`,
                  background: 'transparent', color: colors.stone,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>+ Añadir tamaño</button>
              </div>

              {errorCarta && (
                <div style={{ color: colors.danger, fontSize: 12, textAlign: 'center', background: colors.dangerSoft, padding: '8px 12px', borderRadius: 8 }}>{errorCarta}</div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 22px', borderTop: `1px solid ${colors.border}`,
              background: colors.cream,
              display: 'flex', justifyContent: 'flex-end', gap: 10,
            }}>
              <button onClick={() => setShowAddProd(false)} style={ds.ghostBtn}>Cancelar</button>
              <button onClick={guardarProducto} disabled={saving || !prodForm.nombre.trim() || !prodForm.precio} style={{ ...ds.glossyBtn, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Guardando...' : editProd ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function catChipStyle(active) {
  return {
    padding: '7px 14px', borderRadius: 999,
    border: active ? 'none' : `1px solid ${colors.borderStrong}`,
    background: active ? colors.terracotta : colors.paper,
    color: active ? '#fff' : colors.stone,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
  }
}
