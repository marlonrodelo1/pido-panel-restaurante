import { useState, useEffect } from 'react'
import { Plus, X, TriangleAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type, col } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import { eur, UNIDADES, contabilizarFactura, descontabilizarFactura } from '../../lib/stock'

// El albarán: qué te ha traído el proveedor y a qué precio.
//
// Mientras es BORRADOR no mueve nada del almacén. «Contabilizar» es el botón que hace
// entrar la mercancía y recalcula el coste medio. Una factura ya contabilizada no se
// puede tocar (PD240): primero se descontabiliza, que apunta los movimientos contrarios.
//
// El total del papel se teclea aparte de las líneas a propósito: si no cuadran, hay
// una línea de menos o un precio mal puesto, y eso vale más que un campo calculado.
export default function FacturaEditor({ estId, factura, articulos, proveedores, onCerrar, onGuardado }) {
  const nueva = !factura
  const bloqueada = !!factura?.contabilizada

  const [cab, setCab] = useState({
    proveedor_id: factura?.proveedor_id || '',
    numero: factura?.numero || '',
    fecha: factura?.fecha || new Date().toISOString().slice(0, 10),
    total: factura?.total != null ? String(factura.total).replace('.', ',') : '',
    notas: factura?.notas || '',
  })
  const [lineas, setLineas] = useState([])
  const [nuevoProv, setNuevoProv] = useState('')
  const [cargando, setCargando] = useState(!nueva)
  const [guardando, setGuardando] = useState(false)
  // Artículos dados de alta desde la propia factura. Van aparte del prop `articulos`
  // —que solo se recarga al cerrar el albarán— para que aparezcan en los desplegables
  // sin salir de aquí. No se muta el prop: eso es lo que hace `crearProveedor` y
  // funciona de milagro, porque no dispara render por sí solo.
  const [nuevosArt, setNuevosArt] = useState([])
  const [creando, setCreando] = useState(null)      // { linea, nombre, unidad }
  const [creandoArt, setCreandoArt] = useState(false)

  // Los archivados no se ofrecen (no se compra lo que ya no se usa), pero los recién
  // creados sí, aunque el prop todavía no los tenga.
  const listaArticulos = [...new Map(
    [...articulos.filter(a => a.activo), ...nuevosArt].map(a => [a.id, a])
  ).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  useEffect(() => {
    if (nueva) { setLineas([{ articulo_id: '', cantidad: '', factor: '1', precio_unitario: '' }]); return }
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('stock_factura_lineas')
        .select('*').eq('factura_id', factura.id).order('orden')
      if (!vivo) return
      setLineas((data || []).map(l => ({
        articulo_id: l.articulo_id,
        cantidad: String(l.cantidad).replace('.', ','),
        factor: String(l.factor).replace('.', ','),
        precio_unitario: String(l.precio_unitario).replace('.', ','),
      })))
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [factura?.id, nueva])

  const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0
  const sumaLineas = lineas.reduce((s, l) => s + num(l.cantidad) * num(l.precio_unitario), 0)
  const totalPapel = num(cab.total)
  const descuadre = totalPapel > 0 && Math.abs(totalPapel - sumaLineas) >= 0.01

  const setLinea = (i, c, v) => setLineas(prev => prev.map((l, j) => j === i ? { ...l, [c]: v } : l))

  async function crearProveedor() {
    const nombre = nuevoProv.trim()
    if (!nombre) return
    const { data, error } = await supabase.from('stock_proveedores')
      .insert({ establecimiento_id: estId, nombre }).select().single()
    if (error) return toast('No se ha podido crear el proveedor: ' + error.message, 'error')
    proveedores.push(data)
    setCab({ ...cab, proveedor_id: data.id })
    setNuevoProv('')
    toast('Proveedor creado', 'success')
  }

  // Alta de artículo sin salir del albarán.
  //
  // La factura es JUSTO donde el dueño descubre que le falta un artículo: lo está
  // leyendo del papel. Mandarle a otra pestaña a crearlo le hacía perder la línea a
  // medias, y encima el artículo nacía sin coste. Creado aquí, la propia línea le pone
  // el precio real al contabilizar.
  //
  // Solo se piden nombre y unidad: lo demás (familia, mínimo, si agota la carta) tiene
  // valores por defecto sensatos y se retoca en Artículos cuando haga falta.
  async function crearArticulo() {
    const nombre = (creando?.nombre || '').trim()
    if (!nombre || creandoArt) return

    // El índice único es (establecimiento_id, lower(btrim(nombre))). Se comprueba antes
    // contra la lista que ya tenemos —incluye los archivados— para no dejarle en un
    // callejón sin salida con un 23505 que no sabe qué significa.
    const repe = [...articulos, ...nuevosArt].find(
      a => a.nombre.trim().toLowerCase() === nombre.toLowerCase())
    if (repe) {
      setNuevosArt(prev => prev.some(a => a.id === repe.id) ? prev : [...prev, repe])
      setLinea(creando.linea, 'articulo_id', repe.id)
      setCreando(null)
      return toast(`Ya tenías «${repe.nombre}»: lo he puesto en la línea.`, 'success')
    }

    setCreandoArt(true)
    const { data, error } = await supabase.from('stock_articulos')
      .insert({ establecimiento_id: estId, nombre, unidad: creando.unidad })
      .select().single()
    setCreandoArt(false)
    if (error) {
      return toast(
        error.code === '23505'
          ? 'Ya tienes un artículo con ese nombre.'
          : 'No se ha podido crear: ' + error.message,
        'error')
    }

    setNuevosArt(prev => [...prev, data])
    setLinea(creando.linea, 'articulo_id', data.id)
    setCreando(null)
    toast('Artículo creado. Ponle ahora cuántas y a qué precio.', 'success')
  }

  async function guardar() {
    const limpias = lineas.filter(l => l.articulo_id && num(l.cantidad) > 0)
    if (!limpias.length) return toast('Añade al menos una línea: elige el artículo y pon la cantidad.', 'error')
    if (cab.fecha > new Date().toISOString().slice(0, 10)) {
      return toast('La fecha de la factura no puede estar en el futuro.', 'error')
    }

    setGuardando(true)
    try {
      const cabecera = {
        proveedor_id: cab.proveedor_id || null,
        numero: cab.numero.trim() || null,
        fecha: cab.fecha,
        total: totalPapel || Math.round(sumaLineas * 100) / 100,
        notas: cab.notas.trim() || null,
      }
      let id = factura?.id
      if (nueva) {
        const { data, error } = await supabase.from('stock_facturas')
          .insert({ ...cabecera, establecimiento_id: estId }).select().single()
        if (error) throw new Error(error.message)
        id = data.id
      } else {
        const { error } = await supabase.from('stock_facturas').update(cabecera).eq('id', id)
        if (error) throw new Error(error.message)
        const del = await supabase.from('stock_factura_lineas').delete().eq('factura_id', id)
        if (del.error) throw new Error(del.error.message)
      }

      const filas = limpias.map((l, i) => ({
        factura_id: id,
        articulo_id: l.articulo_id,
        cantidad: num(l.cantidad),
        factor: num(l.factor) || 1,
        precio_unitario: num(l.precio_unitario),
        orden: i,
      }))
      const ins = await supabase.from('stock_factura_lineas').insert(filas)
      if (ins.error) throw new Error(ins.error.message)

      toast('Borrador guardado. Para que entre en el almacén, pulsa Contabilizar.', 'success')
      onGuardado()
    } catch (e) {
      toast('No se ha podido guardar: ' + e.message, 'error')
      setGuardando(false)
    }
  }

  async function contabilizar() {
    if (!(await confirmar(
      'Al contabilizar, esta mercancía entra en tu almacén y cada artículo se queda con ' +
      'el precio que has pagado en esta factura.\n\nDespués no podrás editar la factura sin descontabilizarla antes.'
    ))) return
    setGuardando(true)
    try {
      await contabilizarFactura(factura.id)
      toast('Factura contabilizada. La mercancía está en el almacén y los costes ya están al día.', 'success')
      onGuardado()
    } catch (e) { toast(e.message, 'error'); setGuardando(false) }
  }

  async function descontabilizar() {
    if (!(await confirmar(
      'Se van a apuntar los movimientos contrarios y la mercancía saldrá del almacén.\n\n' +
      'Ojo: se deshace la cantidad, pero lo que ya has calculado que te cuesta el ' +
      'artículo no vuelve atrás — se corregirá solo con la siguiente compra.'
    ))) return
    setGuardando(true)
    try {
      await descontabilizarFactura(factura.id)
      toast('Factura descontabilizada. La mercancía ha salido del almacén.', 'success')
      onGuardado()
    } catch (e) { toast(e.message, 'error'); setGuardando(false) }
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={{ ...ds.modalContent, maxWidth: 940 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...ds.h2, marginBottom: 2 }}>
          {nueva ? 'Nueva factura de compra' : bloqueada ? 'Factura contabilizada' : 'Factura (borrador)'}
        </h2>
        <div style={{ ...ds.muted, marginBottom: 18 }}>
          {bloqueada
            ? 'Esta mercancía ya está en tu almacén. Para cambiarla, descontabilízala primero.'
            : 'Todavía no ha entrado nada en el almacén ni ha cambiado ningún coste. Eso pasa al contabilizarla.'}
        </div>

        {cargando ? (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando…</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 220px' }}>
                <label style={ds.label}>Proveedor</label>
                {/* Un desplegable con una sola opcion vacia no ayuda a nadie: si
                    todavia no tiene proveedores, se le pide el nombre directamente. */}
                {proveedores.length ? (
                  <select value={cab.proveedor_id} disabled={bloqueada}
                    onChange={e => setCab({ ...cab, proveedor_id: e.target.value })}
                    style={ds.select}>
                    <option value="">— Sin proveedor —</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={nuevoProv} disabled={bloqueada}
                      onChange={e => setNuevoProv(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crearProveedor() } }}
                      placeholder="Makro, Coca-Cola, el panadero…"
                      style={{ ...ds.formInput, flex: 1 }} />
                    <button onClick={crearProveedor} disabled={!nuevoProv.trim() || bloqueada}
                      style={{ ...ds.secondaryBtn, flexShrink: 0,
                        opacity: nuevoProv.trim() ? 1 : 0.5 }}>Crear</button>
                  </div>
                )}
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={ds.label}>Número</label>
                <input value={cab.numero} disabled={bloqueada}
                  onChange={e => setCab({ ...cab, numero: e.target.value })}
                  placeholder="A-1234" style={ds.formInput} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label style={ds.label}>Fecha</label>
                <input type="date" value={cab.fecha} disabled={bloqueada}
                  onChange={e => setCab({ ...cab, fecha: e.target.value })}
                  style={ds.formInput} />
              </div>
            </div>

            {!bloqueada && proveedores.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input value={nuevoProv} onChange={e => setNuevoProv(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crearProveedor() } }}
                  placeholder="…o escribe uno nuevo" style={{ ...ds.input, height: 32, flex: 1 }} />
                <button onClick={crearProveedor} disabled={!nuevoProv.trim()} style={{
                  ...ds.miniBtn, flexShrink: 0, opacity: nuevoProv.trim() ? 1 : 0.5,
                }}>Crear</button>
              </div>
            )}

            <div style={{ ...ds.label, marginTop: 20 }}>Qué te han traído</div>
            <div style={{ ...ds.muted, marginBottom: 8, lineHeight: 1.5 }}>
              «Cuántas» es en la unidad en la que compras (cajas, packs…). «Contiene» es
              cuántas unidades sueltas trae cada una: una caja de 6 botellas es 6.
            </div>

            {/* OJO: `ds.label` lleva `display: block`. Si va DESPUES de `display: flex`
                lo pisa y las cabeceras se apilan en vertical. El display va al final. */}
            <div style={{ ...ds.label, marginBottom: 6, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>Artículo</div>
              <div style={col(78)}>Cuántas</div>
              <div style={col(78)}>Contiene</div>
              <div style={col(92)}>Precio ud.</div>
              <div style={col(88)}>Importe</div>
              <div style={col(30)} />
            </div>

            {lineas.map((l, i) => (
              <div key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                {/* La última opción no elige nada: abre el alta ahí mismo. El `value`
                    sigue atado a `articulo_id`, así que al volver de crear el
                    desplegable ya enseña el artículo nuevo. */}
                <select value={l.articulo_id} disabled={bloqueada}
                  onChange={e => {
                    if (e.target.value === '__nuevo__') {
                      setCreando({ linea: i, nombre: '', unidad: 'ud' })
                      return
                    }
                    // Si estaba creando uno para esta línea y al final elige otro de la
                    // lista, el panel abierto sobra.
                    if (creando && creando.linea === i) setCreando(null)
                    setLinea(i, 'articulo_id', e.target.value)
                  }}
                  style={{ ...ds.select, flex: 1, minWidth: 0, height: 34 }}>
                  <option value="">— Elige artículo —</option>
                  {listaArticulos.map(a => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                  {!bloqueada && <option value="__nuevo__">+ Crear un artículo nuevo…</option>}
                </select>
                <input inputMode="decimal" value={l.cantidad} disabled={bloqueada} placeholder="0"
                  onChange={e => setLinea(i, 'cantidad', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, ...col(78), height: 34 }} />
                <input inputMode="decimal" value={l.factor} disabled={bloqueada} placeholder="1"
                  onChange={e => setLinea(i, 'factor', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, ...col(78), height: 34 }} />
                <input inputMode="decimal" value={l.precio_unitario} disabled={bloqueada} placeholder="0,00"
                  onChange={e => setLinea(i, 'precio_unitario', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, ...col(92), height: 34 }} />
                <div style={{ ...col(88), ...ds.muted, alignSelf: 'center' }}>
                  {eur(num(l.cantidad) * num(l.precio_unitario))}
                </div>
                {/* `creando.linea` es un ÍNDICE: si se borra una línea de encima, el
                    panel abierto pasaría a colgar de otra y el artículo nuevo caería en
                    la línea equivocada. Se cierra o se recoloca al borrar. */}
                <button onClick={() => {
                    setLineas(lineas.filter((_, j) => j !== i))
                    setCreando(c => !c ? c
                      : c.linea === i ? null
                      : c.linea > i ? { ...c, linea: c.linea - 1 } : c)
                  }}
                  disabled={bloqueada}
                  style={{ ...ds.miniBtn, ...col(30), padding: 0, height: 34, opacity: bloqueada ? 0.4 : 1 }}
                  aria-label="Quitar línea">
                  <X size={12} />
                </button>
              </div>

              {creando && creando.linea === i && (
                <div style={{
                  display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
                  margin: '0 0 10px', padding: '12px 14px', borderRadius: radius.sm,
                  border: `1px solid ${colors.primary}`, background: colors.surface2,
                }}>
                  <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                    <label style={ds.label}>Cómo se llama</label>
                    <input autoFocus value={creando.nombre}
                      onChange={e => setCreando({ ...creando, nombre: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crearArticulo() } }}
                      placeholder="Carne picada, Pan de hamburguesa, Coca-Cola lata…"
                      style={{ ...ds.input, height: 34 }} />
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <label style={ds.label}>Cómo lo mides</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {UNIDADES.map(u => (
                        <button key={u.id} onClick={() => setCreando({ ...creando, unidad: u.id })}
                          style={{
                            ...ds.filterBtn, height: 34, flex: 1, justifyContent: 'center',
                            background: creando.unidad === u.id ? colors.primary : colors.paper,
                            color: creando.unidad === u.id ? colors.cream : colors.textDim,
                            borderColor: creando.unidad === u.id ? colors.primary : colors.border,
                            fontWeight: creando.unidad === u.id ? 700 : 600,
                          }}>{u.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => setCreando(null)} style={{ ...ds.miniBtn, height: 34 }}>
                      Cancelar
                    </button>
                    <button onClick={crearArticulo}
                      disabled={!creando.nombre.trim() || creandoArt}
                      style={{
                        ...ds.miniBtn, height: 34,
                        background: colors.primary, borderColor: colors.primary, color: colors.cream,
                        opacity: (!creando.nombre.trim() || creandoArt) ? 0.5 : 1,
                      }}>
                      {creandoArt ? 'Creando…' : 'Crear y usarlo'}
                    </button>
                  </div>
                  <div style={{ ...ds.muted, flexBasis: '100%', lineHeight: 1.5 }}>
                    Con el nombre y la unidad basta. Se queda creado en tu almacén y el
                    precio se lo pone esta misma línea al contabilizar la factura.
                  </div>
                </div>
              )}
              </div>
            ))}

            {!bloqueada && (
              <button onClick={() => setLineas([...lineas, { articulo_id: '', cantidad: '', factor: '1', precio_unitario: '' }])}
                style={{ ...ds.miniBtn, marginTop: 4 }}>
                <Plus size={12} /> Añadir línea
              </button>
            )}

            <div style={{
              marginTop: 20, padding: '14px 16px', borderRadius: radius.sm,
              background: colors.surface2, border: `1px solid ${colors.border}`,
              display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ ...ds.label, marginBottom: 2 }}>Suma de las líneas</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: colors.text, lineHeight: 1.2 }}>
                  {eur(sumaLineas)}
                </div>
              </div>
              <div style={{ width: 150, flexShrink: 0 }}>
                <label style={ds.label}>Total del papel</label>
                <input inputMode="decimal" value={cab.total} disabled={bloqueada} placeholder="0,00"
                  onChange={e => setCab({ ...cab, total: e.target.value.replace(/[^\d.,]/g, '') })}
                  style={{ ...ds.formInput, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
              </div>
            </div>

            {descuadre && (
              <div style={{
                display: 'flex', gap: 8, marginTop: 10, padding: '10px 12px',
                borderRadius: radius.sm, border: `1px solid ${colors.warning}`,
                background: colors.warningSoft, fontSize: type.sm, lineHeight: 1.5,
              }}>
                <TriangleAlert size={15} color={colors.warning} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  Las líneas suman <strong>{eur(sumaLineas)}</strong> y el papel pone{' '}
                  <strong>{eur(totalPapel)}</strong>. Puede ser el IGIC, un portes, o una
                  línea que falta. Puedes guardarla igual: quien manda en el almacén son
                  las líneas.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 22, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {bloqueada && (
                  <button onClick={descontabilizar} disabled={guardando} style={ds.miniBtnDanger}>
                    Descontabilizar
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={onCerrar} style={ds.secondaryBtn}>Cerrar</button>
                {!bloqueada && (
                  <button onClick={guardar} disabled={guardando} style={{
                    ...ds.secondaryBtn, opacity: guardando ? 0.5 : 1,
                  }}>
                    {guardando ? 'Guardando…' : 'Guardar borrador'}
                  </button>
                )}
                {!nueva && !bloqueada && (
                  <button onClick={contabilizar} disabled={guardando} style={{
                    ...ds.primaryBtn, opacity: guardando ? 0.5 : 1,
                  }}>
                    Contabilizar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
