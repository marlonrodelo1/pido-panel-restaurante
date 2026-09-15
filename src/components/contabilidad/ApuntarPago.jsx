import { useState, useEffect, useMemo } from 'react'
import { ShoppingCart, Receipt, ArrowLeft, Plus, X, Wallet, Landmark, Vault, Search, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colors, ds, radius, type } from '../../lib/uiStyles'
import { toast } from '../../App'
import {
  eur, eurCoste, cantidad as fmtCantidad, UNIDADES, CATEGORIAS_GASTO, PAGADO_CON,
  cargarArticulos, cargarFijos, cargarGastos, tesoreria,
  apuntarCompra, apuntarGasto, textoCajon, hoyCanariasIso, sumarDias, fechaLarga,
} from '../../lib/stock'

// «Apuntar un pago»: la única puerta de lo que SALE del negocio.
//
// Dos preguntas y listo: ¿qué pagaste? (género, que entra al almacén, o un gasto) y ¿con qué?
// (caja mayor, tarjeta/banco o dinero del cajón). Lo demás lo hace la base de datos en un solo
// paso: la compra entra en el almacén con su precio, el gasto cuenta en las cuentas y el dinero
// sale de donde salió. Así «cuánto queda» dice la verdad en cada bolsillo.
//
// Lo normal es la CAJA MAYOR (15 sep 2026): los billetes que se retiran al cerrar la caja.
// El cajón del TPV queda para lo que se paga en plena venta (el panadero que llega a mediodía):
// si se ofrece igual que las otras, se elige por costumbre y descuadra el cierre. Y solo se
// puede elegir con la caja del TPV abierta y para pagos de HOY: la caja de otro día ya se contó,
// y un pago de ayer sacado de la caja de hoy hace que esta noche «sobre» dinero. La base de
// datos lo rechaza igual (PD284); aquí se dice antes de pulsar.
//
// `inicial` la abre ya encaminada: { modo: 'compra'|'gasto', fijo, salida, fecha }.
// `salida` es una salida del cajón que YA existe (se apuntó en el TPV) y ahora se explica:
// el importe queda fijado y el dinero no se saca dos veces.
//
// No se cierra al pulsar fuera: con media compra tecleada, un clic perdido lo borraba todo.

