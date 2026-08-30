import { useState, useEffect } from 'react'
import { Plus, X, TriangleAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import { eur, contabilizarFactura, descontabilizarFactura } from '../../lib/stock'

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
    if (error) return toast('No se pudo crear: ' + error.message, 'error')
    proveedores.push(data)
    setCab({ ...cab, proveedor_id: data.id })
    setNuevoProv('')
    toast('Proveedor creado', 'success')
  }

  async function guardar() {
    const limpias = lineas.filter(l => l.articulo_id && num(l.cantidad) > 0)
    if (!limpias.length) return toast('Añade al menos una línea con artículo y cantidad.', 'error')
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

      toast('Factura guardada', 'success')
      onGuardado()
    } catch (e) {
      toast('No se ha podido guardar: ' + e.message, 'error')
      setGuardando(false)
    }
  }

  async function contabilizar() {
    if (!(await confirmar(
      'Al contabilizar, esta mercancía entra en tu almacén y se recalcula lo que te ' +
      'cuesta cada artículo.\n\nDespués no podrás editar la factura sin descontabilizarla antes.'
    ))) return
    setGuardando(true)
    try {
      await contabilizarFactura(factura.id)
      toast('Factura contabilizada. La mercancía ya está en el almacén.', 'success')
      onGuardado()
    } catch (e) { toast(e.message, 'error'); setGuardando(false) }
  }

  async function descontabilizar() {
    if (!(await confirmar(
      'Se van a apuntar los movimientos contrarios y la mercancía saldrá del almacén.\n\n' +
      'Ojo: se deshace la cantidad, pero el coste medio ya calculado no vuelve atrás — ' +
      'se corregirá solo con la siguiente compra real.'
    ))) return
    setGuardando(true)
    try {
      await descontabilizarFactura(factura.id)
      toast('Factura descontabilizada', 'success')
      onGuardado()
    } catch (e) { toast(e.message, 'error'); setGuardando(false) }
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={{ ...ds.modalContent, maxWidth: 780 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...ds.h2, marginBottom: 2 }}>
          {nueva ? 'Nueva factura de compra' : bloqueada ? 'Factura contabilizada' : 'Factura (borrador)'}
        </h2>
        <div style={{ ...ds.muted, marginBottom: 18 }}>
          {bloqueada
            ? 'Esta mercancía ya está en tu almacén. Para cambiarla, descontabilízala primero.'
            : 'Todavía no ha entrado nada en el almacén. Eso pasa al contabilizarla.'}
        </div>

        {cargando ? (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando…</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 220px' }}>
                <label style={ds.label}>Proveedor</label>
                <select value={cab.proveedor_id} disabled={bloqueada}
                  onChange={e => setCab({ ...cab, proveedor_id: e.target.value })}
                  style={ds.select}>
                  <option value="">— Sin proveedor —</option>
                  {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
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

            {!bloqueada && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input value={nuevoProv} onChange={e => setNuevoProv(e.target.value)}
                    placeholder="…o escribe un proveedor nuevo" style={{ ...ds.input, height: 32 }} />
                </div>
                <button onClick={crearProveedor} disabled={!nuevoProv.trim()} style={{
                  ...ds.miniBtn, opacity: nuevoProv.trim() ? 1 : 0.5,
                }}>Crear</button>
              </div>
            )}

            <div style={{ ...ds.label, marginTop: 20 }}>Qué te han traído</div>
            <div style={{ ...ds.muted, marginBottom: 8, lineHeight: 1.5 }}>
              «Cuántas» es en la unidad en la que compras (cajas, packs…). «Contiene» es
              cuántas unidades de almacén trae cada una: una caja de 6 botellas es 6.
            </div>

            <div style={{ display: 'flex', gap: 8, ...ds.label, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>Artículo</div>
              <div style={{ width: 78, textAlign: 'right' }}>Cuántas</div>
              <div style={{ width: 78, textAlign: 'right' }}>Contiene</div>
              <div style={{ width: 90, textAlign: 'right' }}>Precio ud.</div>
              <div style={{ width: 84, textAlign: 'right' }}>Importe</div>
              <div style={{ width: 28 }} />
            </div>

            {lineas.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <select value={l.articulo_id} disabled={bloqueada}
                  onChange={e => setLinea(i, 'articulo_id', e.target.value)}
                  style={{ ...ds.select, flex: 1, height: 34 }}>
                  <option value="">— Elige —</option>
                  {articulos.filter(a => a.activo).map(a => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                </select>
                <input inputMode="decimal" value={l.cantidad} disabled={bloqueada} placeholder="0"
                  onChange={e => setLinea(i, 'cantidad', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, width: 78, height: 34, textAlign: 'right' }} />
                <input inputMode="decimal" value={l.factor} disabled={bloqueada} placeholder="1"
                  onChange={e => setLinea(i, 'factor', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, width: 78, height: 34, textAlign: 'right' }} />
                <input inputMode="decimal" value={l.precio_unitario} disabled={bloqueada} placeholder="0,00"
                  onChange={e => setLinea(i, 'precio_unitario', e.target.value.replace(/[^\d.,]/g, ''))}
                  style={{ ...ds.input, width: 90, height: 34, textAlign: 'right' }} />
                <div style={{ width: 84, textAlign: 'right', ...ds.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {eur(num(l.cantidad) * num(l.precio_unitario))}
                </div>
                <button onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                  disabled={bloqueada} style={{ ...ds.miniBtn, width: 28, padding: 0, opacity: bloqueada ? 0.4 : 1 }}
                  aria-label="Quitar línea">
                  <X size={12} />
                </button>
              </div>
            ))}

            {!bloqueada && (
              <button onClick={() => setLineas([...lineas, { articulo_id: '', cantidad: '', factor: '1', precio_unitario: '' }])}
                style={{ ...ds.miniBtn, marginTop: 4 }}>
                <Plus size={12} /> Añadir línea
              </button>
            )}

            <div style={{
              marginTop: 18, padding: '12px 14px', borderRadius: radius.sm,
              background: colors.surface2, border: `1px solid ${colors.border}`,
              display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ ...ds.label, marginBottom: 2 }}>Suma de las líneas</div>
                <div style={{ fontSize: type.lg, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {eur(sumaLineas)}
                </div>
              </div>
              <div style={{ width: 140 }}>
                <label style={ds.label}>Total del papel</label>
                <input inputMode="decimal" value={cab.total} disabled={bloqueada} placeholder="0,00"
                  onChange={e => setCab({ ...cab, total: e.target.value.replace(/[^\d.,]/g, '') })}
                  style={{ ...ds.formInput, textAlign: 'right' }} />
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
