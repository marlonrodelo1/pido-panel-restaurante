// El arranque del almacén, en tres pasos.
//
// Esta es LA pantalla del módulo. Un inventario no se abandona por lo que hace, se
// abandona por lo que cuesta ponerlo en marcha: si al dueño le pintas una tabla vacía
// y le dices "da de alta tus artículos", cierra y no vuelve. Así que:
//
//   1. Se empieza por UNA categoría de su propia carta, no por "el almacén entero".
//   2. Los artículos se crean SOLOS desde los productos que marque (`stock_arranque_desde_carta`
//      crea el artículo y su receta 1:1). Cero escritura.
//   3. Contar es opcional: "lo cuento mañana" también cierra el arranque, porque un
//      arranque a medias es infinitamente mejor que ninguno.
//
// Mientras `stock_config.arranque_at` sea null esto ocupa la pantalla entera: enseñar
// un inventario a cero antes de contar hace que el módulo parezca roto.
import { useState, useEffect } from 'react'
import { Boxes, Check, Search, ArrowRight, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast } from '../../App'
import { arranqueDesdeCarta, recuentoLote } from '../../lib/stock'

// Lo que suena a bebida: son los que mejor se cuentan (están en la cámara, en cajas,
// y no hay que abrir nada para saber cuántos quedan). Por eso se sugieren primero.
const SUENA_A_BEBIDA = /bebida|refresco|cerveza|vino|agua|zumo|caf[eé]|alcoh/i

