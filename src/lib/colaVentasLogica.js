// LA COLA DE VENTAS SIN INTERNET: la parte que DECIDE.
//
// Sin pantalla, sin red y sin localStorage: todo entra y sale por parámetros, y
// así se puede probar con node (`npm run test:cola`, scripts/test-cola-ventas.mjs).
// La parte que guarda en el aparato y manda al servidor está en `colaVentas.js`.
//
// 🔴 POR QUÉ EXISTE (auditoría 05, a6, 22 oct 2026). Antes, CUALQUIER respuesta
// que no fuera «ok» atascaba la venta para siempre: una sesión caducada (401),
// un 500 o un 502 suelto del servidor bastaban. Una venta atascada no se volvía
// a intentar, no había pantalla para verla y el cierre Z se negaba mientras
// existiera: una sola venta bloqueaba la caja de ese aparato para siempre.
// Ahora se separa lo que se arregla solo (se reintenta) de lo que el servidor ha
// rechazado de verdad (se atasca, se ve en «Ventas sin apuntar» y se puede
// reintentar o descartar), y el Z sabe distinguirlo.

// Qué pasó al mandar UNA venta:
//   'ok'       → apuntada (o ya lo estaba: `repetida`). Sale de la cola.
//   'red'      → no hubo respuesta (sin internet, o cortada por tiempo). Se para
//                la vuelta y se reintenta en la siguiente, sin marcar nada malo.
//   'pasajero' → el servidor contestó, pero con un fallo que se arregla solo:
//                sesión caducada (401), servidor caído o desbordado (5xx, 408,
//                425, 429), el TPV pausado desde Ajustes (se quita la pausa y
//                entra tal cual), o una respuesta que NO es del servidor de Pidoo
//                (la página de un router, un portal de wifi, un proxy). Se
//                reintenta en cada vuelta.
//   'rechazo'  → el servidor la ha mirado y dice que NO (producto borrado, TPV
//                desactivado, datos no válidos…). Reintentar igual no la arregla:
//                se ATASCA con su motivo para que la revise una persona.
const ERRORES_PASAJEROS = new Set(['no_autorizado', 'tpv_pausado'])

// UNA VENTA A MEDIAS que el servidor da por buena (revisión del 25 oct 2026): el
// pedido existe, pero sin líneas ni ticket (un intento anterior se quedó a mitad
// con la base de datos fallando). `tpv-venta` hasta la v10 de esta revisión
// contestaba `ok` con 0 € y `items: []`, y la cola la quitaba: el dinero estaba en
// el cajón y en el sistema no había nada. Ahora el servidor contesta 503
// `venta_a_medias` y la rehace; si un servidor anterior (la v9) contesta así, la
// venta NO sale de la cola: se queda como «el servidor le está fallando», se ve
// en «Ventas sin apuntar» y se reintenta sola. Una venta con líneas y sin número
// de ticket (`sin_ticket` sin `items: []`) sí está apuntada: esa sale.
export const esVentaAMedias = (body) => !!body?.ok && !!body?.sin_ticket
  && Array.isArray(body?.items) && body.items.length === 0

