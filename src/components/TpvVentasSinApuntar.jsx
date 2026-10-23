// VENTAS SIN APUNTAR (auditoría 05, a6, 22 oct 2026).
//
// Las ventas que se cobraron en ESTE aparato y que el servidor todavía no tiene:
// las del corte de internet que esperan a la red, y las que el servidor no ha
// aceptado. Antes no había ningún sitio donde verlas: una venta atascada no se
// volvía a intentar, el aviso decía «Sincronizando…» sin fin y el cierre Z se
// negaba para siempre en ese aparato.
//
// Aquí una persona puede, con cada venta que tiene problema:
//   - «Volver a intentar»: cuando el motivo ya se ha arreglado (el TPV vuelve a
//     estar activo, la sesión se ha renovado, el servidor ha vuelto).
//   - «Pasar al mostrador»: el servidor la rechaza por la carta (un producto o un
//     extra que ya no existe). La venta vuelve al mostrador para cobrarla otra vez
//     con la carta de ahora — SIN pedir el dinero, que ya está en el cajón.
//   - «Descartar»: solo si no se llegó a cobrar o ya está apuntada de otra forma.
//     No se tira: queda archivada en el aparato por si Pidoo la necesita.
//
// Lo que aún no ha llegado al servidor por falta de red no se toca: se va sola.
import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import {
  leerCola, estadoCola, reintentarVenta, descartarVentaAtascada, sincronizarCola, sincronizandoAhora,
} from '../lib/colaVentas'
import { tieneProblema } from '../lib/colaVentasLogica'
import { redCaida } from '../lib/estadoRed'
import { toast, confirmar } from '../App'
import { T, eur, btnAccion, btnSecundario } from '../lib/tpvTheme'

const AMBAR = '#F5A623'