// «1.500» es mil quinientos (puntos de miles, como se escribe en España); «13,20» y «13.20»
// son trece con veinte. Sin esto, «1.500» se leía como 1,5 sin ningún aviso.
const num = (v) => {
  let s = String(v ?? '').replace(/\s/g, '')
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s.replace(/\.(?=.*,)/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const redondo = (n) => Math.round(n * 100) / 100
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
let contadorLineas = 0
const lineaVacia = () => ({ key: ++contadorLineas, articulo: null, cantidad: '', importe: '' })
const soloImporte = (v) => v.replace(/[^\d.,]/g, '')

export default function ApuntarPago({ estId, inicial = {}, onCerrar, onHecho }) {
  const salida = inicial.salida || null
  const hoy = hoyCanariasIso()

  const [modo, setModo] = useState(inicial.modo || null)
  const [articulos, setArticulos] = useState(null)
  const [proveedores, setProveedores] = useState([])
  const [fijosPendientes, setFijosPendientes] = useState([])
  const [cajon, setCajon] = useState(null)
  const [cajaMayor, setCajaMayor] = useState(null)   // { saldo, contada, … } de contab_tesoreria
  // Ya se sabe si el TPV tiene la caja abierta. Sin esto, mientras carga, el cajón diría
  // «el TPV no tiene la caja abierta» aunque la tenga.
  const [cajonCargado, setCajonCargado] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [fecha, setFecha] = useState(inicial.fecha && inicial.fecha <= hoy ? inicial.fecha : hoy)
  const [pagadoCon, setPagadoCon] = useState(salida ? 'caja' : null)

  const [lineas, setLineas] = useState([lineaVacia()])
  const [proveedorId, setProveedorId] = useState('')

  const [fijo, setFijo] = useState(inicial.fijo || null)
  const [categoria, setCategoria] = useState(inicial.fijo?.categoria || '')
  const [concepto, setConcepto] = useState('')
  const [importe, setImporte] = useState(
    salida ? String(salida.importe).replace('.', ',')
      : inicial.fijo ? String(inicial.fijo.importe).replace('.', ',') : '')

  useEffect(() => {
    if (!estId) return
    let vivo = true
    const inicioMes = hoy.slice(0, 8) + '01'
    Promise.allSettled([
      cargarArticulos(estId),
      supabase.from('stock_proveedores').select('id, nombre, activo').eq('establecimiento_id', estId).order('nombre'),
      cargarFijos(estId),
      cargarGastos(estId, inicioMes, hoy),
      supabase.rpc('tpv_estado_caja', { p_establecimiento_id: estId }),
    ]).then(([arts, provs, fijos, gastos, caja]) => {
      if (!vivo) return
      setArticulos(arts.status === 'fulfilled' ? arts.value : [])
      if (provs.status === 'fulfilled') setProveedores((provs.value.data || []).filter(p => p.activo !== false))
      if (fijos.status === 'fulfilled' && gastos.status === 'fulfilled') {
        const hechos = new Set(gastos.value.map(g => g.fijo_id).filter(Boolean))
        setFijosPendientes(fijos.value.filter(f => f.activo && !hechos.has(f.id)))
      }
      // Si `tpv_estado_caja` falla, `cajon` se queda en null y el cajón no se ofrece: es lo seguro.
      if (caja.status === 'fulfilled' && caja.value.data?.abierta) setCajon(caja.value.data)
      setCajonCargado(true)
    })
    // La tesorería va APARTE: es la llamada más pesada (datáfono, liquidaciones, lo que debe
    // Pidoo) y solo sirve para el «hay X €». Dentro del allSettled dejaba «Compré género» en
    // «Cargando tus artículos…» hasta que respondía. Si no carga, se puede pagar igual con
    // la caja mayor: se pierde la ayuda, no el requisito.
    tesoreria(estId)
      .then(t => { if (vivo && t?.caja_mayor) setCajaMayor(t.caja_mayor) })
      .catch(() => {})
    return () => { vivo = false }
  }, [estId])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Compra ─────────────────────────────────────────────────────────────── */
  const lineasListas = lineas.filter(l => l.articulo && num(l.cantidad) > 0 && l.importe !== '')
  const lineasAMedias = lineas.filter(l => (l.articulo || l.cantidad || l.importe) && !lineasListas.includes(l))
  const totalCompra = redondo(lineasListas.reduce((s, l) => s + num(l.importe), 0))

  /* ── Gasto ──────────────────────────────────────────────────────────────── */
  const importeGasto = redondo(num(importe))

  const total = modo === 'compra' ? totalCompra : importeGasto
  const cuadraSalida = !salida || Math.abs(total - Number(salida.importe)) < 0.005
  // Del cajón solo sale lo de hoy y con la caja abierta. Explicar una salida que YA existe vale
  // siempre: ese dinero ya salió y no se vuelve a sacar.
  const cajonVale = !!salida || (!!cajon && fecha === hoy)
  const motivoSinCajon = cajonVale ? null
    : !cajonCargado ? 'Mirando si el TPV tiene la caja abierta…'
      : !cajon ? 'El TPV no tiene la caja abierta'
        : 'Solo para pagos de hoy'
  const pagoVale = !!pagadoCon && (pagadoCon !== 'caja' || cajonVale)
  const valido = modo === 'compra'
    ? lineasListas.length > 0 && lineasAMedias.length === 0 && pagoVale && cuadraSalida
    : modo === 'gasto'
      ? categoria.trim() && importeGasto > 0 && pagoVale && cuadraSalida
      : false

  const setLinea = (key, cambios) => setLineas(prev => prev.map(l => l.key === key ? { ...l, ...cambios } : l))

  async function guardar() {
    if (!valido || guardando) return
    setGuardando(true)
    try {
      if (modo === 'compra') {
        const r = await apuntarCompra(estId, {
          lineas: lineasListas.map(l => ({
            articulo_id: l.articulo.id, cantidad: num(l.cantidad), importe: redondo(num(l.importe)),
          })),
          pagadoCon, fecha, proveedorId, cajaMovimientoId: salida?.id,
        })
        toast(`Compra apuntada: ${eur(r.total)}. ${textoCajon(r.cajon, r.total)}`, 'success')
        onHecho?.(r)
      } else {
        const r = await apuntarGasto(estId, {
          categoria, importe: importeGasto, pagadoCon, fecha, concepto,
          fijoId: fijo?.id, cajaMovimientoId: salida?.id,
        })
        toast(`Gasto apuntado: ${eur(r.importe)}. ${textoCajon(r.cajon, r.importe)}`, 'success')
        onHecho?.(r)
      }
    } catch (e) {
      toast(e.message, 'error')
      setGuardando(false)
    }
  }

  const titulo = modo === 'compra' ? 'Compré género' : modo === 'gasto' ? 'Pagué un gasto' : 'Apuntar un pago'

  return (
    <div style={ds.modal}>
      <div style={{ ...ds.modalContent, maxWidth: 660, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Cabecera fija */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          {modo && !inicial.modo && (
            <button onClick={() => setModo(null)} aria-label="Volver" style={{ ...ds.miniBtn, height: 30, width: 30, padding: 0 }}>
              <ArrowLeft size={15} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text }}>{titulo}</div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ ...ds.miniBtn, height: 30, width: 30, padding: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {salida && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: radius.sm,
              background: colors.warningSoft, border: `1px solid ${colors.warning}`,
              fontSize: type.sm, color: colors.text, lineHeight: 1.5,
            }}>
              Estás explicando los <strong>{eur(salida.importe)}</strong> que salieron del cajón
              el {fechaLarga(salida.fecha, { diaSemana: false })} a las {salida.hora}
              {salida.motivo ? ` («${salida.motivo}»)` : ''}. Ese dinero ya salió: no se vuelve a sacar.
            </div>
          )}

          {!modo && (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              <OpcionGrande
                icono={<ShoppingCart size={26} color={colors.primary} />}
                titulo="Compré género"
                texto="Pan, carne, bebida, envases, limpieza… Lo que entra en el almacén."
                onClick={() => setModo('compra')}
              />
              <OpcionGrande
                icono={<Receipt size={26} color={colors.primary} />}
                titulo="Pagué un gasto"
                texto="Luz, alquiler, sueldos, gestoría, una reparación…"
                onClick={() => setModo('gasto')}
              />
            </div>
          )}

          {modo === 'compra' && (
            articulos === null ? (
              <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>Cargando tus artículos…</div>
            ) : (
              <>
                <Paso n={1} texto="¿Qué compraste?" />
                <div style={{ display: 'grid', gap: 10 }}>
                  {lineas.map(l => (
                    <LineaCompra
                      key={l.key}
                      linea={l}
                      estId={estId}
                      articulos={articulos}
                      onArticuloCreado={a => setArticulos(prev => [...prev, a])}
                      onCambio={c => setLinea(l.key, c)}
                      onQuitar={lineas.length > 1 ? () => setLineas(prev => prev.filter(x => x.key !== l.key)) : null}
                    />
                  ))}
                </div>
                <button onClick={() => setLineas(prev => [...prev, lineaVacia()])} style={{ ...ds.miniBtn, marginTop: 10, height: 30 }}>
                  <Plus size={13} /> Otro artículo
                </button>

                {proveedores.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <label style={ds.label}>¿A quién? (opcional)</label>
                    <select value={proveedorId} onChange={e => setProveedorId(e.target.value)} style={{ ...ds.select, maxWidth: 320 }}>
                      <option value="">— Sin decir —</option>
                      {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                )}
              </>
            )
          )}

          {modo === 'gasto' && (
            <>
              {fijosPendientes.length > 0 && !salida && (
                <div style={{ marginBottom: 18 }}>
                  <Paso n={1} texto="¿Es uno de tus gastos fijos de este mes?" />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {fijosPendientes.map(f => {
                      const activo = fijo?.id === f.id
                      return (
                        <button key={f.id} onClick={() => {
                          if (activo) { setFijo(null); return }
                          setFijo(f); setCategoria(f.categoria); setImporte(String(f.importe).replace('.', ','))
                        }} style={chipBtn(activo)}>
                          {activo && <Check size={13} />} {f.categoria} · {eur(f.importe)}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ ...ds.muted, marginTop: 6 }}>
                    Si no es ninguno, rellena lo de abajo. Estos son los que aún no has apuntado este mes.
                  </div>
                </div>
              )}

              <Paso n={fijosPendientes.length > 0 && !salida ? 2 : 1} texto="¿En qué fue?" />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {CATEGORIAS_GASTO.map(c => (
                  <button key={c} onClick={() => { setCategoria(c); if (fijo && fijo.categoria !== c) setFijo(null) }}
                    style={chipBtn(sinAcentos(categoria) === sinAcentos(c))}>
                    {c}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={ds.label}>Qué es</label>
                  <input value={categoria} placeholder="Luz, Reparaciones…"
                    onChange={e => { setCategoria(e.target.value); if (fijo) setFijo(null) }}
                    style={ds.formInput} />
                </div>
                <div style={{ flex: '2 1 220px' }}>
                  <label style={ds.label}>Nota (opcional)</label>
                  <input value={concepto} placeholder="Bombilla de la cocina, recibo de agosto…"
                    onChange={e => setConcepto(e.target.value)} style={ds.formInput} />
                </div>
              </div>
              <div style={{ marginTop: 12, maxWidth: 220 }}>
                <label style={ds.label}>¿Cuánto pagaste?</label>
                <InputEuros value={importe} onChange={setImporte} disabled={!!salida} autoFocus={!inicial.fijo && !salida} />
              </div>
            </>
          )}

          {modo && (
            <>
              <Paso n={modo === 'compra' ? 2 : (fijosPendientes.length > 0 && !salida ? 3 : 2)} texto="¿Con qué pagaste?" arriba={22} />
              {/* Cuando se explica una salida del cajón, el dinero YA salió del cajón: las otras
                  dos se ven (para que se entienda por qué no valen) pero no se pueden elegir. */}
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
                <OpcionPago
                  activo={pagadoCon === 'caja_mayor'}
                  icono={<Vault size={20} />}
                  titulo={PAGADO_CON.caja_mayor.label}
                  texto={!cajaMayor ? 'Los billetes que guardas de los cierres'
                    : cajaMayor.contada === false ? 'Todavía no la has contado'
                      : `Hay ${eur(cajaMayor.saldo)} en la caja mayor`}
                  disabled={!!salida}
                  onClick={() => setPagadoCon('caja_mayor')}
                />
                <OpcionPago
                  activo={pagadoCon === 'banco'}
                  icono={<Landmark size={20} />}
                  titulo={PAGADO_CON.banco.label}
                  texto="No toca el cajón ni la caja mayor"
                  disabled={!!salida}
                  onClick={() => setPagadoCon('banco')}
                />
              </div>
              <div style={{ display: 'grid', marginTop: 10 }}>
                <OpcionPago
                  activo={pagadoCon === 'caja'}
                  discreta={!salida}
                  icono={<Wallet size={salida ? 20 : 17} />}
                  titulo={PAGADO_CON.caja.label}
                  texto={motivoSinCajon || 'Solo si lo sacaste del cajón mientras vendías'}
                  nota={cajon && cajonVale && !salida ? `Hay ${eur(cajon.esperado)} en el cajón` : null}
                  disabled={!cajonVale}
                  onClick={() => setPagadoCon('caja')}
                />
              </div>

              <Paso n={modo === 'compra' ? 3 : (fijosPendientes.length > 0 && !salida ? 4 : 3)} texto="¿Qué día?" arriba={22} />
              {/* Cambiar a otro día con el cajón elegido lo deja sin elegir: ya no vale y el
                  botón de apuntar se quedaría apagado sin que se viera por qué. */}
              <ElegirFecha fecha={fecha} hoy={hoy} onCambio={f => {
                setFecha(f)
                if (!salida && pagadoCon === 'caja' && f !== hoy) setPagadoCon(null)
              }} />

              <Resumen
                modo={modo} total={total} lineas={lineasListas} lineasAMedias={lineasAMedias.length}
                pagadoCon={pagadoCon} cajon={cajon} cajaMayor={cajaMayor} salida={salida} cuadraSalida={cuadraSalida}
                fecha={fecha} hoy={hoy} categoria={categoria} fijo={fijo}
              />
            </>
          )}
        </div>

        {modo && (
          <div style={{
            display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap',
            padding: '14px 20px', borderTop: `1px solid ${colors.border}`,
          }}>
            <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
            <button onClick={guardar} disabled={!valido || guardando}
              style={{ ...ds.primaryBtn, height: 42, fontSize: type.base, opacity: !valido || guardando ? 0.5 : 1 }}>
              {guardando ? 'Apuntando…'
                : modo === 'compra' ? `Apuntar compra${total > 0 ? ' de ' + eur(total) : ''}`
                  : `Apuntar gasto${total > 0 ? ' de ' + eur(total) : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Paso({ n, texto, arriba = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: arriba, marginBottom: 10 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 999, background: colors.ink, color: colors.cream,
        fontSize: type.xxs, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{n}</span>
      <span style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>{texto}</span>
    </div>
  )
}

function OpcionGrande({ icono, titulo, texto, onClick }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      padding: 18, borderRadius: radius.md, background: colors.paper,
      border: `1px solid ${colors.borderStrong}`, boxShadow: colors.shadow,
      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 130,
    }}>
      {icono}
      <span style={{ fontSize: type.lg, fontWeight: 800, color: colors.text }}>{titulo}</span>
      <span style={{ fontSize: type.sm, color: colors.textMute, lineHeight: 1.45 }}>{texto}</span>
    </button>
  )
}

// `discreta`: la misma opción, pero en segundo plano (más baja, borde discontinuo, título más
// pequeño). Es para el cajón del TPV, que vale pero no es lo normal. Elegida, se ve como las demás.
function OpcionPago({ activo, icono, titulo, texto, nota, onClick, disabled, discreta }) {
  const baja = discreta && !activo
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: baja ? 10 : 12, textAlign: 'left',
      padding: baja ? '8px 12px' : '12px 14px', borderRadius: radius.md, fontFamily: 'inherit',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      background: activo ? colors.primarySoft : baja ? 'transparent' : colors.paper,
      border: `2px ${baja ? 'dashed' : 'solid'} ${activo ? colors.primary : colors.border}`,
      color: activo ? colors.primaryDark : baja ? colors.textDim : colors.text,
    }}>
      <span style={{ flexShrink: 0, display: 'flex' }}>{icono}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: baja ? type.sm : type.base, fontWeight: 700 }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: type.xs, color: colors.textMute }}>{texto}</span>
        {nota && <span style={{ display: 'block', fontSize: type.xs, color: colors.textMute }}>{nota}</span>}
      </span>
    </button>
  )
}

function chipBtn(activo) {
  return {
    ...ds.filterBtn, height: 32,
    background: activo ? colors.primary : colors.paper,
    color: activo ? colors.cream : colors.textDim,
    borderColor: activo ? colors.primary : colors.border,
    fontWeight: activo ? 700 : 600,
  }
}

function InputEuros({ value, onChange, disabled, autoFocus, placeholder = '0,00' }) {
  return (
    <div style={{ position: 'relative' }}>
      <input inputMode="decimal" value={value} disabled={disabled} autoFocus={autoFocus} placeholder={placeholder}
        onChange={e => onChange(soloImporte(e.target.value))}
        style={{
          ...ds.formInput, paddingRight: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          fontSize: type.base, fontWeight: 700, background: disabled ? colors.surface2 : colors.paper,
        }} />
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: colors.textMute, fontSize: type.sm }}>€</span>
    </div>
  )
}

function ElegirFecha({ fecha, hoy, onCambio }) {
  const ayer = sumarDias(hoy, -1)
  const otro = fecha !== hoy && fecha !== ayer
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button onClick={() => onCambio(hoy)} style={chipBtn(fecha === hoy)}>Hoy</button>
      <button onClick={() => onCambio(ayer)} style={chipBtn(fecha === ayer)}>Ayer</button>
      <input type="date" value={fecha} max={hoy}
        onChange={e => e.target.value && onCambio(e.target.value > hoy ? hoy : e.target.value)}
        style={{ ...ds.formInput, width: 160, height: 32, borderColor: otro ? colors.primary : colors.border }} />
    </div>
  )
}

// Un renglón de la compra: qué, cuántos y cuánto pagaste por todo. El precio por unidad lo
// calcula la pantalla y lo compara con el de antes: si el pan ha subido, se ve aquí.
function LineaCompra({ linea, estId, articulos, onArticuloCreado, onCambio, onQuitar }) {
  const a = linea.articulo
  const unidad = UNIDADES.find(u => u.id === a?.unidad) || UNIDADES[0]
  const cant = num(linea.cantidad)
  const pagado = num(linea.importe)
  const precio = cant > 0 && linea.importe !== '' ? pagado / cant : null
  const antes = Number(a?.coste_medio || 0)
  const cambio = precio != null && antes > 0 ? (precio - antes) / antes : null

  return (
    <div style={{ padding: 12, borderRadius: radius.md, border: `1px solid ${colors.border}`, background: colors.surface }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BuscaArticulo
            estId={estId} articulos={articulos} valor={a}
            onElegir={art => onCambio({ articulo: art })}
            onCreado={art => { onArticuloCreado(art); onCambio({ articulo: art }) }}
          />
        </div>
        {onQuitar && (
          <button onClick={onQuitar} aria-label="Quitar" style={{ ...ds.miniBtn, height: 36, width: 36, padding: 0 }}>
            <X size={14} />
          </button>
        )}
      </div>

      {a && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <div style={{ flex: '1 1 140px' }}>
              <label style={ds.label}>{unidad.id === 'ud' ? '¿Cuántas unidades?' : `¿Cuántos ${unidad.label}?`}</label>
              <div style={{ position: 'relative' }}>
                <input inputMode="decimal" value={linea.cantidad} placeholder="0" autoFocus
                  onChange={e => onCambio({ cantidad: soloImporte(e.target.value) })}
                  style={{ ...ds.formInput, paddingRight: 36, textAlign: 'right', fontSize: type.base, fontWeight: 700 }} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: colors.textMute, fontSize: type.sm }}>
                  {unidad.corto}
                </span>
              </div>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label style={ds.label}>¿Cuánto pagaste por todo?</label>
              <InputEuros value={linea.importe} onChange={v => onCambio({ importe: v })} />
            </div>
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8, lineHeight: 1.5 }}>
            {precio != null ? (
              <>
                Te sale a <strong style={{ color: colors.text }}>{eurCoste(precio)}</strong> {unidad.id === 'ud' ? 'cada uno' : `el ${unidad.corto}`}
                {cambio != null && Math.abs(cambio) >= 0.03 && (
                  <span style={{ color: cambio > 0 ? colors.danger : colors.sage2, fontWeight: 700 }}>
                    {' '}· {cambio > 0 ? 'sube' : 'baja'} un {Math.round(Math.abs(cambio) * 100)} % (antes {eurCoste(antes)})
                  </span>
                )}
                {cambio != null && Math.abs(cambio) < 0.03 && ` · igual que antes`}
                {' '}· tendrás {fmtCantidad(Number(a.existencia || 0) + cant, a.unidad)}
              </>
            ) : (
              <>Tienes {fmtCantidad(a.existencia, a.unidad)}{antes > 0 ? ` · la última vez te costó ${eurCoste(antes)} ${unidad.id === 'ud' ? 'cada uno' : `el ${unidad.corto}`}` : ''}</>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Buscador de artículos: se escribe «pan» y salen los panes. Si no existe, se crea ahí mismo
// (nombre + cómo se mide) sin perder lo tecleado.
function BuscaArticulo({ estId, articulos, valor, onElegir, onCreado }) {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [creando, setCreando] = useState(null)   // { nombre, unidad }
  const [ocupado, setOcupado] = useState(false)

  const activos = useMemo(() => articulos.filter(a => a.activo), [articulos])
  const encontrados = useMemo(() => {
    const t = sinAcentos(q.trim())
    if (!t) return activos.slice(0, 0)
    const partes = t.split(/\s+/)
    return activos
      .filter(a => { const n = sinAcentos(a.nombre); return partes.every(p => n.includes(p)) })
      .sort((x, y) => sinAcentos(x.nombre).indexOf(partes[0]) - sinAcentos(y.nombre).indexOf(partes[0]) || x.nombre.localeCompare(y.nombre, 'es'))
      .slice(0, 8)
  }, [activos, q])
  const exacto = encontrados.some(a => sinAcentos(a.nombre) === sinAcentos(q.trim()))

  async function crear() {
    const nombre = (creando?.nombre || '').trim()
    if (!nombre || ocupado) return
    const repe = articulos.find(a => sinAcentos(a.nombre.trim()) === sinAcentos(nombre))
    if (repe) {
      if (!repe.activo) return toast(`«${repe.nombre}» existe pero está archivado. Actívalo en Almacén → Artículos.`, 'error')
      setCreando(null); setQ(''); onElegir(repe)
      return
    }
    setOcupado(true)
    const { data, error } = await supabase.from('stock_articulos')
      .insert({ establecimiento_id: estId, nombre, unidad: creando.unidad })
      .select().single()
    setOcupado(false)
    if (error) return toast(error.code === '23505' ? 'Ya tienes un artículo con ese nombre.' : 'No se ha podido crear: ' + error.message, 'error')
    setCreando(null); setQ('')
    onCreado(data)
    toast(`«${data.nombre}» creado en tu almacén.`, 'success')
  }

  if (valor) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
        <span style={{ fontSize: type.base, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valor.nombre}
        </span>
        <button onClick={() => onElegir(null)} style={{ ...ds.miniBtn, flexShrink: 0 }}>Cambiar</button>
      </div>
    )
  }

  if (creando) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus value={creando.nombre} onChange={e => setCreando({ ...creando, nombre: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crear() } }}
          placeholder="Cómo se llama" style={ds.formInput} />
        <div style={{ fontSize: type.xs, color: colors.textMute }}>¿Cómo lo cuentas?</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {UNIDADES.map(u => (
            <button key={u.id} onClick={() => setCreando({ ...creando, unidad: u.id })} title={u.ayuda}
              style={chipBtn(creando.unidad === u.id)}>
              {u.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCreando(null)} style={{ ...ds.secondaryBtn, height: 34 }}>Cancelar</button>
          <button onClick={crear} disabled={!creando.nombre.trim() || ocupado}
            style={{ ...ds.primaryBtn, height: 34, opacity: !creando.nombre.trim() || ocupado ? 0.5 : 1 }}>
            {ocupado ? 'Creando…' : 'Crear artículo'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <Search size={15} color={colors.textMute} style={{ position: 'absolute', left: 12, top: 11 }} />
      <input value={q} autoFocus placeholder="Escribe: pan, carne, coca-cola…"
        onChange={e => { setQ(e.target.value); setAbierto(true) }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (encontrados[0]) { onElegir(encontrados[0]); setQ('') }
            else if (q.trim()) setCreando({ nombre: q.trim(), unidad: 'ud' })
          }
        }}
        style={{ ...ds.formInput, paddingLeft: 34 }} />
      {abierto && q.trim() && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 42, zIndex: 5,
          background: colors.paper, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.sm,
          boxShadow: colors.shadowMd, overflow: 'hidden',
        }}>
          {encontrados.map(a => (
            <button key={a.id} onMouseDown={e => e.preventDefault()} onClick={() => { onElegir(a); setQ(''); setAbierto(false) }}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
                padding: '9px 12px', border: 'none', borderBottom: `1px solid ${colors.border}`,
                background: colors.paper, cursor: 'pointer', fontFamily: 'inherit', fontSize: type.sm, color: colors.text,
              }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{a.nombre}</span>
              <span style={{ color: colors.textMute, flexShrink: 0, fontSize: type.xs }}>tienes {fmtCantidad(a.existencia, a.unidad)}</span>
            </button>
          ))}
          {/* Crear solo si no sale nada: con «pan» en la lista, un «Crear pan» a mano era la
              forma más rápida de duplicar el pan. Para uno nuevo parecido basta con escribir
              su nombre entero (p. ej. «pan integral»), que ya no coincide. */}
          {!exacto && encontrados.length === 0 && (
            <button onMouseDown={e => e.preventDefault()} onClick={() => { setCreando({ nombre: q.trim(), unidad: 'ud' }); setAbierto(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                padding: '9px 12px', border: 'none', background: colors.surface2, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: type.sm, color: colors.primaryDark, fontWeight: 700,
              }}>
              <Plus size={13} /> Crear «{q.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Lo que va a pasar al pulsar, dicho antes de pulsar.
function Resumen({ modo, total, lineas, lineasAMedias, pagadoCon, cajon, cajaMayor, salida, cuadraSalida, fecha, hoy, categoria, fijo }) {
  const puntos = []
  if (modo === 'compra') {
    for (const l of lineas) {
      puntos.push(`Entran en el almacén ${fmtCantidad(num(l.cantidad), l.articulo.unidad)} de ${l.articulo.nombre}.`)
    }
    if (lineasAMedias > 0) puntos.push(`Hay ${lineasAMedias === 1 ? 'un artículo' : `${lineasAMedias} artículos`} a medias: pon cuántos y cuánto pagaste, o quítalo.`)
  } else if (categoria.trim() && total > 0) {
    puntos.push(`Gasto de ${eur(total)} en ${categoria.trim()}${fijo ? ' (tu fijo de este mes: ya no te lo volverá a pedir)' : ''}.`)
  }

  if (salida) {
    puntos.push(cuadraSalida
      ? `Queda explicada la salida de ${eur(salida.importe)} del cajón. El cajón no cambia: ese dinero ya había salido.`
      : `Tiene que sumar ${eur(salida.importe)}, lo que salió del cajón. Ahora suma ${eur(total)}.`)
  } else if (pagadoCon === 'caja_mayor' && total > 0) {
    // Sin contar, el saldo parte de 0 desde que empezó la contabilidad: decir «quedarán
    // −13,20 €» asustaría por un número que no es real. Mejor no dar cifra.
    const quedan = cajaMayor ? Number(cajaMayor.saldo) - total : null
    if (!cajaMayor) puntos.push(`Salen ${eur(total)} de la caja mayor.`)
    else if (cajaMayor.contada === false) puntos.push(`Salen ${eur(total)} de la caja mayor. Todavía no la has contado, así que no sabemos cuánto queda.`)
    // Contada, el saldo puede quedar en negativo por pagos apuntados después del recuento:
    // «solo hay −5,00 €» no lo entiende nadie. Con 0 o menos se dice que ya no queda nada.
    else if (Number(cajaMayor.saldo) <= 0.005) puntos.push(`Salen ${eur(total)} de la caja mayor, pero según lo apuntado ya no queda nada. ¿Seguro que lo pagaste con ella? Si falta algo, cuéntala en Tu dinero.`)
    else if (quedan < -0.005) puntos.push(`Salen ${eur(total)} de la caja mayor, pero solo hay ${eur(cajaMayor.saldo)}. ¿Seguro que lo pagaste con ella?`)
    else puntos.push(`Salen ${eur(total)} de la caja mayor: quedarán ${eur(quedan)}.`)
  } else if (pagadoCon === 'caja' && total > 0) {
    // Sin caja abierta o de otro día la base de datos no apunta nada (PD284): no se promete.
    if (cajon && fecha === hoy) puntos.push(`Salen ${eur(total)} del cajón: quedarán ${eur(Number(cajon.esperado) - total)}.`)
    else if (!cajon) puntos.push('El TPV no tiene la caja abierta: elige caja mayor o banco.')
    else puntos.push('Del cajón del TPV solo se pagan cosas de hoy: la caja de ese día ya se contó. Elige caja mayor o banco.')
  } else if (pagadoCon === 'banco') {
    puntos.push('Se paga por el banco: no toca el cajón ni la caja mayor.')
  }
  if (fecha !== hoy) puntos.push(`Cuenta en el ${fechaLarga(fecha)}.`)

  if (!puntos.length) return null
  return (
    <div style={{
      marginTop: 22, padding: '14px 16px', borderRadius: radius.md,
      background: colors.surface2, border: `1px solid ${colors.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ ...ds.label, marginBottom: 0 }}>Lo que va a pasar</span>
        {total > 0 && <span style={{ fontSize: 22, fontWeight: 800, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>{eur(total)}</span>}
      </div>
      {puntos.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: type.sm, color: colors.textDim, lineHeight: 1.5, marginTop: 4 }}>
          <span style={{ color: colors.textMute }}>•</span><span>{p}</span>
        </div>
      ))}
    </div>
  )
}
