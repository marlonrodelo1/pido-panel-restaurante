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

/**
 * URL que codifica el QR. Con `tokenMesa`, la carta sabrá desde qué mesa se ha
 * escaneado (lo necesita el camarero virtual para saber dónde llevar el pedido).
 *
 * El token añade 9 caracteres. Eso son más módulos en el QR y menos margen con el
 * logo encima, así que NO se da por bueno: `npm run test:qr` decodifica de verdad
 * el peor caso real (slug largo + mesa, a 300 px, con el logo tapando el centro).
 * Medido: aguanta hasta 170 caracteres de URL. Vamos por 50.
 */
export function urlCarta(slug, tokenMesa) {
  const base = `https://pidoo.es/${slug}/carta`
  return tokenMesa ? `${base}?m=${tokenMesa}` : base
}

/**
 * Carga una imagen SIN contaminar el canvas.
 *
 * Con un <img src="url-remota"> el canvas queda "tainted" y toDataURL() revienta
 * con SecurityError justo al descargar, que es el peor momento para enterarse.
 * Con fetch, un fallo de CORS se detecta antes y se puede caer a un QR sin logo.
 * Devuelve null si no se puede cargar.
 */
// Memoria del logo ya cargado. Sin esto, generar 20 carteles de mesa haría 20
// fetch idénticos del mismo PNG.
const logosCargados = new Map()

async function cargarImagen(url) {
  if (!url) return null
  if (logosCargados.has(url)) return logosCargados.get(url)
  const img = await cargarImagenSinCache(url)
  logosCargados.set(url, img)
  return img
}

async function cargarImagenSinCache(url) {
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

/**
 * Canvas con el QR y, si se puede cargar, el logo del restaurante en el centro.
 *
 * ⚠️ RECIBE LA URL YA HECHA, no el slug. Antes la construía por dentro y por eso
 * no había forma de meterle la mesa. Quien llame usa `urlCarta(slug, token)`.
 */
export async function construirQr(url, logoUrl, lado = LADO_QR) {
  const QRCode = (await import('qrcode')).default
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, url, {
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

/**
 * Cartel A6 listo para imprimir y poner en la mesa.
 *
 * `mesa` (opcional) = { codigo, token }. Con mesa, el QR lleva su token y el
 * cartel enseña el número en grande. Sin mesa, sale el cartel de siempre.
 */
export async function construirCartel(restaurante, mesa = null) {
  const url = urlCarta(restaurante.slug, mesa?.token)
  const qr = await construirQr(url, restaurante.logo_url, 760)
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

  if (mesa?.codigo) {
    // El número de mesa, en grande. Es lo que hace que el camarero sepa dónde
    // llevar el plato y lo que permite al del bar repartir los carteles sin
    // equivocarse. Va DEBAJO del QR para no competir con el nombre del local.
    ctx.fillStyle = '#C5562C'
    ctx.font = 'bold 96px "Plus Jakarta Sans", Arial, sans-serif'
    recortarTexto(ctx, esNumero(mesa.codigo) ? `MESA ${mesa.codigo}` : mesa.codigo,
      CARTEL_W / 2, 440 + qr.height + 236, CARTEL_W - 180)

    // Sin URL escrita cuando hay mesa, y es deliberado: `?m=A3K7QP` no lo teclea
    // nadie bien, y poner la corta llevaría a la carta SIN mesa — el cliente
    // hablaría con el camarero sin que este sepa dónde está sentado. Mejor una
    // sola forma de entrar: el QR.
  } else {
    // Sin mesa sí: si el QR no lee (cámara vieja, pantalla sucia), se teclea.
    ctx.fillStyle = '#6B6356'
    ctx.font = '38px "Plus Jakarta Sans", Arial, sans-serif'
    recortarTexto(ctx, `pidoo.es/${restaurante.slug}/carta`, CARTEL_W / 2, 440 + qr.height + 176, CARTEL_W - 180)
  }

  ctx.fillStyle = '#C5562C'
  ctx.font = 'bold 40px "Plus Jakarta Sans", Arial, sans-serif'
  ctx.fillText('pidoo', CARTEL_W / 2, CARTEL_H - 120)

  return c
}

function esNumero(codigo) {
  return /^\d+$/.test(String(codigo).trim())
}

/**
 * PDF con un cartel por página, listo para mandar a la impresora de una vez.
 *
 * Un PNG por mesa no vale: el navegador bloquea la segunda descarga automática y
 * el dueño acabaría bajando 20 ficheros a mano. `jspdf` ya es dependencia del
 * panel (se usa en informeVentas.js) y va con import dinámico, así que no engorda
 * la carga inicial.
 */
export async function construirPdfCarteles(restaurante, mesas, onProgreso) {
  const { jsPDF } = await import('jspdf')
  // A6 en mm; los canvas son A6 a 300 ppp, así que encajan al milímetro.
  const pdf = new jsPDF({ unit: 'mm', format: [105, 148], orientation: 'portrait' })

  for (let i = 0; i < mesas.length; i++) {
    const canvas = await construirCartel(restaurante, mesas[i])
    if (i > 0) pdf.addPage([105, 148], 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 105, 148)
    onProgreso?.(i + 1, mesas.length)
  }
  return pdf
}

export function descargarCanvas(canvas, nombre) {
  const enlace = document.createElement('a')
  enlace.download = nombre
  enlace.href = canvas.toDataURL('image/png')
  enlace.click()
}
