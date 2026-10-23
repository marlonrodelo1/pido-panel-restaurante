/* Pruebas de COCINA Y TICKETS del TPV (auditoría 05: a9, a10 y a13; 23 oct 2026).
 *
 * Por qué existe: lo que sale en el papel de la cocina y del cliente no se ve
 * hasta que alguien lo imprime en el local, y Duende imprime a diario. Aquí se
 * comprueba el papel decodificado a texto y la parte que decide (número de
 * cliente, nombre de la venta), sin pantalla, sin red y sin impresora.
 *
 *   npm run test:cocina
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generarComandaTpv, generarComandaCocina, generarTicketCliente, generarTicketTpv } from '../src/lib/escpos.js'
import {
  claveJornada, siguienteNumero, asignarNumeroCliente, anadirQuien, buscarQuien,
  recordarQuien, quienDeVenta, nombrePuesto, tieneQuien, lineasComandaDeItems,
} from '../src/lib/comandaVenta.js'

// El papel, decodificado a texto (solo ASCII basta para buscar las frases).
const texto = (bytes) => Array.from(bytes, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ')).join('')

// Un almacén en memoria con la misma forma que localStorage.
function almacen() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

const linea = { cantidad: 2, nombre: 'Pizza Barbacoa', tamano: 'Familiar', extrasTexto: 'Extra queso', notas: 'Sin cebolla' }

// ── a9: de quién es la comanda ───────────────────────────────────────────────
test('comanda sin número ni nombre: el papel de siempre (pruebas de impresora)', () => {
  const t = texto(generarComandaTpv([linea], { nombre: 'Max' }, { numero: 1 }))
  assert.match(t, /MOSTRADOR #1/)
  assert.doesNotMatch(t, /CLIENTE/)
  // Los mismos bytes que antes de a9: sin opciones nuevas no cambia nada.
  const a = generarComandaTpv([linea], { nombre: 'Max' }, { numero: 1, nota: 'PARA LLEVAR' })
  const b = generarComandaTpv([linea], { nombre: 'Max' }, { numero: 1, nota: 'PARA LLEVAR', cliente: null, nombre: null, codigo: null })
  assert.deepEqual(a, b)
})

test('comanda con número de cliente, nombre y código', () => {
  const t = texto(generarComandaTpv([linea], { nombre: 'Max' }, { numero: 2, cliente: 23, nombre: 'Juan', codigo: 'PD-ABC123' }))
  assert.match(t, /MOSTRADOR #2/)
  assert.match(t, /CLIENTE 23/)
  assert.match(t, /JUAN/)
  assert.match(t, /PD-ABC123/)
  assert.match(t, /2 x Pizza Barbacoa \(Familiar\)/)
})

test('un nombre largo se parte por palabras, no se corta', () => {
  const t = texto(generarComandaTpv([linea], {}, { cliente: 4, nombre: 'el chico de la moto roja de la esquina' }))
  assert.match(t, /EL CHICO DE LA MOTO ROJA/)
  assert.match(t, /DE LA ESQUINA/)
})

test('número de cliente: sigue la cuenta en el día y vuelve a 1 a las 5:00', () => {
  const noche = new Date(2026, 9, 24, 23, 50)
  const madrugada = new Date(2026, 9, 25, 2, 10)   // sigue siendo la jornada del 24
  const manana = new Date(2026, 9, 25, 9, 0)
  assert.equal(claveJornada(noche), '2026-10-24')
  assert.equal(claveJornada(madrugada), '2026-10-24')
  assert.equal(claveJornada(manana), '2026-10-25')
  let r = siguienteNumero(null, noche)
  assert.equal(r.numero, 1)
  r = siguienteNumero(r.guardado, madrugada)
  assert.equal(r.numero, 2)
  r = siguienteNumero(r.guardado, manana)
  assert.equal(r.numero, 1)
  // Lo guardado roto no rompe nada: empieza en 1.
  assert.equal(siguienteNumero({ dia: '2026-10-25', n: 'x' }, manana).numero, 1)
})

test('número de cliente: se guarda en el aparato, por restaurante', () => {
  const a = almacen()
  const hoy = new Date(2026, 9, 24, 13, 0)
  assert.equal(asignarNumeroCliente('est1', a, hoy), 1)
  assert.equal(asignarNumeroCliente('est1', a, hoy), 2)
  assert.equal(asignarNumeroCliente('est2', a, hoy), 1)
  assert.equal(asignarNumeroCliente('est1', a, hoy), 3)
})

test('número de cliente: sin almacén (incógnito, lleno) la cuenta sigue en memoria', () => {
  const roto = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('lleno') } }
  const hoy = new Date(2026, 9, 24, 13, 0)
  assert.equal(asignarNumeroCliente('estX', roto, hoy), 1)
  assert.equal(asignarNumeroCliente('estX', roto, hoy), 2)
})

test('se recuerda de quién fue cada venta cobrada (para reimprimir su comanda)', () => {
  const a = almacen()
  recordarQuien('est', 'k1', { numero: 7, nombre: 'Ana' }, a)
  recordarQuien('est', 'k2', { numero: 8, nombre: null }, a)
  recordarQuien('est', 'k3', { numero: null, nombre: null }, a)   // nada que recordar
  assert.deepEqual(quienDeVenta('est', 'k1', a), { numero: 7, nombre: 'Ana' })
  assert.deepEqual(quienDeVenta('est', 'k2', a), { numero: 8, nombre: null })
  assert.equal(quienDeVenta('est', 'k3', a), null)
  assert.equal(quienDeVenta('otro', 'k1', a), null)
  // La misma clave otra vez se sustituye, y la lista no crece sin fin.
  let lista = []
  for (let i = 0; i < 10; i++) lista = anadirQuien(lista, 'k' + i, { numero: i }, 5)
  assert.equal(lista.length, 5)
  assert.equal(buscarQuien(lista, 'k0'), null)
  assert.deepEqual(buscarQuien(anadirQuien(lista, 'k9', { numero: 99 }, 5), 'k9'), { numero: 99, nombre: null })
})

test('el nombre puesto de una aparcada: el tecleado sí, la etiqueta automática no', () => {
  assert.equal(nombrePuesto({ nombre: 'Mesa 3' }), 'Mesa 3')
  assert.equal(nombrePuesto({ nombre: 'Sin nombre 21:05' }), null)
  assert.equal(nombrePuesto({ nombre: 'Juan', nombre_venta: null }), null)
  assert.equal(nombrePuesto({ nombre: 'Sin nombre 21:05', nombre_venta: 'Pepe' }), 'Pepe')
  assert.equal(tieneQuien({ numero: null, nombre: null }), false)
  assert.equal(tieneQuien({ numero: 0, nombre: null }), true)
})

// ── a10: reimprimir la comanda ───────────────────────────────────────────────
test('comanda del mostrador reimpresa: lo dice arriba y lleva la hora de la venta', () => {
  const t = texto(generarComandaTpv([linea], { nombre: 'Max' }, {
    cliente: 23, codigo: 'PD-ABC123', reimpresa: true, fecha: '2026-10-24T19:30:00.000Z',
  }))
  assert.match(t, /REIMPRESION/)
  assert.match(t, /Si ya la tienes, no la hagas otra vez/)
  assert.match(t, /24\/10\/2026/)
  assert.match(t, /Reimpresa: /)
  assert.match(t, /CLIENTE 23/)
})

test('comanda de un pedido reimpresa: marca arriba; sin la opción, el papel de siempre', () => {
  const pedido = { codigo: 'PD-XYZ999', created_at: '2026-10-24T19:30:00.000Z', metodo_pago: 'efectivo', origen_pedido: 'telefonico', subtotal: 12 }
  const items = [{ cantidad: 1, nombre_producto: 'Pizza', extras: ['Queso (+0.50€)'], notas: null }]
  const normal = generarComandaCocina(pedido, items, {}, '** COCINA **')
  assert.deepEqual(normal, generarComandaCocina(pedido, items, {}, '** COCINA **', {}))
  assert.doesNotMatch(texto(normal), /REIMPRESION/)
  const t = texto(generarComandaCocina(pedido, items, {}, '** COCINA **', { reimpresa: true }))
  assert.match(t, /REIMPRESION/)
  assert.match(t, /Reimpresa: /)
  assert.match(t, /PD-XYZ999/)
})

test('las líneas guardadas vuelven a cocina sin precios y con su producto (para su impresora)', () => {
  const l = lineasComandaDeItems([
    { producto_id: 'p1', cantidad: 2, nombre_producto: 'Hamburguesa', tamano: null, extras: ['Queso (+0.50€)', 'Al punto'], notas: 'Sin cebolla' },
    { producto_id: null, cantidad: 1, nombre_producto: 'Varios', extras: null },
    { cantidad: 1, nombre_producto: 'Sin columna' },
  ])
  assert.deepEqual(l[0], { producto_id: 'p1', cantidad: 2, nombre: 'Hamburguesa', tamano: null, extrasTexto: 'Queso, Al punto', notas: 'Sin cebolla' })
  assert.equal(l[1].producto_id, null)       // línea libre: a la cocina
  assert.equal(l[1].extrasTexto, '')
  assert.equal(l[2].producto_id, undefined)  // sin el campo: el camino de siempre (caja)
})

// ── a13: el papel de los repartos y del teléfono no es una factura ───────────
const pedidoTel = {
  codigo: 'PD-TEL001', created_at: '2026-10-24T19:30:00.000Z', metodo_pago: 'efectivo',
  origen_pedido: 'telefonico', total: 13, guest_nombre: 'Ana', guest_telefono: '600000000',
}
const itemsTel = [{ cantidad: 1, nombre_producto: 'Pizza', precio_unitario: 13, extras: [] }]
const datosCliente = { nombre: 'Ana SL', nif: 'B12345678', direccion: 'Calle 1' }

test('«Crear justificante»: ni «FACTURA SIMPLIFICADA» ni «Canal: PIDO» en un pedido del local', () => {
  const t = texto(generarTicketCliente(pedidoTel, itemsTel, { nombre: 'Max' }, null, datosCliente))
  assert.doesNotMatch(t, /FACTURA SIMPLIFICADA/)
  assert.match(t, /JUSTIFICANTE DE PEDIDO/)
  assert.match(t, /No v.lido como factura/)
  assert.match(t, /B12345678/)
  assert.doesNotMatch(t, /Canal:/)
})

test('ticket normal de un pedido por teléfono o de la mesa: sin «Canal: PIDO»', () => {
  for (const origen of ['telefonico', 'mesa']) {
    const t = texto(generarTicketCliente({ ...pedidoTel, origen_pedido: origen }, itemsTel, {}))
    assert.match(t, /TICKET DE PEDIDO/)
    assert.doesNotMatch(t, /Canal:/)
    assert.doesNotMatch(t, /No v.lido como factura/)
  }
})

test('pedido que entró por Pidoo (o sin origen): «Canal: PIDO» como siempre', () => {
  for (const origen of ['pido', 'tienda_publica', 'marketplace_socio', undefined]) {
    const t = texto(generarTicketCliente({ ...pedidoTel, origen_pedido: origen }, itemsTel, {}))
    assert.match(t, /Canal:\s+PIDO/)
  }
  // Con los datos del cliente, también justificante y no factura.
  const t = texto(generarTicketCliente({ ...pedidoTel, origen_pedido: 'pido' }, itemsTel, {}, null, datosCliente))
  assert.match(t, /JUSTIFICANTE DE PEDIDO/)
  assert.doesNotMatch(t, /FACTURA SIMPLIFICADA/)
})

test('el ticket del MOSTRADOR sigue siendo factura simplificada (no cambia)', () => {
  const t = texto(generarTicketTpv({
    serie: 'A', numero: 12, total: 10, base_imponible: 9.35, igic_pct: 7, cuota_igic: 0.65,
    metodo_pago: 'efectivo', emitido_at: '2026-10-26T09:00:00.000Z',
  }, {}, [], { nombre: 'Max', nif: 'X' }, null, false, null, null, datosCliente))
  assert.match(t, /FACTURA SIMPLIFICADA/)
})
