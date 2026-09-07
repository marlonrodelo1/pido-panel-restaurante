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
//
// 🔴 EL IMPORTE SE TECLEA EN CÉNTIMOS, COMO UNA CAJA REGISTRADORA (6 sep 2026).
// Antes había un `<input>` de texto y un parser (`aCents`) que tenía que adivinar
// si "1.250,00" eran mil doscientos cincuenta o uno con veinticinco. Con el
// teclado, cada tecla entra por la derecha —1, 0, 0, 0, 0 son 100,00 €— y no hay
// nada que interpretar: el estado ES el número de céntimos. Rediseño pedido por
// Marlon a partir de las pantallas de Last.app.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { VIAS, etiquetaLinea } from '../lib/jornada'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { imprimirReporteCaja, pulsoCajon } from '../lib/printService'
import { ventasPendientes } from '../lib/colaVentas'
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock, Unlock, Printer, Calculator, Minus, Plus, Copy, Inbox } from 'lucide-react'

export default function TpvCaja({ establecimientoId, restaurante, vistaInicial = 'resumen', onCerrarModal }) {
  const [estado, setEstado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [vista, setVista] = useState(vistaInicial)   // resumen | entrada | salida | cierre | historial | cerrada
  const [importeC, setImporteC] = useState(0)        // SIEMPRE céntimos
  const [motivo, setMotivo] = useState('')
  const [contando, setContando] = useState(false)    // arqueo por denominaciones abierto
  const [confirmando, setConfirmando] = useState(false)
  const [ultimoCierre, setUltimoCierre] = useState(null)
  const [cerrada, setCerrada] = useState(null)       // la caja recién cerrada, para el resumen
  // 🔴 SE MIDE EL RECUADRO, NO LA VENTANA (7 sep 2026). Estaba con
  // `useEsMonitor()`, que mira el ancho de la PANTALLA: con el PC del local a
  // 1280 px y esta caja dentro de un modal de 440, se pintaban dos columnas en
  // 440 px y el teclado salia montado encima del resumen. Marlon lo vio y mando
  // la foto. Es la misma leccion del 2 de septiembre con la pantalla del TPV:
  // lo que manda es el hueco que tiene ESTE componente.
  const cajaRef = useRef(null)
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const el = cajaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width))
    ro.observe(el)
    setAncho(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  // 720 px: por debajo de eso, el resumen y el teclado no caben uno al lado del
  // otro sin que el teclado quede impracticable con el dedo.
  const dosColumnas = ancho >= 720

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: establecimientoId })
    if (error) { toast('No se pudo leer la caja: ' + error.message, 'error'); setCargando(false); return }
    setEstado(data)
    setCargando(false)
  }, [establecimientoId])

  useEffect(() => { cargar() }, [cargar])

  // El último cierre, para el botón "Copiar último cierre". En un bar el fondo de
  // hoy suele ser lo que quedó ayer, y teclearlo cada mañana es justo donde se
  // cuela un error de un dígito.
  useEffect(() => {
    supabase.from('tpv_cajas')
      .select('contado_final, cerrada_at').eq('establecimiento_id', establecimientoId)
      .not('cerrada_at', 'is', null)
      .order('cerrada_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setUltimoCierre(data || null))
  }, [establecimientoId])

  const limpiar = () => { setImporteC(0); setMotivo(''); setContando(false) }

  // La RPC ya habla claro ("Ya tienes una caja abierta…"); lo único que llegaba
  // crudo era el 23505 del índice único cuando dos aparatos abren a la vez.
  function errorCaja(error) {
    const choque = error?.code === '23505' || /duplicate key/i.test(error?.message || '')
    toast(choque ? 'Ya hay una caja abierta (quizá desde otro aparato).' : error.message, 'error')
    cargar()   // la pantalla se pone al día en vez de quedarse mintiendo
  }

  async function abrirCajon() {
    const ok = await pulsoCajon()
    if (!ok) toast('El cajón no responde (¿está conectado a la impresora?)', 'error')
  }

  async function abrir() {
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_abrir_caja', {
      p_establecimiento_id: establecimientoId, p_fondo: importeC / 100,
    })
    setOcupado(false)
    if (error) { errorCaja(error); return }
    toast('Turno abierto con ' + eur(importeC) + ' en el cajón', 'success')
    limpiar(); setVista('resumen'); cargar()
    // 🔴 Y AL MOSTRADOR. Antes se quedaba en esta ventana, con el botón gordo de
    // "Cerrar caja" delante: acabas de abrir el turno y lo que te invita a hacer
    // la pantalla es cerrarlo. Lo que toca después de abrir es vender.
    onCerrarModal?.()
  }

  async function mover(tipo) {
    if (importeC <= 0) { toast('Escribe cuánto, por ejemplo 20,00', 'error'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_movimiento_caja', {
      p_establecimiento_id: establecimientoId, p_tipo: tipo,
      p_importe: importeC / 100, p_motivo: motivo || null,
    })
    setOcupado(false)
    if (error) { errorCaja(error); return }
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${eur(importeC)} apuntada`, 'success')
    limpiar(); setVista('resumen'); cargar()
  }

  async function cerrar() {
    setConfirmando(false)
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
    // había forma de volver a sacarlo. Ahora avisa, y en el resumen queda el
    // botón de reimprimirlo.
    imprimirReporteCaja(data, restaurante, 'Z')
      .then((ok) => { if (!ok) toast('La caja está cerrada, pero el Z no se imprimió. Puedes reimprimirlo desde aquí.', 'error') })
      .catch(() => toast('La caja está cerrada, pero el Z no se imprimió. Puedes reimprimirlo desde aquí.', 'error'))
    // Antes de esto, cerrar solo dejaba un toast de tres segundos: el resumen de
    // lo que acababa de pasar se perdía. Ahora queda en pantalla hasta que se
    // cierra a propósito.
    setCerrada(data)
    setUltimoCierre({ contado_final: data?.contado_final, cerrada_at: data?.cerrada_at })
    limpiar(); setVista('cerrada'); cargar()
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

  // El div medido envuelve TODAS las vistas: por eso el cuerpo se arma aparte y
  // se devuelve al final envuelto en `cajaRef`.
  const cuerpo = (() => {
  if (cargando) {
    return <div style={{ padding: 24, textAlign: 'center', color: T.muted }}>Leyendo la caja…</div>
  }

  // ── Resumen de la caja que se acaba de cerrar ─────────────────────────────
  if (vista === 'cerrada' && cerrada) {
    const d = cents(cerrada.descuadre)
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <strong style={{ fontSize: 17, color: T.text }}>Caja cerrada</strong>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            Del {fechaHora(cerrada.abierta_at)} al {fechaHora(cerrada.cerrada_at)}
          </div>
        </div>

        <div style={{
          padding: 16, borderRadius: 14, textAlign: 'center',
          background: d === 0 ? 'rgba(143,196,107,0.14)' : 'rgba(255,122,107,0.12)',
        }}>
          <div style={{ fontSize: 12, color: T.muted }}>Diferencia del recuento</div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4, color: d === 0 ? T.ok : T.danger }}>
            {d === 0 ? '0,00 €' : (d > 0 ? '+' : '−') + eur(Math.abs(d))}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {d === 0 ? 'Cuadra' : d > 0 ? 'Sobra dinero en el cajón' : 'Falta dinero en el cajón'}
          </div>
        </div>

        <div style={{ background: T.surface2, borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span style={{ flex: 1 }} />
            <span style={{ width: 90, textAlign: 'right' }}>Teórico</span>
            <span style={{ width: 90, textAlign: 'right' }}>Real</span>
          </div>
          <FilaTres etiqueta="Efectivo" teorico={eur(cents(cerrada.esperado))} real={eur(cents(cerrada.contado_final))} />
          <div style={{ height: 1, background: T.border }} />
          <Fila etiqueta="Vendido en el turno" valor={eur(cents(cerrada.venta_total))} />
          <Fila etiqueta="Fondo con el que se abrió" valor={eur(cents(cerrada.fondo_inicial))} />
        </div>

        <button onClick={() => imprimirZDe(cerrada)} style={{ ...btnSecundario, height: 46 }}>
          <Printer size={16} style={{ marginRight: 6 }} /> Imprimir el reporte Z
        </button>
        <button onClick={() => { setCerrada(null); setVista('resumen') }} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
          Continuar
        </button>
      </div>
    )
  }

  // ── Sin caja abierta: el comienzo del turno ───────────────────────────────
  if (!estado?.abierta) {
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

        <Pestanas contando={contando} setContando={setContando} />
        <Display valor={importeC} etiqueta="Fondo inicial" />
        {contando
          ? <ContadorDenominaciones onTotal={setImporteC} />
          : <Teclado onCambio={setImporteC} valor={importeC} />}

        <button onClick={abrirCajon} style={{ ...btnSecundario, height: 46 }}>
          <Inbox size={16} style={{ marginRight: 6 }} /> Abrir cajón
        </button>
        {/* Sin importe escrito no se puede abrir: quien venía buscando el
            informe X o el Z aterrizaba aquí y un toque abría una caja a 0 €
            sin querer — y deshacerla obligaba a un cierre entero con Z falso. */}
        <button onClick={abrir} disabled={ocupado || importeC <= 0}
          style={{ ...btnAccion, height: 54, fontSize: 17, opacity: (ocupado || importeC <= 0) ? 0.4 : 1 }}>
          <Wallet size={18} style={{ marginRight: 8 }} />
          {ocupado ? 'Abriendo…' : 'Comenzar'}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reimprimirUltimoZ} style={{ ...btnSecundario, flex: 1, height: 44 }}>
            <Printer size={15} style={{ marginRight: 6 }} /> Último Z
          </button>
          {/* El fondo de hoy suele ser lo que quedó ayer. Teclearlo otra vez es
              regalar una oportunidad de equivocarse en un dígito. */}
          {ultimoCierre?.contado_final != null && (
            <button onClick={() => { setContando(false); setImporteC(cents(ultimoCierre.contado_final)) }}
              style={{ ...btnSecundario, flex: 1, height: 44 }}>
              <Copy size={15} style={{ marginRight: 6 }} />
              Copiar cierre: {eur(cents(ultimoCierre.contado_final))}
            </button>
          )}
        </div>
        <button onClick={abrirHistorial} style={{ ...btnSecundario, height: 42 }}>
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
        <button onClick={() => setVista('resumen')} style={{ ...btnSecundario, height: 44 }}>Volver</button>
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
        <Display valor={importeC} etiqueta="Importe" />
        <Teclado onCambio={setImporteC} valor={importeC} />
        <div>
          <label style={etiqueta}>Motivo</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={esEntrada ? 'Cambio de la caja fuerte' : 'Pago al proveedor'}
            maxLength={80} style={inputOscuro} />
        </div>
        <button onClick={() => mover(vista)} disabled={ocupado || importeC <= 0}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importeC <= 0) ? 0.4 : 1 }}>
          {ocupado ? 'Guardando…' : `Apuntar ${esEntrada ? 'entrada' : 'salida'}`}
        </button>
        <button onClick={() => { setVista('resumen'); limpiar() }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── Cierre ────────────────────────────────────────────────────────────────
  if (vista === 'cierre') {
    const tecleado = importeC > 0 || contando
    const descuadre = importeC - esperado

    // Izquierda: el resumen del turno. Mientras no se ha tecleado nada solo se
    // ve el teórico; en cuanto entra un número aparecen real y diferencia, que
    // es lo que se mira de verdad al cuadrar.
    const resumen = (
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <div>
          <strong style={{ fontSize: 16, color: T.text }}>{restaurante?.nombre || 'Caja'}</strong>
          <div style={{ fontSize: 12, color: T.muted }}>Resumen del turno</div>
        </div>

        <div style={{
          borderRadius: 14, padding: 16,
          background: !tecleado ? T.surface2
            : descuadre === 0 ? 'rgba(143,196,107,0.14)' : 'rgba(255,122,107,0.12)',
          display: 'grid', gap: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 15, color: T.text }}>Efectivo</strong>
            <span style={{ fontSize: 12, color: T.muted }}>
              Teórico <strong style={{ fontSize: 16, color: T.text, marginLeft: 6 }}>{eur(esperado)}</strong>
            </span>
          </div>
          {tecleado && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, color: T.muted }}>
                Real <strong style={{ fontSize: 16, color: T.text, marginLeft: 6 }}>{eur(importeC)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', fontSize: 12, color: T.muted }}>
                Diferencia
                <strong style={{
                  fontSize: 20, marginLeft: 8, fontVariantNumeric: 'tabular-nums',
                  color: descuadre === 0 ? T.ok : T.danger,
                }}>
                  {descuadre === 0 ? '0,00 €' : (descuadre > 0 ? '+' : '−') + eur(Math.abs(descuadre))}
                </strong>
              </div>
            </>
          )}
        </div>

        <div>
          <label style={etiqueta}>Añadir comentario</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Se rompió un billete, propina…" maxLength={120} style={inputOscuro} />
        </div>

        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
          Cuenta primero el dinero y mira después lo que debería haber: si lo haces
          al revés, cuadra siempre y no sirve de nada.
        </div>
      </div>
    )

    // Derecha: el teclado.
    const panel = (
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <Pestanas contando={contando} setContando={setContando} />
        <Display valor={importeC} etiqueta="Dinero contado" />
        {contando
          ? <ContadorDenominaciones onTotal={setImporteC} />
          : <Teclado onCambio={setImporteC} valor={importeC} />}
        <button onClick={abrirCajon} style={{ ...btnSecundario, height: 46 }}>
          <Inbox size={16} style={{ marginRight: 6 }} /> Abrir cajón
        </button>
        <button onClick={() => setConfirmando(true)} disabled={ocupado || !tecleado}
          style={{ ...btnAccion, height: 54, fontSize: 17, opacity: (ocupado || !tecleado) ? 0.4 : 1 }}>
          <Lock size={17} style={{ marginRight: 8 }} />
          {ocupado ? 'Cerrando…' : 'Finalizar'}
        </button>
        <button onClick={() => { setVista('resumen'); limpiar() }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )

    return (
      <>
        {dosColumnas
          ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20 }}>{resumen}{panel}</div>
          : <div style={{ display: 'grid', gap: 14 }}>{resumen}{panel}</div>}

        {/* Antes de guardar, lo que se va a declarar. Un cierre no se deshace:
            se corrige con otro cierre, y el descuadre ya queda escrito. */}
        {confirmando && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }} onClick={() => setConfirmando(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: T.surface, borderRadius: 16, padding: 22, maxWidth: 420, width: '100%',
              border: `1px solid ${T.border}`, textAlign: 'center', display: 'grid', gap: 14,
            }}>
              <strong style={{ fontSize: 16, color: T.text }}>
                La caja se cerrará con estas cantidades
              </strong>
              <div style={{ fontSize: 15, color: T.text }}>
                Efectivo contado: <strong>{eur(importeC)}</strong>
              </div>
              <div style={{ fontSize: 13, color: descuadre === 0 ? T.ok : T.danger }}>
                {descuadre === 0
                  ? 'Cuadra con lo que debería haber.'
                  : `${descuadre > 0 ? 'Sobran' : 'Faltan'} ${eur(Math.abs(descuadre))} respecto a los ${eur(esperado)} que debería haber.`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmando(false)} style={{ ...btnSecundario, flex: 1, height: 48 }}>
                  Cancelar
                </button>
                <button onClick={cerrar} disabled={ocupado}
                  style={{ ...btnAccion, flex: 1, height: 48, opacity: ocupado ? 0.5 : 1 }}>
                  {ocupado ? 'Cerrando…' : 'Finalizar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: T.muted }}>
        Abierta {new Date(estado.abierta_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        {' · '}{estado.pedidos ?? estado.tickets} pedido{(estado.pedidos ?? estado.tickets) === 1 ? '' : 's'} cobrado{(estado.pedidos ?? estado.tickets) === 1 ? '' : 's'}
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

      {/* TODO LO VENDIDO EN EL TURNO, línea a línea. Marlon: "pedido pagado por
          datáfono en delivery, pedidos en efectivo de delivery, pedido de
          recogida en tarjeta, mostrador... eso debe estar bien especificado, para
          que las cuentas me sean claras". Arriba está lo que hay en el CAJÓN;
          esto es la venta entera, cobre quien la cobre. */}
      {estado.desglose?.length > 0 && (
        <div style={{ background: T.surface2, borderRadius: 12, padding: 14, display: 'grid', gap: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.muted, textTransform: 'uppercase' }}>
            Todo lo vendido en este turno
          </div>
          {estado.desglose.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
              <span style={{ color: T.muted, minWidth: 0 }}>
                {etiquetaLinea(d)} <span style={{ opacity: 0.7 }}>({d.pedidos})</span>
              </span>
              <span style={{ fontWeight: 700, color: T.text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {eur(cents(d.total))}
              </span>
            </div>
          ))}
          <div style={{ height: 1, background: T.border, margin: '2px 0' }} />
          <Fila etiqueta="Total vendido" valor={eur(cents(estado.venta_total))} fuerte />
        </div>
      )}

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
        <button onClick={() => { limpiar(); setVista('entrada') }} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowDownLeft size={16} style={{ marginRight: 6 }} /> Entrada
        </button>
        <button onClick={() => { limpiar(); setVista('salida') }} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowUpRight size={16} style={{ marginRight: 6 }} /> Salida
        </button>
      </div>

      <button onClick={abrirHistorial} style={{ ...btnSecundario, width: '100%', height: 42 }}>
        Cierres anteriores
      </button>

      {/* El botón grande es SEGUIR VENDIENDO, no cerrar. Cerrar la caja se hace
          una vez al día; entrar aquí a mirar cuánto hay, veinte. Con el naranja
          en "Cerrar caja" la pantalla estaba invitando a cerrar el turno cada
          vez que alguien miraba la caja. */}
      {onCerrarModal && (
        <button onClick={onCerrarModal} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
          Seguir vendiendo
        </button>
      )}
      <button onClick={() => { limpiar(); setVista('cierre') }} style={{ ...btnSecundario, height: 46 }}>
        <Lock size={16} style={{ marginRight: 8 }} /> Cerrar caja y turno
      </button>
    </div>
  )
  })()

  return <div ref={cajaRef}>{cuerpo}</div>
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function fechaHora(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

// El importe, en grande. Es el número que se mira mientras se teclea.
function Display({ valor, etiqueta: e }) {
  return (
    <div style={{
      background: T.surface2, borderRadius: 12, padding: '14px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
    }}>
      <span style={{ fontSize: 12, color: T.muted }}>{e}</span>
      <strong style={{ fontSize: 30, color: T.text, fontVariantNumeric: 'tabular-nums' }}>
        {eur(valor)}
      </strong>
    </div>
  )
}

function Pestanas({ contando, setContando }) {
  const base = { flex: 1, height: 44, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, border: 'none' }
  return (
    <div style={{ display: 'flex', gap: 6, background: T.surface2, padding: 4, borderRadius: 12 }}>
      <button onClick={() => setContando(false)} style={{
        ...base, background: contando ? 'transparent' : T.accent,
        color: contando ? T.muted : '#fff', fontWeight: contando ? 500 : 700,
      }}>Total</button>
      <button onClick={() => setContando(true)} style={{
        ...base, background: contando ? T.accent : 'transparent',
        color: contando ? '#fff' : T.muted, fontWeight: contando ? 700 : 500,
      }}>
        <Calculator size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
        Billetes y monedas
      </button>
    </div>
  )
}

// Teclado de caja registradora: los dígitos entran por la DERECHA, en céntimos.
// Teclear 1-0-0-0-0 son 100,00 €. Así no hay comas, ni puntos, ni un parser que
// tenga que adivinar si "1.250" son mil doscientos cincuenta o uno con veinticinco.
function Teclado({ valor, onCambio }) {
  const pulsar = (d) => onCambio(Math.min(valor * 10 + d, 10000000))   // tope 100.000 €
  const borrar = () => onCambio(Math.floor(valor / 10))
  const limpiar = () => onCambio(0)

  const tecla = {
    height: 62, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 22, fontWeight: 700, color: T.text,
    border: `1px solid ${T.border}`, background: T.surface,
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
      {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((d) => (
        <button key={d} onClick={() => pulsar(d)} style={tecla}>{d}</button>
      ))}
      <button onClick={borrar} style={{ ...tecla, fontSize: 18, color: T.muted }} aria-label="Borrar un dígito">←</button>
      <button onClick={() => pulsar(0)} style={tecla}>0</button>
      <button onClick={limpiar} style={{ ...tecla, fontSize: 16, color: T.muted }} aria-label="Borrar todo">C</button>
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

function FilaTres({ etiqueta: e, teorico, real }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.text }}>{e}</span>
      <span style={{ width: 90, textAlign: 'right', fontSize: 14, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{teorico}</span>
      <span style={{ width: 90, textAlign: 'right', fontSize: 14, fontWeight: 700, color: T.text, fontVariantNumeric: 'tabular-nums' }}>{real}</span>
    </div>
  )
}

const etiqueta = {
  display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6,
}

// ── Arqueo por denominaciones ────────────────────────────────────────────────
// Contar los billetes y monedas AQUÍ, no en una calculadora aparte: la suma
// rellena el importe sola y no hay número que transcribir mal.
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
