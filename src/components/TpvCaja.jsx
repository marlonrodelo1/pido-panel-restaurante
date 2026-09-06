// LA CAJA del mostrador: abrir con un fondo, meter y sacar efectivo, y cerrar
// contando lo que hay de verdad.
//
// La diferencia que da sentido a todo esto: el informe del día dice lo que se ha
// VENDIDO; la caja dice lo que hay EN EL CAJÓN. Entre una cosa y otra están el
// fondo inicial, lo que se saca para pagar al proveedor y lo que se mete de la
// caja fuerte. El descuadre es la resta de las dos.
//
// Las cuentas NO se hacen aquí: se piden al servidor (`tpv_estado_caja`,
// `tpv_cerrar_caja`). Si se hicieran en la tablet, un cierre podría guardarse
// "cuadrado" sin serlo.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { VIAS } from '../lib/jornada'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { imprimirReporteCaja } from '../lib/printService'
import { ventasPendientes } from '../lib/colaVentas'
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock, Unlock, Printer, Calculator, Minus, Plus } from 'lucide-react'

export default function TpvCaja({ establecimientoId, restaurante, vistaInicial = 'resumen', onCerrarModal }) {
  const [estado, setEstado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [vista, setVista] = useState(vistaInicial)   // resumen | entrada | salida | cierre | historial
  const [importe, setImporte] = useState('')
  const [motivo, setMotivo] = useState('')
  const [contando, setContando] = useState(false)    // arqueo por denominaciones abierto

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: establecimientoId })
    if (error) { toast('No se pudo leer la caja: ' + error.message, 'error'); setCargando(false); return }
    setEstado(data)
    setCargando(false)
  }, [establecimientoId])

  useEffect(() => { cargar() }, [cargar])

  // 🔴 El parser de antes hacía `replace(',', '.')` — SOLO la primera coma — y
  // "1.250,00" (un sábado normal) se convertía en NaN: la pantalla decía
  // "Sobran NaN €" y el servidor rechazaba el cierre con un error críptico.
  // Este entiende lo que se teclea de verdad: "50", "50,5", "1.250,00", "70.5".
  // Devuelve CÉNTIMOS, o null si aquello no es un importe.
  function aCents(str) {
    let t = String(str || '').trim()
    if (!t) return null
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')       // coma = decimal, puntos = miles
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')      // "1.250" sin coma = miles
    const num = parseFloat(t)
    if (!Number.isFinite(num) || num < 0) return null
    return Math.round(num * 100)
  }
  const importeC = aCents(importe)

  // La RPC ya habla claro ("Ya tienes una caja abierta…"); lo único que llegaba
  // crudo era el 23505 del índice único cuando dos aparatos abren a la vez.
  function errorCaja(error) {
    const choque = error?.code === '23505' || /duplicate key/i.test(error?.message || '')
    toast(choque ? 'Ya hay una caja abierta (quizá desde otro aparato).' : error.message, 'error')
    cargar()   // la pantalla se pone al día en vez de quedarse mintiendo
  }

  async function abrir() {
    if (importeC == null) { toast('Escribe el fondo con el que abres (puede ser 0)', 'error'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_abrir_caja', {
      p_establecimiento_id: establecimientoId, p_fondo: importeC / 100,
    })
    setOcupado(false)
    if (error) { errorCaja(error); return }
    toast('Caja abierta con ' + eur(importeC), 'success')
    setImporte(''); setVista('resumen'); cargar()
  }

  async function mover(tipo) {
    if (importeC == null || importeC <= 0) { toast('Ese importe no vale. Escribe cuánto, por ejemplo 20,00', 'error'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_movimiento_caja', {
      p_establecimiento_id: establecimientoId, p_tipo: tipo,
      p_importe: importeC / 100, p_motivo: motivo || null,
    })
    setOcupado(false)
    if (error) { errorCaja(error); return }
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${eur(importeC)} apuntada`, 'success')
    setImporte(''); setMotivo(''); setVista('resumen'); cargar()
  }

  async function cerrar() {
    if (importeC == null) { toast('Cuenta el dinero y escribe el total (puede ser 0)', 'error'); return }
    // El Z cuadra contra lo APUNTADO en el servidor: con ventas cobradas sin
    // conexión aún en la cola local, cerraría descuadrado a la fuerza (el
    // dinero está en el cajón pero el servidor no lo sabe todavía).
    const pendientes = ventasPendientes(establecimientoId)
    if (pendientes) {
      toast(`Hay ${pendientes} venta${pendientes > 1 ? 's' : ''} cobrada${pendientes > 1 ? 's' : ''} sin conexión pendiente${pendientes > 1 ? 's' : ''} de apuntar: conecta internet, espera al aviso de sincronizado y cierra entonces`, 'error')
      return
    }
    setOcupado(true)
    const { data, error } = await supabase.rpc('tpv_cerrar_caja', {
      p_establecimiento_id: establecimientoId, p_contado: importeC / 100, p_notas: motivo || null,
    })
    setOcupado(false)
    if (error) { errorCaja(error); return }
    const d = cents(data?.descuadre)
    toast(d === 0 ? 'Caja cerrada y cuadrada'
      : `Caja cerrada · ${d > 0 ? 'sobran' : 'faltan'} ${eur(Math.abs(d))}`,
      d === 0 ? 'success' : 'error')
    // El Z sale solo al cerrar: es el papel que se guarda del día. Si la térmica
    // falla, la caja YA está cerrada — antes eso se tragaba en silencio y no
    // había forma de volver a sacarlo. Ahora avisa, y abajo queda el botón de
    // reimprimir el último cierre.
    imprimirReporteCaja(data, restaurante, 'Z')
      .then((ok) => { if (!ok) toast('La caja está cerrada, pero el Z no se imprimió. Puedes reimprimirlo desde aquí.', 'error') })
      .catch(() => toast('La caja está cerrada, pero el Z no se imprimió. Puedes reimprimirlo desde aquí.', 'error'))
    setImporte(''); setMotivo(''); setVista('resumen'); cargar()
  }

  // Reimprime el Z de una caja cerrada cualquiera: sirve si la impresora falló
  // al cerrar, si se acabó el papel, o si el papel de hace días se ha perdido.
  async function imprimirZDe(caja) {
    const ok = await imprimirReporteCaja(caja, restaurante, 'Z')
    toast(ok
      ? `Z reimpreso (caja del ${new Date(caja.cerrada_at).toLocaleDateString('es-ES')})`
      : 'La impresora no responde', ok ? 'success' : 'error')
  }

  async function reimprimirUltimoZ() {
    const { data, error } = await supabase.from('tpv_cajas')
      .select('*').eq('establecimiento_id', establecimientoId)
      .not('cerrada_at', 'is', null)
      .order('cerrada_at', { ascending: false }).limit(1).maybeSingle()
    if (error) { toast('No se pudo leer el último cierre: ' + error.message, 'error'); return }
    if (!data) { toast('Todavía no hay ningún cierre de caja'); return }
    await imprimirZDe(data)
  }

  // El HISTORIAL de cierres: hasta ahora la caja solo conocía la abierta, y un
  // descuadre de hace tres días no se podía ni consultar ni reimprimir.
  const [cierres, setCierres] = useState(null)
  async function abrirHistorial() {
    setVista('historial')
    const { data, error } = await supabase.from('tpv_cajas')
      .select('*').eq('establecimiento_id', establecimientoId)
      .not('cerrada_at', 'is', null)
      .order('cerrada_at', { ascending: false }).limit(20)
    if (error) { toast('No se pudo leer el historial: ' + error.message, 'error'); setCierres([]); return }
    setCierres(data || [])
  }

  if (cargando) return <div style={{ padding: 20, textAlign: 'center', color: T.muted }}>Mirando la caja…</div>

  // ── Sin caja abierta ──────────────────────────────────────────────────────
  // (el historial de cierres se puede mirar igual, con la caja cerrada)
  if (!estado?.abierta && vista !== 'historial') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: T.muted, fontSize: 14 }}>
          <Unlock size={18} color={T.accent} />
          No tienes ninguna caja abierta.
        </div>
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
          Puedes vender sin abrir caja, pero esas ventas no entrarán en ningún arqueo.
          Ábrela con el dinero que dejas para dar cambio.
        </div>
        <div>
          <label style={etiqueta}>Fondo inicial</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="50,00" inputMode="decimal" style={inputOscuro} />
        </div>
        {/* Sin importe escrito no se puede abrir: quien venía buscando el
            informe X o el Z aterrizaba aquí y un toque abría una caja a 0 €
            sin querer — y deshacerla obligaba a un cierre entero con Z falso. */}
        <button onClick={abrir} disabled={ocupado || importeC == null}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importeC == null) ? 0.4 : 1 }}>
          <Wallet size={18} style={{ marginRight: 8 }} />
          {ocupado ? 'Abriendo…' : 'Abrir caja'}
        </button>
        <button onClick={reimprimirUltimoZ} style={{ ...btnSecundario, height: 44 }}>
          <Printer size={15} style={{ marginRight: 6 }} /> Reimprimir el último cierre Z
        </button>
        <button onClick={abrirHistorial} style={{ ...btnSecundario, height: 44 }}>
          Cierres anteriores
        </button>
      </div>
    )
  }

  // ── Historial de cierres ──────────────────────────────────────────────────
  if (vista === 'historial') {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <strong style={{ fontSize: 15, color: T.text }}>Cierres anteriores</strong>
        {cierres == null ? (
          <div style={{ padding: 16, textAlign: 'center', color: T.muted }}>Leyendo…</div>
        ) : !cierres.length ? (
          <div style={{ padding: 16, textAlign: 'center', color: T.muted, fontSize: 13 }}>
            Todavía no hay ningún cierre.
          </div>
        ) : cierres.map((c) => {
          const d = cents(c.descuadre)
          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 12, background: T.surface2,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {new Date(c.cerrada_at).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  {' · '}{new Date(c.cerrada_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 12, color: T.muted }}>
                  Contado {eur(cents(c.contado_final))} · esperado {eur(cents(c.esperado))}
                </div>
              </div>
              <div style={{
                fontSize: 13, fontWeight: 800, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                color: d === 0 ? T.ok : T.danger,
              }}>
                {d === 0 ? 'Cuadró' : (d > 0 ? '+' : '−') + eur(Math.abs(d))}
              </div>
              <button onClick={() => imprimirZDe(c)} title="Reimprimir Z"
                style={{ ...btnSecundario, height: 38, width: 42, padding: 0, flexShrink: 0 }}>
                <Printer size={15} />
              </button>
            </div>
          )
        })}
        <button onClick={() => setVista(estado?.abierta ? 'resumen' : 'resumen')}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  const esperado = cents(estado.esperado)

  // ── Entrada / salida ──────────────────────────────────────────────────────
  if (vista === 'entrada' || vista === 'salida') {
    const esEntrada = vista === 'entrada'
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 15, color: T.text }}>
          {esEntrada ? 'Meter dinero en la caja' : 'Sacar dinero de la caja'}
        </strong>
        <div>
          <label style={etiqueta}>Importe</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="20,00" inputMode="decimal" autoFocus style={inputOscuro} />
        </div>
        <div>
          <label style={etiqueta}>Motivo</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={esEntrada ? 'Cambio de la caja fuerte' : 'Pago al proveedor'}
            maxLength={80} style={inputOscuro} />
        </div>
        <button onClick={() => mover(vista)} disabled={ocupado || importeC == null || importeC <= 0}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importeC == null || importeC <= 0) ? 0.4 : 1 }}>
          {ocupado ? 'Guardando…' : `Apuntar ${esEntrada ? 'entrada' : 'salida'}`}
        </button>
        <button onClick={() => { setVista('resumen'); setImporte(''); setMotivo('') }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── Cierre ────────────────────────────────────────────────────────────────
  if (vista === 'cierre') {
    // `importeC` es null si lo tecleado no es un importe: la vista previa se
    // esconde en vez de pintar "Sobran NaN €".
    const descuadre = importeC == null ? null : importeC - esperado
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 15, color: T.text }}>Cerrar la caja</strong>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          Cuenta el dinero que hay en el cajón y escríbelo. Cuenta primero y mira
          después lo que debería haber: si no, cuadra siempre y no sirve de nada.
        </div>
        <div>
          <label style={etiqueta}>Dinero contado</label>
          <input value={importe} onChange={(e) => { setImporte(e.target.value.replace(/[^\d.,]/g, '')); setContando(false) }}
            placeholder="0,00" inputMode="decimal" autoFocus={!contando} readOnly={contando}
            style={{ ...inputOscuro, ...(contando ? { opacity: 0.85 } : null) }} />
        </div>

        {/* Contar por billetes y monedas: teclear el total de una calculadora
            aparte es justo donde se cuela el error que el descuadre quiere
            cazar. La suma rellena el campo de arriba sola. */}
        <button onClick={() => setContando((v) => !v)} style={{ ...btnSecundario, height: 42 }}>
          <Calculator size={15} style={{ marginRight: 6 }} />
          {contando ? 'Escribir el total a mano' : 'Contar por billetes y monedas'}
        </button>
        {contando && (
          <ContadorDenominaciones onTotal={(c) => setImporte((c / 100).toFixed(2).replace('.', ','))} />
        )}

        {descuadre != null && (
          <div style={{
            padding: 14, borderRadius: 12, textAlign: 'center',
            background: descuadre === 0 ? 'rgba(143,196,107,0.14)' : 'rgba(255,122,107,0.12)',
          }}>
            <div style={{ fontSize: 12, color: T.muted }}>Debería haber {eur(esperado)}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: descuadre === 0 ? T.ok : T.danger, marginTop: 4 }}>
              {descuadre === 0 ? 'Cuadra' : `${descuadre > 0 ? 'Sobran' : 'Faltan'} ${eur(Math.abs(descuadre))}`}
            </div>
          </div>
        )}

        <div>
          <label style={etiqueta}>Nota (opcional)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Se rompió un billete, propina..." maxLength={120} style={inputOscuro} />
        </div>

        <button onClick={cerrar} disabled={ocupado || importeC == null}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importeC == null) ? 0.4 : 1 }}>
          <Lock size={17} style={{ marginRight: 8 }} />
          {ocupado ? 'Cerrando…' : 'Cerrar caja'}
        </button>
        <button onClick={() => { setVista('resumen'); setImporte(''); setMotivo('') }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: T.muted }}>
        Abierta {new Date(estado.abierta_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        {' · '}{estado.tickets} ticket{estado.tickets === 1 ? '' : 's'}
      </div>

      <div style={{ background: T.surface2, borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <Fila etiqueta="Fondo inicial" valor={eur(cents(estado.fondo_inicial))} />
        <Fila etiqueta="Cobrado en mano (efectivo)" valor={eur(cents(estado.ventas_efectivo))} />
        {/* De qué puerta viene cada euro del cajón. Antes esta caja solo sabía
            del mostrador y el efectivo de los repartos aparecía como sobrante
            cada noche; ahora que cuenta todo, hay que poder verlo desglosado o
            no hay manera de fiarse del número. */}
        {estado.por_via && Object.entries(estado.por_via)
          .filter(([, v]) => Number(v.efectivo) > 0)
          .map(([clave, v]) => (
            <div key={clave} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.muted, paddingLeft: 10 }}>
              <span>· {VIAS[clave] || clave} ({v.pedidos})</span>
              <span>{eur(cents(v.efectivo))}</span>
            </div>
          ))}
        <Fila etiqueta="Entradas" valor={eur(cents(estado.entradas))} />
        <Fila etiqueta="Salidas" valor={'-' + eur(cents(estado.salidas))} />
        <div style={{ height: 1, background: T.border, margin: '4px 0' }} />
        <Fila etiqueta="Debería haber en el cajón" valor={eur(esperado)} fuerte />
        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
          Vendido en este turno: <strong style={{ color: T.text }}>{eur(cents(estado.venta_total))}</strong>.
          De eso, no está en el cajón lo del datáfono ({eur(cents(estado.ventas_datafono))}),
          que va al banco, ni lo pagado con tarjeta en la app ({eur(cents(estado.ventas_online))}),
          que llega por Stripe en la liquidación del lunes.
        </div>
      </div>

      <button onClick={async () => {
        // El X es el papel del cambio de turno: se imprime con una lectura
        // FRESCA del servidor, no con la foto de cuando se abrió este modal
        // (que puede llevar un rato abierto, o haberse cobrado desde otro
        // aparato en medio).
        const { data: fresco } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: establecimientoId })
        if (fresco) setEstado(fresco)
        const ok = await imprimirReporteCaja(fresco || estado, restaurante, 'X')
        toast(ok ? 'Informe X impreso' : 'La impresora no responde', ok ? 'success' : 'error')
      }} style={{ ...btnSecundario, width: '100%', height: 46 }}>
        <Printer size={16} style={{ marginRight: 6 }} /> Imprimir informe X (sin cerrar)
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setVista('entrada')} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowDownLeft size={16} style={{ marginRight: 6 }} /> Entrada
        </button>
        <button onClick={() => setVista('salida')} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowUpRight size={16} style={{ marginRight: 6 }} /> Salida
        </button>
      </div>

      <button onClick={abrirHistorial} style={{ ...btnSecundario, width: '100%', height: 42 }}>
        Cierres anteriores
      </button>

      <button onClick={() => setVista('cierre')} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
        <Lock size={17} style={{ marginRight: 8 }} /> Cerrar caja
      </button>
      {onCerrarModal && (
        <button onClick={onCerrarModal} style={{ ...btnSecundario, height: 44 }}>Seguir vendiendo</button>
      )}
    </div>
  )
}

function Fila({ etiqueta: e, valor, fuerte }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: fuerte ? 14 : 13, color: fuerte ? T.text : T.muted, fontWeight: fuerte ? 700 : 400 }}>{e}</span>
      <span style={{
        fontSize: fuerte ? 20 : 14, fontWeight: fuerte ? 800 : 600, color: T.text,
        fontVariantNumeric: 'tabular-nums',
      }}>{valor}</span>
    </div>
  )
}

const etiqueta = {
  display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6,
}

// ── Arqueo por denominaciones ────────────────────────────────────────────────
// Contar los billetes y monedas AQUÍ, no en una calculadora aparte: la suma
// rellena el campo de contado sola y no hay número que transcribir mal.
const DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]

function ContadorDenominaciones({ onTotal }) {
  const [n, setN] = useState({})
  const total = DENOMS.reduce((s, d) => s + d * (n[d] || 0), 0)

  const cambiar = (d, delta) => setN((prev) => {
    const next = { ...prev, [d]: Math.max(0, (prev[d] || 0) + delta) }
    onTotal(DENOMS.reduce((s, den) => s + den * (next[den] || 0), 0))
    return next
  })

  return (
    <div style={{ background: T.surface2, borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6,
      }}>
        {DENOMS.map((d) => (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 62, fontSize: 13, fontWeight: 700, color: d >= 500 ? T.text : T.muted,
              fontVariantNumeric: 'tabular-nums', textAlign: 'right',
            }}>
              {d >= 100 ? `${d / 100} €` : `${d} cts`}
            </span>
            <button onClick={() => cambiar(d, -1)} style={mini}><Minus size={12} /></button>
            <span style={{ minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: 700, color: (n[d] || 0) > 0 ? T.accent : T.muted }}>
              {n[d] || 0}
            </span>
            <button onClick={() => cambiar(d, +1)} style={mini}><Plus size={12} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
        <span style={{ fontSize: 13, color: T.muted }}>Suma del recuento</span>
        <strong style={{ fontSize: 16, color: T.text, fontVariantNumeric: 'tabular-nums' }}>{eur(total)}</strong>
      </div>
    </div>
  )
}

const mini = {
  width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`,
  background: T.surface, color: T.text, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
