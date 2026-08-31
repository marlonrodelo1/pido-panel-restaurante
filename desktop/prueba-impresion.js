// Prueba de la impresion SIN impresora: se levanta una de mentira que escucha en un
// puerto y se comprueba que llega lo que tiene que llegar.
//
// No sustituye a probarlo con la impresora de verdad —eso sigue pendiente— pero cubre
// lo que mas se rompe: que los bytes lleguen ENTEROS (un ticket a medias es medio
// pedido), que una impresora apagada de error en vez de colgar la app, y que una IP
// que no existe no deje la venta esperando.
//
//   node prueba-impresion.js
const net = require('node:net')
const { enviarBytes, comprobar } = require('./impresion')

let fallos = 0
const ok = (bien, texto, extra = '') => {
  console.log(`${bien ? '  OK  ' : '  MAL '} ${texto}${extra ? ' -> ' + extra : ''}`)
  if (!bien) fallos++
}

// Una "impresora": guarda todo lo que le mandan y lo devuelve al cerrarse.
function impresoraDeMentira() {
  return new Promise((resolve) => {
    const trozos = []
    const server = net.createServer((socket) => {
      socket.on('data', (d) => trozos.push(d))
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({
        puerto: server.address().port,
        recibido: () => Buffer.concat(trozos),
        cerrar: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

async function main() {
  console.log('\n== La impresora recibe los bytes ENTEROS ==')
  {
    const imp = await impresoraDeMentira()
    // Un ticket de verdad son unos 2 KB. Se manda algo mas grande para que no quepa en
    // un solo paquete: ahi es donde se ven los cierres prematuros.
    const original = Buffer.alloc(50000)
    for (let i = 0; i < original.length; i++) original[i] = i % 256
    const r = await enviarBytes('127.0.0.1', imp.puerto, original.toString('base64'))
    await new Promise((r2) => setTimeout(r2, 150))
    const llegado = imp.recibido()
    ok(r.ok === true, 'devuelve ok')
    ok(llegado.length === original.length, 'llegan todos los bytes', `${llegado.length} de ${original.length}`)
    ok(llegado.equals(original), 'y llegan sin cambiar ni uno')
    await imp.cerrar()
  }

  console.log('\n== Una impresora APAGADA da error, no cuelga ==')
  {
    const imp = await impresoraDeMentira()
    const puerto = imp.puerto
    await imp.cerrar() // ahora ese puerto no escucha nadie
    const t0 = Date.now()
    let error = null
    try { await enviarBytes('127.0.0.1', puerto, Buffer.from('hola').toString('base64')) }
    catch (e) { error = e }
    const tardo = Date.now() - t0
    ok(!!error, 'lanza error')
    ok(tardo < 3000, 'y no se queda colgado', `${tardo} ms`)
    ok(/rechaza|ECONNREFUSED/i.test(error?.message || ''), 'con un mensaje que se entiende', error?.message)
  }

  console.log('\n== Una IP que no contesta corta por timeout ==')
  {
    const t0 = Date.now()
    let error = null
    // 192.0.2.x es la red reservada para documentacion: no existe, nadie contesta.
    try { await enviarBytes('192.0.2.1', 9100, Buffer.from('x').toString('base64'), 1200) }
    catch (e) { error = e }
    const tardo = Date.now() - t0
    ok(!!error, 'lanza error')
    ok(tardo < 2500, 'respeta el tope de tiempo', `${tardo} ms`)
  }

  console.log('\n== comprobar() distingue viva de muerta ==')
  {
    const imp = await impresoraDeMentira()
    const viva = await comprobar('127.0.0.1', imp.puerto, 1000)
    ok(viva.ok === true, 'una impresora encendida sale ok')
    const puerto = imp.puerto
    await imp.cerrar()
    const muerta = await comprobar('127.0.0.1', puerto, 1000)
    ok(muerta.ok === false, 'una apagada sale no-ok')
  }

  console.log('\n== Datos invalidos no revientan el proceso ==')
  {
    let error = null
    try { await enviarBytes('', 9100, 'AAAA') } catch (e) { error = e }
    ok(!!error && /IP/i.test(error.message), 'sin IP da un error claro', error?.message)
  }

  console.log(fallos ? `\nHAY ${fallos} FALLOS\n` : '\nTodo correcto\n')
  process.exit(fallos ? 1 : 0)
}

main().catch((e) => { console.error('la prueba reventó:', e); process.exit(1) })