export default function ArranqueAsistido({ estId, onListo }) {
  const [paso, setPaso] = useState(1)
  const [cats, setCats] = useState([])
  const [prods, setProds] = useState([])
  const [catsElegidas, setCatsElegidas] = useState([])
  const [marcados, setMarcados] = useState({})
  const [conteos, setConteos] = useState({})
  const [busca, setBusca] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [creados, setCreados] = useState([])

  useEffect(() => {
    if (!estId) return
    Promise.all([
      supabase.from('categorias').select('id, nombre, orden').eq('establecimiento_id', estId).order('orden'),
      supabase.from('productos').select('id, nombre, categoria_id').eq('establecimiento_id', estId).order('nombre'),
    ]).then(([c, p]) => {
      const cs = c.data || []
      setCats(cs)
      setProds(p.data || [])
      const sugerida = cs.find(x => SUENA_A_BEBIDA.test(x.nombre || ''))
      if (sugerida) setCatsElegidas([sugerida.id])
      setCargando(false)
    })
  }, [estId])

  const porCat = (id) => prods.filter(p => p.categoria_id === id)
  const candidatos = prods.filter(p => catsElegidas.includes(p.categoria_id))
  const visibles = busca.trim()
    ? candidatos.filter(p => p.nombre.toLowerCase().includes(busca.trim().toLowerCase()))
    : candidatos
  const nMarcados = candidatos.filter(p => marcados[p.id]).length

  // Al entrar en el paso 2, todo marcado: lo normal es que una categoría entera se
  // venda tal cual. Desmarcar 3 es menos trabajo que marcar 21.
  function irAPaso2() {
    if (!catsElegidas.length) return toast('Elige al menos una categoría', 'error')
    const m = {}
    candidatos.forEach(p => { m[p.id] = true })
    setMarcados(m)
    setPaso(2)
  }

  async function crearArticulos() {
    const ids = candidatos.filter(p => marcados[p.id]).map(p => p.id)
    if (!ids.length) return toast('Marca al menos un producto', 'error')
    setGuardando(true)
    try {
      await arranqueDesdeCarta(estId, ids)
      const { data } = await supabase.from('stock_articulos')
        .select('id, nombre, unidad').eq('establecimiento_id', estId).order('nombre')
      setCreados(data || [])
      setPaso(3)
    } catch (e) {
      toast(e.message, 'error')
    }
    setGuardando(false)
  }

  // Contar y no contar cierran los dos el arranque. Con todo a cero no se crea ningún
  // movimiento (la diferencia es 0), pero `arranque_at` sí queda fijado: es la época
  // cero del inventario y a partir de ahí los números significan algo.
  async function cerrar(contando) {
    setGuardando(true)
    try {
      const lineas = creados.map(a => ({
        articulo_id: a.id,
        contado: contando ? Number(String(conteos[a.id]?.cant ?? '').replace(',', '.')) || 0 : 0,
        coste: contando && conteos[a.id]?.coste
          ? Number(String(conteos[a.id].coste).replace(',', '.')) || null
          : null,
      }))
      await recuentoLote(lineas)
      const { data: cfg } = await supabase.from('stock_config')
        .select('*').eq('establecimiento_id', estId).maybeSingle()
      toast(contando ? 'Inventario en marcha' : 'Listo. Cuenta cuando puedas.', 'success')
      onListo?.(cfg)
    } catch (e) {
      toast(e.message, 'error')
      setGuardando(false)
    }
  }

  if (cargando) return <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Cargando tu carta…</div>

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Boxes size={20} color={colors.primary} />
        <h1 style={ds.h1}>Poner el almacén en marcha</h1>
      </div>
      <div style={{ ...ds.muted, marginBottom: 18 }}>
        Son tres pasos y se hace una sola vez. Puedes ampliarlo cuando quieras.
      </div>

      <Pasos actual={paso} />

      {paso === 1 && (
        <div style={{ ...ds.card, marginTop: 16 }}>
          <h2 style={ds.h2}>Empieza por las bebidas</h2>
          <p style={{ ...ds.dim, lineHeight: 1.6, marginTop: 0, marginBottom: 16 }}>
            No intentes meter la carta entera hoy. Con las bebidas ya vas a ver si te
            cuadra la caja, y son las que se cuentan solas: están en cajas y no hay que
            abrir nada para saber cuántas quedan.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cats.map(c => {
              const on = catsElegidas.includes(c.id)
              const n = porCat(c.id).length
              return (
                <button key={c.id} disabled={!n}
                  onClick={() => setCatsElegidas(prev =>
                    on ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                  style={{
                    ...ds.filterBtn, height: 36,
                    background: on ? colors.primary : colors.paper,
                    color: on ? colors.cream : colors.textDim,
                    borderColor: on ? colors.primary : colors.border,
                    fontWeight: on ? 700 : 600,
                    opacity: n ? 1 : 0.4, cursor: n ? 'pointer' : 'not-allowed',
                  }}>
                  {on && <Check size={13} />}
                  {c.nombre} <span style={{ opacity: 0.7 }}>({n})</span>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={irAPaso2} style={ds.primaryBtn}>
              Siguiente <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div style={{ ...ds.card, marginTop: 16 }}>
          <h2 style={ds.h2}>Marca lo que se vende tal cual</h2>
          <p style={{ ...ds.dim, lineHeight: 1.6, marginTop: 0, marginBottom: 14 }}>
            Una lata de refresco se vende tal cual: entra una, sale una. Desmarca lo que
            sea un plato elaborado — esos llevan receta y los harás después, con calma.
          </p>

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={15} color={colors.textMute}
              style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar en estos productos…"
              style={{ ...ds.input, paddingLeft: 34 }} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={() => {
              const m = { ...marcados }; visibles.forEach(p => { m[p.id] = true }); setMarcados(m)
            }} style={ds.miniBtn}>Marcar todos</button>
            <button onClick={() => {
              const m = { ...marcados }; visibles.forEach(p => { m[p.id] = false }); setMarcados(m)
            }} style={ds.miniBtn}>Desmarcar todos</button>
            <div style={{ ...ds.muted, alignSelf: 'center', marginLeft: 'auto' }}>
              {nMarcados} marcado{nMarcados === 1 ? '' : 's'}
            </div>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: radius.sm }}>
            {visibles.map(p => (
              <label key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                borderBottom: `1px solid ${colors.border}`, cursor: 'pointer',
                background: marcados[p.id] ? colors.primarySoft : colors.paper,
              }}>
                <input type="checkbox" checked={!!marcados[p.id]}
                  onChange={e => setMarcados({ ...marcados, [p.id]: e.target.checked })} />
                <span style={{ fontSize: type.sm, color: colors.text }}>{p.nombre}</span>
              </label>
            ))}
            {!visibles.length && (
              <div style={{ ...ds.muted, padding: 20, textAlign: 'center' }}>Nada que mostrar.</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button onClick={() => setPaso(1)} style={ds.secondaryBtn}>
              <ArrowLeft size={15} /> Atrás
            </button>
            <button onClick={crearArticulos} disabled={guardando || !nMarcados} style={{
              ...ds.primaryBtn, opacity: (guardando || !nMarcados) ? 0.5 : 1,
              cursor: (guardando || !nMarcados) ? 'not-allowed' : 'pointer',
            }}>
              {guardando ? 'Creando…' : `Crear ${nMarcados} artículo${nMarcados === 1 ? '' : 's'}`}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div style={{ ...ds.card, marginTop: 16 }}>
          <h2 style={ds.h2}>Cuenta lo que tienes ahora mismo</h2>
          <p style={{ ...ds.dim, lineHeight: 1.6, marginTop: 0, marginBottom: 14 }}>
            Esto es el punto de partida. A partir de aquí cada venta va restando sola.
            Lo que te cuesta cada uno es opcional: si lo pones, verás el margen de cada
            plato; si no, entrará solo con la primera factura de compra.
          </p>

          <div style={{ maxHeight: 380, overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: radius.sm }}>
            <div style={{ ...ds.tableHeader }}>
              <div style={{ flex: 1 }}>Artículo</div>
              <div style={{ width: 120 }}>¿Cuántos tienes?</div>
              <div style={{ width: 120 }}>¿A cómo te sale?</div>
            </div>
            {creados.map(a => (
              <div key={a.id} style={{ ...ds.tableRow }}>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nombre}</div>
                <div style={{ width: 120 }}>
                  <input inputMode="decimal" placeholder="0"
                    value={conteos[a.id]?.cant ?? ''}
                    onChange={e => setConteos({
                      ...conteos,
                      [a.id]: { ...conteos[a.id], cant: e.target.value.replace(/[^\d.,]/g, '') },
                    })}
                    style={{ ...ds.input, height: 32, textAlign: 'right' }} />
                </div>
                <div style={{ width: 120 }}>
                  <input inputMode="decimal" placeholder="€ / ud"
                    value={conteos[a.id]?.coste ?? ''}
                    onChange={e => setConteos({
                      ...conteos,
                      [a.id]: { ...conteos[a.id], coste: e.target.value.replace(/[^\d.,]/g, '') },
                    })}
                    style={{ ...ds.input, height: 32, textAlign: 'right' }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => cerrar(false)} disabled={guardando} style={ds.secondaryBtn}>
              Lo cuento mañana
            </button>
            <button onClick={() => cerrar(true)} disabled={guardando} style={{
              ...ds.primaryBtn, opacity: guardando ? 0.5 : 1,
            }}>
              {guardando ? 'Guardando…' : 'Guardar el recuento'}
            </button>
          </div>
          <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.5 }}>
            Vas a controlar {creados.length} artículo{creados.length === 1 ? '' : 's'}.
            El resto de tu carta sigue funcionando igual: puedes añadirlos cuando quieras.
          </div>
        </div>
      )}
    </div>
  )
}

function Pasos({ actual }) {
  const pasos = ['Elegir', 'Marcar', 'Contar']
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {pasos.map((p, i) => {
        const n = i + 1
        const hecho = n < actual
        const activo = n === actual
        return (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 12px', borderRadius: radius.full,
              background: activo ? colors.primary : hecho ? colors.sageSoft : colors.surface2,
              color: activo ? colors.cream : hecho ? colors.sage2 : colors.textMute,
              fontSize: type.xs, fontWeight: 700,
            }}>
              {hecho ? <Check size={13} /> : <span>{n}</span>}
              {p}
            </div>
            {i < pasos.length - 1 && (
              <div style={{ width: 18, height: 1, background: colors.border }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
