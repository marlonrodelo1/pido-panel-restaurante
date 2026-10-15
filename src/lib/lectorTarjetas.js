// lectorTarjetas.js — el lector de tarjetas BBPOS WisePad 3 en el móvil del mostrador (15 oct 2026).
//
// El WisePad 3 se conecta por BLUETOOTH a un móvil o tablet Android con la app del panel. El TPV
// del ordenador no puede hablarle (Stripe solo lo deja usar desde sus SDK de móvil), así que este
// móvil hace de puente: recibe el cobro que pide el TPV, lo pasa al lector y avisa al servidor.
// La parte de servidor está en la edge `tpv-cobro-lector` (ver cobroLector.js).
//
// Plugin: @capacitor-community/stripe-terminal 8.2.1 con los arreglos de
// scripts/fix-stripe-terminal.mjs (los mismos que la app del socio, ver su cabecera).
// 🔴 Lo que aprendimos con el Tap to Pay del socio:
//   - el plugin no siempre resuelve sus promesas si el SDK falla: cada paso lleva tiempo máximo;
//   - initialize() solo cuenta una vez por proceso: los listeners se quitan antes de ponerlos;
//   - el token de conexión lo da la edge con la sesión del restaurante.
//
// Solo Android. En web y en iPhone, lectorSoportado() es false.
import { Capacitor } from '@capacitor/core'
import { llamarLector } from './cobroLector'

const MAX_ARRANQUE_MS = 30_000
const MAX_BUSCAR_MS = 30_000
// La primera conexión puede instalar una actualización obligatoria del lector: minutos.
const MAX_CONECTAR_MS = 12 * 60_000
const CLAVE_SERIAL = 'pidoo_lector_serial'

let _mod = null
let _init = null
let _conectado = null      // el lector conectado (ReaderInterface) o null
let _establecimiento = null
const _oyentes = new Set()

export function lectorSoportado() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('StripeTerminal')
  } catch {
    return false
  }
}

// La pantalla se suscribe a lo que cuenta el lector: { tipo, ... }
//   'desconectado' | 'mensaje' {texto} | 'actualizando' {progreso} | 'actualizado' | 'bateria' {nivel, cargando}
export function escucharLector(fn) {
  _oyentes.add(fn)
  return () => _oyentes.delete(fn)
}
function avisar(evento) {
  for (const fn of _oyentes) { try { fn(evento) } catch { /* una pantalla rota no tumba el lector */ } }
}

export class ErrorLector extends Error {
  constructor(codigo, detalle) {
    super(MENSAJES[codigo] || MENSAJES.desconocido)
    this.codigo = codigo
    this.detalle = detalle || null
  }
}

const MENSAJES = {
  no_soportado: 'Este aparato no puede usar el lector de tarjetas. Hace falta la app de Pidoo en un Android.',
  no_arranca: 'No se pudo preparar el lector. Revisa la conexión a internet e inténtalo otra vez.',
  permisos: 'La app necesita permiso de «Dispositivos cercanos» (Bluetooth) y de ubicación PRECISA para encontrar el lector. Dáselos en Ajustes del móvil → Aplicaciones → Pidoo Partner → Permisos.',
  bluetooth: 'Enciende el Bluetooth del móvil.',
  no_encontrado: 'No se encuentra el lector. Enciéndelo (botón del lateral), acércalo al móvil y vuelve a buscar.',
  no_conecta: 'No se pudo conectar con el lector. Apágalo y enciéndelo, y vuelve a intentarlo.',
  cuenta: 'El lector no está activado para este restaurante. Avisa a Pidoo.',
  cancelado: 'Cobro cancelado. No se ha cobrado nada.',
  rechazada: 'Tarjeta rechazada. Pide otra tarjeta o cobra de otra forma.',
  sin_lector: 'El lector no está conectado.',
  red: 'Sin conexión. Revisa internet.',
  desconocido: 'No se pudo cobrar. No se ha cobrado nada: inténtalo otra vez.',
}

function conTiempo(promesa, ms, codigo) {
  let t
  return Promise.race([
    Promise.resolve(promesa).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new ErrorLector(codigo)), ms) }),
  ])
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function plugin() {
  if (!_mod) _mod = await import('@capacitor-community/stripe-terminal')
  return _mod
}

