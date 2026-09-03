// Contabilidad: la casa del DINERO, separada del Almacén (la casa de las COSAS).
//
// Lo pidió Marlon el 3 sep con estas palabras: "quiero un panorama completo del
// negocio, que no se escape absolutamente nada". Aquí viven el resumen del mes
// (entró − salió = te quedó), las facturas de compra y los gastos. El Almacén se
// queda con lo físico: existencias, recetas, preparaciones, merma y recuento.
//
// SIN datos duplicados: las facturas son LAS MISMAS de siempre (misma tabla, misma
// RPC de contabilizar que alimenta el inventario) — solo cambia desde dónde se ven.
//
// Pantalla de ESCRITORIO como el Almacén (`App.jsx` la monta con `!isNative`).
// Pestañas con `useState`, no router: el patrón de la casa.
import { useState, useEffect } from 'react'
import { Wallet, TriangleAlert } from 'lucide-react'
import { useRest } from '../context/RestContext'
import { colors, ds, type } from '../lib/uiStyles'
import { cargarArticulos } from '../lib/stock'
import ResumenTab from '../components/contabilidad/ResumenTab'
import GastosTab from '../components/contabilidad/GastosTab'
import ComprasTab from '../components/almacen/ComprasTab'

const PESTANAS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'facturas', label: 'Facturas de compra' },
  { id: 'gastos', label: 'Gastos' },
]

export default function Contabilidad() {
  const { restaurante, stockConfig } = useRest()
  const estId = restaurante?.id

  const [pestana, setPestana] = useState('resumen')
  // La pantalla de Facturas necesita los artículos (las líneas se escriben contra
  // ellos, y el alta de artículo vive dentro de la propia factura).
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [refresco, setRefresco] = useState(0)
  const recargar = () => setRefresco(n => n + 1)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      try {
        const arts = await cargarArticulos(estId)
        if (!vivo) return
        setArticulos(arts)
        setError(null)
      } catch (e) {
        if (vivo) setError(e.message)
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, refresco])

  if (!stockConfig) {
    return (
      <Aviso icono={<Wallet size={26} color={colors.textMute} />}
        titulo="No tienes la contabilidad activada"
        texto="Va con el módulo de almacén, que lo activa Pidoo para tu restaurante. Sirve para ver cuánto entra, cuánto sale y qué te queda, con las facturas de compra y todos tus gastos en un solo sitio." />
    )
  }

  if (cargando) {
    return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Cargando la contabilidad…</div>
  }

  if (error) {
    return (
      <Aviso icono={<TriangleAlert size={26} color={colors.danger} />}
        titulo="No se ha podido cargar la contabilidad" texto={error} />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Wallet size={20} color={colors.primary} />
        <h1 style={ds.h1}>Contabilidad</h1>
      </div>
      <div style={{ ...ds.muted, marginBottom: 16 }}>
        Cuánto entra, cuánto sale y qué te queda. En <strong>Facturas de compra</strong> va
        todo lo que le compras al proveedor (comida, bebida, envases, aseo); en{' '}
        <strong>Gastos</strong>, lo demás: alquiler, luz, sueldos…
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {PESTANAS.map(p => (
          <button key={p.id} onClick={() => setPestana(p.id)} style={{
            ...ds.filterBtn, height: 34,
            background: pestana === p.id ? colors.primary : colors.paper,
            color: pestana === p.id ? colors.cream : colors.textDim,
            borderColor: pestana === p.id ? colors.primary : colors.border,
            fontWeight: pestana === p.id ? 700 : 600,
          }}>
            {p.label}
          </button>
        ))}
      </div>

      {pestana === 'resumen' && (
        <ResumenTab estId={estId} onIrA={setPestana} />
      )}
      {pestana === 'facturas' && (
        <ComprasTab estId={estId} articulos={articulos} onCambio={recargar} />
      )}
      {pestana === 'gastos' && (
        <GastosTab estId={estId} />
      )}
    </div>
  )
}

function Aviso({ icono, titulo, texto }) {
  return (
    <div style={{ ...ds.card, padding: 40, textAlign: 'center', maxWidth: 520, margin: '20px auto' }}>
      <div style={{ marginBottom: 12 }}>{icono}</div>
      <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.text, marginBottom: 8 }}>{titulo}</div>
      <div style={{ fontSize: type.sm, color: colors.textMute, lineHeight: 1.6 }}>{texto}</div>
    </div>
  )
}
