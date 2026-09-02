// Almacén: existencias, escandallos y compras.
//
// Es una pantalla de ESCRITORIO a propósito (`App.jsx` la monta con `!isNative`):
// dar de alta artículos y escribir recetas con el dedo en la tablet del mostrador es
// inviable, y meterla en la APK obligaría a compilar un AAB por cada retoque. En la
// tablet solo va lo del servicio —ver qué queda, apuntar una merma y hacer recuento—
// y eso vive dentro del TPV.
//
// Pestañas con `useState`, no router: el panel no tiene router y no se va a meter
// uno por esta pantalla. Mismo patrón que `Tpv.jsx`.
import { useState, useEffect } from 'react'
import { Boxes, TriangleAlert, PauseCircle } from 'lucide-react'
import { useRest } from '../context/RestContext'
import { colors, ds, radius, type } from '../lib/uiStyles'
import { cargarArticulos, cargarResumen } from '../lib/stock'
import ArranqueAsistido from '../components/almacen/ArranqueAsistido'
import ResumenTab from '../components/almacen/ResumenTab'
import NegocioTab from '../components/almacen/NegocioTab'
import ArticulosTab from '../components/almacen/ArticulosTab'
import EscandallosTab from '../components/almacen/EscandallosTab'
import ComprasTab from '../components/almacen/ComprasTab'
import MovimientosTab from '../components/almacen/MovimientosTab'

const PESTANAS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'negocio', label: 'Negocio' },
  { id: 'articulos', label: 'Artículos de compra' },
  { id: 'escandallos', label: 'Escandallos' },
  { id: 'compras', label: 'Compras' },
  { id: 'movimientos', label: 'Movimientos' },
]

export default function Almacen() {
  const { restaurante, stockConfig, setStockConfig } = useRest()
  const estId = restaurante?.id

  const [pestana, setPestana] = useState('resumen')
  const [articulos, setArticulos] = useState([])
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  // Un contador en vez de llamar a la carga desde el efecto: el patron de la casa
  // (Tpv.jsx, Carta.jsx) es un IIFE asincrono con bandera `vivo`, para no dejar un
  // setState colgando si el usuario cambia de seccion a mitad de la consulta.
  const [refresco, setRefresco] = useState(0)
  const recargar = () => setRefresco(n => n + 1)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      try {
        const [arts, res] = await Promise.all([cargarArticulos(estId), cargarResumen(estId)])
        if (!vivo) return
        setArticulos(arts)
        setResumen(res)
        setError(null)
      } catch (e) {
        if (vivo) setError(e.message)
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, refresco])

  // Sin fila de configuración, el módulo no está contratado.
  if (!stockConfig) {
    return (
      <Aviso icono={<Boxes size={26} color={colors.textMute} />}
        titulo="No tienes el almacén activado"
        texto="Lo activa Pidoo para tu restaurante. Sirve para llevar las existencias de lo que le compras al proveedor, saber lo que te cuesta cada plato de tu carta y meter las facturas." />
    )
  }

  if (cargando) {
    return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Cargando el almacén…</div>
  }

  if (error) {
    return (
      <Aviso icono={<TriangleAlert size={26} color={colors.danger} />}
        titulo="No se ha podido cargar el almacén" texto={error} />
    )
  }

  // Mientras no haya recuento inicial, los números no significan nada: se enseña el
  // asistente a pantalla completa en lugar de un inventario vacío que parece roto.
  if (!stockConfig.arranque_at) {
    return (
      <ArranqueAsistido
        estId={estId}
        onListo={(cfg) => { if (cfg) setStockConfig(cfg); recargar() }}
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Boxes size={20} color={colors.primary} />
        <h1 style={ds.h1}>Almacén</h1>
      </div>
      <div style={{ ...ds.muted, marginBottom: 16 }}>
        Lo que tienes, lo que te cuesta y lo que entra por tus proveedores.
        En <strong>Artículos de compra</strong> van la carne, el pan, el aceite. En{' '}
        <strong>Escandallos</strong>, la receta de cada plato de tu carta.
      </div>

      {stockConfig.pausado_por_restaurante && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
          padding: '10px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
        }}>
          <PauseCircle size={16} color={colors.warning} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5 }}>
            <strong>Almacén en pausa.</strong> Las ventas no descuentan existencias
            mientras esté así. Se reactiva desde Ajustes.
          </div>
        </div>
      )}

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
        <ResumenTab resumen={resumen} articulos={articulos} onIrA={setPestana} />
      )}
      {pestana === 'negocio' && (
        <NegocioTab estId={estId} onIrA={setPestana} />
      )}
      {pestana === 'articulos' && (
        <ArticulosTab estId={estId} articulos={articulos} onCambio={recargar} />
      )}
      {pestana === 'escandallos' && (
        <EscandallosTab estId={estId} articulos={articulos} onCambio={recargar} />
      )}
      {pestana === 'compras' && (
        <ComprasTab estId={estId} articulos={articulos} onCambio={recargar} />
      )}
      {pestana === 'movimientos' && (
        <MovimientosTab estId={estId} articulos={articulos} />
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