function cuando(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TpvVentasSinApuntar({ establecimientoId, onVolver, onVolverACobrar }) {
  const [cola, setCola] = useState(() => leerCola(establecimientoId))
  const [ocupado, setOcupado] = useState(false)
  const [sinRed, setSinRed] = useState(() => redCaida())

  const releer = useCallback(() => setCola(leerCola(establecimientoId)), [establecimientoId])
  useEffect(() => {
    const cambioCola = (e) => { if (e?.detail?.est === establecimientoId) releer() }
    const cambioRed = () => setSinRed(redCaida())
    window.addEventListener('pidoo:cola-ventas', cambioCola)
    window.addEventListener('pidoo:red', cambioRed)
    releer()
    return () => {
      window.removeEventListener('pidoo:cola-ventas', cambioCola)
      window.removeEventListener('pidoo:red', cambioRed)
    }
  }, [establecimientoId, releer])

  const resumen = estadoCola(establecimientoId)
  const conProblema = cola.filter(tieneProblema)
  const esperando = cola.filter((v) => !tieneProblema(v))

  async function trabajar(fn) {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await fn()
      releer()
      if (r?.enviadas) toast(`Apuntada${r.enviadas > 1 ? 's' : ''} ${r.enviadas} venta${r.enviadas > 1 ? 's' : ''}`, 'success')
      else if (r?.sinRed) toast('Sin conexión: se mandarán solas cuando vuelva internet', 'error')
      else if (r && r.conProblema) toast('El servidor sigue sin aceptarla: mira el motivo', 'error')
      return r
    } catch {
      toast('No se ha podido mandar ahora. Se vuelve a intentar sola.', 'error')
      return null
    } finally {
      setOcupado(false)
    }
  }

  async function descartar(v) {
    if (sincronizandoAhora()) { toast('Se están mandando ventas ahora mismo: espera unos segundos', 'error'); return }
    const efectivo = v.metodo === 'efectivo'
    const seguro = await confirmar(
      `¿Descartar la venta OFF-${v.numeroOff} de ${eur(Number(v.total_c) || 0)}?\n\n`
      + 'No se apuntará NUNCA en Pidoo. '
      + (efectivo ? `Si se cobró, el cierre de caja tendrá ${eur(Number(v.total_c) || 0)} de más. ` : '')
      + 'Hazlo solo si no se llegó a cobrar o si ya está apuntada de otra forma.',
    )
    if (!seguro) return
    descartarVentaAtascada(establecimientoId, v.payload?.idempotency_key, 'descartada')
    releer()
    toast(`Venta OFF-${v.numeroOff} descartada (queda archivada en este aparato)`, 'success')
  }

  function alMostrador(v) {
    if (sincronizandoAhora()) { toast('Se están mandando ventas ahora mismo: espera unos segundos', 'error'); return }
    if (!onVolverACobrar) return
    // El TPV decide si se puede (con otra venta a medias en el mostrador, no).
    if (onVolverACobrar(v) === false) return
    releer()
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
        {resumen.total
          ? <>Cobradas en <strong style={{ color: T.text }}>este aparato</strong> que el servidor todavía no tiene: <strong style={{ color: T.text }}>{resumen.total}</strong> ({eur(resumen.importe_c)}). El dinero ya está en el cajón o en el datáfono.</>
          : 'No queda ninguna venta sin apuntar en este aparato.'}
      </div>

      {conProblema.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.danger, textTransform: 'uppercase' }}>
            Con problema · necesitan a alguien
          </div>
          {conProblema.map((v) => (
            <FilaVenta key={v.payload?.idempotency_key} v={v}>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: v.atascada ? T.danger : AMBAR }}>
                {v.atascada
                  ? <>No la acepta el servidor: {v.motivo || 'sin motivo'}</>
                  : <>Falla al mandarla{v.fallos > 1 ? ` (${v.fallos} veces)` : ''}: {String(v.ultimoFallo || 'error del servidor').replace(/\.+$/, '')}. Se vuelve a intentar sola.</>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <button disabled={ocupado || sinRed}
                  onClick={() => trabajar(() => reintentarVenta(establecimientoId, v.payload?.idempotency_key))}
                  style={{ ...btnSecundario, height: 38, fontSize: 13, opacity: (ocupado || sinRed) ? 0.45 : 1 }}>
                  <RefreshCw size={14} style={{ marginRight: 6 }} /> Volver a intentar
                </button>
                {/* Solo con un «no» de verdad del servidor: con un fallo suyo (5xx)
                    no se sabe si llegó a grabarla, y cobrarla otra vez podría
                    apuntarla dos veces. */}
                {v.atascada && onVolverACobrar && v.carrito?.length > 0 && (
                  <button disabled={ocupado} onClick={() => alMostrador(v)}
                    style={{ ...btnSecundario, height: 38, fontSize: 13, opacity: ocupado ? 0.45 : 1 }}>
                    <Undo2 size={14} style={{ marginRight: 6 }} /> Pasar al mostrador
                  </button>
                )}
                <button disabled={ocupado} onClick={() => descartar(v)}
                  style={{ ...btnSecundario, height: 38, fontSize: 13, color: T.danger, opacity: ocupado ? 0.45 : 1 }}>
                  <Trash2 size={14} style={{ marginRight: 6 }} /> Descartar
                </button>
              </div>
            </FilaVenta>
          ))}
        </div>
      )}

      {esperando.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.muted, textTransform: 'uppercase' }}>
            Esperando a internet · se mandan solas
          </div>
          {esperando.map((v) => (
            <FilaVenta key={v.payload?.idempotency_key} v={v}>
              <div style={{ fontSize: 12, color: T.muted }}>
                {v.ultimoResultado === 'red' ? 'Sin conexión la última vez que se intentó.' : 'Pendiente de mandar.'}
              </div>
            </FilaVenta>
          ))}
        </div>
      )}

      {conProblema.length > 0 && (
        <div style={{ background: T.surface2, borderRadius: 12, padding: 12, fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text, fontWeight: 700, marginBottom: 4 }}>
            <AlertTriangle size={14} color={AMBAR} /> Qué hacer
          </div>
          <div>· Si el motivo ya está arreglado: <strong style={{ color: T.text }}>Volver a intentar</strong>.</div>
          <div>· Si falta un producto o un extra de la carta: <strong style={{ color: T.text }}>Pasar al mostrador</strong>, quita o cambia lo que falte y cóbrala <strong style={{ color: T.text }}>sin pedir el dinero otra vez</strong> (ya está en el cajón).</div>
          <div>· Si no se llegó a cobrar: <strong style={{ color: T.text }}>Descartar</strong>.</div>
          <div style={{ marginTop: 4 }}>Una venta con problema no impide cerrar la caja: el cierre avisa y la deja fuera, apuntada en el comentario.</div>
        </div>
      )}

      {resumen.total > 0 && (
        <button disabled={ocupado || sinRed}
          onClick={() => trabajar(() => (conProblema.length ? reintentarVenta(establecimientoId) : sincronizarCola(establecimientoId)))}
          style={{ ...btnAccion, height: 50, fontSize: 15, opacity: (ocupado || sinRed) ? 0.45 : 1 }}>
          <RefreshCw size={16} style={{ marginRight: 8 }} />
          {ocupado ? 'Mandando…' : sinRed ? 'Sin conexión: se mandarán solas' : 'Mandar todas ahora'}
        </button>
      )}
      {onVolver && (
        <button onClick={onVolver} style={{ ...btnSecundario, height: 44 }}>Volver</button>
      )}
    </div>
  )
}

function FilaVenta({ v, children }) {
  const lineas = Array.isArray(v.lineas) ? v.lineas : []
  return (
    <div style={{ padding: '10px 12px', borderRadius: 12, background: T.surface2, border: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 14, color: T.text }}>OFF-{v.numeroOff ?? '?'}</strong>
        <span style={{ fontSize: 12, color: T.muted }}>
          {cuando(v.hora)} · {v.metodo === 'datafono' ? 'Datáfono' : 'Efectivo'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: T.text, fontVariantNumeric: 'tabular-nums' }}>
          {eur(Number(v.total_c) || 0)}
        </span>
      </div>
      {lineas.length > 0 && (
        <div style={{ fontSize: 12, color: T.muted, marginTop: 3, lineHeight: 1.4 }}>
          {lineas.slice(0, 6).join(' · ')}{lineas.length > 6 ? ` · y ${lineas.length - 6} más` : ''}
        </div>
      )}
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  )
}
