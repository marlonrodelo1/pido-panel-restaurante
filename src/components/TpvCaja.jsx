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
import { useRest } from '../context/RestContext'
import { VIAS, etiquetaLinea } from '../lib/jornada'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { imprimirReporteCaja, pulsoCajon } from '../lib/printService'
import { ventasPendientes } from '../lib/colaVentas'
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock, Unlock, Printer, Calculator, Minus, Plus, Inbox } from 'lucide-react'

export default function TpvCaja({ establecimientoId, restaurante, vistaInicial = 'resumen', onCerrarModal }) {
  // La BASE del cajón (15 sep 2026): lo que se deja cada noche para dar cambio.
  // Al cerrar, lo que pase de ahí se va a la caja mayor. La edita el dueño en el
  // panel web (`tpv_config.fondo_base`) y la cuenta de verdad la hace el servidor
  // al cerrar; aquí solo se usa para ENSEÑAR ese reparto antes de que ocurra.
  //
  // 🔴 SE VUELVE A LEER, NO SE FÍA DEL CONTEXTO. `tpvConfig` se carga al arrancar
  // y solo se refresca al volver a primer plano, y el TPV está SIEMPRE delante:
  // si el dueño cambia la base en el panel web, la tablet seguiría con la vieja,
  // el aviso antes de cerrar diría un reparto y el servidor haría otro. Por eso
  // se lee al abrir esta ventana, al entrar en el cierre y al pulsar Finalizar.
  // Mientras no llega (o si falla la lectura), vale la del contexto.
  const { tpvConfig } = useRest()
  const [baseLeidaC, setBaseLeidaC] = useState(undefined)   // undefined = aún no leída
  const baseC = baseLeidaC !== undefined ? baseLeidaC : centsONull(tpvConfig?.fondo_base)
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

  const leerBase = useCallback(async () => {
    const { data, error } = await supabase.from('tpv_config')
      .select('fondo_base').eq('establecimiento_id', establecimientoId).maybeSingle()
    if (!error) setBaseLeidaC(centsONull(data?.fondo_base))
  }, [establecimientoId])
  const enCierre = vista === 'cierre'
  useEffect(() => { leerBase() }, [leerBase, enCierre])

  // El aviso «Pones X € más/menos…» espera a que se deje de teclear. El teclado
  // mete los céntimos por la derecha: para escribir 50,00 se pasa por 0,05, 0,50
  // y 5,00, y en cada tecla salía «Pones 49,95 € menos…». A quien no sabe de
  // cuentas le parecía que estaba haciendo algo mal a cada pulsación.
  const [importeQuietoC, setImporteQuietoC] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setImporteQuietoC(importeC), 800)
    return () => clearTimeout(t)
  }, [importeC])

  // El último cierre, para proponer con cuánto se empieza. En un bar el fondo de
  // hoy suele ser lo que quedó ayer, y teclearlo cada mañana es justo donde se
  // cuela un error de un dígito.
  //
  // 🔴 LO QUE QUEDÓ NO ES LO CONTADO (15 sep 2026). Desde que existe la caja
  // mayor, al cerrar se retira lo que pasa de la base: en el cajón queda
  // `fondo_siguiente`, no `contado_final`. Proponer lo contado entero haría
  // abrir con 237 € un cajón que tiene 50, y el turno nacería descuadrado. Por
  // eso de aquí solo se usa lo contado, y solo como último recurso: lo que
  // debería haber en el cajón lo trae `tpv_estado_caja` (ver `debeHaberC`).
  useEffect(() => {
    supabase.from('tpv_cajas')
      .select('contado_final, cerrada_at, fondo_siguiente, retirado_caja_mayor').eq('establecimiento_id', establecimientoId)
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

  // Se abre SIEMPRE con lo que pone la pantalla: nunca a 0 € ni con una
  // propuesta de un solo toque. Ver la nota junto al botón.
  async function abrir() {
    if (!(importeC > 0)) return
    setOcupado(true)
    // 🔴 SE VUELVE A LEER JUSTO ANTES DE ABRIR (15 sep 2026). Lo que debería haber
    // en el cajón se leyó al abrir esta ventana, y la ventana puede llevar un
    // rato abierta: si mientras tanto se entrega un reparto cobrado en efectivo,
    // la propuesta y el aviso de la diferencia hablan de una cifra vieja y el
    // servidor mide contra la nueva. Si ha cambiado, NO se abre: la pantalla se
    // pone al día y quien abre vuelve a mirar la cantidad antes de pulsar. Si la
    // lectura falla se sigue: la diferencia la calcula el servidor igualmente.
    const { data: fresco, error: errorLectura } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: establecimientoId })
    if (!errorLectura && fresco) {
      const antesC = centsONull(estado?.esperado_apertura)
      const ahoraC = centsONull(fresco.esperado_apertura)
      setEstado(fresco)
      if (fresco.abierta) {
        setOcupado(false)
        toast('Ya hay una caja abierta (quizá desde otro aparato).', 'error')
        return
      }
      if (antesC !== ahoraC) {
        setOcupado(false)
        toast(ahoraC != null
          ? `Lo que debería haber en el cajón acaba de cambiar: ahora son ${eur(ahoraC)}. Revisa la cantidad y vuelve a pulsar.`
          : 'La caja acaba de cambiar. Revisa la cantidad y vuelve a pulsar.', 'error')
        return
      }
    }
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
    setUltimoCierre({
      contado_final: data?.contado_final, cerrada_at: data?.cerrada_at,
      fondo_siguiente: data?.fondo_siguiente ?? null, retirado_caja_mayor: data?.retirado_caja_mayor ?? null,
    })
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
    // Manda lo que ha guardado el servidor. Solo si no lo trajera se recalcula,
    // y entonces con la base de ESTA caja antes que con la de la configuración:
    // el dueño pudo cambiarla después.
    const reparto = (cerrada.retirado_caja_mayor != null && cerrada.fondo_siguiente != null)
      ? { aMayor: cents(cerrada.retirado_caja_mayor), enCajon: cents(cerrada.fondo_siguiente) }
      : repartoCierre(cents(cerrada.contado_final), centsONull(cerrada.fondo_base) ?? baseC)
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

        {/* A DÓNDE VA EL DINERO CONTADO (15 sep 2026). Lo que pasa de la base se
            saca y se guarda aparte: es la caja mayor. Si la pantalla no lo dice,
            ese dinero se queda en el cajón y mañana nadie sabe con cuánto abrir. */}
        {reparto && (
          <div style={{ background: T.surface2, borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
            <Fila etiqueta="Pasa a la caja mayor" valor={eur(reparto.aMayor)} fuerte />
            <Fila etiqueta="Se queda en el cajón para mañana" valor={eur(reparto.enCajon)} />
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
              {reparto.aMayor > 0
                ? `Saca ${eur(reparto.aMayor)} del cajón y guárdalos aparte. `
                : 'Todo se queda en el cajón. '}
              Lo de la caja mayor lo ves en Contabilidad → Tu dinero.
            </div>
          </div>
        )}

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
    // CON CUÁNTO SE EMPIEZA. Por orden: lo que debería haber en el cajón según
    // el servidor; si no se sabe (cierres de antes de la caja mayor), la base
    // del cajón; y si tampoco hay base, lo contado en el último cierre, como se
    // hacía antes.
    //
    // 🔴 LO QUE DEBERÍA HABER LO DICE EL SERVIDOR (15 sep 2026). No es solo lo
    // que quedó al cerrar (`fondo_siguiente`): si después del Z se entrega un
    // pedido cobrado en efectivo, ese dinero también está en el cajón, y
    // `tpv_abrir_caja` mide la diferencia contra las dos cosas juntas. La
    // pantalla proponía solo lo que quedó: al aceptarlo, la caja mayor contaba
    // ese dinero dos veces (al abrir y otra vez al cerrar). Ahora la cifra es
    // `esperado_apertura` de `tpv_estado_caja`, la misma que usa el servidor, y
    // aquí no se suma nada. Si la lectura falló, no hay cifra y se pide contar.
    const debeHaberC = centsONull(estado?.esperado_apertura)
    const despuesC = centsONull(estado?.efectivo_despues_cierre) || 0
    const propuestaC = debeHaberC ?? baseC ?? centsONull(ultimoCierre?.contado_final)
    const dePropuesta = debeHaberC != null
      ? (despuesC > 0
        ? `Es lo que quedó en el cajón al cerrar (${eur(cents(estado.quedo_al_cerrar))}) más ${eur(despuesC)} de pedidos cobrados en efectivo después.`
        : 'Es lo que quedó en el cajón al cerrar.')
      : baseC != null ? 'Es la base del cajón.'
      : 'Es lo que se contó en el último cierre.'
    // Si no se sabe lo que quedó (los cierres de antes de la caja mayor no lo
    // guardaron), la propuesta es un número de manual, no el del cajón: se pide
    // contarlo antes. Si se sabe, basta con recordar que se puede poner otro.
    const notaPropuesta = debeHaberC == null
      ? ' Cuenta el cajón antes: si hay otra cantidad, escríbela.'
      : ' ¿Hay otra cantidad? Escríbela arriba.'
    // Si se teclea otra cantidad, la diferencia con lo que debería haber no sale
    // de la nada: el servidor la apunta contra la caja mayor. Se avisa ANTES de
    // abrir, pero solo con el número ya quieto (ver `importeQuietoC`).
    const difC = debeHaberC != null && importeC > 0 && importeQuietoC === importeC ? importeC - debeHaberC : 0
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

        {/* La propuesta RELLENA el importe, no abre (ver la nota del botón de
            abrir). Se queda en su sitio aunque ya esté puesta, apagada: si
            desapareciera, todo lo de debajo subiría y un segundo toque rápido
            caería en otro botón. */}
        {propuestaC > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <button onClick={() => { setContando(false); setImporteC(propuestaC) }}
              disabled={importeC === propuestaC}
              style={{ ...btnSecundario, height: 46, opacity: importeC === propuestaC ? 0.4 : 1 }}>
              Poner {eur(propuestaC)}
            </button>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, textAlign: 'center' }}>
              {dePropuesta}{notaPropuesta}
            </div>
          </div>
        )}

        {difC !== 0 && (
          <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, background: T.surface2, borderRadius: 12, padding: '10px 12px' }}>
            {difC > 0
              ? `Pones ${eur(difC)} más de lo que debería haber en el cajón (${eur(debeHaberC)}): se apuntará como sacado de la caja mayor.`
              : `Pones ${eur(-difC)} menos de lo que debería haber en el cajón (${eur(debeHaberC)}): la diferencia cuenta como pasada a la caja mayor.`}
          </div>
        )}

        <button onClick={abrirCajon} style={{ ...btnSecundario, height: 46 }}>
          <Inbox size={16} style={{ marginRight: 6 }} /> Abrir cajón
        </button>
        {/* 🔴 NUNCA SE ABRE UNA CAJA CON UN SOLO TOQUE. A esta pantalla se llega
            sin querer: «Meter dinero», «Sacar dinero», «Estado de la caja»,
            «Informe X» y «Cierre Z» abren esta ventana aunque no haya caja, y
            también el «Continuar» de después de cerrar. Cuando la propuesta
            abría directamente, quien buscaba el X o el Z abría una caja sin
            querer, y deshacerla obliga a un cierre entero con un Z falso.

            Por eso abrir es SOLO este botón: no se enciende hasta que hay una
            cantidad puesta (tecleada o con «Poner») y siempre lleva escrito con
            cuánto se abre. Además, en los cierres de antes de la caja mayor la
            propuesta es la base, no lo que hay de verdad en el cajón. */}
        <button onClick={() => abrir()} disabled={ocupado || importeC <= 0}
          style={{ ...btnAccion, height: 54, fontSize: 17, opacity: (ocupado || importeC <= 0) ? 0.4 : 1 }}>
          <Wallet size={18} style={{ marginRight: 8 }} />
          {ocupado ? 'Abriendo…' : importeC > 0 ? `Empezar con ${eur(importeC)}` : 'Escribe con cuánto empiezas'}
        </button>

        <button onClick={reimprimirUltimoZ} style={{ ...btnSecundario, height: 44 }}>
          <Printer size={15} style={{ marginRight: 6 }} /> Último Z
        </button>
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
                {/* Lo retirado a la caja mayor, para que "contado 237" y "abrió
                    con 50" al día siguiente no parezcan dinero perdido. */}
                {Number(c.retirado_caja_mayor) > 0 && (
                  <div style={{ fontSize: 12, color: T.muted }}>
                    Pasó a la caja mayor {eur(cents(c.retirado_caja_mayor))}
                    {c.fondo_siguiente != null && <> · quedó {eur(cents(c.fondo_siguiente))}</>}
                  </div>
                )}
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
    // El reparto que hará el servidor al cerrar, para enseñarlo antes, con la
    // base recién leída de `tpv_config`: la misma que usa `tpv_cerrar_caja`.
    const repartoConfirm = repartoCierre(importeC, baseC)

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
        <button onClick={() => { leerBase(); setConfirmando(true) }} disabled={ocupado || !tecleado}
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
              {/* Qué pasa con ese dinero al pulsar Finalizar: lo que pasa de la
                  base va a la caja mayor y la base se queda para mañana. */}
              {repartoConfirm && (
                <div style={{ background: T.surface2, borderRadius: 12, padding: 12, display: 'grid', gap: 6, textAlign: 'left' }}>
                  <Fila etiqueta="Pasa a la caja mayor" valor={eur(repartoConfirm.aMayor)} />
                  <Fila etiqueta="Se queda en el cajón para mañana" valor={eur(repartoConfirm.enCajon)} />
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                    {importeC > baseC
                      ? `La base del cajón es ${eur(baseC)}. `
                      : importeC === baseC
                        ? 'Es justo la base: todo se queda en el cajón. '
                        : `No llega a la base de ${eur(baseC)}: todo se queda en el cajón. `}
                    Lo de la caja mayor lo ves en Contabilidad → Tu dinero.
                  </div>
                </div>
              )}
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

