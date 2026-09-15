import { useState, useEffect } from 'react'
import { Plus, X, TriangleAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type, col } from '../../lib/uiStyles'
import { toast, confirmar } from '../../App'
import {
  eur, UNIDADES, contabilizarFactura, descontabilizarFactura,
  marcarPagado, textoCajon, hoyCanariasIso, fechaLarga,
} from '../../lib/stock'

// El albarán: qué te ha traído el proveedor y a qué precio.
//
// Mientras es BORRADOR no mueve nada del almacén. «Contabilizar» es el botón que hace
// entrar la mercancía y recalcula el coste medio. Una factura ya contabilizada no se
// puede tocar (PD240): primero se descontabiliza, que apunta los movimientos contrarios.
//
// El total del papel se teclea aparte de las líneas a propósito: si no cuadran, hay
// una línea de menos o un precio mal puesto, y eso vale más que un campo calculado.
//
// «¿Con qué la pagaste?» (15 sep 2026): lo normal es la caja mayor. Un BORRADOR no mueve
// dinero: el pago cuenta al contabilizar, igual que la mercancía. Si fue con el dinero del
// cajón, sale de la caja abierta del TPV, y por eso «Cajón del TPV» solo se ofrece con la
// caja abierta y para facturas de hoy: la caja de otro día ya se contó. Las compras rápidas
// no se descontabilizan aquí: se deshacen en «El día».
//
// OJO con la DESCONTABILIZADA: vuelve a ser borrador, pero conserva el pago de la primera vez
// (`pagado_at`, y la salida del cajón si la hubo). Ese pago sigue contando en Tu dinero y al
// contabilizarla otra vez no resta de nuevo. Por eso «el pago cuenta al contabilizar» solo se
// dice de un borrador que nunca se ha contabilizado.
//
// Contabilizar y apuntar el pago son DOS llamadas. La primera no se deshace si la segunda
// falla, así que lo del cajón se comprueba antes, y si aun así falla el pago, la factura se
// queda sin «con qué» (sale «¿Con qué?» en El día) en vez de decir que se pagó con algo
// que no se ha apuntado. Salvo que ese pago ya contara la primera vez (o saliera del cajón):
// entonces está bien apuntado y no se toca.

// Cómo se dice en el aviso con qué quedó pagada.
const PAGADA_CON = {
  caja_mayor: 'con la caja mayor',
  banco: 'por banco',
  caja: 'con el cajón del TPV',
}

