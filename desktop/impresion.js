// Hablar con la impresora termica por TCP al puerto 9100.
//
// Vive en su propio fichero, sin nada de Electron dentro, PARA PODER PROBARLO: con
// `node prueba-impresion.js` se levanta una impresora de mentira y se comprueba que
// los bytes llegan enteros, que un timeout no cuelga y que una IP muerta da error en
// vez de quedarse esperando. La impresora de verdad no la tenemos delante.
const net = require('node:net')
const os = require('node:os')

// Manda bytes ESC/POS crudos. Mismo contrato que el plugin de Android
// (`ThermalPrinterPlugin.print`): ip, puerto y los datos en base64.
function enviarBytes(ip, puerto, base64, msTope = 6000) {
  return new Promise((resolve, reject) => {
    let datos
    try {
      datos = Buffer.from(base64, 'base64')
    } catch {
      return reject(new Error('Datos de impresion invalidos'))
    }
    if (!ip) return reject(new Error('Falta la IP de la impresora'))

    const socket = new net.Socket()
    let hecho = false
    // UNA sola salida. Sin esto, un 'error' que llega despues del 'close' vuelve a
    // llamar al callback: la promesa ya esta resuelta y la excepcion se pierde.
    const terminar = (err) => {
      if (hecho) return
      hecho = true
      socket.destroy()
      err ? reject(err) : resolve({ ok: true, bytes: datos.length })
    }

    socket.setTimeout(msTope)
    socket.once('timeout', () => terminar(new Error(`La impresora no responde (${ip}:${puerto})`)))
    socket.once('error', (e) => terminar(new Error(
      e.code === 'ECONNREFUSED' ? `La impresora rechaza la conexion en ${ip}:${puerto}`
      : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `No se llega a ${ip}. Comprueba que esta en la misma red.`
      : e.message)))
    socket.once('close', () => terminar(null))

    socket.connect(puerto, ip, () => {
      // `end()` DENTRO del callback del write: cerrar antes de que salgan los bytes
      // deja el ticket a medias, y en una comanda eso es medio pedido.
      socket.write(datos, () => socket.end())
    })
  })
}

// Solo abre y cierra: sirve para saber si hay algo escuchando.
function comprobar(ip, puerto, msTope = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let hecho = false
    const terminar = (ok, error) => {
      if (hecho) return
      hecho = true
      socket.destroy()
      resolve({ ok, error })
    }
    socket.setTimeout(msTope)
    socket.once('timeout', () => terminar(false, 'No responde'))
    socket.once('error', (e) => terminar(false, e.message))
    socket.connect(puerto, ip, () => terminar(true))
  })
}

// Las redes /24 de esta maquina, para saber donde buscar.
function subredes() {
  const bases = new Set()
  for (const listas of Object.values(os.networkInterfaces())) {
    for (const i of listas || []) {
      if (i.family === 'IPv4' && !i.internal) bases.add(i.address.split('.').slice(0, 3).join('.'))
    }
  }
  return [...bases]
}

// Recorre el /24 probando el puerto. De 40 en 40: abrir 254 sockets de golpe tumba la
// tabla de conexiones de algunos routers domesticos, que es justo donde va esto.
async function escanear(puerto = 9100, bases = subredes()) {
  if (!bases.length) return { printers: [], subnet: null, scanned: 0, error: 'Sin red local' }
  const encontradas = []
  let miradas = 0
  for (const base of bases) {
    const todas = Array.from({ length: 254 }, (_, n) => `${base}.${n + 1}`)
    for (let i = 0; i < todas.length; i += 40) {
      const tanda = todas.slice(i, i + 40)
      const res = await Promise.all(tanda.map((ip) => comprobar(ip, puerto, 900).then((r) => (r.ok ? ip : null))))
      miradas += tanda.length
      for (const ip of res) if (ip) encontradas.push({ ip, port: puerto })
    }
  }
  return { printers: encontradas, subnet: `${bases[0]}.0/24`, scanned: miradas }
}

// Los tres canales, con los mismos nombres y la misma forma que en Android, para que
// el frontend no tenga que saber en cual de las dos plataformas esta.
//
// `ipcMain` entra POR ARGUMENTO y no por `require('electron')` para que este fichero
// siga arrancando fuera de Electron: es lo que permite que la prueba use exactamente
// este cableado en vez de uno copiado, que es como se cuelan las diferencias.
function registrarCanales(ipcMain) {
  ipcMain.handle('pidoo:print', (_e, { ip, port, data }) => enviarBytes(ip, port || 9100, data))
  ipcMain.handle('pidoo:check', (_e, { ip, port }) => comprobar(ip, port || 9100))
  ipcMain.handle('pidoo:scan', (_e, { port } = {}) => escanear(port || 9100))
}

module.exports = { enviarBytes, comprobar, escanear, subredes, registrarCanales }
