/* Comprueba que el QR de la carta del local SIGUE LEYÉNDOSE con el logo
 * tapando el centro.
 *
 * Por qué existe: el logo del restaurante cubre el 22 % del lado del QR (24 %
 * con su recuadro blanco). Eso sale bien porque el nivel de corrección es H,
 * pero es un equilibrio frágil: subir el logo o bajar el nivel deja un cartel
 * impreso en TODAS las mesas del bar que ningún móvil lee, y de eso no se
 * entera nadie hasta que un cliente lo intenta.
 *
 * No usa canvas: renderiza la matriz de módulos que devuelve `qrcode` a un
 * buffer RGBA, le pinta encima el cuadrado del logo y se lo pasa a jsQR — que
 * es justo lo que hace la cámara de un móvil.
 *
 *   npm run test:qr
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const URL_CARTA = 'https://pidoo.es/cafe-bar-australia/carta'

// Debe ir sincronizado con construirQr() en src/lib/qrCarta.js.
const NIVEL = 'H'
const LOGO_PCT = 0.22
const RECUADRO_PCT = LOGO_PCT + 0.016 * 2 // el recuadro blanco de 8 px sobre 1024

/** Matriz de módulos → buffer RGBA de `lado` px, con el centro tapado o no. */
function pintar(texto, lado, tapadoPct) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: NIVEL })
  const n = qr.modules.size
  const datos = qr.modules.data
  const margen = 4 // zona tranquila estándar
  const total = n + margen * 2
  const escala = lado / total

  const px = new Uint8ClampedArray(lado * lado * 4).fill(255)
  const poner = (x, y, v) => {
    const i = (y * lado + x) * 4
    px[i] = px[i + 1] = px[i + 2] = v
    px[i + 3] = 255
  }

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const mx = Math.floor(x / escala) - margen
      const my = Math.floor(y / escala) - margen
      const oscuro = mx >= 0 && my >= 0 && mx < n && my < n && datos[my * n + mx]
      poner(x, y, oscuro ? 0 : 255)
    }
  }

  if (tapadoPct > 0) {
    const caja = Math.round(lado * tapadoPct)
    const ini = Math.round((lado - caja) / 2)
    for (let y = ini; y < ini + caja; y++) {
      for (let x = ini; x < ini + caja; x++) poner(x, y, 255)
    }
  }
  return px
}

function leer(px, lado) {
  const r = jsQR(px, lado, lado)
  return r ? r.data : null
}

test('el QR sin logo se lee', () => {
  const lado = 1024
  assert.equal(leer(pintar(URL_CARTA, lado, 0), lado), URL_CARTA)
})

test('el QR se lee con el logo y su recuadro tapando el centro', () => {
  const lado = 1024
  assert.equal(leer(pintar(URL_CARTA, lado, RECUADRO_PCT), lado), URL_CARTA)
})

test('sigue leyéndose reducido a 300 px (QR pequeño en el cartel impreso)', () => {
  const lado = 300
  assert.equal(leer(pintar(URL_CARTA, lado, RECUADRO_PCT), lado), URL_CARTA)
})

test('aguanta un slug largo, que es el QR más denso', () => {
  const largo = 'https://pidoo.es/guachinche-del-sheriff-valle-tabares/carta'
  const lado = 1024
  assert.equal(leer(pintar(largo, lado, RECUADRO_PCT), lado), largo)
})

test('deja de leerse si alguien agranda el logo hasta el 45%: el margen es real, no infinito', () => {
  const lado = 1024
  assert.equal(leer(pintar(URL_CARTA, lado, 0.45), lado), null)
})
