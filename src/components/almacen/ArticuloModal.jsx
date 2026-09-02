import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  UNIDADES, FAMILIAS, cantidad, eurCoste, fijarCoste,
  cargarElaboracion, guardarElaboracion,
} from '../../lib/stock'

// Alta y edición de un artículo de almacén.
//
// Lo que NO se toca aquí: `existencia` y `coste_medio`. Los congela un guard en base
// de datos (PD233) y se mueven apuntando una compra, una merma o un recuento — si se
// pudieran teclear, el libro de movimientos dejaría de cuadrar con la realidad y todo
// el módulo perdería el sentido. Por eso ni siquiera se ofrecen: se enseñan y punto.
export default function ArticuloModal({ estId, articulo, familiasUsadas = [], articulos = [], onCerrar, onGuardado }) {
  const nuevo = !articulo
  const [v, setV] = useState({
    nombre: articulo?.nombre || '',
    unidad: articulo?.unidad || 'ud',
    familia: articulo?.familia || '',
    minimo: articulo?.minimo ?? 0,
    controla_agotado: articulo?.controla_agotado ?? true,
    activo: articulo?.activo ?? true,
    es_elaborado: articulo?.es_elaborado ?? false,
  })
  // La receta de una preparación: qué lleva CADA unidad de almacén. Vive aquí y no
  // en un modal aparte porque ser preparación ES parte de qué es el artículo.
  const [receta, setReceta] = useState([])
  useEffect(() => {
    if (nuevo || !articulo?.es_elaborado) return
    let vivo = true
    cargarElaboracion(articulo.id)
      .then(ls => { if (vivo) setReceta(ls.map(l => ({ articulo_id: l.articulo_id, cantidad: String(l.cantidad).replace('.', ',') }))) })
      .catch(e => toast('No se ha podido cargar la receta: ' + e.message, 'error'))
    return () => { vivo = false }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Ingredientes posibles: artículos de compra activos. Nunca otra preparación
  // (PD255, sin ciclos) ni el propio artículo.
  const ingredientes = articulos.filter(x => x.activo && !x.es_elaborado && x.id !== articulo?.id)
  // El coste va aparte del resto del formulario: no se guarda con un UPDATE (la
  // columna está congelada por PD233), se apunta en el libro con su propia RPC.
  const [coste, setCoste] = useState(
    articulo?.coste_medio != null ? String(articulo.coste_medio).replace('.', ',') : '')
  const [guardando, setGuardando] = useState(false)

  // Las 8 sugeridas MAS las que el restaurante ya se haya inventado. Y como es un
  // campo de texto con lista, tambien puede escribir una nueva: la columna `familia`
  // es texto libre en base de datos, la limitacion estaba solo en la pantalla.
  const familias = [...new Set([...familiasUsadas, ...FAMILIAS].filter(Boolean))].sort()

  const cambiar = (k, val) => setV(prev => ({ ...prev, [k]: val }))
  const valido = v.nombre.trim().length > 0

  async function guardar() {
    setGuardando(true)
    const payload = {
      nombre: v.nombre.trim(),
      unidad: v.unidad,
      familia: v.familia || null,
      minimo: Number(String(v.minimo).replace(',', '.')) || 0,
      controla_agotado: !!v.controla_agotado,
      activo: !!v.activo,
      es_elaborado: !!v.es_elaborado,
    }
    // En el alta se pide el id de vuelta: la receta se guarda contra él justo después.
    let id = articulo?.id
    let error
    if (nuevo) {
      const res = await supabase.from('stock_articulos')
        .insert({ ...payload, establecimiento_id: estId }).select('id').single()
      error = res.error
      id = res.data?.id
    } else {
      ({ error } = await supabase.from('stock_articulos').update(payload).eq('id', articulo.id))
    }
    setGuardando(false)
    // supabase-js NO lanza: devuelve `{ error }`.
    if (error) {
      return toast(
        error.code === '23505'
          ? 'Ya tienes un artículo con ese nombre.'
          : 'No se ha podido guardar: ' + error.message,
        'error')
    }
    // La receta va DESPUÉS del artículo, como el coste: un fallo aquí no tira el resto.
    // Las líneas a medias (sin ingrediente o sin cantidad) se ignoran sin ruido.
    if (v.es_elaborado) {
      const lineas = receta
        .map(l => ({ articulo_id: l.articulo_id, cantidad: Number(String(l.cantidad).replace(',', '.')) }))
        .filter(l => l.articulo_id && l.cantidad > 0)
      try { await guardarElaboracion(id, lineas) }
      catch (e) { toast('El artículo se guardó, pero la receta no: ' + e.message, 'error') }
    }
    // Si además tocó el coste, se apunta aparte. Va DESPUÉS de guardar el resto para
    // que un fallo aquí no tire por tierra el cambio de nombre o de unidad.
    if (!nuevo) {
      const c = Number(String(coste).replace(',', '.'))
      if (coste !== '' && !Number.isNaN(c) && c !== Number(articulo.coste_medio)) {
        try { await fijarCoste(articulo.id, c) }
        catch (e) { toast('El artículo se guardó, pero el coste no: ' + e.message, 'error') }
      }
    }
    toast(nuevo ? 'Artículo creado' : 'Artículo guardado', 'success')
    onGuardado()
  }

  async function borrar() {
    if (!(await confirmar(
      `¿Borrar "${articulo.nombre}"?\n\nSolo se puede borrar si no tiene historial: un ` +
      `artículo con movimientos, facturas o recetas no se borra, se archiva (así el libro ` +
      `sigue cuadrando).\n\nPara dejar de usarlo, desmárcalo como activo.`
    ))) return
    const { error } = await supabase.from('stock_articulos').delete().eq('id', articulo.id)
    if (error) {
      // 23503 = está en una factura o receta (FK). PD248 = tiene movimientos y el libro
      // es append-only: el CASCADE del borrado los arrastraría y el guard lo corta.
      // En ambos casos la salida es la misma: archivar.
      return toast(
        error.code === '23503' || error.code === 'PD248'
          ? 'No se puede borrar: tiene historial (movimientos, facturas o recetas). Desmárcalo como activo y conservas el libro.'
          : 'No se ha podido borrar: ' + error.message,
        'error')
    }
    toast('Artículo borrado', 'success')
    onGuardado()
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={{ ...ds.modalContent, maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <h2 style={ds.h2}>{nuevo ? 'Nuevo artículo de compra' : 'Editar artículo'}</h2>

        <label style={ds.label}>¿Qué compras?</label>
        <input autoFocus value={v.nombre} onChange={e => cambiar('nombre', e.target.value)}
          placeholder="Carne picada, Pan de hamburguesa, Coca-Cola lata…"
          style={ds.formInput} />

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ flex: '1 1 250px', minWidth: 0 }}>
            <label style={ds.label}>¿Cómo lo mides?</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {UNIDADES.map(u => (
                <button key={u.id} onClick={() => cambiar('unidad', u.id)} style={{
                  ...ds.filterBtn, height: 38, flex: 1, justifyContent: 'center',
                  background: v.unidad === u.id ? colors.primary : colors.paper,
                  color: v.unidad === u.id ? colors.cream : colors.textDim,
                  borderColor: v.unidad === u.id ? colors.primary : colors.border,
                  fontWeight: v.unidad === u.id ? 700 : 600,
                }}>{u.label}</button>
              ))}
            </div>
            <div style={{ ...ds.muted, marginTop: 6 }}>
              {UNIDADES.find(u => u.id === v.unidad)?.ayuda}
            </div>
          </div>

          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <label style={ds.label}>Familia (opcional)</label>
            {/* Campo con lista, no 8 botones en dos filas: ocupaban media pantalla
                para algo opcional y ademas NO dejaban poner una familia propia. */}
            <input list="stock-familias" value={v.familia}
              onChange={e => cambiar('familia', e.target.value)}
              placeholder="Elige o escribe la tuya" style={ds.formInput} />
            <datalist id="stock-familias">
              {familias.map(f => <option key={f} value={f} />)}
            </datalist>
            <div style={{ ...ds.muted, marginTop: 6 }}>Solo sirve para filtrar la lista.</div>
          </div>
        </div>

        <div style={{ marginTop: 16, maxWidth: 260 }}>
          <label style={ds.label}>Avísame cuando queden menos de</label>
          <input inputMode="decimal" value={v.minimo}
            onChange={e => cambiar('minimo', e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0" style={{ ...ds.formInput, textAlign: 'right' }} />
          <div style={{ ...ds.muted, marginTop: 6 }}>Déjalo en 0 si no quieres aviso.</div>
        </div>

        <Interruptor
          titulo="Puede agotar lo que vendes"
          texto={v.controla_agotado
            ? 'Si se acaba, los platos que lo llevan desaparecen de la carta en pidoo.es y en el QR hasta que vuelva a entrar género.'
            : 'Aunque se acabe, no apagará ningún plato. Ponlo así para la sal, el aceite o las especias: no quieres que un bote vacío te tire media carta.'}
          valor={!!v.controla_agotado}
          onChange={x => cambiar('controla_agotado', x)} />

        <Interruptor
          titulo="Es una preparación"
          texto={v.es_elaborado
            ? 'La haces tú, no la compras: una mezcla, una salsa, una masa. Abajo va su receta, y cada tanda se apunta con el botón Preparar de la lista.'
            : 'Enciéndelo si esto no se compra, se hace: una mezcla de pollo, una salsa de la casa, una masa.'}
          valor={!!v.es_elaborado}
          onChange={x => cambiar('es_elaborado', x)} />

        {v.es_elaborado && (
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: radius.sm,
            background: colors.surface2, border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: type.sm, fontWeight: 600, color: colors.text }}>
              Receta: qué lleva {v.unidad === 'ud' ? 'cada unidad' : `1 ${v.unidad}`} de esta preparación
            </div>
            <div style={{ ...ds.muted, marginTop: 2, marginBottom: 10, lineHeight: 1.5 }}>
              Truco: haz una tanda apuntando lo que le echas y pesa lo que sale, y divide.
              Si con 2 kg de pollo y 0,5 l de mayonesa te salen 2,4 kg de mezcla, cada kg
              lleva 0,83 de pollo y 0,21 de mayonesa.
            </div>

            {receta.map((l, i) => {
              const ing = ingredientes.find(x => x.id === l.articulo_id)
              return (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  {/* flex:1 SIEMPRE con minWidth:0: un select toma como mínimo el ancho
                      de su opción más larga y revienta el modal (lección del EscandalloEditor). */}
                  <select value={l.articulo_id} style={{ ...ds.select, flex: 1, minWidth: 0 }}
                    onChange={e => setReceta(rs => rs.map((x, j) => j === i ? { ...x, articulo_id: e.target.value } : x))}>
                    <option value="">— Elige de tus artículos —</option>
                    {ingredientes.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                  <input inputMode="decimal" value={l.cantidad} placeholder="0,00"
                    onChange={e => setReceta(rs => rs.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                    style={{ ...ds.formInput, width: 78, textAlign: 'right', flexShrink: 0 }} />
                  <span style={{ ...ds.muted, width: 22, flexShrink: 0 }}>{ing?.unidad || ''}</span>
                  <button onClick={() => setReceta(rs => rs.filter((_, j) => j !== i))}
                    title="Quitar ingrediente"
                    style={{ ...ds.miniBtn, flexShrink: 0, padding: '4px 7px' }}>
                    <X size={12} />
                  </button>
                </div>
              )
            })}

            <button onClick={() => setReceta(rs => [...rs, { articulo_id: '', cantidad: '' }])}
              style={{ ...ds.miniBtn, marginTop: 4 }}>
              <Plus size={12} /> Añadir ingrediente
            </button>

            {(() => {
              const coste = receta.reduce((s, l) => {
                const ing = ingredientes.find(x => x.id === l.articulo_id)
                const c = Number(String(l.cantidad).replace(',', '.'))
                return s + (ing && c > 0 ? c * Number(ing.coste_medio) : 0)
              }, 0)
              return coste > 0 ? (
                <div style={{ ...ds.muted, marginTop: 10 }}>
                  Hacer {v.unidad === 'ud' ? '1 unidad' : `1 ${v.unidad}`} te cuesta hoy{' '}
                  <strong style={{ color: colors.text }}>{eurCoste(coste)}</strong>, a los
                  precios actuales de tus artículos.
                </div>
              ) : null
            })()}
          </div>
        )}

        {!nuevo && (
          <Interruptor
            titulo="Activo"
            texto={v.activo ? 'Se cuenta en el inventario.' : 'Archivado: no cuenta, pero conservas su histórico.'}
            valor={!!v.activo}
            onChange={x => cambiar('activo', x)}
            alerta={!v.activo} />
        )}

        {!nuevo && (
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: radius.sm,
            background: colors.surface2, border: `1px solid ${colors.border}`,
          }}>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Dato label="Quedan ahora" valor={cantidad(articulo.existencia, articulo.unidad)} />
              <div style={{ width: 150 }}>
                <label style={ds.label}>Te cuesta (€ / {articulo.unidad})</label>
                <input inputMode="decimal" value={coste}
                  onChange={e => setCoste(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="0,00" style={{ ...ds.formInput, textAlign: 'right' }} />
              </div>
            </div>
            <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.5 }}>
              <strong>Lo que queda no se escribe a mano</strong>: se mueve con una compra,
              una merma o un recuento, y así el inventario siempre cuadra con lo que pasó.
              El coste sí puedes corregirlo aquí — normalmente entra solo con las facturas,
              pero para el género que ya tenías o un proveedor sin factura, ponlo tú. Queda
              apuntado en Movimientos.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 22, flexWrap: 'wrap' }}>
          {!nuevo
            ? <button onClick={borrar} style={ds.miniBtnDanger}>Borrar</button>
            : <span />}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
            <button onClick={guardar} disabled={!valido || guardando} style={{
              ...ds.primaryBtn,
              opacity: (!valido || guardando) ? 0.5 : 1,
              cursor: (!valido || guardando) ? 'not-allowed' : 'pointer',
            }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Interruptor({ titulo, texto, valor, onChange, alerta }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginTop: 16,
      borderRadius: radius.sm,
      border: `1px solid ${alerta ? colors.warning : colors.border}`,
      background: alerta ? colors.warningSoft : colors.surface2,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: type.sm, fontWeight: 600, color: colors.text }}>{titulo}</div>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, lineHeight: 1.5 }}>{texto}</div>
      </div>
      <button role="switch" aria-checked={valor} aria-label={titulo}
        onClick={() => onChange(!valor)}
        style={{
          width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: valor ? colors.primary : colors.borderStrong,
          position: 'relative', flexShrink: 0, transition: 'background .15s',
        }}>
        <span style={{
          position: 'absolute', top: 3, left: valor ? 23 : 3, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
        }} />
      </button>
    </div>
  )
}

function Dato({ label, valor }) {
  return (
    <div>
      <div style={{ ...ds.label, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </div>
    </div>
  )
}
