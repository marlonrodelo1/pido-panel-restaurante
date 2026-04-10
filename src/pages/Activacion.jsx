import { useState } from 'react'
import { useRest } from '../context/RestContext'
import { toast } from '../App'

export default function Activacion() {
  const { restaurante, updateRestaurante } = useRest()
  const [descripcion, setDescripcion] = useState(restaurante?.descripcion || '')
  const [telefono, setTelefono] = useState(restaurante?.telefono || '')
  const [activando, setActivando] = useState(false)

  async function activar() {
    setActivando(true)
    const { error } = await updateRestaurante({
      descripcion: descripcion.trim() || null,
      telefono: telefono.trim() || null,
      activado: true,
    })
    if (error) {
      toast('Error al activar el negocio. Intenta de nuevo.', 'error')
      setActivando(false)
    }
    // Si no hay error, RestContext actualiza restaurante.activado=true
    // App.jsx dejará de renderizar este componente automáticamente
  }

  const inp = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.12)', fontSize: 13,
    fontFamily: 'inherit', background: 'rgba(255,255,255,0.06)',
    color: '#F5F5F5', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0D', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.4s ease' }}>

        {/* Logo PIDOGO */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🎉</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#F5F5F5', margin: '0 0 8px' }}>
            ¡Bienvenido a PIDOGO!
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: '#F5F5F5' }}>{restaurante?.nombre}</strong> ya está en la plataforma.
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8, lineHeight: 1.5 }}>
            Tu socio ha configurado lo básico. Revisa y completa tu perfil para empezar a recibir pedidos.
          </p>
        </div>

        {/* Preview: logo y banner del restaurante (configurados por el socio) */}
        {(restaurante?.logo_url || restaurante?.banner_url || restaurante?.nombre) && (
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, overflow: 'hidden', marginBottom: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
            {restaurante?.banner_url ? (
              <img src={restaurante.banner_url} alt="Banner" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', height: 80, background: 'linear-gradient(135deg, rgba(185,28,28,0.3), rgba(185,28,28,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Sin banner — puedes añadirlo en Ajustes</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                {restaurante?.logo_url
                  ? <img src={restaurante.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : '🍽️'
                }
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: '#F5F5F5' }}>{restaurante?.nombre}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  {restaurante?.tipo} · {restaurante?.direccion || 'Sin dirección configurada'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Formulario: campos que el restaurante puede completar */}
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 20, marginBottom: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#F5F5F5', margin: '0 0 4px' }}>Completa tu perfil</h3>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '0 0 16px' }}>Puedes editar todo esto más tarde en Ajustes.</p>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 6, display: 'block' }}>
              Teléfono de contacto
            </label>
            <input
              style={inp}
              value={telefono}
              onChange={e => setTelefono(e.target.value)}
              placeholder="+34 600 000 000"
              type="tel"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 6, display: 'block' }}>
              Descripción del negocio
            </label>
            <textarea
              style={{ ...inp, minHeight: 90, resize: 'vertical', lineHeight: 1.6 }}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Cuéntale a tus clientes quién eres y qué ofreces..."
            />
          </div>
        </div>

        {/* Info comisión estándar */}
        <div style={{
          background: 'rgba(185,28,28,0.08)', borderRadius: 12,
          padding: '12px 16px', marginBottom: 24,
          border: '1px solid rgba(185,28,28,0.2)',
          fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6,
        }}>
          ℹ️ Tu negocio se activará como <strong style={{ color: '#F5F5F5' }}>público</strong> — otros socios podrán solicitar repartir tus pedidos. Comisión: <strong style={{ color: '#F5F5F5' }}>18% reparto / 13% recogida</strong>. Puedes cambiarlo en Ajustes.
        </div>

        {/* Botón principal */}
        <button
          onClick={activar}
          disabled={activando}
          style={{
            width: '100%', padding: '16px 0', borderRadius: 14, border: 'none',
            background: activando ? 'rgba(185,28,28,0.4)' : '#B91C1C',
            color: '#fff', fontSize: 16, fontWeight: 800,
            cursor: activando ? 'default' : 'pointer',
            fontFamily: 'inherit', transition: 'background 0.2s',
            boxShadow: activando ? 'none' : '0 4px 24px rgba(185,28,28,0.35)',
          }}
        >
          {activando ? 'Activando...' : '🚀 Activar mi negocio'}
        </button>
      </div>
    </div>
  )
}
