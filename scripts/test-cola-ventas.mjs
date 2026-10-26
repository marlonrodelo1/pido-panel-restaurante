/* Pruebas de la COLA DE VENTAS SIN INTERNET del TPV (auditoría 05, 22 oct 2026).
 *
 * Por qué existe: el modo sin internet nunca se ha probado con un corte real, y
 * cada fallo de la cola es dinero que está en el cajón y no en el sistema. La
 * parte que DECIDE (qué se reintenta, qué se atasca, cuándo se puede cerrar la
 * caja) está en `src/lib/colaVentasLogica.js`, sin pantalla, sin red y sin
 * localStorage, justo para poder probarla aquí con un servidor de mentira. Lo
 * mismo con la de las impresoras y el cajón sin red (`src/lib/impresionSinRed.js`)
 * y con el papel del ticket (`src/lib/escpos.js`).
 *
 *   npm run test:cola
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clasificarEnvio, debeParar, motivoDeRespuesta, nuevaEntrada, anadirSiNoEsta,
  aplicarResultado, marcarParaReintentar, quitarDeCola, resumenCola, decisionCierre,
  notaCierreSinApuntar, sincronizar, tieneProblema, cuerpoParaEnviar, cobroVaALaCola, esVentaAMedias,
} from '../src/lib/colaVentasLogica.js'
import { nacioAceptado, marcarComandaAvisada, comandaAvisada, reservarImpresion, soltarImpresion } from '../src/lib/ticketsImpresos.js'
import { esFalloSinRespuesta, esErrorDeRed, renovacionSeReintenta, sesionSinRenovarDe } from '../src/lib/estadoRed.js'
import { generarTicketTpv } from '../src/lib/escpos.js'
import {
  abreCajonSinRed, destinosAGuardar, destinosDeGuardado, anotarIpLocal, ponerIpsLocales,
  conciliarIpsLocales, cambiarIpEnLista, conLimite, VIDA_IP_LOCAL_MS,
} from '../src/lib/impresionSinRed.js'

// ── Ayudas ───────────────────────────────────────────────────────────────────
let n = 0
const clave = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const venta = (extra = {}) => nuevaEntrada({
  payload: { establecimiento_id: 'est', metodo_pago: extra.metodo || 'efectivo', idempotency_key: clave(), lineas: [{ producto_id: 'p1', cantidad: 1 }] },
  numeroOff: n, total_c: extra.total_c ?? 1250, metodo: extra.metodo || 'efectivo',
  hora: extra.hora || '2026-10-22T21:03:00.000Z',
  ...extra,
})
const k = (v) => v.payload.idempotency_key

// Un almacén en memoria con la misma forma que localStorage para la cola.
function almacen(inicial = []) {
  let lista = inicial
  return { leer: () => lista, guardar: (l) => { lista = l }, ver: () => lista }
}

// ── Qué es cada respuesta ────────────────────────────────────────────────────
test('sin respuesta = red: no se marca nada malo', () => {
  assert.equal(clasificarEnvio({ errorRed: true }), 'red')
  assert.equal(clasificarEnvio({ status: 0 }), 'red')
  assert.equal(clasificarEnvio({}), 'red')
})

test('ok y repetida salen de la cola', () => {
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true } }), 'ok')
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true, repetida: true } }), 'ok')
  // La venta grabada sin número de ticket también está apuntada.
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true, sin_ticket: true } }), 'ok')
})

test('lo que se arregla solo NO atasca: sesión, servidor caído, TPV pausado, respuestas ajenas', () => {
  for (const status of [401, 408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(clasificarEnvio({ status, body: { error: 'x' } }), 'pasajero', `HTTP ${status}`)
  }
  assert.equal(clasificarEnvio({ status: 409, body: { error: 'tpv_pausado' } }), 'pasajero')
  // La página de un router o de un portal wifi (no es JSON de Pidoo).
  assert.equal(clasificarEnvio({ status: 200, body: null }), 'pasajero')
  assert.equal(clasificarEnvio({ status: 403, body: null }), 'pasajero')
  assert.equal(clasificarEnvio({ status: 404, body: { message: 'Not found' } }), 'pasajero')
})

test('un «no» de verdad del servidor sí atasca', () => {
  assert.equal(clasificarEnvio({ status: 400, body: { error: 'producto_no_encontrado' } }), 'rechazo')
  assert.equal(clasificarEnvio({ status: 403, body: { error: 'tpv_no_activo' } }), 'rechazo')
  assert.equal(clasificarEnvio({ status: 400, body: { error: 'validacion', campo: 'lineas' } }), 'rechazo')
  // 200 con ok:false (por si algún día) también es un no.
  assert.equal(clasificarEnvio({ status: 200, body: { ok: false, error: 'x' } }), 'rechazo')
})

test('la vuelta se para sin red y con la sesión caducada; un 5xx suelto no frena a las demás', () => {
  assert.equal(debeParar('red', 0), true)
  assert.equal(debeParar('pasajero', 401), true)
  assert.equal(debeParar('pasajero', 500), false)
  assert.equal(debeParar('rechazo', 400), false)
  assert.equal(debeParar('ok', 200), false)
})

test('el motivo se dice en palabras', () => {
  assert.match(motivoDeRespuesta(400, { error: 'producto_no_encontrado' }), /ya no está en la carta/)
  assert.match(motivoDeRespuesta(401, null), /sesión/)
  assert.match(motivoDeRespuesta(502, null), /HTTP 502/)
  assert.equal(motivoDeRespuesta(400, { error: 'validacion', campo: 'lineas' }), 'validacion (lineas)')
  assert.equal(motivoDeRespuesta(400, { error: 'x', detalle: 'La venta esta vacia' }), 'La venta esta vacia')
})

// ── La cola ──────────────────────────────────────────────────────────────────
test('la misma clave no entra dos veces (doble toque sobre el mismo fallo)', () => {
  const v = venta()
  const a = anadirSiNoEsta([], v)
  assert.equal(a.anadida, true)
  const b = anadirSiNoEsta(a.lista, { ...v })
  assert.equal(b.anadida, false)
  assert.equal(b.lista.length, 1)
})

test('aplicar resultados: ok sale, red solo apunta, pasajero cuenta fallos, rechazo atasca', () => {
  const v = venta()
  let cola = [v]
  cola = aplicarResultado(cola, k(v), 'red', { ahora: 't1' })
  assert.equal(cola[0].ultimoResultado, 'red')
  assert.equal(cola[0].atascada, false)
  assert.equal(cola[0].fallos, 0)
  cola = aplicarResultado(cola, k(v), 'pasajero', { motivo: 'HTTP 502', ahora: 't2' })
  cola = aplicarResultado(cola, k(v), 'pasajero', { motivo: 'HTTP 502', ahora: 't3' })
  assert.equal(cola[0].fallos, 2)
  assert.equal(cola[0].atascada, false)
  assert.equal(tieneProblema(cola[0]), true)
  cola = aplicarResultado(cola, k(v), 'rechazo', { motivo: 'Un producto…' })
  assert.equal(cola[0].atascada, true)
  assert.equal(cola[0].motivo, 'Un producto…')
  assert.deepEqual(aplicarResultado(cola, k(v), 'ok'), [])
})

test('reintentar a mano devuelve la venta a la cola normal; quitar la saca', () => {
  const v = { ...venta(), atascada: true, motivo: 'x', ultimoResultado: 'rechazo', fallos: 3 }
  const [r] = marcarParaReintentar([v], k(v))
  assert.equal(r.atascada, false)
  assert.equal(r.fallos, 0)
  assert.equal(r.ultimoResultado, null)
  assert.deepEqual(quitarDeCola([v], k(v)), [])
})

test('resumen: tres montones que no se pisan, y el efectivo que sobrará', () => {
  const cola = [
    venta({ total_c: 1000 }),                                                        // esperando
    { ...venta({ total_c: 500 }), ultimoResultado: 'red' },                          // esperando
    { ...venta({ total_c: 700 }), ultimoResultado: 'pasajero', fallos: 1 },          // fallando
    { ...venta({ total_c: 300, metodo: 'datafono' }), atascada: true },              // atascada (datáfono)
  ]
  const r = resumenCola(cola)
  assert.equal(r.total, 4)
  assert.equal(r.esperandoRed, 2)
  assert.equal(r.fallando, 1)
  assert.equal(r.atascadas, 1)
  assert.equal(r.conProblema, 2)
  assert.equal(r.importe_c, 2500)
  assert.equal(r.importeConProblema_c, 1000)
  assert.equal(r.efectivoConProblema_c, 700)   // la de datáfono no está en el cajón
  assert.equal(r.numerosConProblema.length, 2)
})

// ── El cierre Z ──────────────────────────────────────────────────────────────
test('el cierre: libre sin cola; espera a la red si algo no ha llegado; pregunta si solo quedan problemas', () => {
  assert.equal(decisionCierre(resumenCola([])), 'libre')
  assert.equal(decisionCierre(null), 'libre')
  assert.equal(decisionCierre(resumenCola([venta()])), 'esperar_red')
  assert.equal(decisionCierre(resumenCola([venta(), { ...venta(), atascada: true }])), 'esperar_red')
  // 🔴 Lo que antes bloqueaba la caja para siempre: solo ventas atascadas.
  assert.equal(decisionCierre(resumenCola([{ ...venta(), atascada: true }])), 'confirmar')
  assert.equal(decisionCierre(resumenCola([{ ...venta(), ultimoResultado: 'pasajero' }])), 'confirmar')
})

test('la nota del cierre deja escrito lo que queda fuera', () => {
  const r = resumenCola([{ ...venta({ total_c: 1250 }), atascada: true, numeroOff: 7 }])
  const nota = notaCierreSinApuntar(r, (c) => (c / 100).toFixed(2).replace('.', ',') + ' €')
  assert.match(nota, /1 venta sin apuntar/)
  assert.match(nota, /12,50 €/)
  assert.match(nota, /OFF-7/)
  assert.equal(notaCierreSinApuntar(resumenCola([]), null), null)
})

// ── Una vuelta de envío con un servidor de mentira ───────────────────────────
test('vuelta normal: todas entran y la cola queda vacía', async () => {
  const a = almacen([venta(), venta(), venta()])
  const r = await sincronizar({ ...a, enviar: async () => ({ status: 200, body: { ok: true } }) })
  assert.equal(r.enviadas, 3)
  assert.equal(r.total, 0)
  assert.deepEqual(a.ver(), [])
})

test('sin red: se para en la primera, no marca nada malo', async () => {
  const a = almacen([venta(), venta()])
  let llamadas = 0
  const r = await sincronizar({ ...a, enviar: async () => { llamadas += 1; return { errorRed: true } } })
  assert.equal(llamadas, 1)
  assert.equal(r.sinRed, true)
  assert.equal(r.esperandoRed, 2)
  assert.equal(a.ver().some((v) => v.atascada), false)
})

test('si `enviar` lanza, cuenta como red (nunca rompe la vuelta)', async () => {
  const a = almacen([venta()])
  const r = await sincronizar({ ...a, enviar: async () => { throw new Error('boom') } })
  assert.equal(r.sinRed, true)
  assert.equal(r.total, 1)
})

test('🔴 una sesión caducada (401) ya NO atasca la venta: se reintenta y entra al renovarse', async () => {
  const a = almacen([venta(), venta()])
  let sesionBuena = false
  const enviar = async () => (sesionBuena ? { status: 200, body: { ok: true } } : { status: 401, body: { error: 'no_autorizado' } })
  const r1 = await sincronizar({ ...a, enviar })
  assert.equal(r1.atascadas, 0)
  assert.equal(r1.enviadas, 0)
  assert.equal(r1.fallando, 1)        // la primera falló; la vuelta se paró ahí
  assert.equal(r1.esperandoRed, 1)
  sesionBuena = true
  const r2 = await sincronizar({ ...a, enviar })
  assert.equal(r2.enviadas, 2)
  assert.equal(r2.total, 0)
})

test('🔴 un 502 suelto ya NO atasca, y no frena a las demás', async () => {
  const [v1, v2] = [venta(), venta()]
  const a = almacen([v1, v2])
  let primera = true
  const enviar = async (v) => {
    if (k(v) === k(v1) && primera) { primera = false; return { status: 502, body: null } }
    return { status: 200, body: { ok: true } }
  }
  const r1 = await sincronizar({ ...a, enviar })
  assert.equal(r1.enviadas, 1)
  assert.equal(r1.atascadas, 0)
  assert.equal(r1.fallando, 1)
  assert.equal(decisionCierre(r1), 'confirmar')   // y no bloquea el Z para siempre
  const r2 = await sincronizar({ ...a, enviar })
  assert.equal(r2.enviadas, 1)
  assert.equal(r2.total, 0)
})

test('un rechazo de verdad se atasca con su motivo y las demás siguen', async () => {
  const [v1, v2] = [venta(), venta()]
  const a = almacen([v1, v2])
  const enviar = async (v) => (k(v) === k(v1)
    ? { status: 400, body: { error: 'producto_no_encontrado' } }
    : { status: 200, body: { ok: true } })
  const r = await sincronizar({ ...a, enviar })
  assert.equal(r.enviadas, 1)
  assert.equal(r.atascadas, 1)
  assert.match(a.ver()[0].motivo, /carta/)
  // Una venta atascada no se vuelve a mandar sola…
  let llamadas = 0
  await sincronizar({ ...a, enviar: async () => { llamadas += 1; return { status: 200, body: { ok: true } } } })
  assert.equal(llamadas, 0)
  // …hasta que una persona pulsa «Volver a intentar».
  a.guardar(marcarParaReintentar(a.ver(), k(v1)))
  const r3 = await sincronizar({ ...a, enviar: async () => ({ status: 200, body: { ok: true } }) })
  assert.equal(r3.enviadas, 1)
  assert.equal(r3.total, 0)
})

test('lo cobrado DURANTE la vuelta no se pierde (se guarda tras cada venta leyendo de nuevo)', async () => {
  const v1 = venta()
  const nueva = venta()
  const a = almacen([v1])
  const enviar = async () => {
    a.guardar([...a.ver(), nueva])           // el mostrador cobra mientras se manda
    return { status: 200, body: { ok: true } }
  }
  const r = await sincronizar({ ...a, enviar })
  assert.equal(r.enviadas, 1)
  assert.deepEqual(a.ver().map(k), [k(nueva)])
})

test('una venta descartada a mano a mitad de la vuelta ya no se manda', async () => {
  const [v1, v2] = [venta(), venta()]
  const a = almacen([v1, v2])
  const mandadas = []
  const enviar = async (v) => {
    mandadas.push(k(v))
    if (k(v) === k(v1)) a.guardar(quitarDeCola(a.ver(), k(v2)))   // alguien descarta la 2ª
    return { status: 200, body: { ok: true } }
  }
  await sincronizar({ ...a, enviar })
  assert.deepEqual(mandadas, [k(v1)])
})

// ── La hora real de la venta (a7) ────────────────────────────────────────────
test('la cola manda la hora real de la venta como fecha_operacion, sin tocar lo demás', () => {
  const v = venta({ hora: '2026-10-24T20:15:30.000Z' })
  const cuerpo = cuerpoParaEnviar(v)
  assert.equal(cuerpo.fecha_operacion, '2026-10-24T20:15:30.000Z')
  // ISO con zona, como la pide tpv-venta v10.
  assert.match(cuerpo.fecha_operacion, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  const { fecha_operacion, ...resto } = cuerpo
  assert.ok(fecha_operacion)
  assert.deepEqual(resto, v.payload)                        // el cuerpo de siempre, intacto
  assert.equal('fecha_operacion' in v.payload, false)       // y sin mutar lo guardado
})

test('fecha_operacion: la del cuerpo manda; sin hora válida no se inventa ninguna', () => {
  const conPropia = { ...venta(), payload: { idempotency_key: 'x', fecha_operacion: '2026-10-20T10:00:00.000Z' } }
  assert.equal(cuerpoParaEnviar(conPropia).fecha_operacion, '2026-10-20T10:00:00.000Z')
  assert.equal('fecha_operacion' in cuerpoParaEnviar({ payload: { a: 1 }, hora: 'no es una fecha' }), false)
  assert.equal('fecha_operacion' in cuerpoParaEnviar({ payload: { a: 1 } }), false)
  // Una hora guardada con zona distinta sale normalizada a UTC.
  assert.equal(cuerpoParaEnviar({ payload: {}, hora: '2026-10-24T21:15:30+01:00' }).fecha_operacion, '2026-10-24T20:15:30.000Z')
})

// El papel, decodificado a texto (solo ASCII basta para buscar las frases).
const texto = (bytes) => Array.from(bytes, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ')).join('')
const ticketBase = {
  serie: 'A', numero: 12, total: 10, base_imponible: 9.35, igic_pct: 7, cuota_igic: 0.65,
  metodo_pago: 'efectivo', emitido_at: '2026-10-26T09:00:00.000Z',
}
const est = { nombre: 'Max', nif: 'X' }

test('ticket provisional: lleva la hora de la venta', () => {
  const t = texto(generarTicketTpv({ ...ticketBase, serie: 'OFF', numero: 3, fecha_operacion: '2026-10-24T20:15:00.000Z', emitido_at: '2026-10-24T20:15:00.000Z' },
    { para_llevar: false }, [], est, null, false, null, null, null, true))
  assert.match(t, /TICKET PROVISIONAL/)
  assert.match(t, /Hora de la venta: 24\/10\/2026/)
})

test('ticket con internet: sin fecha de la operación aparte (el papel no cambia)', () => {
  const t1 = texto(generarTicketTpv(ticketBase, {}, [], est, null))
  assert.doesNotMatch(t1, /Fecha de la operacion/)
  // Aunque la trajera, si es del mismo momento (<= 5 min) tampoco sale.
  const t2 = texto(generarTicketTpv({ ...ticketBase, fecha_operacion: '2026-10-26T08:57:00.000Z' }, {}, [], est, null))
  assert.doesNotMatch(t2, /Fecha de la operacion/)
})

test('ticket de una venta del corte numerada después: sale la fecha de la operación', () => {
  const t = texto(generarTicketTpv({ ...ticketBase, fecha_operacion: '2026-10-24T20:15:00.000Z' }, {}, [], est, null))
  assert.match(t, /Fecha de la operacion\s+24\/10\/2026/)
})

// ── Impresoras y cajón sin red (a8) ──────────────────────────────────────────
test('cajón sin red: se lee como el servidor (efectivo / datáfono), no el ajuste que no existe', () => {
  // Valores por defecto de la tabla: efectivo sí, datáfono no.
  assert.equal(abreCajonSinRed({ abrir_cajon_efectivo: true, abrir_cajon_datafono: false }, 'efectivo'), true)
  assert.equal(abreCajonSinRed({ abrir_cajon_efectivo: true, abrir_cajon_datafono: false }, 'datafono'), false)
  // 🔴 Antes: configurado para NO abrir en efectivo… se abría igual.
  assert.equal(abreCajonSinRed({ abrir_cajon_efectivo: false }, 'efectivo'), false)
  // 🔴 Antes: configurado para abrir con datáfono… no se abría nunca.
  assert.equal(abreCajonSinRed({ abrir_cajon_datafono: true }, 'datafono'), true)
  // Sin configuración en el aparato: lo de fábrica.
  assert.equal(abreCajonSinRed(null, 'efectivo'), true)
  assert.equal(abreCajonSinRed(null, 'datafono'), false)
  // El ajuste viejo inventado ya no manda nada.
  assert.equal(abreCajonSinRed({ abrir_cajon: true, abrir_cajon_datafono: false }, 'datafono'), false)
})

test('qué va a cada impresora se guarda y se recupera igual', () => {
  const entrada = {
    catDe: new Map([['p1', 'c1'], ['p2', 'c2']]),
    destinoCat: new Map([['c1', 'imp-cocina'], ['c2', null]]),
  }
  const guardado = JSON.parse(JSON.stringify(destinosAGuardar(entrada, 1)))
  const vuelta = destinosDeGuardado(guardado)
  assert.equal(vuelta.catDe.get('p1'), 'c1')
  assert.equal(vuelta.destinoCat.get('c1'), 'imp-cocina')
  assert.equal(vuelta.destinoCat.get('c2'), null)
  assert.equal(destinosDeGuardado(null), null)
  assert.equal(destinosDeGuardado({ catDe: 'roto' }), null)
})

test('IP corregida sin internet: vale ya en el aparato, y se concilia con la nube al volver', () => {
  const ahora = 1_000_000
  const nube = [{ id: 'coc', ip: '192.168.1.11' }, { id: 'caja', ip: '192.168.1.20' }]
  // El aparato encuentra la cocina en .12 y no puede guardarlo en la nube.
  let pend = anotarIpLocal({}, nube[0], '192.168.1.12', ahora)
  assert.deepEqual(pend.coc, { ip: '192.168.1.12', desde: '192.168.1.11', at: ahora, subida_at: null })
  // El espejo del aparato la usa.
  assert.equal(ponerIpsLocales(nube, pend, ahora)[0].ip, '192.168.1.12')
  assert.equal(ponerIpsLocales(nube, pend, ahora)[1].ip, '192.168.1.20')
  // Vuelve internet: la nube sigue con la vieja → manda la de aquí y se sube.
  const r1 = conciliarIpsLocales(nube, pend, ahora + 1000)
  assert.equal(r1.lista[0].ip, '192.168.1.12')
  assert.deepEqual(r1.porSubir, [{ id: 'coc', ip: '192.168.1.12' }])
  // La siguiente lectura (sin permiso para subirla, sigue vieja): no se reintenta antes de 10 min.
  const r2 = conciliarIpsLocales(nube, r1.pendientes, ahora + 2000)
  assert.equal(r2.lista[0].ip, '192.168.1.12')
  assert.deepEqual(r2.porSubir, [])
  // La nube ya la tiene → se olvida.
  const r3 = conciliarIpsLocales(cambiarIpEnLista(nube, 'coc', '192.168.1.12'), r1.pendientes, ahora + 3000)
  assert.deepEqual(r3.pendientes, {})
  // Alguien la cambió a mano en la nube a otra → manda la nube.
  const r4 = conciliarIpsLocales(cambiarIpEnLista(nube, 'coc', '192.168.1.50'), r1.pendientes, ahora + 3000)
  assert.equal(r4.lista[0].ip, '192.168.1.50')
  assert.deepEqual(r4.pendientes, {})
  // Pasadas 12 h, se olvida.
  const r5 = conciliarIpsLocales(nube, pend, ahora + VIDA_IP_LOCAL_MS + 1)
  assert.equal(r5.lista[0].ip, '192.168.1.11')
  assert.deepEqual(r5.pendientes, {})
})

test('dos cambios de IP sin internet: `desde` sigue siendo la de la nube', () => {
  const nube = { id: 'coc', ip: '10.0.0.11' }
  let pend = anotarIpLocal({}, nube, '10.0.0.12', 1)
  pend = anotarIpLocal(pend, { id: 'coc', ip: '10.0.0.12' }, '10.0.0.13', 2)
  assert.equal(pend.coc.desde, '10.0.0.11')
  assert.equal(pend.coc.ip, '10.0.0.13')
})

test('con internet y nada pendiente, la lista de la nube sale TAL CUAL', () => {
  const nube = [{ id: 'a', ip: '1.1.1.1' }]
  const r = conciliarIpsLocales(nube, {})
  assert.equal(r.lista, nube)            // el mismo objeto: nada cambia
  assert.deepEqual(r.porSubir, [])
})

test('una consulta colgada no espera más del límite; una rápida contesta lo suyo', async () => {
  let avisos = 0
  const colgada = new Promise(() => {})
  const r1 = await conLimite(colgada, 20, { error: 'tarde' }, () => { avisos += 1 })
  assert.deepEqual(r1, { error: 'tarde' })
  assert.equal(avisos, 1)
  const r2 = await conLimite(Promise.resolve({ data: 1 }), 1000, { error: 'tarde' }, () => { avisos += 1 })
  assert.deepEqual(r2, { data: 1 })
  assert.equal(avisos, 1)
})

// ── ¿Hay red? (estadoRed) ────────────────────────────────────────────────────
test('qué cuenta como «sin respuesta» en supabase-js', () => {
  assert.equal(esFalloSinRespuesta({ error: { message: 'TypeError: Failed to fetch' }, status: 0 }), true)
  assert.equal(esFalloSinRespuesta({ error: { message: 'x' }, status: 503 }), true)
  assert.equal(esFalloSinRespuesta({ error: { message: 'x' }, status: 429 }), true)
  // Un «no existe» o «no tienes permiso» es una respuesta de verdad.
  assert.equal(esFalloSinRespuesta({ error: { message: 'x' }, status: 406 }), false)
  assert.equal(esFalloSinRespuesta({ error: { message: 'permission denied' }, status: 403 }), false)
  assert.equal(esFalloSinRespuesta({ data: [], error: null, status: 200 }), false)
  // Sin status, se mira el mensaje.
  assert.equal(esFalloSinRespuesta({ error: { message: 'Failed to fetch' } }), true)
})

test('qué errores son de red', () => {
  assert.equal(esErrorDeRed({ name: 'AbortError' }), true)
  assert.equal(esErrorDeRed({ name: 'AuthRetryableFetchError', message: '' }), true)
  assert.equal(esErrorDeRed(new TypeError('Failed to fetch')), true)
  assert.equal(esErrorDeRed(new Error('NetworkError when attempting to fetch resource.')), true)
  assert.equal(esErrorDeRed(new Error('duplicate key value')), false)
  assert.equal(esErrorDeRed(null), false)
})

// ── Revisión del 24 oct 2026 ─────────────────────────────────────────────────
test('cobro directo: el servidor caído o que no es el nuestro va a la cola', () => {
  // Respuesta cortada (2xx sin cuerpo de Pidoo): la venta puede estar grabada.
  assert.equal(cobroVaALaCola({ status: 200, body: {} }), true)
  assert.equal(cobroVaALaCola({ status: 200, body: null }), true)
  // Sesión o servidor desbordado.
  for (const status of [401, 408, 425, 429]) assert.equal(cobroVaALaCola({ status, body: { error: 'x' } }), true, String(status))
  // Páginas que no son de tpv-venta (Cloudflare 522, la pasarela de edges).
  assert.equal(cobroVaALaCola({ status: 522, body: {} }), true)
  assert.equal(cobroVaALaCola({ status: 503, body: { code: 'x', message: 'Service Unavailable' } }), true)
  assert.equal(cobroVaALaCola({ status: 404, body: { code: 'NOT_FOUND', message: 'Function not found' } }), true)
  // tpv-venta diciendo que la base de datos o las sesiones no contestan (v10) y
  // los 5xx de la v9 que son el servidor caído.
  for (const error of ['bd_no_disponible', 'auth_no_disponible', 'generar_codigo_failed', 'productos_error', 'extras_error']) {
    assert.equal(cobroVaALaCola({ status: 503, body: { error } }), true, error)
  }
})

test('cobro directo: un «no» de Pidoo y un fallo de ESA venta se avisan como siempre', () => {
  assert.equal(cobroVaALaCola({ status: 200, body: { ok: true } }), false)
  for (const [status, error] of [[403, 'tpv_no_contratado'], [403, 'tpv_no_activo'], [409, 'tpv_pausado'], [403, 'forbidden'],
    [400, 'producto_no_encontrado'], [400, 'extras_invalidos'], [404, 'establecimiento_no_encontrado'],
    [500, 'pedido_insert_failed'], [500, 'items_insert_failed']]) {
    assert.equal(cobroVaALaCola({ status, body: { error } }), false, error)
  }
})

test('la cola manda también la hora del envío, solo cuando lleva la de la venta', () => {
  const v = venta({ hora: '2026-10-24T20:15:30.000Z' })
  const c = cuerpoParaEnviar(v, { enviadoAt: '2026-10-24T21:00:00.000Z' })
  assert.equal(c.fecha_operacion, '2026-10-24T20:15:30.000Z')
  assert.equal(c.enviado_at, '2026-10-24T21:00:00.000Z')
  assert.equal('enviado_at' in cuerpoParaEnviar({ payload: { a: 1 } }, { enviadoAt: '2026-10-24T21:00:00.000Z' }), false)
  assert.equal('enviado_at' in cuerpoParaEnviar(v), false)
  assert.equal('enviado_at' in v.payload, false)          // sin mutar lo guardado
})

test('renovación de la sesión: un 5xx, 408, 429 o una página HTML se reintentan; un «no» de verdad no', () => {
  const url = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token'
  for (const status of [500, 520, 522, 524, 408, 429]) assert.equal(renovacionSeReintenta({ url, status }), true, String(status))
  assert.equal(renovacionSeReintenta({ url, status: 403, contentType: 'text/html; charset=UTF-8' }), true)
  // Token caducado o ya usado: JSON 400/401. Pasa tal cual y la sesión se borra.
  assert.equal(renovacionSeReintenta({ url, status: 400, contentType: 'application/json' }), false)
  assert.equal(renovacionSeReintenta({ url, status: 401, contentType: 'application/json' }), false)
  assert.equal(renovacionSeReintenta({ url, status: 200 }), false)
  // Solo la renovación: ni el login ni las consultas.
  assert.equal(renovacionSeReintenta({ url: 'https://x.supabase.co/auth/v1/token?grant_type=password', status: 500 }), false)
  assert.equal(renovacionSeReintenta({ url: 'https://x.supabase.co/rest/v1/pedidos', status: 500 }), false)
})

test('sesión sin renovar: caducada o a menos de 90 s; sin sesión guardada, no', () => {
  const ahora = Date.parse('2026-10-24T20:00:00.000Z')
  const s = (segs) => ({ refresh_token: 'r', expires_at: Math.floor(ahora / 1000) + segs })
  assert.equal(sesionSinRenovarDe(s(-600), ahora), true)
  assert.equal(sesionSinRenovarDe(s(60), ahora), true)
  assert.equal(sesionSinRenovarDe(s(3000), ahora), false)
  assert.equal(sesionSinRenovarDe(null, ahora), false)
  assert.equal(sesionSinRenovarDe({ expires_at: 1 }, ahora), false)
})

// ── Revisión del 25 oct 2026 ─────────────────────────────────────────────────
test('venta a medias (pedido sin líneas ni ticket) NO sale de la cola', () => {
  const aMedias = { ok: true, repetida: true, sin_ticket: true, items: [], pedido: { total: 0 } }
  assert.equal(esVentaAMedias(aMedias), true)
  assert.equal(clasificarEnvio({ status: 200, body: aMedias }), 'pasajero')
  assert.match(motivoDeRespuesta(200, aMedias), /a medias/)
  // Con líneas y sin número de ticket SÍ está apuntada; sin la clave `items`
  // (el ticket no se pudo numerar) también.
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true, sin_ticket: true, items: [{ nombre_producto: 'x' }] } }), 'ok')
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true, sin_ticket: true, pedido: { total: 9 } } }), 'ok')
  assert.equal(clasificarEnvio({ status: 200, body: { ok: true, items: [] } }), 'ok')
  // El servidor nuevo la rehace y mientras tanto contesta 503.
  assert.equal(clasificarEnvio({ status: 503, body: { error: 'venta_a_medias' } }), 'pasajero')
  assert.match(motivoDeRespuesta(503, { error: 'venta_a_medias' }), /a medias/)
})

test('venta a medias en el cobro directo: a la cola', () => {
  assert.equal(cobroVaALaCola({ status: 503, body: { error: 'venta_a_medias' } }), true)
  assert.equal(cobroVaALaCola({ status: 200, body: { ok: true, sin_ticket: true, items: [] } }), true)
  assert.equal(cobroVaALaCola({ status: 200, body: { ok: true, sin_ticket: true, items: [{ x: 1 }] } }), false)
})

test('la cola no da por buena una venta a medias aunque el servidor diga ok', async () => {
  const v = venta()
  const a = almacen([v])
  const r = await sincronizar({ ...a, enviar: async () => ({ status: 200, body: { ok: true, repetida: true, sin_ticket: true, items: [] } }) })
  assert.equal(r.enviadas, 0)
  assert.equal(a.ver().length, 1)
  assert.equal(a.ver()[0].ultimoResultado, 'pasajero')
  assert.equal(a.ver()[0].atascada, false)
})

test('recuperación de comandas: nació aceptado (telefónico del TPV) frente a aceptado de verdad', () => {
  const c = '2026-10-24T20:00:00.000000+00:00'
  assert.equal(nacioAceptado({ created_at: '2026-10-24T20:00:00.079+00:00', aceptado_at: '2026-10-24T20:00:00+00:00' }), true)   // -0,079 s
  assert.equal(nacioAceptado({ created_at: c, aceptado_at: '2026-10-24T20:00:00.000000+00:00' }), true)                         // 0 s
  assert.equal(nacioAceptado({ created_at: c, aceptado_at: '2026-10-24T20:00:00.955123+00:00' }), false)                        // Lucía / tienda
  assert.equal(nacioAceptado({ created_at: c, aceptado_at: '2026-10-24T20:00:02.877+00:00' }), false)                           // web
  // Sin fechas que se entiendan: se saca (mejor una de más que ninguna).
  assert.equal(nacioAceptado({ created_at: null, aceptado_at: c }), false)
  assert.equal(nacioAceptado({ created_at: 'x', aceptado_at: c }), false)
  assert.equal(nacioAceptado(null), false)
})

test('recuperación de comandas: la que este aparato ya avisó como fallida no se saca sola', () => {
  const datos = new Map()
  globalThis.localStorage = {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => { datos.set(k, String(v)) },
  }
  try {
    assert.equal(comandaAvisada('p1'), false)
    // La comanda falla: se suelta la reserva y se apunta el aviso.
    assert.equal(reservarImpresion('p1'), true)
    soltarImpresion('p1')
    marcarComandaAvisada('p1')
    marcarComandaAvisada('p1')
    assert.equal(comandaAvisada('p1'), true)
    assert.equal(comandaAvisada('p2'), false)
    // La reserva sigue libre para los demás caminos, como antes.
    assert.equal(reservarImpresion('p1'), true)
    assert.deepEqual(JSON.parse(datos.get('pidoo_comandas_avisadas')), ['p1'])
    // Sin almacenamiento, no queda apuntado (y no revienta).
    globalThis.localStorage = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    marcarComandaAvisada('p3')
    assert.equal(comandaAvisada('p1'), false)
  } finally {
    delete globalThis.localStorage
  }
})
