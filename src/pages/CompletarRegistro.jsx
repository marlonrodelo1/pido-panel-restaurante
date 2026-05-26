import { useState } from 'react'
import { Utensils } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'

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

  const handleSubmit = async () => {
    if (!form.nombre.trim()) { setError('El nombre del negocio es obligatorio'); return }
    if (!form.direccion.trim()) { setError('La dirección es obligatoria'); return }
    setError(null); setLoading(true)

    try {
      let latitud = 28.4139, longitud = -16.5474
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

      const { data: perfil } = await supabase.from('usuarios').select('id').eq('id', user.id).single()
      if (!perfil) {
        await supabase.from('usuarios').insert({ id: user.id, rol: 'restaurante' })
      } else {
        await supabase.from('usuarios').update({ rol: 'restaurante' }).eq('id', user.id)
      }

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

      await refetch()
    } catch (err) {
      setError(err.message || 'Error al completar el registro')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: colors.cream,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Icono ink */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: `linear-gradient(135deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
            color: colors.cream,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: colors.shadowMd,
          }}>
            <Utensils size={28} strokeWidth={2} />
          </div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={{ ...ds.h1, margin: 0 }}>Completa tu registro</h1>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 8 }}>
            Conectado como <strong style={{ color: colors.ink }}>{user.email}</strong>
          </div>
          <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
            Configura los datos de tu negocio para empezar a recibir pedidos.
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: colors.paper,
          borderRadius: 16, padding: 26,
          border: `1px solid ${colors.border}`,
          boxShadow: colors.shadow,
        }}>
          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Nombre del negocio</label>
            <input
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              placeholder="Ej: La Pizzería del Puerto"
              style={ds.formInput}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <label style={ds.label}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={ds.select}>
                {TIPOS.map(t => <option key={t.id} value={t.id}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label style={ds.label}>Categoría</label>
              <select value={form.categoria_padre} onChange={e => setForm({ ...form, categoria_padre: e.target.value })} style={ds.select}>
                <option value="comida">🍕 Comida</option>
                <option value="farmacia">💊 Farmacia</option>
                <option value="marketplace">🛒 Marketplace</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Teléfono</label>
            <input
              type="tel"
              value={form.telefono}
              onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="+34 600 000 000"
              style={ds.formInput}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={ds.label}>Dirección</label>
            <input
              value={form.direccion}
              onChange={e => setForm({ ...form, direccion: e.target.value })}
              placeholder="Dirección del negocio"
              style={ds.formInput}
            />
          </div>

          {error && (
            <div style={{
              color: colors.danger, fontSize: 12, marginBottom: 12, textAlign: 'center',
              background: colors.dangerSoft, padding: '10px 12px', borderRadius: 8,
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ ...ds.glossyBtn, width: '100%', height: 46, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Creando...' : 'Crear mi negocio'}
          </button>

          <button onClick={logout} style={{
            width: '100%', padding: '10px 0',
            background: 'none', border: 'none',
            color: colors.stone, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            marginTop: 12,
          }}>
            Usar otra cuenta
          </button>
        </div>
      </div>
    </div>
  )
}
