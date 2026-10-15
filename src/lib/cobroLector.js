// cobroLector.js — hablar con la edge `tpv-cobro-lector` (15 oct 2026).
//
// El cobro con el lector de tarjetas (BBPOS WisePad 3) tiene dos lados:
//   - el TPV (ordenador del mostrador): pide el cobro y espera a que se haga (`crear`, `estado`,
//     `cancelar`, `config`);
//   - el móvil del mostrador (app del panel, pantalla «Lector de tarjetas»): conecta el lector
//     por Bluetooth y pasa los cobros (`token`, `latido`, `pendiente`, `confirmar`, `cancelar`).
// Los dos usan esta misma llamada. La parte del lector (Stripe Terminal) vive en lectorTarjetas.js.
//
// Devuelve siempre { ok, status, data, error } y nunca lanza: quien llama decide qué decir.
// status 0 = sin red o sin respuesta a tiempo.
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const MAX_MS = 20_000

export async function llamarLector(accion, establecimientoId, extra = {}) {
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(), MAX_MS)
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-cobro-lector`, {
      method: 'POST',
      signal: corte.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ accion, establecimiento_id: establecimientoId, ...extra }),
    })
    const data = await resp.json().catch(() => ({}))
    const error = (typeof data?.error === 'string' && data.error) || (resp.ok ? null : `http_${resp.status}`)
    return { ok: resp.ok && !data?.error, status: resp.status, data, error }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e?.name === 'AbortError' ? 'sin_respuesta' : 'sin_red' }
  } finally {
    clearTimeout(reloj)
  }
}

// ¿Está el lector activado para este restaurante y el móvil listo para cobrar?
// { habilitado, listo, movil } — listo = el móvil ha dado señal hace < 1 min con el lector conectado.
export async function estadoLector(establecimientoId) {
  const r = await llamarLector('config', establecimientoId)
  if (!r.ok) return { habilitado: false, listo: false, movil: null, error: r.error }
  return { habilitado: !!r.data?.habilitado, listo: !!(r.data?.habilitado && r.data?.movil?.listo), movil: r.data?.movil || null }
}

// Mensaje para el mostrador según el error de la edge.
export function mensajeErrorLector(error) {
  switch (error) {
    case 'sin_red': return 'Sin conexión. Revisa internet e inténtalo otra vez.'
    case 'sin_respuesta': return 'El servidor no ha contestado. Inténtalo otra vez.'
    case 'lector_desactivado': return 'El cobro con lector no está activado en este restaurante.'
    case 'ya_pagado': return 'Esta venta ya está pagada con tarjeta.'
    case 'importe_minimo': return 'Con tarjeta el mínimo es 0,50 €.'
    case 'cobro_en_curso': return 'Hay un cobro en marcha en el lector. Espera unos segundos.'
    case 'estado_no_cobrable': return 'Esta venta ya no se puede cobrar (está anulada o cancelada).'
    case 'metodo_no_cobrable': return 'Esta venta no se puede cobrar con el lector.'
    case 'sin_permiso': return 'Esta cuenta no puede cobrar en este restaurante.'
    case 'location_no_disponible':
    case 'no_se_pudo_preparar_cobro':
    case 'stripe_no_responde': return 'Stripe no responde ahora mismo. Inténtalo otra vez.'
    default: return 'No se pudo preparar el cobro. Inténtalo otra vez.'
  }
}
