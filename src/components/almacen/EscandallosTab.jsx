import { useState, useEffect } from 'react'
import { Search, CircleCheck, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { eur, comisionPidoo } from '../../lib/stock'
import EscandalloEditor from './EscandalloEditor'

// La lista de escandallos, con semáforo.
//
// 🔴 AL TOCAR LOS ANCHOS DE COLUMNA: los botones de este panel son más anchos de lo que
// parecen («Escribir receta» mide 144 px, no ~90) porque `ds.miniBtn` lleva peso 700 y
// letter-spacing. Con `col()` no pueden encogerse, así que lo que sobra DESBORDA hacia
// la izquierda y tapa el importe de al lado. Medir en el navegador, no estimar.
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
  const [categoria, setCategoria] = useState('')   // '' = todas
  const [abierto, setAbierto] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)
  // null = no se ha podido saber. NO es lo mismo que 0: un fallo disfrazado de
  // "no paga comision" enseña un margen inflado como si fuera bueno.
  const [comision, setComision] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    ;(async () => {
      const [p, e, c] = await Promise.all([
        supabase.from('productos')
          .select('id, nombre, precio, precio_local, categoria_id, categorias(nombre)')
          .eq('establecimiento_id', estId).order('nombre'),
        supabase.from('escandallo_lineas')
          .select('producto_id, articulo_id, cantidad, tamano_clave')
          .eq('establecimiento_id', estId),
        comisionPidoo(estId).catch((e) => { console.warn('[almacen] comisión:', e.message); return null }),
      ])
      if (!vivo) return
      setComision(c == null ? null : Number(c))
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

  const catDe = (p) => p.categorias?.nombre || 'Sin categoría'
  // Las categorías salen de la propia carta, con cuántos platos tiene cada una.
  const categorias = Object.entries(
    prods.reduce((acc, p) => { acc[catDe(p)] = (acc[catDe(p)] || 0) + 1; return acc }, {})
  ).sort(([a], [b]) => a.localeCompare(b, 'es'))

  const visibles = prods.filter(p => {
    if (soloSin && conReceta[p.id]) return false
    if (categoria && catDe(p) !== categoria) return false
    if (busca.trim() && !p.nombre.toLowerCase().includes(busca.trim().toLowerCase())) return false
    return true
  })

  const nSin = prods.filter(p => !conReceta[p.id] && (!categoria || catDe(p) === categoria)).length

  if (cargando) return <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando la carta…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={15} color={colors.textMute}
            style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar un plato de tu carta…" style={{ ...ds.input, paddingLeft: 34 }} />
        </div>
        <select value={categoria} onChange={e => setCategoria(e.target.value)}
          aria-label="Filtrar por categoría"
          style={{ ...ds.select, flex: '0 1 220px', minWidth: 170, height: 36 }}>
          <option value="">Todas las categorías ({prods.length})</option>
          {categorias.map(([nombre, n]) => (
            <option key={nombre} value={nombre}>{nombre} ({n})</option>
          ))}
        </select>
        <button onClick={() => setSoloSin(v => !v)} style={{
          ...ds.filterBtn, height: 36,
          background: soloSin ? colors.primary : colors.paper,
          color: soloSin ? colors.cream : colors.textDim,
          borderColor: soloSin ? colors.primary : colors.border,
        }}>
          Solo sin receta ({nSin})
        </button>
      </div>

      {!articulos.length && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: radius.md,
          border: `1px solid ${colors.warning}`, background: colors.warningSoft,
          fontSize: type.sm, lineHeight: 1.6, color: colors.text,
        }}>
          Todavía no tienes artículos en el almacén. Un artículo es lo que le compras al
          proveedor: la carne, el pan, el queso, el aceite. Las recetas se escriben con eso,
          así que créalos primero en la pestaña <strong>Artículos de compra</strong>.
        </div>
      )}

      <div style={{ ...ds.table, ...tablaScroll }}>
        <div style={{ ...ds.tableHeader, ...filaMin(950) }}>
          <div style={col(22, 'left')}></div>
          <div style={{ flex: 1, minWidth: 0 }}>Plato de tu carta</div>
          <div style={col(88)}>Te cuesta</div>
          <div style={col(124)}>En barra</div>
          <div style={col(148)}>Por Pidoo</div>
          <div style={col(176, 'right')}></div>
        </div>

        {visibles.map(p => {
          const tiene = !!conReceta[p.id]
          const coste = costes[p.id]
          // Los DOS precios del producto. `precio_local` es la barra y el QR de mesa;
          // `precio` es lo que paga el cliente por la app y la tienda.
          // Sin precio de local la barra cobra el de la carta, igual que el TPV.
          const pPidoo = Number(p.precio ?? 0)
          const pBarra = p.precio_local != null ? Number(p.precio_local) : (pPidoo > 0 ? pPidoo : null)
          // Por Pidoo se paga comisión; en barra no. Comparar los dos brutos mentiría.
          const netoPidoo = comision == null ? pPidoo : pPidoo * (1 - comision / 100)
          const mBarra = tiene && pBarra != null ? pBarra - coste : null
          const mPidoo = tiene && pPidoo > 0 ? netoPidoo - coste : null
          return (
            <div key={p.id} style={{ ...ds.tableRow, ...filaMin(950), background: colors.paper }}>
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
              <div style={{ ...col(88), color: colors.textMute }}>
                {tiene ? eur(coste) : '—'}
              </div>
              <Precio ancho={124} precio={pBarra} margen={mBarra} coste={coste} />
              <Precio ancho={148} precio={pPidoo} margen={mPidoo} coste={coste}
                nota={comision == null ? 'sin descontar comisión'
                  : comision > 0 ? `−${comision} % comisión` : 'sin comisión'} />
              <div style={{ ...col(176), display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setAbierto(p)} style={{ ...ds.miniBtn, flexShrink: 0 }}>
                  {tiene ? 'Ver receta' : 'Escribir receta'}
                </button>
              </div>
            </div>
          )
        })}

        {!visibles.length && (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>
            {soloSin ? 'Todos los de ese filtro ya tienen receta.' : 'Ningún plato de tu carta con ese filtro.'}
          </div>
        )}
      </div>

      <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.5 }}>
        El % es lo que ganas sobre lo que te cuesta el plato: si cuesta 2 € y lo vendes a
        5 €, ganas 3 €, que es un 150 %.
        <br />
        Aquí está tu carta entera, plato por plato. La receta dice qué le echas y cuánto,
        con los artículos de la pestaña <strong>Artículos de compra</strong>. Los platos sin
        receta no descuentan nada del almacén: es lo normal al principio, empieza por los que
        más vendes, que son los que mueven el género.
        <br />
        Si el plato lo compras y lo vendes igual —una lata, un agua, una tarrina— no hace
        falta que escribas nada: abre su receta y pulsa <strong>«Se vende tal cual»</strong>.
      </div>

      {abierto && (
        <EscandalloEditor
          estId={estId}
          producto={abierto}
          articulos={articulos}
          onCerrar={() => setAbierto(null)}
          onGuardado={() => { setAbierto(null); onCambio?.(); setRefresco(n => n + 1) }}
        />
      )}
    </div>
  )
}

// Una celda de precio: lo que cobra arriba y lo que le queda debajo. Dos numeros en
// el sitio de uno, porque el precio solo no dice nada sin el coste al lado.
// El % es la ganancia SOBRE EL COSTE (2 € de coste, 5 € de venta → 150 %), como lo
// cuenta Marlon. Sin coste no se enseña %.
function Precio({ ancho, precio, margen, nota, coste }) {
  if (precio == null || precio === 0) {
    return <div style={{ ...col(ancho), color: colors.textMute }}>—</div>
  }
  return (
    <div style={col(ancho)}>
      <div style={{ fontWeight: 600, color: colors.text }}>{eur(precio)}</div>
      <div style={{
        fontSize: type.xxs, marginTop: 1, fontWeight: 700,
        color: margen === null ? colors.textMute : margen < 0 ? colors.danger : colors.sage2,
      }}>
        {margen === null
          ? (nota || '—')
          : `${margen < 0 ? '' : '+'}${eur(margen)}${coste > 0 ? ` · ${Math.round(100 * margen / coste)} %` : ''}`}
      </div>
      {nota && margen !== null && (
        <div style={{ fontSize: type.xxs, color: colors.textMute }}>{nota}</div>
      )}
    </div>
  )
}