// Euros de la BD → céntimos, pero distinguiendo "no hay dato" de "0 €": una caja
// de antes de la caja mayor no tiene `fondo_siguiente`, y tratarlo como 0
// propondría abrir con un cajón vacío.
function centsONull(euros) {
  return euros == null || euros === '' ? null : cents(euros)
}

// Lo que se lleva la caja mayor y lo que se queda en el cajón, en céntimos. Es
// la misma cuenta que hace `tpv_cerrar_caja`: max(contado − base, 0). Aquí solo
// sirve para ENSEÑARLA; lo que queda guardado es lo que calcula el servidor.
function repartoCierre(contadoC, baseC) {
  if (baseC == null) return null
  const aMayor = Math.max(contadoC - baseC, 0)
  return { aMayor, enCajon: contadoC - aMayor }
}

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

// `gap` y `nowrap` en la cifra: con etiquetas largas ("Se queda en el cajón para
// mañana") en un móvil de 340 px, la etiqueta baja de renglón pero el importe no
// se parte en "237,80" / "€".
function Fila({ etiqueta: e, valor, fuerte }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: fuerte ? 14 : 13, color: fuerte ? T.text : T.muted, fontWeight: fuerte ? 700 : 400, minWidth: 0 }}>{e}</span>
      <span style={{
        fontSize: fuerte ? 20 : 14, fontWeight: fuerte ? 800 : 600, color: T.text,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
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
