// Un servidor de un solo uso para pasarle el instalador al ordenador del mostrador.
//
// Es lo que ya hacía Marlon a mano: levantar algo en el 8080 y abrir la URL desde el
// navegador del otro ordenador. Aquí queda escrito para no tener que acordarse.
//
// Solo sirve ficheros .exe de `dist/`, y nada más: si algún día esto se levanta sin
// pensar en una red que no es la del bar, que no reparta el disco entero.
//
//   node servir-instalador.js
//
// Se para con Ctrl+C. No hay que dejarlo puesto: es para el rato de la instalación.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const PUERTO = Number(process.env.PUERTO || 8080)
const CARPETA = path.join(__dirname, 'dist')

const servidor = http.createServer((req, res) => {
  // Solo el nombre del fichero, sin rutas: `..%2F..%2F` no lleva a ningún sitio.
  const pedido = path.basename(decodeURIComponent((req.url || '').split('?')[0]))

  if (!pedido || pedido === '/') {
    const exes = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.exe'))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(
      '<h2>Instaladores de Pidoo Negocios</h2><ul>' +
      exes.map((f) => `<li><a href="/${encodeURIComponent(f)}">${f}</a></li>`).join('') +
      '</ul>')
  }

  if (!pedido.endsWith('.exe')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Aqui solo se sirven instaladores.')
  }

  const ruta = path.join(CARPETA, pedido)
  if (!fs.existsSync(ruta)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('No existe ese instalador.')
  }

  const { size } = fs.statSync(ruta)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="${pedido}"`,
  })
  fs.createReadStream(ruta).pipe(res)
})

servidor.listen(PUERTO, '0.0.0.0', () => {
  const ips = []
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address)
  }
  console.log('Sirviendo', CARPETA)
  console.log('Desde el otro ordenador, abre una de estas en el navegador:')
  for (const ip of ips) console.log(`   http://${ip}:${PUERTO}/`)
  console.log('Ctrl+C para pararlo.')
})