// Mensajes que el lector pide enseñar, en castellano.
const TEXTO_MENSAJE = {
  CHECK_MOBILE_DEVICE: 'Mira el móvil del cliente',
  RETRY_CARD: 'Vuelve a pasar la tarjeta',
  INSERT_CARD: 'Inserta la tarjeta',
  INSERT_OR_SWIPE_CARD: 'Inserta o desliza la tarjeta',
  SWIPE_CARD: 'Desliza la tarjeta',
  REMOVE_CARD: 'Retira la tarjeta',
  MULTIPLE_CONTACTLESS_CARDS_DETECTED: 'Hay varias tarjetas juntas: acerca solo una',
  TRY_ANOTHER_READ_METHOD: 'Prueba de otra forma (insertar en vez de acercar)',
  TRY_ANOTHER_CARD: 'Prueba con otra tarjeta',
  CARD_REMOVED_TOO_EARLY: 'Has retirado la tarjeta antes de tiempo: vuelve a insertarla',
}
function textoEntrada(options) {
  const o = new Set(options || [])
  const partes = []
  if (o.has('TAP')) partes.push('acerca')
  if (o.has('INSERT')) partes.push('inserta')
  if (o.has('SWIPE')) partes.push('desliza')
  if (!partes.length) return 'Pasa la tarjeta por el lector'
  const t = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} o ${partes[partes.length - 1]}` : partes[0]
  return `${t[0].toUpperCase()}${t.slice(1)} la tarjeta en el lector`
}

async function inicializar(establecimientoId) {
  _establecimiento = establecimientoId
  if (_init) return _init
  _init = (async () => {
    const { StripeTerminal: ST, TerminalEventsEnum: Ev } = await plugin()
    try { await ST.removeAllListeners() } catch { /* no pasa nada */ }
    await ST.addListener(Ev.RequestedConnectionToken, async () => {
      const r = await llamarLector('token', _establecimiento)
      try { await ST.setConnectionToken({ token: (r.ok && r.data?.secret) || '' }) } catch { /* no pasa nada */ }
    })
    const perdido = () => { _conectado = null; avisar({ tipo: 'desconectado' }) }
    await ST.addListener(Ev.DisconnectedReader, perdido)
    await ST.addListener(Ev.UnexpectedReaderDisconnect, perdido)
    await ST.addListener(Ev.ReaderReconnectFailed, perdido)
    await ST.addListener(Ev.ReaderReconnectStarted, () => avisar({ tipo: 'reconectando' }))
    await ST.addListener(Ev.ReaderReconnectSucceeded, () => avisar({ tipo: 'reconectado' }))
    await ST.addListener(Ev.RequestReaderInput, ({ options }) => avisar({ tipo: 'mensaje', texto: textoEntrada(options) }))
    await ST.addListener(Ev.RequestDisplayMessage, ({ messageType, message }) =>
      avisar({ tipo: 'mensaje', texto: TEXTO_MENSAJE[messageType] || message || '' }))
    await ST.addListener(Ev.StartInstallingUpdate, () => avisar({ tipo: 'actualizando', progreso: 0 }))
    await ST.addListener(Ev.ReaderSoftwareUpdateProgress, ({ progress }) => avisar({ tipo: 'actualizando', progreso: Number(progress) || 0 }))
    await ST.addListener(Ev.FinishInstallingUpdate, () => avisar({ tipo: 'actualizado' }))
    await ST.addListener(Ev.BatteryLevel, ({ level, charging }) => avisar({ tipo: 'bateria', nivel: Number(level), cargando: !!charging }))
    await ST.initialize({ isTest: false })
  })()
  try {
    return await _init
  } catch (e) {
    _init = null
    throw e
  }
}

// ¿Hay un lector conectado ahora mismo? Devuelve el lector o null.
export async function lectorConectado() {
  if (!lectorSoportado() || !_init) return null
  try {
    const { StripeTerminal: ST } = await plugin()
    const { reader } = await conTiempo(ST.getConnectedReader(), 5_000, 'no_arranca')
    _conectado = reader || null
  } catch { /* se queda lo que había */ }
  return _conectado
}

export function serialGuardado() {
  try { return localStorage.getItem(CLAVE_SERIAL) || null } catch { return null }
}

// Arranca Stripe Terminal y busca lectores por Bluetooth. Devuelve la lista (puede venir vacía).
export async function buscarLectores(establecimientoId, locationId) {
  if (!lectorSoportado()) throw new ErrorLector('no_soportado')
  if (!locationId) throw new ErrorLector('cuenta')
  try {
    await conTiempo(inicializar(establecimientoId), MAX_ARRANQUE_MS, 'no_arranca')
  } catch (e) {
    throw traducir(e, 'no_arranca')
  }
  const { StripeTerminal: ST, TerminalConnectTypes: Tipos } = await plugin()
  try { await conTiempo(ST.cancelDiscoverReaders(), 5_000, 'no_arranca') } catch { /* no pasa nada */ }
  try {
    const r = await conTiempo(ST.discoverReaders({ type: Tipos.Bluetooth, locationId }), MAX_BUSCAR_MS, 'no_encontrado')
    return r?.readers || []
  } catch (e) {
    ST.cancelDiscoverReaders().catch(() => {})
    throw traducir(e, 'no_encontrado')
  }
}

// Conecta un lector de los encontrados (el plugin usa la Location de la última búsqueda).
// La primera vez puede instalarse una actualización obligatoria del lector: minutos.
export async function conectarLector(lector) {
  const { StripeTerminal: ST } = await plugin()
  try {
    await conTiempo(ST.connectReader({ reader: lector, autoReconnectOnUnexpectedDisconnect: true }), MAX_CONECTAR_MS, 'no_conecta')
  } catch (e) {
    throw traducir(e, 'no_conecta')
  }
  _conectado = lector
  try { localStorage.setItem(CLAVE_SERIAL, lector.serialNumber) } catch { /* no pasa nada */ }
  return lector
}

export async function desconectarLector() {
  try {
    const { StripeTerminal: ST } = await plugin()
    await conTiempo(ST.disconnectReader(), 15_000, 'no_conecta')
  } catch { /* no pasa nada */ }
  _conectado = null
}

// Pasa un cobro por el lector y lo confirma en el servidor.
// cobro = { id, client_secret, importe_cent } (de la edge `pendiente`).
// Devuelve { cobrado: true, tarjeta } o lanza ErrorLector.
export async function cobrarEnLector(establecimientoId, cobro, { onPaso } = {}) {
  if (!_conectado) throw new ErrorLector('sin_lector')
  const { StripeTerminal: ST } = await plugin()

  onPaso?.('tarjeta')
  try {
    await ST.collectPaymentMethod({ paymentIntent: cobro.client_secret })
  } catch (e) {
    throw traducir(e, 'desconocido')
  }

  onPaso?.('confirmando')
  let aprobado = false
  let errorConfirmar = null
  try {
    await ST.confirmPaymentIntent()
    aprobado = true
  } catch (e) {
    errorConfirmar = e
  }

  // La última palabra la tiene Stripe: el servidor le pregunta y, si está cobrado, lo apunta.
  for (let i = 0; i < 5; i++) {
    const r = await llamarLector('confirmar', establecimientoId, { cobro_id: cobro.id })
    if (r.ok && r.data?.cobrado) return { cobrado: true, tarjeta: r.data.tarjeta || null }
    if (r.status === 202 || r.status === 0) { await esperar(1500 * (i + 1)); continue }
    break
  }
  // El lector dijo «aprobado» pero el servidor no ha podido comprobarlo (sin red): el cobro es
  // real y el aviso de Stripe (webhook) o el vigilante lo apuntarán. El TPV lo verá llegar.
  if (aprobado) return { cobrado: true, tarjeta: null, pendienteRegistro: true }
  throw traducir(errorConfirmar, 'desconocido')
}

export async function cancelarLectura() {
  try {
    const { StripeTerminal: ST } = await plugin()
    await conTiempo(ST.cancelCollectPaymentMethod(), 8_000, 'desconocido')
  } catch { /* no pasa nada */ }
}

// Los errores del SDK llegan en inglés: se traducen por palabras clave a algo que se pueda
// resolver en el mostrador.
function traducir(e, porDefecto) {
  if (e instanceof ErrorLector) return e
  const partes = [e?.code, e?.message, e?.data?.code, e?.data?.declineCode, e?.data?.message, typeof e === 'string' ? e : null]
  const texto = partes.filter(Boolean).join(' | ')
  const t = texto.toLowerCase()
  const codigo =
    /cancel/.test(t) ? 'cancelado'
      : /declin|insufficient|expired|incorrect_pin|pin_|do_not_honor/.test(t) ? 'rechazada'
        : /bluetooth_disabled|bluetooth is (off|disabled)|bluetooth.*(off|disabled)/.test(t) ? 'bluetooth'
          : /permission|location/.test(t) ? 'permisos'
            : /not available|not enabled|not_enabled|account|country/.test(t) ? 'cuenta'
              : /network|timed out|timeout|offline|unable to resolve|connection_error/.test(t) ? 'red'
                : porDefecto
  return new ErrorLector(codigo, texto.slice(0, 300))
}