export function clasificarEnvio({ errorRed = false, status = 0, body = null } = {}) {
  if (errorRed || !status) return 'red'
  if (status >= 200 && status < 300 && esVentaAMedias(body)) return 'pasajero'
  if (status >= 200 && status < 300 && body?.ok) return 'ok'
  if (status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'pasajero'
  if (body && typeof body === 'object' && ERRORES_PASAJEROS.has(body.error)) return 'pasajero'
  // Solo es un «no» de verdad si lo dice NUESTRO servidor: `tpv-venta` siempre
  // contesta un objeto con `ok` o con `error`.
  const deNuestroServidor = !!body && typeof body === 'object' && ('ok' in body || 'error' in body)
  if (!deNuestroServidor) return 'pasajero'
  return 'rechazo'
}

// EL COBRO DIRECTO, cuando el servidor SÍ contesta pero mal (revisión del 24 oct
// 2026). Antes solo iba a la cola un cobro sin red o cortado por tiempo: con
// Supabase caído (un 522 como el del disco lleno, un 503 de las edges) cada cobro
// acababa en «No se pudo completar la venta» SIN guardarse, y el mostrador dejaba
// de vender. Devuelve true si la venta tiene que ir a la cola (con su misma clave:
// si ya había entrado, el servidor contesta «repetida» y no se cobra dos veces).
//   - 2xx sin cuerpo de Pidoo: llegaron las cabeceras y el cuerpo se cortó. La
//     venta PUEDE estar grabada: a la cola, que la recoge como repetida.
//   - 401 (sesión), 408/425/429 (servidor desbordado): se arregla solo.
//   - Una respuesta que no es de `tpv-venta` (página de un router, de Cloudflare,
//     error del servidor de edges): a la cola.
//   - 5xx de `tpv-venta`: solo los errores que son el servidor caído (la base de
//     datos o el servicio de sesiones que no contestan, el código del pedido que
//     no sale). Un fallo al grabar el pedido o sus líneas puede ser de ESA venta
//     (un trigger que la rechaza): se avisa como siempre y se queda en pantalla.
//   - Cualquier otro «no» de Pidoo (TPV pausado, producto borrado…): como siempre.
// Ojo: NO es `clasificarEnvio`. Para la cola el TPV pausado es pasajero (entra al
// quitar la pausa); en el cobro directo es un aviso y la venta no se hace.
const ERRORES_DE_SERVIDOR_CAIDO = new Set([
  'bd_no_disponible', 'auth_no_disponible', 'generar_codigo_failed', 'productos_error', 'extras_error',
  // Revisión del 25 oct: un intento anterior con esta clave dejó la venta a
  // medias y el servidor la está rehaciendo. El dinero ya está en la mano.
  'venta_a_medias',
])

export function cobroVaALaCola({ status = 0, body = null } = {}) {
  const deNuestroServidor = !!body && typeof body === 'object' && ('ok' in body || 'error' in body)
  // Una venta a medias dada por buena (un servidor anterior): a la cola, que no
  // la quita hasta que esté apuntada de verdad (ver `esVentaAMedias`).
  if (status >= 200 && status < 300 && esVentaAMedias(body)) return true
  if (status >= 200 && status < 300) return !deNuestroServidor
  if (status === 401 || status === 408 || status === 425 || status === 429) return true
  if (!deNuestroServidor) return true
  if (status >= 500) return ERRORES_DE_SERVIDOR_CAIDO.has(body.error)
  return false
}

// ¿Se para la vuelta aquí? Sin red, sí (las demás tampoco llegarán). Con la
// sesión caducada, también: las demás llevan el mismo permiso. Un 5xx de UNA
// venta no frena a las demás: si fuera cosa de esa venta, la bloquearía siempre.
export const debeParar = (resultado, status) => resultado === 'red' || (resultado === 'pasajero' && status === 401)

const MOTIVOS = {
  tpv_no_contratado: 'Este restaurante no tiene el TPV activado.',
  tpv_no_activo: 'El TPV está desactivado. Habla con Pidoo.',
  tpv_pausado: 'El TPV está pausado desde Ajustes: entrará sola al quitar la pausa.',
  forbidden: 'Esta cuenta no puede cobrar en este restaurante.',
  no_autorizado: 'La sesión ha caducado: se mandará cuando se renueve.',
  establecimiento_no_encontrado: 'El restaurante no se ha encontrado.',
  producto_no_encontrado: 'Un producto de la venta ya no está en la carta.',
  producto_de_otro_restaurante: 'Un producto de la venta es de otro restaurante.',
  extra_no_encontrado: 'Un extra de la venta ya no existe.',
  extra_de_otro_restaurante: 'Un extra de la venta es de otro restaurante.',
  generar_codigo_failed: 'El servidor no pudo numerar el pedido.',
  bd_no_disponible: 'El servidor de Pidoo no responde bien ahora mismo: se reintenta sola.',
  auth_no_disponible: 'El servidor de sesiones de Pidoo no responde ahora mismo: se reintenta sola.',
  venta_a_medias: 'Un intento anterior dejó esta venta a medias en el servidor: se reintenta sola.',
}

// El motivo en palabras, para la pantalla «Ventas sin apuntar».
export function motivoDeRespuesta(status, body) {
  if (esVentaAMedias(body)) return 'El servidor tiene esta venta a medias (sin productos ni ticket): se reintenta sola. Si no entra, avisa a Pidoo.'
  const cod = body && typeof body === 'object' ? body.error : null
  if (cod && MOTIVOS[cod]) return MOTIVOS[cod]
  if (body?.detalle) return String(body.detalle)
  if (cod) return String(cod) + (body?.campo ? ` (${body.campo})` : '')
  if (status === 401) return 'La sesión ha caducado: se mandará cuando se renueve.'
  if (status >= 500) return `El servidor ha fallado (HTTP ${status}).`
  return `Respuesta inesperada (HTTP ${status}).`
}

const claveDe = (v) => v?.payload?.idempotency_key

// Una venta nueva para la cola. `payload` es EXACTAMENTE el cuerpo que iba a
// viajar a tpv-venta (con su idempotency_key dentro); lo demás es contexto para
// el papel y para revisarla.
export function nuevaEntrada({ payload, numeroOff, total_c, metodo, hora, lineas = null, carrito = null }) {
  return {
    payload,
    numeroOff,
    total_c,
    metodo,
    hora: hora || new Date().toISOString(),
    // Lo que se vendió, en texto, para que una persona pueda reconocer la venta
    // (el payload solo lleva ids de producto).
    lineas: Array.isArray(lineas) ? lineas : null,
    // Las líneas TAL CUAL estaban en el mostrador: con ellas una venta que el
    // servidor rechaza se puede «Pasar al mostrador» y cobrarla de nuevo con la
    // carta de ahora (ver «Ventas sin apuntar»).
    carrito: Array.isArray(carrito) && carrito.length ? carrito : null,
    atascada: false,
    motivo: null,
    // Cómo fue el último intento: null (ninguno), 'red', 'pasajero' o 'rechazo'.
    ultimoResultado: null,
    ultimoIntento: null,
    fallos: 0,          // fallos PASAJEROS seguidos (el servidor contestó mal)
    ultimoFallo: null,
  }
}

// ── LA HORA REAL DE LA VENTA (a7, 22 oct 2026) ────────────────────────────────
// Lo que viaja a `tpv-venta` desde la cola: el cuerpo de siempre MÁS
// `fecha_operacion`, la hora a la que se cobró de verdad (la que quedó en la cola
// y en el ticket provisional), en ISO con zona. Antes la venta del corte se
// apuntaba con la hora a la que llegaba al servidor: una del sábado que llegaba
// el lunes contaba el lunes (RD 1619/2012, arts. 7.1 y 11: la fecha de la
// operación va aparte si no es la de expedición).
//   - El servidor nuevo (tpv-venta v10) la usa si es de hace más de 5 min y como
//     mucho de 72 h; si no, apunta como siempre. Nunca rechaza por ella.
//   - El servidor viejo (v9) no lee ese campo: lo ignora y apunta como siempre.
// Las ventas que ya estaban en la cola antes de esto también la llevan: sale de
// `hora`, que se guardaba desde el primer día. Si el cuerpo ya trae una, manda.
//
// `enviadoAt` (revisión del 24 oct): la hora del aparato en el momento de MANDAR.
// Las dos horas salen del mismo reloj, así que lo que el servidor puede fiarse es
// la DIFERENCIA entre ellas: un PC que va 20 min atrasado ya no mueve sus ventas
// 20 min (el servidor corrige con su propio reloj). Solo viaja con una hora de la
// venta: sin ella no hay nada que corregir.
export function cuerpoParaEnviar(venta, { enviadoAt = null } = {}) {
  const payload = venta?.payload || {}
  const conEnvio = (cuerpo) => (enviadoAt && cuerpo.fecha_operacion ? { ...cuerpo, enviado_at: enviadoAt } : cuerpo)
  if (typeof payload.fecha_operacion === 'string' && payload.fecha_operacion) return conEnvio(payload)
  const ms = venta?.hora ? Date.parse(venta.hora) : NaN
  if (!Number.isFinite(ms)) return payload
  return conEnvio({ ...payload, fecha_operacion: new Date(ms).toISOString() })
}

// La misma clave no entra dos veces (doble toque sobre el mismo fallo).
export function anadirSiNoEsta(cola, entrada) {
  const lista = Array.isArray(cola) ? cola : []
  if (lista.some((v) => claveDe(v) === claveDe(entrada))) return { lista, anadida: false }
  return { lista: [...lista, entrada], anadida: true }
}

// Aplica el resultado de un envío a la venta con esa clave. Devuelve la cola
// NUEVA (no toca la que recibe).
export function aplicarResultado(cola, clave, resultado, { motivo = null, ahora = new Date().toISOString() } = {}) {
  const lista = Array.isArray(cola) ? cola : []
  if (resultado === 'ok') return lista.filter((v) => claveDe(v) !== clave)
  return lista.map((v) => {
    if (claveDe(v) !== clave) return v
    if (resultado === 'red') return { ...v, ultimoResultado: 'red', ultimoIntento: ahora }
    if (resultado === 'pasajero') {
      return { ...v, ultimoResultado: 'pasajero', ultimoIntento: ahora, fallos: (Number(v.fallos) || 0) + 1, ultimoFallo: motivo }
    }
    return { ...v, ultimoResultado: 'rechazo', ultimoIntento: ahora, atascada: true, motivo }
  })
}

// «Volver a intentar» una venta atascada (lo pulsa una persona): vuelve a la
// cola normal, con el contador a cero.
export function marcarParaReintentar(cola, clave) {
  return (Array.isArray(cola) ? cola : []).map((v) => (claveDe(v) === clave
    ? { ...v, atascada: false, motivo: null, ultimoResultado: null, fallos: 0, ultimoFallo: null }
    : v))
}

export function quitarDeCola(cola, clave) {
  return (Array.isArray(cola) ? cola : []).filter((v) => claveDe(v) !== clave)
}

// ¿En qué está cada venta? Tres montones que no se pisan:
//   - esperandoRed: aún no ha llegado al servidor (sin internet, o ni se ha
//     intentado). Se irá sola al volver la red.
//   - conProblema: el servidor la ha rechazado (atascada) o le está fallando
//     (pasajero). Esto es lo que necesita a una persona.
export const tieneProblema = (v) => !!v?.atascada || v?.ultimoResultado === 'pasajero'

export function resumenCola(cola) {
  const lista = Array.isArray(cola) ? cola : []
  const atascadas = lista.filter((v) => v.atascada)
  const fallando = lista.filter((v) => !v.atascada && v.ultimoResultado === 'pasajero')
  const esperando = lista.filter((v) => !tieneProblema(v))
  const suma = (l) => l.reduce((s, v) => s + (Number(v.total_c) || 0), 0)
  const conProblema = [...atascadas, ...fallando]
  return {
    total: lista.length,
    atascadas: atascadas.length,
    fallando: fallando.length,
    conProblema: conProblema.length,
    esperandoRed: esperando.length,
    importe_c: suma(lista),
    importeConProblema_c: suma(conProblema),
    // Lo de esas ventas que está en el CAJÓN (las de datáfono van al banco): es
    // lo que sobrará en un cierre que se haga sin ellas.
    efectivoConProblema_c: suma(conProblema.filter((v) => v.metodo === 'efectivo')),
    numerosConProblema: conProblema.map((v) => v.numeroOff).filter((n) => n != null),
  }
}

// La nota que se guarda en el cierre de caja cuando se cierra dejando fuera
// ventas con problema: así el sobrante del Z tiene explicación escrita.
export function notaCierreSinApuntar(resumen, eur) {
  if (!resumen?.conProblema) return null
  const fmt = typeof eur === 'function' ? eur : (c) => (c / 100).toFixed(2) + ' €'
  const nums = (resumen.numerosConProblema || []).slice(0, 12).map((n) => 'OFF-' + n).join(', ')
  const mas = (resumen.numerosConProblema || []).length > 12 ? '…' : ''
  return `Fuera de este cierre: ${resumen.conProblema} venta${resumen.conProblema > 1 ? 's' : ''} sin apuntar de este aparato `
    + `(${fmt(resumen.importeConProblema_c)}; ${fmt(resumen.efectivoConProblema_c)} en efectivo)`
    + (nums ? `: ${nums}${mas}` : '')
}

// EL CIERRE Z con ventas en la cola (después de intentar mandarlas):
//   'libre'       → no queda nada: se cierra como siempre.
//   'esperar_red' → hay ventas que aún no han llegado al servidor por falta de
//                   red. Sin red tampoco se puede cerrar la caja (el cierre va al
//                   servidor), así que se espera a internet: se irán solas.
//   'confirmar'   → solo quedan ventas CON PROBLEMA. No bloquean para siempre: se
//                   pregunta, y si se cierra quedan fuera de este Z (el cajón
//                   tendrá ese dinero de más) y siguen en «Ventas sin apuntar».
export function decisionCierre(resumen) {
  if (!resumen?.total) return 'libre'
  if (resumen.esperandoRed) return 'esperar_red'
  return 'confirmar'
}

// Una vuelta de envío, con todo inyectado: `leer()` y `guardar(lista)` son el
// almacén, `enviar(venta)` resuelve { errorRed } o { status, body }. Se guarda
// tras CADA venta: si la app se cierra a mitad, lo hecho no se repite y lo que
// se ha cobrado mientras tanto (que entra por `leer`) no se pierde.
export async function sincronizar({ leer, guardar, enviar, ahora = () => new Date().toISOString() }) {
  const pendientes = (leer() || []).filter((v) => !v.atascada)
  let enviadas = 0
  let sinRed = false
  for (const venta of pendientes) {
    const clave = claveDe(venta)
    // Mientras se mandaban las anteriores, una persona ha podido descartarla o
    // atascarla a mano desde «Ventas sin apuntar»: entonces no se manda.
    if (!(leer() || []).some((v) => claveDe(v) === clave && !v.atascada)) continue
    let r
    try { r = await enviar(venta) } catch { r = { errorRed: true } }
    const resultado = clasificarEnvio(r || {})
    const motivo = resultado === 'pasajero' || resultado === 'rechazo' ? motivoDeRespuesta(r?.status, r?.body) : null
    guardar(aplicarResultado(leer() || [], clave, resultado, { motivo, ahora: ahora() }))
    if (resultado === 'ok') enviadas += 1
    if (resultado === 'red') sinRed = true
    if (debeParar(resultado, r?.status)) break
  }
  const quedan = leer() || []
  const resumen = resumenCola(quedan)
  return { ok: true, enviadas, sinRed, quedan: resumen.total, ...resumen }
}
