/* QrCartaLocal — UI para descargar el QR de las mesas. La lógica de canvas
 * vive en ../lib/qrCarta.js (módulo puro, sin React). */
import { useState } from 'react'
import { QrCode, Download, Copy, Check } from 'lucide-react'
import { colors, type, ds } from '../lib/uiStyles'
import { urlCarta, construirQr, construirCartel, descargarCanvas } from '../lib/qrCarta'

export default function QrCartaLocal({ restaurante }) {
  const [ocupado, setOcupado] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState(null)
  const url = urlCarta(restaurante?.slug)

  async function generar(tipo) {
    setOcupado(tipo)
    setError(null)
    try {
      if (tipo === 'qr') {
        const canvas = await construirQr(urlCarta(restaurante.slug), restaurante.logo_url)
        descargarCanvas(canvas, `qr-carta-${restaurante.slug}.png`)
      } else {
        const canvas = await construirCartel(restaurante)
        descargarCanvas(canvas, `cartel-mesa-${restaurante.slug}.png`)
      }
    } catch (e) {
      setError('No se pudo generar la imagen: ' + (e?.message || 'error desconocido'))
    } finally {
      setOcupado(null)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch (_) {
      setError('No se pudo copiar. La dirección es: ' + url)
    }
  }

  if (!restaurante?.slug) {
    return (
      <div style={{ ...ds.card, marginBottom: 18 }}>
        <div style={{ fontSize: type.sm, color: colors.stone }}>
          Para tener el QR de las mesas hace falta la dirección web de tu carta.
          Ponla en Ajustes → Tienda online.
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...ds.card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <QrCode size={17} strokeWidth={2.2} color={colors.terracotta} />
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink }}>
          QR para las mesas
        </div>
      </div>
      <p style={{ fontSize: type.sm, color: colors.stone, margin: '0 0 12px', lineHeight: 1.45 }}>
        Imprime el cartel y ponlo en las mesas. Quien lo escanee ve tu carta con
        los precios del local; desde ahí no se puede pedir.
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: colors.cream2, borderRadius: 10, padding: '9px 12px', marginBottom: 12,
      }}>
        <span style={{ fontFamily: type.mono, fontSize: type.xs, color: colors.ink, wordBreak: 'break-all' }}>
          {url}
        </span>
        <button onClick={copiar} style={{ ...ds.miniBtn, marginLeft: 'auto' }}>
          {copiado
            ? <><Check size={11} strokeWidth={2.4} /> Copiada</>
            : <><Copy size={11} strokeWidth={2.2} /> Copiar</>}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => generar('cartel')} disabled={!!ocupado} style={{ ...ds.glossyBtn, opacity: ocupado ? 0.5 : 1 }}>
          <Download size={14} strokeWidth={2.2} />
          {ocupado === 'cartel' ? 'Generando…' : 'Descargar cartel de mesa'}
        </button>
        <button onClick={() => generar('qr')} disabled={!!ocupado} style={{ ...ds.ghostBtn, opacity: ocupado ? 0.5 : 1 }}>
          {ocupado === 'qr' ? 'Generando…' : 'Solo el QR (PNG)'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 10, color: colors.danger, fontSize: type.xs,
          background: colors.dangerSoft, padding: '8px 12px', borderRadius: 8,
        }}>{error}</div>
      )}
    </div>
  )
}
