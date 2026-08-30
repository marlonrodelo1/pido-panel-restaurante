import { useState, useEffect } from 'react'
import { Search, CircleCheck, Circle, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../App'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { eur, arranqueDesdeCarta } from '../../lib/stock'
import EscandalloEditor from './EscandalloEditor'

// La lista de escandallos, con semáforo.
//
// Se enseñan TODOS los productos, no solo los que ya tienen receta: la gracia es ver
// de un vistazo cuántos te faltan. Un plato sin receta no descuenta nada — no es un
// error, es que todavía no lo has hecho, y así se dice.
export default function EscandallosTab({ estId, articulos, onCambio }) {
  const [prods, setProds] = useState([])
  const [conReceta, setConReceta] = useState({})   // producto_id -> nº de líneas
  const [costes, setCostes] = useState({})         // producto_id -> coste receta base
  const [busca, setBusca] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)
  const [creando, setCreando] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      const [p, e] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, precio, precio_local, categoria_id, categorias(nombre)')
          .eq('establecimiento_id', estId).order('nombre'),
        supabase.from('escandallo_lineas')
          .select('producto_id, articulo_id, cantidad, tamano_clave')
          .eq('establecimiento_id', estId),
      ])
      if (!vivo) return
      setProds(p.data || [])

      const cuenta = {}
      const coste = {}
      const porId = Object.fromEntries(articulos.map(a => [a.id, a]))
      for (const l of (e.data || [])) {
        if (l.tamano_clave !== '') continue
        cuenta[l.producto_id] = (cuenta[l.producto_id] || 0) + 1
        coste[l.producto_id] = (coste[l.producto_id] || 0)
          + Number(l.cantidad) * Number(porId[l.articulo_id]?.coste_medio || 0)
      }
      setConReceta(cuenta)
      setCostes(coste)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [estId, articulos, refresco])

  const visibles = prods.filter(p => {
    if (soloSin && conReceta[p.id]) return false
    if (busca.trim() && !p.nombre.toLowerCase().includes(busca.trim().toLowerCase())) return false
    return true
  })

  const nSin = prods.length - Object.keys(conReceta).length

  // Un producto que entra y sale igual (una lata, un agua) tambien necesita receta,
  // solo que de una linea: "1 de este producto = 1 de este articulo". El asistente de
  // arranque la escribe sola, pero el asistente sale UNA VEZ; sin este boton, dar de
  // alta una bebida nueva costaba 4 pasos en 2 pestañas. La RPC es la misma.
  async function venderTalCual(prod) {
    setCreando(prod.id)
    try {
      await arranqueDesdeCarta(estId, [prod.id])
      toast(`«${prod.nombre}» ya descuenta del almacén`, 'success')
      onCambio?.()
      setRefresco(n => n + 1)
    } catch (e) {
      toast(e.message, 'error')
    }
    setCreando(null)
  }

  if (cargando) return <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando la carta…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={15} color={colors.textMute}
            style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar plato…" style={{ ...ds.input, paddingLeft: 34 }} />
        </div>
        <button onClick={() => setSoloSin(v => !v)} style={{
          ...ds.filterBtn, height: 36,
          background: soloSin ? colors.primary : colors.paper,
          color: soloSin ? colors.cream : colors.textDim,
          borderColor: soloSin ? colors.primary : colors.border,
        }}>
          Solo los que faltan ({nSin})
        </button>
      </div>

      {!articulos.length && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
          fontSize: type.sm, lineHeight: 1.6, color: colors.text,
        }}>
          Todavía no tienes artículos en el almacén. Una receta se escribe con artículos,
          así que créalos primero en la pestaña <strong>Artículos</strong>.
        </div>
      )}

      <div style={{ ...ds.table, ...tablaScroll }}>
        <div style={{ ...ds.tableHeader, ...filaMin(890) }}>
          <div style={col(22, 'left')}></div>
          <div style={{ flex: 1, minWidth: 0 }}>Plato</div>
          <div style={col(92)}>Te cuesta</div>
          <div style={col(92)}>Lo vendes a</div>
          <div style={col(128)}>Te queda</div>
          <div style={col(200, 'right')}></div>
        </div>

        {visibles.map(p => {
          const tiene = !!conReceta[p.id]
          const coste = costes[p.id]
          const precio = Number(p.precio_local ?? p.precio ?? 0)
          const margen = tiene ? precio - coste : null
          const pct = tiene && precio > 0 ? Math.round(1000 * margen / precio) / 10 : null
          return (
            <div key={p.id} style={{ ...ds.tableRow, ...filaMin(890), background: colors.paper }}>
              <div style={{ ...col(22, 'left'), display: 'flex' }}>
                {tiene
                  ? <CircleCheck size={16} color={colors.sage2} />
                  : <Circle size={16} color={colors.borderStrong} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button onClick={() => setAbierto(p)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: type.sm, fontWeight: 600,
                  color: colors.text, textAlign: 'left', display: 'block',
                  maxWidth: '100%', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{p.nombre}</button>
                <div style={{ ...ds.muted, marginTop: 1 }}>
                  {p.categorias?.nombre || 'Sin categoría'}
                  {tiene ? ` · ${conReceta[p.id]} ingrediente${conReceta[p.id] === 1 ? '' : 's'}` : ' · sin receta'}
                </div>
              </div>
              <div style={{ ...col(92), color: colors.textMute }}>
                {tiene ? eur(coste) : '—'}
              </div>
              <div style={col(92)}>
                {eur(precio)}
              </div>
              <div style={{
                ...col(128), fontWeight: 700,
                color: margen === null ? colors.textMute : margen < 0 ? colors.danger : colors.sage2,
              }}>
                {margen === null ? '—' : `${eur(margen)}${pct !== null ? ` · ${pct} %` : ''}`}
              </div>
              <div style={{ ...col(200), display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {tiene ? (
                  <button onClick={() => setAbierto(p)} style={{ ...ds.miniBtn, flexShrink: 0 }}>
                    Ver receta
                  </button>
                ) : (
                  <button onClick={() => venderTalCual(p)} disabled={creando === p.id}
                    title="Crea el artículo y su receta de una unidad, de un clic"
                    style={{ ...ds.miniBtn, flexShrink: 0, opacity: creando === p.id ? 0.5 : 1 }}>
                    <Wand2 size={12} /> {creando === p.id ? 'Creando…' : 'Se vende tal cual'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {!visibles.length && (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>
            {soloSin ? 'No falta ninguno con esa búsqueda.' : 'Ningún plato con esa búsqueda.'}
          </div>
        )}
      </div>

      <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.5 }}>
        Los platos sin receta no descuentan nada del almacén. Es lo normal al principio:
        empieza por los que más vendes, que son los que mueven el género.
        <br />
        <strong>«Se vende tal cual»</strong> es para lo que entra y sale igual —una lata,
        un agua, una tarrina—: te crea el artículo y su receta de una unidad de un clic.
        Para los platos que se elaboran, <strong>toca el nombre</strong> y escribe la receta.
      </div>

      {abierto && (
        <EscandalloEditor
          estId={estId}
          producto={abierto}
          articulos={articulos}
          onCerrar={() => setAbierto(null)}
          onGuardado={() => { setAbierto(null); setRefresco(n => n + 1) }}
        />
      )}
    </div>
  )
}
