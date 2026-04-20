import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

const TIPOS = [
  { id: 'restaurante', l: '🍽️ Restaurante' }, { id: 'cafeteria', l: '☕ Cafetería' },
  { id: 'pizzeria', l: '🍕 Pizzería' }, { id: 'hamburgueseria', l: '🍔 Hamburguesería' },
  { id: 'sushi', l: '🍣 Sushi' }, { id: 'panaderia', l: '🥐 Panadería' },
  { id: 'minimarket', l: '🛒 Minimarket' }, { id: 'farmacia', l: '💊 Farmacia' },
  { id: 'otro', l: '🏪 Otro' },
]

export default function CompletarRegistro() {
  const { user, logout, refetch } = useRest()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    nombre: '', tipo: 'restaurante', categoria_padre: 'comida',
    telefono: '', direccion: '',
  })

  const inp = { width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--c-border)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box' }
  const sel = { ...inp, appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 36 }
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', marginBottom: 4, display: 'block' }

  const handleSubmit = async () => {
    if (!form.nombre.trim()) { setError('El nombre del negocio es obligatorio'); return }
    if (!form.direccion.trim()) { setError('La dirección es obligatoria'); return }
    setError(null); setLoading(true)

    try {
      // Geocodificar la dirección para obtener lat/lng
      let latitud = 28.4139, longitud = -16.5474 // Default: Puerto de la Cruz
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
        if (apiKey) {
          const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(form.direccion.trim())}&key=${apiKey}`)
          const geoData = await geoRes.json()
          if (geoData.results?.length > 0) {
            latitud = geoData.results[0].geometry.location.lat
            longitud = geoData.results[0].geometry.location.lng
          }
        }
      } catch (e) { console.warn('Geocoding failed, using default:', e) }

      // Asegurar que existe entrada en usuarios con rol restaurante
      const { data: perfil } = await supabase.from('usuarios').select('id').eq('id', user.id).single()
      if (!perfil) {
        await supabase.from('usuarios').insert({ id: user.id, rol: 'restaurante' })
      } else {
        await supabase.from('usuarios').update({ rol: 'restaurante' }).eq('id', user.id)
      }

      // Crear establecimiento
      const { error: estError } = await supabase.from('establecimientos').insert({
        user_id: user.id,
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        categoria_padre: form.categoria_padre,
        email: user.email,
        telefono: form.telefono.trim() || null,
        direccion: form.direccion.trim(),
        activo: true,
        rating: 0,
        total_resenas: 0,
        latitud,
        longitud,
        radio_cobertura_km: 10,
      })
      if (estError) throw new Error('Error al crear el establecimiento: ' + estError.message)

      // Recargar datos del restaurante
      await refetch()
    } catch (err) {
      setError(err.message || 'Error al completar el registro')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🍽️</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)', marginBottom: 4 }}>Completa tu registro</div>
      <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 6, textAlign: 'center' }}>
        Conectado como <strong style={{ color: 'var(--c-text)' }}>{user.email}</strong>
      </p>
      <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 24, textAlign: 'center' }}>
        Configura los datos de tu negocio para empezar a recibir pedidos.
      </p>

      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Nombre del negocio *</label>
          <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: La Pizzeria del Puerto" style={inp} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={sel}>
              {TIPOS.map(t => <option key={t.id} value={t.id}>{t.l}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Categoría</label>
            <select value={form.categoria_padre} onChange={e => setForm({ ...form, categoria_padre: e.target.value })} style={sel}>
              <option value="comida">🍕 Comida</option>
              <option value="farmacia">💊 Farmacia</option>
              <option value="marketplace">🛒 Marketplace</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Teléfono</label>
          <input type="tel" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="+34 600 000 000" style={inp} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Dirección</label>
          <input value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} placeholder="Dirección del negocio" style={inp} />
        </div>

        {error && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 10, textAlign: 'center', background: 'rgba(220,38,38,0.1)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading} style={{ width: '100%', padding: '16px 0', borderRadius: 14, border: 'none', background: loading ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Creando...' : 'Crear mi negocio'}
        </button>

        <button onClick={logout} style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 12 }}>
          Usar otra cuenta
        </button>
      </div>
    </div>
  )
}
