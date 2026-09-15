// Contabilidad: la casa del DINERO, separada del Almacén (la casa de las COSAS).
//
// 3 sep: «quiero un panorama completo del negocio, que no se escape absolutamente nada».
// 15 sep: «lo veo muy enredado… tiene que ser intuitivo, como para un bebé». Por eso:
//   - Se abre en EL DÍA (vendiste · pagaste · ganaste · cuánto hay en el cajón).
//   - Un solo botón para todo lo que sale: «Apuntar un pago». Una compra entra sola en el
//     almacén y, si se pagó con el cajón, sale sola de la caja del TPV.
//   - «Cómo va» es la semana o el mes; Compras, Gastos, Platos y el informe de la gestoría
//     quedan detrás, para cuando hagan falta.
//
// SIN datos duplicados: las facturas son LAS MISMAS de siempre (misma tabla, misma RPC de
// contabilizar que alimenta el inventario) y las salidas del cajón, las de la caja del TPV.
//
// Pantalla de ESCRITORIO como el Almacén (`App.jsx` la monta con `!isNative`).
// Pestañas con `useState`, no router: el patrón de la casa.
import { useState, useEffect } from 'react'
import { Wallet, TriangleAlert, Plus } from 'lucide-react'
import { useRest } from '../context/RestContext'
import { colors, ds, type } from '../lib/uiStyles'
import { cargarArticulos, hoyCanariasIso } from '../lib/stock'
import DiaTab from '../components/contabilidad/DiaTab'
import ResumenTab from '../components/contabilidad/ResumenTab'
import PlatosTab from '../components/contabilidad/PlatosTab'
import GastosTab from '../components/contabilidad/GastosTab'
import InformeTab from '../components/contabilidad/InformeTab'
import ApuntarPago from '../components/contabilidad/ApuntarPago'
import ComprasTab from '../components/almacen/ComprasTab'

const PESTANAS = [
  { id: 'dia', label: 'El día' },
  { id: 'resumen', label: 'Cómo va' },
  { id: 'facturas', label: 'Compras' },
  { id: 'gastos', label: 'Gastos' },
  { id: 'platos', label: 'Platos' },
  { id: 'informe', label: 'Para la gestoría' },
]

export default function Contabilidad() {
  const { restaurante, stockConfig } = useRest()
  return <ContabilidadVista restaurante={restaurante} stockConfig={stockConfig} />
}

// La pantalla sin el contexto de sesión: así se puede montar con datos de prueba.
export function ContabilidadVista({ restaurante, stockConfig }) {
  const estId = restaurante?.id

  const [pestana, setPestana] = useState('dia')
  const [fechaDia, setFechaDia] = useState(hoyCanariasIso)
  // Lo que abre la ventana «Apuntar un pago» (null = cerrada).
  const [pago, setPago] = useState(null)
  // Compras necesita los artículos (las líneas se escriben contra ellos).
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

  const apuntar = (inicial = {}) => setPago({ ...(pestana === 'dia' ? { fecha: fechaDia } : {}), ...inicial })
  const irADia = (f) => { setFechaDia(f); setPestana('dia') }

  if (!stockConfig) {
    return (
      <Aviso icono={<Wallet size={26} color={colors.textMute} />}
        titulo="No tienes la contabilidad activada"
        texto="Va con el módulo de almacén, que lo activa Pidoo para tu restaurante. Sirve para ver cuánto vendes, cuánto pagas y qué te queda, con las compras y todos tus gastos en un solo sitio." />
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Wallet size={20} color={colors.primary} />
            <h1 style={ds.h1}>Contabilidad</h1>
          </div>
          <div style={{ fontSize: type.sm, color: colors.textMute, lineHeight: 1.5 }}>
            Lo que vendes, lo que pagas y lo que te queda. Cada vez que pagues algo —el pan, la luz,
            una reparación— apúntalo con el botón: entra en el almacén y sale del cajón solo.
          </div>
        </div>
        <button onClick={() => apuntar()} style={{ ...ds.primaryBtn, height: 44, fontSize: type.base, padding: '0 20px' }}>
          <Plus size={18} /> Apuntar un pago
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {PESTANAS.map(p => (
          <button key={p.id} onClick={() => setPestana(p.id)} style={{
            ...ds.filterBtn, height: 36, padding: '0 14px', fontSize: type.sm,
            background: pestana === p.id ? colors.primary : colors.paper,
            color: pestana === p.id ? colors.cream : colors.textDim,
            borderColor: pestana === p.id ? colors.primary : colors.border,
            fontWeight: pestana === p.id ? 700 : 600,
          }}>
            {p.label}
          </button>
        ))}
      </div>

      {pestana === 'dia' && (
        <DiaTab estId={estId} fecha={fechaDia} onFecha={setFechaDia} recarga={refresco}
          onApuntar={apuntar} onIrA={setPestana} />
      )}
      {pestana === 'resumen' && (
        <ResumenTab estId={estId} onIrA={setPestana} onIrADia={irADia} recarga={refresco} />
      )}
      {pestana === 'platos' && (
        <PlatosTab estId={estId} />
      )}
      {pestana === 'facturas' && (
        <ComprasTab estId={estId} articulos={articulos} onCambio={recargar} recarga={refresco}
          onApuntar={apuntar} />
      )}
      {pestana === 'gastos' && (
        <GastosTab estId={estId} recarga={refresco} onApuntar={apuntar} />
      )}
      {pestana === 'informe' && (
        <InformeTab estId={estId} nombreRestaurante={restaurante?.nombre} />
      )}

      {pago && (
        <ApuntarPago
          estId={estId}
          inicial={pago}
          onCerrar={() => setPago(null)}
          onHecho={() => { setPago(null); recargar() }}
        />
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
