import { useState, useEffect } from 'react'
import { Plus, X, ChevronDown, ChevronUp, Wand2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, comisionPidoo, arranqueDesdeCarta, recetaATexto, textoAReceta, unidadReceta, recetaSospechosa,
} from '../../lib/stock'

// El escandallo de un plato: qué lleva y cuánto cuesta.
//
// DOS DECISIONES QUE SOSTIENEN LA PANTALLA:
//
// 1. Los tamaños se resuelven con un FACTOR, no con recetas separadas. Con 101 tamaños
//    en producción, pedirle al dueño tres recetas por plato es pedirle una tarde.
//    «Grande = 1,5» es un número. Solo se escribe receta propia cuando el tamaño lleva
//    otra cosa de verdad, y para eso está el enlace de abajo.
//
// 2. La clave del tamaño es su NOMBRE normalizado, nunca `producto_tamanos.id`: la
//    Carta borra y recrea esas filas en cada guardado, así que sus id son volátiles.
//
// El margen se recalcula EN VIVO mientras se teclea. Ver el número moverse es lo que
// hace que el hostelero rellene el siguiente plato.
export default function EscandalloEditor({ estId, producto, articulos, onCerrar, onGuardado }) {
  const [lineas, setLineas] = useState([])          // receta base
  const [tamanos, setTamanos] = useState([])        // producto_tamanos
  const [factores, setFactores] = useState({})      // tamano_clave -> factor
  const [propias, setPropias] = useState({})        // tamano_clave -> [lineas]
  const [abierta, setAbierta] = useState(null)      // tamano_clave con receta propia desplegada
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [comision, setComision] = useState(null)
  const [montando, setMontando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(null)

  const clave = (s) => (s || '').trim().toLowerCase()
  const porId = Object.fromEntries(articulos.map(a => [a.id, a]))

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [t, e, f, c] = await Promise.all([
        supabase.from('producto_tamanos').select('id, nombre, precio, precio_local')
          .eq('producto_id', producto.id).order('orden'),
        supabase.from('escandallo_lineas').select('*, stock_articulos(unidad)').eq('producto_id', producto.id),
        supabase.from('escandallo_tamanos').select('*').eq('producto_id', producto.id),
        comisionPidoo(estId).catch((e) => { console.warn('[almacen] comisión:', e.message); return null }),
      ])
      if (!vivo) return
      // Si la receta no carga NO se enseña vacía: guardar una receta vacía borraría la de verdad.
      const fallo = t.error || e.error || f.error
      if (fallo || (e.data || []).some(l => !l.stock_articulos?.unidad)) {
        setErrorCarga(fallo ? fallo.message : 'falta la unidad de algún ingrediente')
        setCargando(false)
        return
      }
      setComision(c == null ? null : Number(c))
      setTamanos(t.data || [])
      const todas = e.data || []
      // En pantalla la cantidad va en gramos / mililitros (7 g, no 0,007 kg). La unidad viene
      // pegada a cada línea desde la base de datos: convertir con una unidad sacada de otro
      // sitio podría guardar una cantidad mil veces más grande o más pequeña.
      const aFila = (l) => {
        const unidad = l.stock_articulos?.unidad
        return { articulo_id: l.articulo_id, unidad, cantidad: recetaATexto(l.cantidad, unidad) }
      }
      setLineas(todas.filter(l => l.tamano_clave === '').map(aFila))
      const pr = {}
      for (const l of todas.filter(l => l.tamano_clave !== '')) {
        pr[l.tamano_clave] = pr[l.tamano_clave] || []
        pr[l.tamano_clave].push(aFila(l))
      }
      setPropias(pr)
      setFactores(Object.fromEntries((f.data || []).map(x => [x.tamano_clave, String(x.factor).replace('.', ',')])))
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [producto.id, estId])

  const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0
  // Lo escrito (7 g) pasado a la unidad del artículo (0,007 kg): así se guarda y se costea.
  const unidadDe = (l) => l.unidad ?? porId[l.articulo_id]?.unidad
  // Redondeado a 4 decimales, lo que guarda la base de datos (0,1 g): el coste que se ve es
  // exactamente lo que se guarda y lo que descontará el almacén. En dos pasos, para que el
  // ruido de coma flotante (0,15 g = 1,4999…) no decida hacia dónde redondea.
  const base = (l) => Math.round(Math.round(textoAReceta(l.cantidad, unidadDe(l)) * 1e7) / 1e3) / 1e4
  const costeDe = (ls) => ls.reduce((s, l) => s + base(l) * Number(porId[l.articulo_id]?.coste_medio || 0), 0)

  const costeBase = costeDe(lineas)
  // En el local se sirve en plato de vidrio: la barra no gasta empaque (el almacén no lo
  // descuenta en ventas de mostrador ni de mesa, ver `_stock_pedido_en_local`).
  const costeLocal = costeDe(lineas.filter(l => !porId[l.articulo_id]?.es_empaque))
  // Los DOS precios: la barra no paga comisión, lo que entra por Pidoo sí. Enseñar
  // uno solo hace que el dueño decida con la mitad de la información.
  // La barra cobra `precio_local ?? precio`, igual que el TPV (Tpv.jsx): un plato sin
  // precio de local se vende en barra al precio de la carta, no "sin precio".
  const pPidoo = Number(producto.precio ?? 0)
  const pBarra = producto.precio_local != null ? Number(producto.precio_local) : (pPidoo > 0 ? pPidoo : null)
  const mBarra = pBarra != null ? pBarra - costeLocal : null
  const mPidoo = pPidoo > 0
    ? (comision == null ? pPidoo : pPidoo * (1 - comision / 100)) - costeBase
    : null
  // El % de ganancia va SOBRE EL COSTE (decisión de Marlon, 14 sep 2026): Acentejo cuesta
  // 2 € y se vende a 5 € → gana 3 € = 150 %. Sin coste no hay % (sería dividir entre 0).
  const sobreCoste = (margen, coste) => (coste > 0 && margen != null
    ? `${Math.round((margen / coste) * 100)} % sobre el coste` : null)

  // Al cambiar de ingrediente se queda el número escrito y se toma la unidad del nuevo:
  // quien pone «30» y corrige el artículo quiere 30 g del nuevo, no la conversión del viejo.
  const cambiarCampo = (l, campo, valor) => campo === 'articulo_id'
    ? { ...l, articulo_id: valor, unidad: porId[valor]?.unidad }
    : { ...l, [campo]: valor }
  function setLinea(i, campo, valor) {
    setLineas(prev => prev.map((l, j) => j === i ? cambiarCampo(l, campo, valor) : l))
  }
  function setLineaPropia(k, i, campo, valor) {
    setPropias(prev => ({
      ...prev,
      [k]: prev[k].map((l, j) => j === i ? cambiarCampo(l, campo, valor) : l),
    }))
  }

  // El atajo para lo que entra y sale igual: crea el artículo con el mismo nombre y
  // su receta de una unidad. Va aquí y no en la lista porque es aquí donde surge la
  // duda: estás mirando una receta vacía.
  async function seVendeTalCual() {
    setMontando(true)
    try {
      await arranqueDesdeCarta(estId, [producto.id])
      toast(`«${producto.nombre}» ya descuenta del almacén: lo tienes también en Artículos de compra`, 'success')
      onGuardado()
    } catch (e) {
      toast(e.message, 'error')
      setMontando(false)
    }
  }

  async function guardar() {
    // Se valida antes de borrar nada: si algo está mal, el escandallo anterior sigue
    // en pie. Borrar primero y fallar después dejaría al plato sin receta.
    // Todas las líneas, también las de los tamaños con receta propia: ninguna se tira sin avisar.
    const conArticulo = [...lineas, ...Object.values(propias).flat()].filter(l => l.articulo_id)
    const aCero = conArticulo.filter(l => base(l) <= 0)
    if (aCero.length) {
      return toast(aCero.some(l => textoAReceta(l.cantidad, unidadDe(l)) > 0)
        ? 'Hay una cantidad demasiado pequeña: lo mínimo es 0,1 g o 0,1 ml.'
        : 'Hay un ingrediente con cantidad 0. Pon cuánto lleva o quítalo.', 'error')
    }
    // La columna admite hasta 9.999.999.999 kg: más que eso haría fallar el guardado a medias.
    if (conArticulo.some(l => base(l) >= 1e10)) {
      return toast('Hay una cantidad demasiado grande. Revísala.', 'error')
    }
    // Menos de 1 g / 1 ml suele ser la costumbre de escribir en kilos, y 5 kg o más un punto
    // de más («12.500»): se pregunta.
    if (conArticulo.some(l => recetaSospechosa(l.cantidad, unidadDe(l))) && !(await confirmar(
      'Hay cantidades raras: menos de 1 g o más de 5 kg.\n\nLas recetas van en gramos y mililitros: 150 g se escribe 150, no 0,15.\n\n¿Guardar así?'
    ))) return
    const limpias = lineas.filter(l => l.articulo_id && base(l) > 0)
    const dup = new Set()
    for (const l of limpias) {
      if (dup.has(l.articulo_id)) return toast('Has puesto el mismo ingrediente dos veces.', 'error')
      dup.add(l.articulo_id)
    }

    setGuardando(true)
    try {
      // Reemplazo completo de la receta del producto. Es una sola transacción lógica
      // por producto y evita tener que casar altas/bajas/modificaciones una a una.
      const del1 = await supabase.from('escandallo_lineas').delete().eq('producto_id', producto.id)
      if (del1.error) throw new Error(del1.error.message)
      const del2 = await supabase.from('escandallo_tamanos').delete().eq('producto_id', producto.id)
      if (del2.error) throw new Error(del2.error.message)

      const filas = limpias.map(l => ({
        establecimiento_id: estId, producto_id: producto.id, tamano_clave: '',
        articulo_id: l.articulo_id, cantidad: base(l),
      }))
      for (const [k, ls] of Object.entries(propias)) {
        for (const l of ls.filter(x => x.articulo_id && base(x) > 0)) {
          filas.push({
            establecimiento_id: estId, producto_id: producto.id, tamano_clave: k,
            articulo_id: l.articulo_id, cantidad: base(l),
          })
        }
      }
      if (filas.length) {
        const ins = await supabase.from('escandallo_lineas').insert(filas)
        if (ins.error) throw new Error(ins.error.message)
      }

      const fs = Object.entries(factores)
        .filter(([k, v]) => k && num(v) > 0 && num(v) !== 1 && !propias[k]?.length)
        .map(([k, v]) => ({
          establecimiento_id: estId, producto_id: producto.id,
          tamano_clave: k, factor: num(v),
        }))
      if (fs.length) {
        const ins2 = await supabase.from('escandallo_tamanos').insert(fs)
        if (ins2.error) throw new Error(ins2.error.message)
      }

      toast('Escandallo guardado', 'success')
      onGuardado()
    } catch (e) {
      toast('No se ha podido guardar: ' + e.message, 'error')
      setGuardando(false)
    }
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={{ ...ds.modalContent, maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...ds.h2, marginBottom: 2 }}>{producto.nombre}</h2>
        <div style={{ ...ds.muted, marginBottom: 18 }}>Escandallo: qué lleva una ración y cuánto te cuesta.</div>

        {cargando ? (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando…</div>
        ) : errorCarga ? (
          <div style={{ padding: '14px 0' }}>
            <div style={{ fontSize: type.sm, color: colors.danger, lineHeight: 1.5 }}>
              No se ha podido cargar la receta ({errorCarga}). Cierra y vuelve a abrirla.
            </div>
            <button onClick={onCerrar} style={{ ...ds.secondaryBtn, marginTop: 12 }}>Cerrar</button>
          </div>
        ) : (
          <>
            <div style={ds.label}>Ingredientes de una ración · en g, ml o ud</div>
            {lineas.map((l, i) => (
              <FilaIngrediente key={i} linea={l} articulos={articulos} porId={porId} baseDe={base}
                onCambio={(c, v) => setLinea(i, c, v)}
                onQuitar={() => setLineas(prev => prev.filter((_, j) => j !== i))} />
            ))}
            {!lineas.length && (
              <div style={{
                padding: '14px 16px', borderRadius: radius.sm, marginTop: 4,
                border: `1px solid ${colors.border}`, background: colors.surface2,
              }}>
                <div style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.6 }}>
                  Todavía no lleva nada. Añade abajo los artículos que le echas a una ración: la carne, el pan, el queso.
                </div>
                <div style={{ ...ds.muted, marginTop: 10, lineHeight: 1.6 }}>
                  ¿Es de los que compras y vendes igual, como una lata o un agua? Entonces
                  no hace falta receta: te lo damos de alta también como artículo y listo.
                </div>
                <button onClick={seVendeTalCual} disabled={montando} style={{
                  ...ds.secondaryBtn, marginTop: 10, opacity: montando ? 0.5 : 1,
                }}>
                  <Wand2 size={14} /> {montando ? 'Dándolo de alta…' : 'Se vende tal cual'}
                </button>
              </div>
            )}
            <button onClick={() => setLineas([...lineas, { articulo_id: '', cantidad: '' }])}
              style={{ ...ds.miniBtn, marginTop: 8 }}>
              <Plus size={12} /> Añadir ingrediente
            </button>

            <div style={{
              marginTop: 18, padding: '12px 14px', borderRadius: radius.sm,
              background: colors.surface2, border: `1px solid ${colors.border}`,
              display: 'flex', gap: 22, flexWrap: 'wrap',
            }}>
              <Cifra label="Te cuesta" valor={eur(costeBase)}
                nota={costeLocal !== costeBase ? `en el local, sin empaque: ${eur(costeLocal)}` : null} />
              <Cifra label="En barra te queda"
                valor={pBarra == null ? '—' : eur(mBarra)}
                porcentaje={pBarra == null ? null : sobreCoste(mBarra, costeLocal)}
                nota={pBarra == null ? 'sin precio' : `vendes a ${eur(pBarra)}`}
                tono={mBarra != null && mBarra < 0 ? 'danger' : 'ok'} />
              <Cifra label="Por Pidoo te queda"
                valor={pPidoo > 0 ? eur(mPidoo) : '—'}
                porcentaje={pPidoo > 0 ? sobreCoste(mPidoo, costeBase) : null}
                nota={pPidoo > 0
                  ? `vendes a ${eur(pPidoo)}${comision == null ? ' · sin descontar comisión'
                      : comision > 0 ? ` − ${comision} % comisión` : ''}`
                  : 'sin precio'}
                tono={mPidoo != null && mPidoo < 0 ? 'danger' : 'ok'} />
            </div>
            {costeBase === 0 && lineas.length > 0 && (
              <div style={{ ...ds.muted, marginTop: 8, lineHeight: 1.5 }}>
                Te cuesta 0 € porque esos artículos todavía no tienen precio de coste.
                El precio entra solo cuando metes la primera factura en Compras, o se lo
                pones tú en un recuento.
              </div>
            )}

            {tamanos.length > 0 && (
              <>
                <div style={{ ...ds.label, marginTop: 22 }}>Tamaños</div>
                <div style={{ ...ds.muted, marginBottom: 10, lineHeight: 1.5 }}>
                  Lo normal es que un tamaño lleve lo mismo pero en otra proporción.
                  Pon cuántas veces la receta de arriba: doble = 2, mediano = 0,7.
                </div>
                {tamanos.map(t => {
                  const k = clave(t.nombre)
                  const tienePropia = !!propias[k]?.length
                  const precioT = Number(t.precio_local ?? t.precio ?? 0)  // barra, o el de app si no hay
                  const costeT = tienePropia ? costeDe(propias[k]) : costeBase * (num(factores[k]) || 1)
                  return (
                    <div key={t.id} style={{
                      border: `1px solid ${colors.border}`, borderRadius: radius.sm,
                      padding: '10px 12px', marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 120, fontSize: type.sm, fontWeight: 600 }}>
                          {t.nombre}
                        </div>
                        {!tienePropia && (
                          <input inputMode="decimal" value={factores[k] ?? '1'}
                            onChange={e => setFactores({ ...factores, [k]: e.target.value.replace(/[^\d.,]/g, '') })}
                            style={{ ...ds.input, width: 80, height: 32, textAlign: 'right' }} />
                        )}
                        <div style={{ width: 150, textAlign: 'right', ...ds.muted }}>
                          {eur(costeT)} → {eur(precioT)}
                        </div>
                      </div>

                      <button onClick={() => {
                        if (tienePropia && abierta !== k) { setAbierta(k); return }
                        if (!tienePropia) { setPropias({ ...propias, [k]: [{ articulo_id: '', cantidad: '' }] }); setAbierta(k) }
                        else setAbierta(abierta === k ? null : k)
                      }} style={{
                        background: 'none', border: 'none', padding: '6px 0 0', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: type.xs, color: colors.primary, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {tienePropia
                          ? <>Este tamaño lleva otra cosa {abierta === k ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</>
                          : <>Este tamaño lleva otra cosa <ChevronDown size={12} /></>}
                      </button>

                      {abierta === k && propias[k] && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${colors.border}` }}>
                          {propias[k].map((l, i) => (
                            <FilaIngrediente key={i} linea={l} articulos={articulos} porId={porId} baseDe={base}
                              onCambio={(c, v) => setLineaPropia(k, i, c, v)}
                              onQuitar={() => setPropias({ ...propias, [k]: propias[k].filter((_, j) => j !== i) })} />
                          ))}
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button onClick={() => setPropias({ ...propias, [k]: [...propias[k], { articulo_id: '', cantidad: '' }] })}
                              style={ds.miniBtn}><Plus size={12} /> Ingrediente</button>
                            <button onClick={() => { const p = { ...propias }; delete p[k]; setPropias(p); setAbierta(null) }}
                              style={ds.miniBtn}>Volver a la proporción</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
              <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
              <button onClick={guardar} disabled={guardando} style={{
                ...ds.primaryBtn, opacity: guardando ? 0.5 : 1,
              }}>
                {guardando ? 'Guardando…' : 'Guardar escandallo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FilaIngrediente({ linea, articulos, porId, baseDe, onCambio, onQuitar }) {
  const art = porId[linea.articulo_id]
  const unidad = linea.unidad ?? art?.unidad
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
      <select value={linea.articulo_id} onChange={e => onCambio('articulo_id', e.target.value)}
        style={{ ...ds.select, flex: 1, height: 36 }}>
        <option value="">— Elige de tus artículos —</option>
        {articulos.filter(a => a.activo).map(a => (
          <option key={a.id} value={a.id}>{a.nombre}</option>
        ))}
      </select>
      <input inputMode="decimal" value={linea.cantidad} placeholder="0"
        onChange={e => onCambio('cantidad', e.target.value.replace(/[^\d.,]/g, ''))}
        style={{ ...ds.input, width: 90, height: 36, textAlign: 'right' }} />
      <div style={{ width: 34, ...ds.muted }}>{unidadReceta(unidad)}</div>
      <div style={{ width: 76, textAlign: 'right', ...ds.muted, fontVariantNumeric: 'tabular-nums' }}>
        {art ? eur(baseDe(linea) * Number(art.coste_medio)) : ''}
      </div>
      <button onClick={onQuitar} style={{ ...ds.miniBtn, width: 28, padding: 0 }} aria-label="Quitar">
        <X size={12} />
      </button>
    </div>
  )
}

function Cifra({ label, valor, tono, nota, porcentaje }) {
  const color = tono === 'danger' ? colors.danger : tono === 'ok' ? colors.sage2 : colors.text
  return (
    <div>
      <div style={{ ...ds.label, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: type.lg, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color }}>{valor}</div>
        {porcentaje && (
          <div style={{ fontSize: type.sm, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color }}>
            {porcentaje}
          </div>
        )}
      </div>
      {nota && <div style={{ ...ds.muted, marginTop: 1 }}>{nota}</div>}
    </div>
  )
}
