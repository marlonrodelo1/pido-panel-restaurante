// El logo del restaurante impreso en el ticket.
//
// Una impresora termica no sabe nada de PNG ni de colores: imprime PUNTOS. Hay que
// darle un mapa de bits de 1 bit —cada punto es negro o no es nada— con el comando
// ESC/POS `GS v 0`. Esto convierte el logo (una URL, en color) a eso.
//
// TRES REGLAS:
//  1. Si algo falla, se devuelve null y el ticket sale SIN logo. Un logo que no carga
//     no puede costar una venta ni dejar a un cliente sin su factura.
//  2. Se convierte UNA vez y se guarda: hacerlo en cada cobro seria descargar y
//     procesar una imagen con el cliente delante.
//  3. El ancho va en puntos y SIEMPRE multiplo de 8, porque cada byte del mapa son
//     8 puntos horizontales. Si no cuadra, la imagen sale inclinada — el clasico
//     "efecto persiana" de las termicas.

const GS = 0x1D
const CLAVE = 'pidoo_logo_ticket_v1'

// 80 mm a 203 ppp son 576 puntos de ancho util. El logo a 384 (dos tercios) se ve
// bien centrado y deja respirar el ticket; a 576 queda gigante y come papel.
const ANCHO_POR_DEFECTO = 384
// Tope de alto: un logo muy vertical se comeria medio ticket en papel.
const ALTO_MAXIMO = 240

// ─── Conversion ─────────────────────────────────────────────────────────────

function cargarImagen(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Sin esto el canvas queda "manchado" y `getImageData` lanza una excepcion de
    // seguridad. El bucket de logos devuelve `Access-Control-Allow-Origin: *`.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('no se pudo cargar el logo'))
    img.src = url
    // Una impresora esperando por una imagen que no llega es peor que sin logo.
    setTimeout(() => reject(new Error('el logo tarda demasiado')), 8000)
  })
}

/**
 * Convierte una imagen a los bytes ESC/POS de un mapa de bits.
 * Devuelve null si no se puede: el llamante debe seguir sin logo.
 */
export async function rasterDesdeUrl(url, anchoPuntos = ANCHO_POR_DEFECTO) {
  if (!url) return null
  try {
    const img = await cargarImagen(url)

    // El tope de alto se respeta ESTRECHANDO el logo, nunca recortando el alto: un
    // logo casi cuadrado (el de Duende Burger es 456x438) al que se le corta el alto
    // sale APLASTADO, y un logo deformado en el ticket es peor que no ponerlo.
    const proporcion = img.naturalHeight / img.naturalWidth || 1
    let ancho = Math.max(8, Math.floor(anchoPuntos / 8) * 8)
    if (Math.round(ancho * proporcion) > ALTO_MAXIMO) {
      ancho = Math.max(8, Math.floor((ALTO_MAXIMO / proporcion) / 8) * 8)
    }
    const alto = Math.max(1, Math.round(ancho * proporcion))

    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })

    // Fondo BLANCO primero: un logo con transparencia, sin esto, se interpreta como
    // negro y sale un cuadrado macizo.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(img, 0, 0, ancho, alto)

    const datos = ctx.getImageData(0, 0, ancho, alto).data

    // Escala de grises con los pesos de luminancia reales: un naranja saturado y un
    // azul del mismo "valor" no se ven igual de oscuros al ojo, ni deben imprimirse
    // igual.
    const gris = new Float32Array(ancho * alto)
    for (let i = 0, p = 0; i < datos.length; i += 4, p++) {
      const a = datos[i + 3] / 255
      const r = datos[i] * a + 255 * (1 - a)
      const g = datos[i + 1] * a + 255 * (1 - a)
      const b = datos[i + 2] * a + 255 * (1 - a)
      gris[p] = 0.299 * r + 0.587 * g + 0.114 * b
    }

    // Difuminado Floyd-Steinberg. Con un umbral seco, una foto o un degradado salen
    // como manchas planas; repartiendo el error se conservan los medios tonos, que
    // es lo que hace que un logo con sombras siga pareciendo el logo.
    const bytesPorFila = ancho / 8
    const mapa = new Uint8Array(bytesPorFila * alto)
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = y * ancho + x
        const viejo = gris[i]
        const nuevo = viejo < 128 ? 0 : 255
        const error = viejo - nuevo
        if (nuevo === 0) {
          // bit a 1 = punto negro; el bit mas alto del byte es el punto de la izquierda
          mapa[y * bytesPorFila + (x >> 3)] |= 0x80 >> (x & 7)
        }
        if (x + 1 < ancho) gris[i + 1] += error * 7 / 16
        if (y + 1 < alto) {
          if (x > 0) gris[i + ancho - 1] += error * 3 / 16
          gris[i + ancho] += error * 5 / 16
          if (x + 1 < ancho) gris[i + ancho + 1] += error * 1 / 16
        }
      }
    }

    // GS v 0 m xL xH yL yH d1..dk
    const cabecera = [GS, 0x76, 0x30, 0x00,
      bytesPorFila & 0xFF, (bytesPorFila >> 8) & 0xFF,
      alto & 0xFF, (alto >> 8) & 0xFF]
    const salida = new Uint8Array(cabecera.length + mapa.length)
    salida.set(cabecera, 0)
    salida.set(mapa, cabecera.length)
    return salida
  } catch (e) {
    console.warn('[logoTicket] no se pudo preparar el logo, el ticket saldra sin el:', e.message)
    return null
  }
}

