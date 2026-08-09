/* ──────────────────────────────────────────────────────────────────────────
 * qrCarta — genera el QR y el cartel de mesa que apuntan a la carta del local
 * (https://pidoo.es/<slug>/carta). Módulo puro: sin React, solo canvas.
 *
 * `qrcode` va con import dinámico, igual que jspdf en informeVentas.js: solo
 * se descarga cuando el dueño pulsa el botón, no en cada carga del panel.
 * ────────────────────────────────────────────────────────────────────────── */

const LADO_QR = 1024
// A6 (105 × 148 mm) a 300 ppp: medida de imprenta, no de pantalla.
const CARTEL_W = 1240
const CARTEL_H = 1748

export function urlCarta(slug) {
  return `https://pidoo.es/${slug}/carta`
}

/**
 * Carga una imagen SIN contaminar el canvas.
 *
 * Con un <img src="url-remota"> el canvas queda "tainted" y toDataURL() revienta
 * con SecurityError justo al descargar, que es el peor momento para enterarse.
 * Con fetch, un fallo de CORS se detecta antes y se puede caer a un QR sin logo.
 * Devuelve null si no se puede cargar.
 */
async function cargarImagen(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = objectUrl
      })
    } finally {
      // Se revoca tras el load: la imagen ya está decodificada en memoria.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
    }
  } catch (_) {
    return null
  }
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Canvas con el QR y, si se puede cargar, el logo del restaurante en el centro. */
export async function construirQr(slug, logoUrl, lado = LADO_QR) {
  const QRCode = (await import('qrcode')).default
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, urlCarta(slug), {
    // Nivel H: es lo que permite tapar el centro con el logo sin que el lector
    // falle. Si alguna vez no lee, se reduce el logo, NUNCA el nivel.
    errorCorrectionLevel: 'H',
    margin: 1,
    width: lado,
    color: { dark: '#1A1815', light: '#FFFFFF' },
  })

  const logo = await cargarImagen(logoUrl)
  if (logo) {
    const ctx = canvas.getContext('2d')
    const caja = Math.round(canvas.width * 0.22)
    const x = Math.round((canvas.width - caja) / 2)
    const y = Math.round((canvas.height - caja) / 2)
    const r = Math.round(caja * 0.18)

    // Recuadro blanco debajo: sin él, los módulos oscuros del QR se ven a través
    // de un logo con transparencia y el lector se confunde.
    ctx.fillStyle = '#FFFFFF'
    redondeado(ctx, x - 8, y - 8, caja + 16, caja + 16, r)
    ctx.fill()

    ctx.save()
    redondeado(ctx, x, y, caja, caja, r)
    ctx.clip()
    // Recorte "cover" para que un logo rectangular no salga deformado.
    const escala = Math.max(caja / logo.width, caja / logo.height)
    const w = logo.width * escala
    const h = logo.height * escala
    ctx.drawImage(logo, x + (caja - w) / 2, y + (caja - h) / 2, w, h)
    ctx.restore()
  }
  return canvas
}

function recortarTexto(ctx, texto, x, y, maxAncho) {
  let t = texto
  while (t.length > 4 && ctx.measureText(t).width > maxAncho) t = t.slice(0, -1)
  ctx.fillText(t === texto ? t : t.trimEnd() + '…', x, y)
}

/** Cartel A6 listo para imprimir y poner en la mesa. */
export async function construirCartel(restaurante) {
  const qr = await construirQr(restaurante.slug, restaurante.logo_url, 760)
  const c = document.createElement('canvas')
  c.width = CARTEL_W
  c.height = CARTEL_H
  const ctx = c.getContext('2d')

  ctx.fillStyle = '#F7F3EC'
  ctx.fillRect(0, 0, CARTEL_W, CARTEL_H)

  ctx.strokeStyle = '#C5562C'
  ctx.lineWidth = 14
  redondeado(ctx, 46, 46, CARTEL_W - 92, CARTEL_H - 92, 46)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#1A1815'
  ctx.font = 'bold 74px "Plus Jakarta Sans", Arial, sans-serif'
  recortarTexto(ctx, restaurante.nombre || '', CARTEL_W / 2, 260, CARTEL_W - 200)

  ctx.fillStyle = '#C5562C'
  ctx.font = 'bold 52px "Plus Jakarta Sans", Arial, sans-serif'
  ctx.fillText('CARTA DIGITAL', CARTEL_W / 2, 360)

  const qx = (CARTEL_W - qr.width) / 2
  ctx.fillStyle = '#FFFFFF'
  redondeado(ctx, qx - 26, 440 - 26, qr.width + 52, qr.height + 52, 34)
  ctx.fill()
  ctx.drawImage(qr, qx, 440)

  ctx.fillStyle = '#1A1815'
  ctx.font = 'bold 46px "Plus Jakarta Sans", Arial, sans-serif'
  ctx.fillText('Escanea con la cámara del móvil', CARTEL_W / 2, 440 + qr.height + 110)

  // La dirección escrita: si el QR no lee (cámara vieja, pantalla sucia), se teclea.
  ctx.fillStyle = '#6B6356'
  ctx.font = '38px "Plus Jakarta Sans", Arial, sans-serif'
  recortarTexto(ctx, `pidoo.es/${restaurante.slug}/carta`, CARTEL_W / 2, 440 + qr.height + 176, CARTEL_W - 180)

  ctx.fillStyle = '#C5562C'
  ctx.font = 'bold 40px "Plus Jakarta Sans", Arial, sans-serif'
  ctx.fillText('pidoo', CARTEL_W / 2, CARTEL_H - 120)

  return c
}

export function descargarCanvas(canvas, nombre) {
  const enlace = document.createElement('a')
  enlace.download = nombre
  enlace.href = canvas.toDataURL('image/png')
  enlace.click()
}