export default function FacturaEditor({ estId, factura, articulos, proveedores, onCerrar, onGuardado }) {
  const nueva = !factura
  const bloqueada = !!factura?.contabilizada
  const rapida = factura?.origen === 'rapida'

  const [cab, setCab] = useState({
    proveedor_id: factura?.proveedor_id || '',
    numero: factura?.numero || '',
    fecha: factura?.fecha || hoyCanariasIso(),
    total: factura?.total != null ? String(factura.total).replace('.', ',') : '',
    notas: factura?.notas || '',
    pagado_con: factura?.pagado_con || '',
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
  // ¿Tiene el TPV la caja abierta? null mientras se mira. Si la consulta falla se queda en
  // false: mejor no ofrecer el cajón que ofrecer un pago que la base de datos va a rechazar.
  const [cajaAbierta, setCajaAbierta] = useState(null)
  // Contabilizada, pero el pago no se pudo apuntar: se avisa con calma, no con un toast de 3 s.
  const [avisoPago, setAvisoPago] = useState(null)

  const hoy = hoyCanariasIso()
  // La factura ya sacó dinero del cajón del TPV (tiene su salida enlazada). Entonces «con qué
  // la pagaste» no se cambia con un UPDATE a pelo: la base de datos lo corta (PD277) y, aunque
  // no lo cortara, la salida seguiría en el cajón y el mismo pago saldría dos veces.
  const conSalidaCajon = !nueva && !!factura?.caja_movimiento_id
  // «Cajón del TPV» solo con la caja del TPV abierta y para pagos de hoy. `cajonNoVale` es
  // la respuesta ya sabida; mientras se mira el TPV tampoco se ofrece, pero no se acusa.
  const cajonNoVale = !conSalidaCajon && (cab.fecha !== hoy || cajaAbierta === false)
  const motivoSinCajon = conSalidaCajon ? null
    : cab.fecha !== hoy ? 'Solo para pagos de hoy'
      : cajaAbierta === null ? 'Mirando el TPV…'
        : !cajaAbierta ? 'El TPV no tiene la caja abierta' : null
  // El pago ya contó la primera vez que se contabilizó (lo guardado, no lo del formulario).
  const pagoContadoAntes = !nueva && (!!factura?.pagado_at || conSalidaCajon)
  // …y sigue siendo el mismo: al contabilizarla otra vez no se vuelve a restar.
  const pagoYaContado = pagoContadoAntes && (cab.pagado_con || null) === (factura?.pagado_con || null)

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

  useEffect(() => {
    if (!estId) return
    let vivo = true
    supabase.rpc('tpv_estado_caja', { p_establecimiento_id: estId })
      .then(({ data }) => { if (vivo) setCajaAbierta(!!data?.abierta) })
    return () => { vivo = false }
  }, [estId])

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
    if (cab.fecha > hoyCanariasIso()) {
      return toast('La fecha de la factura no puede estar en el futuro.', 'error')
    }
    // Guardarla con el cajón cuando no vale solo sirve para que falle al contabilizar.
    if (cab.pagado_con === 'caja' && motivoSinCajon) {
      return toast(cab.fecha !== hoy
        ? 'Una factura de otro día no se puede pagar con el cajón del TPV: la caja de ese día ya se contó. Elige caja mayor o banco.'
        : cajonNoVale ? 'El TPV no tiene la caja abierta: elige caja mayor o banco.'
          : 'Un momento: se está mirando si el TPV tiene la caja abierta. Vuelve a pulsar Guardar.', 'error')
    }
    const cambiaPago = conSalidaCajon && (cab.pagado_con || null) !== (factura.pagado_con || null)
    if (cambiaPago && !cab.pagado_con) {
      return toast('Esta factura ya sacó dinero del cajón del TPV: no puede quedarse sin decir. Elige caja mayor, banco o déjala en el cajón.', 'error')
    }

    setGuardando(true)
    try {
      const cabecera = {
        proveedor_id: cab.proveedor_id || null,
        numero: cab.numero.trim() || null,
        fecha: cab.fecha,
        total: totalPapel || Math.round(sumaLineas * 100) / 100,
        notas: cab.notas.trim() || null,
        // Con salida del cajón, el pago lo cambia la RPC de abajo, nunca este UPDATE.
        ...(conSalidaCajon ? {} : { pagado_con: cab.pagado_con || null }),
      }
      let id = factura?.id
      if (nueva) {
        const { data, error } = await supabase.from('stock_facturas')
          .insert({ ...cabecera, establecimiento_id: estId }).select().single()
        if (error) throw new Error(error.message)
        id = data.id
      } else {
        // ANTES del UPDATE: si la RPC falla (PD277, esa caja ya está cerrada) no se ha tocado
        // nada y el catch de abajo enseña el motivo. Si va bien, la salida vuelve al cajón.
        if (cambiaPago) await marcarPagado('compra', id, cab.pagado_con)
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

      toast(pagoContadoAntes
        ? 'Borrador guardado. Hasta que pulses Contabilizar no entra en el almacén.'
        : 'Borrador guardado. Hasta que pulses Contabilizar no entra en el almacén ni cuenta el pago.', 'success')
      onGuardado()
    } catch (e) {
      toast('No se ha podido guardar: ' + e.message, 'error')
      setGuardando(false)
    }
  }

  async function contabilizar() {
    // Con salida del cajón, cambiar «con qué» va por la RPC ANTES de tocar nada, y eso lo hace
    // «Guardar borrador». Aquí la mercancía entraría primero y el cambio podría fallar (PD277).
    if (conSalidaCajon && (cab.pagado_con || null) !== (factura.pagado_con || null)) {
      return toast('Has cambiado con qué la pagaste: pulsa «Guardar borrador» y luego Contabilizar.', 'error')
    }
    // Lo del cajón se mira ANTES: después de contabilizar ya no hay vuelta atrás. La RPC mira
    // la fecha GUARDADA de la factura, no la del formulario.
    if (cab.pagado_con === 'caja' && !conSalidaCajon) {
      if (factura.fecha !== hoy) {
        return toast(cab.fecha === hoy
          ? 'Has cambiado la fecha pero no la has guardado: pulsa «Guardar borrador» y luego Contabilizar.'
          : 'Una factura de otro día no se puede pagar con el cajón del TPV: la caja de ese día ya se contó. Elige caja mayor o banco y guarda el borrador.', 'error')
      }
      const { data: caja } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: estId })
      setCajaAbierta(!!caja?.abierta)
      if (!caja?.abierta) return toast('El TPV no tiene la caja abierta: elige caja mayor o banco y guarda el borrador.', 'error')
    }
    if (!(await confirmar(
      'Al contabilizar, esta mercancía entra en tu almacén y cada artículo se queda con ' +
      'el precio que has pagado en esta factura.' +
      (pagoYaContado && cab.pagado_con !== 'caja' ? '\n\nEl pago ya contó la primera vez que la contabilizaste: no se vuelve a restar.'
        : cab.pagado_con === 'caja_mayor' ? '\n\nComo la pagaste con la caja mayor, al contabilizarla sale de la caja mayor.'
        : cab.pagado_con === 'banco' ? '\n\nComo la pagaste por banco, al contabilizarla sale del banco.'
          : cab.pagado_con === 'caja' && conSalidaCajon ? '\n\nLa pagaste con el cajón del TPV y ese dinero ya salió: no se vuelve a sacar.'
          : cab.pagado_con === 'caja' ? '\n\nComo la pagaste con el cajón del TPV, al contabilizarla sale de la caja abierta del TPV.'
            : '\n\nNo has dicho con qué la pagaste: el dinero no sale de ningún sitio hasta que lo digas.') +
      '\n\nDespués no podrás editar la factura sin descontabilizarla antes.'
    ))) return
    setGuardando(true)
    try {
      await contabilizarFactura(factura.id)
    } catch (e) { toast(e.message, 'error'); setGuardando(false); return }

    let cajonTxt = ''
    if (cab.pagado_con) {
      try {
        const r = await marcarPagado('compra', factura.id, cab.pagado_con)
        // Si el pago ya contó la primera vez, no se dice «Salen X de la caja mayor»: no sale otra vez.
        cajonTxt = pagoYaContado && cab.pagado_con !== 'caja' ? '' : textoCajon(r.cajon, factura.total)
      } catch (e) {
        // La mercancía ya entró y eso no se deshace. Que la lista no diga «pagada con…» algo
        // que no se ha apuntado: se deja sin «con qué» y El día lo pregunta. Con salida del
        // cajón no se puede (PD277): ahí sigue siendo del cajón, que es lo que de verdad pasó.
        // Si el pago ya contó la primera vez tampoco se toca: está bien apuntado, y quitarle el
        // «con qué» borraría un pago que sí se hizo.
        // `.select('id')`: si no es el dueño, la RLS deja el UPDATE en 0 filas SIN error.
        let sinConQue = false
        if (!conSalidaCajon && !pagoYaContado) {
          const { data, error } = await supabase.from('stock_facturas')
            .update({ pagado_con: null }).eq('id', factura.id).select('id')
          sinConQue = !error && (data?.length || 0) > 0
        }
        setAvisoPago({ motivo: e.message, sinConQue })
        return
      }
    }
    toast(['Factura contabilizada: la mercancía está en el almacén.', cajonTxt].filter(Boolean).join(' '), 'success')
    onGuardado()
  }

  // Ya contabilizada, decir con qué se pagó va por RPC: si fue el cajón, sale de la caja.
  async function cambiarPagadoBloqueada(valor) {
    if (!valor || valor === cab.pagado_con) return
    try {
      const r = await marcarPagado('compra', factura.id, valor)
      setCab(c => ({ ...c, pagado_con: valor }))
      toast([`Apuntado: pagada ${PAGADA_CON[valor] || 'por banco'}.`, textoCajon(r.cajon, factura.total)].filter(Boolean).join(' '), 'success')
    } catch (e) { toast(e.message, 'error') }
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

  // Contabilizada, pero el pago no se pudo apuntar. El formulario ya no vale (la factura de
  // la prop es la de antes de contabilizar): solo el aviso, y al cerrarlo se recarga la lista.
  if (avisoPago) {
    // El pago de antes (del cajón, o de la primera vez que se contabilizó) sigue bien apuntado:
    // no se le dice «sin el pago», que le haría pensar que falta dinero por apuntar.
    const pagoIntacto = conSalidaCajon || pagoYaContado
    return (
      <div style={ds.modal} onClick={onGuardado}>
        <div style={{ ...ds.modalContent, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
          <h2 style={{ ...ds.h2, marginBottom: 12 }}>
            {pagoIntacto ? 'Factura contabilizada, con un aviso del pago' : 'Factura contabilizada, pero sin el pago'}
          </h2>
          <div style={{
            display: 'flex', gap: 8, padding: '12px 14px', borderRadius: radius.sm,
            border: `1px solid ${colors.warning}`, background: colors.warningSoft,
            fontSize: type.sm, lineHeight: 1.55, color: colors.text,
          }}>
            <TriangleAlert size={16} color={colors.warning} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              {pagoIntacto ? (
                <>La mercancía ya está en tu almacén. Al repasar con qué la pagaste ha salido un error, pero <strong>el pago sigue bien apuntado</strong>.</>
              ) : (
                <>La mercancía ya está en tu almacén, pero <strong>no se ha podido apuntar con qué la pagaste</strong>.</>
              )}
              <div style={{ marginTop: 6, color: colors.textDim }}>Motivo: {avisoPago.motivo}</div>
            </div>
          </div>
          <div style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.6, marginTop: 14 }}>
            {avisoPago.sinConQue ? (
              <>
                Se ha quedado sin decir con qué se pagó, para que tu dinero no cuente mal. Dilo en{' '}
                <strong>Contabilidad → El día</strong> del {fechaLarga(factura.fecha)}, donde pone
                «¿Con qué?», o abriendo otra vez esta factura.
              </>
            ) : conSalidaCajon ? (
              'Sigue apuntada con el cajón del TPV: ese dinero ya salió del cajón y así queda bien apuntado. No tienes que hacer nada más.'
            ) : pagoYaContado ? (
              `Sigue apuntada ${PAGADA_CON[cab.pagado_con] || 'por banco'}, como la primera vez que la contabilizaste: ese pago ya contó y no se vuelve a restar. No tienes que hacer nada más.`
            ) : (
              'Ábrela otra vez y elige con qué la pagaste.'
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={onGuardado} style={ds.primaryBtn}>Entendido</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={{ ...ds.modalContent, maxWidth: 940 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ ...ds.h2, marginBottom: 2 }}>
          {nueva ? 'Nueva factura de compra' : rapida ? 'Compra rápida' : bloqueada ? 'Factura contabilizada' : 'Factura (borrador)'}
        </h2>
        <div style={{ ...ds.muted, marginBottom: 18 }}>
          {rapida
            ? 'Ya está en tu almacén. Si te equivocaste, deshazla en Contabilidad → El día: sale del almacén y vuelve el coste de antes.'
            : bloqueada
              ? 'Esta mercancía ya está en tu almacén. Para cambiarla, descontabilízala primero.'
              : pagoContadoAntes
                ? 'Todavía no ha entrado nada en el almacén ni ha cambiado ningún coste. El pago ya contó la primera vez que la contabilizaste: no se vuelve a restar.'
                : 'Todavía no ha entrado nada en el almacén, ni ha cambiado ningún coste, ni ha contado el pago. Eso pasa al contabilizarla.'}
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
                <input type="date" value={cab.fecha} disabled={bloqueada} max={hoyCanariasIso()}
                  onChange={e => setCab({ ...cab, fecha: e.target.value })}
                  style={ds.formInput} />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={ds.label}>¿Con qué la pagaste?</label>
                <select value={cab.pagado_con}
                  onChange={e => bloqueada
                    ? cambiarPagadoBloqueada(e.target.value)
                    : setCab({ ...cab, pagado_con: e.target.value })}
                  style={ds.select}>
                  {/* Con salida del cajón no puede quedarse sin decir: la base de datos lo corta (PD277). */}
                  <option value="" disabled={(bloqueada && !!cab.pagado_con) || conSalidaCajon}>— Sin decir / aún no —</option>
                  <option value="caja_mayor">Caja mayor</option>
                  <option value="banco">Tarjeta o banco</option>
                  {/* Deshabilitado en vez de oculto: así se ve que existe y por qué ahora no vale. */}
                  <option value="caja" disabled={!!motivoSinCajon}>
                    {motivoSinCajon ? `Cajón del TPV · ${motivoSinCajon}` : 'Cajón del TPV'}
                  </option>
                </select>
                {cab.pagado_con === 'caja' && cajonNoVale && (
                  <div style={{ fontSize: type.xs, color: colors.danger, marginTop: 4, lineHeight: 1.4 }}>
                    {cab.fecha !== hoy
                      ? 'El cajón del TPV solo vale para pagos de hoy: elige caja mayor o banco.'
                      : 'El TPV no tiene la caja abierta: elige caja mayor o banco.'}
                  </div>
                )}
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
                {bloqueada && !rapida && (
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