// ─── Guardado ───────────────────────────────────────────────────────────────
// Convertir en cada cobro seria descargar y procesar una imagen con el cliente
// delante. Se guarda por URL: si el restaurante cambia el logo, la clave cambia y se
// vuelve a convertir sola.

function leerGuardado(url, ancho) {
  try {
    const bruto = localStorage.getItem(CLAVE)
    if (!bruto) return undefined
    const g = JSON.parse(bruto)
    if (g.url !== url || g.ancho !== ancho) return undefined
    if (g.bytes === null) return null            // se intento y no se pudo
    return Uint8Array.from(atob(g.bytes), (c) => c.charCodeAt(0))
  } catch { return undefined }
}

function guardar(url, ancho, bytes) {
  try {
    let b64 = null
    if (bytes) {
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      b64 = btoa(bin)
    }
    localStorage.setItem(CLAVE, JSON.stringify({ url, ancho, bytes: b64 }))
  } catch { /* sin sitio o en incognito: se convertira otra vez, no pasa nada */ }
}

/**
 * Los bytes del logo listos para meter en el ticket, o null si no hay o no se pudo.
 * Nunca lanza.
 */
export async function bytesDelLogo(url, ancho = ANCHO_POR_DEFECTO) {
  if (!url) return null
  const guardado = leerGuardado(url, ancho)
  if (guardado !== undefined) return guardado
  const bytes = await rasterDesdeUrl(url, ancho)
  guardar(url, ancho, bytes)
  return bytes
}

// ─── Vista previa ───────────────────────────────────────────────────────────

/**
 * Deshace el mapa de bits para poder VERLO antes de gastar papel.
 *
 * No es una aproximacion ni una miniatura del original: se leen los MISMOS bits que
 * se van a mandar a la impresora, uno a uno. Lo que sale aqui es exactamente lo que
 * saldra en el ticket — que es justo lo que hay que poder juzgar. Un logo con
 * sombras o poco contraste puede convertirse en una mancha, y descubrirlo en pantalla
 * cuesta cero.
 *
 * Devuelve { url, ancho, alto, mm } o null.
 */
export function previsualizar(bytes) {
  if (!bytes || bytes.length < 9) return null
  try {
    const bytesPorFila = bytes[4] | (bytes[5] << 8)
    const alto = bytes[6] | (bytes[7] << 8)
    const ancho = bytesPorFila * 8
    if (!ancho || !alto) return null

    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    const im = ctx.createImageData(ancho, alto)
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const bit = (bytes[8 + y * bytesPorFila + (x >> 3)] >> (7 - (x & 7))) & 1
        const p = (y * ancho + x) * 4
        const v = bit ? 0 : 255
        im.data[p] = v; im.data[p + 1] = v; im.data[p + 2] = v; im.data[p + 3] = 255
      }
    }
    ctx.putImageData(im, 0, 0)
    // 203 puntos por pulgada es la resolucion de casi todas las termicas de 80 mm.
    return { url: lienzo.toDataURL('image/png'), ancho, alto, mm: +(ancho / 203 * 25.4).toFixed(1) }
  } catch { return null }
}

/** Para el boton "volver a probar" si el dueno cambia el logo. */
export function olvidarLogo() {
  try { localStorage.removeItem(CLAVE) } catch { /* da igual */ }
}
