// tpv-cobro-lector v1 (15 oct 2026) — cobrar una venta del TPV con el lector de tarjetas
// (BBPOS WisePad 3) a través del móvil Android del mostrador.
//
// POR QUÉ UN MÓVIL EN MEDIO: el WisePad 3 es un lector «móvil» (Bluetooth). Stripe solo deja
// usarlo desde sus SDK de iOS/Android; el TPV del ordenador va en el navegador y no puede
// hablarle. Así que:
//   1. el TPV cobra la venta como hasta hoy (tpv-venta, 'datafono') y llama aquí a `crear`;
//   2. el móvil del mostrador (app del panel, pantalla «Lector de tarjetas») se entera por
//      realtime (pedido_cobros_movil) o preguntando `pendiente`, recoge la tarjeta en el lector
//      y llama a `confirmar`;
//   3. el TPV ve la fila pasar a 'cobrado' e imprime el ticket.
//
// EL DINERO: igual que el Tap to Pay del socio. Entra en la cuenta de Stripe de Pidoo y la RPC
// registrar_cobro_movil pasa el pedido a metodo_pago='tarjeta' con su stripe_payment_id. Los
// PaymentIntent llevan metadata.origen='cobro_movil_socio' (+ canal='lector_tpv') A PROPÓSITO:
// así el webhook de pagos (stripe-webhook-pagos) y el vigilante del cron 43
// (socio-cobro-movil 'reconciliar') también registran estos cobros si el móvil muere justo
// después de cobrar. No cambiar ese origen sin tocar esas dos piezas.
//
// EL IMPORTE LO PONE EL SERVIDOR (total del pedido), nunca el TPV ni el móvil.
//
// UN COBRO A LA VEZ POR RESTAURANTE: `crear` anula los cobros del lector que se quedaron a
// medias en otros pedidos (el móvil siempre atiende el último).
//
// ACCIONES (POST, JWT del dueño, de su equipo o de Pidoo; todas llevan establecimiento_id):
//   config     -> ¿está activado? + Location + estado del móvil (señal de vida).
//   token      -> connection token de Stripe Terminal (lo pide el SDK del móvil).
//   latido     -> el móvil dice que está vivo y si tiene el lector conectado.
//   crear      -> { pedido_id } prepara el PaymentIntent card_present (TPV).
//   pendiente  -> el cobro que el móvil tiene que pasar ahora, con su client_secret (móvil).
//   confirmar  -> { cobro_id } pregunta a Stripe y, si está cobrado, registra (móvil).
//   cancelar   -> { cobro_id } anula un cobro a medias, sin dinero movido (TPV o móvil).
//   estado     -> { cobro_id, verificar? } cómo va el cobro (TPV). Con verificar=true, si sigue
//                 'creado' se pregunta además a Stripe (por si el móvil cobró y no avisó).
//
// INTERRUPTOR: tpv_config.cobro_lector (solo Pidoo, PD360). Errores de negocio: 409.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const admin = () => createClient(URL, SVC, { auth: { persistSession: false } })
type SB = ReturnType<typeof admin>

// El mismo origen que el Tap to Pay del socio: ver la cabecera.
const ORIGEN = 'cobro_movil_socio'
const CANAL = 'lector_tpv'
const PLATAFORMA = 'lector_tpv'
const MINIMO_CENT = 50
const PI_ANULABLES = ['requires_payment_method', 'requires_confirmation', 'requires_action']
// Un cobro pedido hace más de esto ya no lo atiende el móvil (el vigilante lo anula a las 2 h).
const PENDIENTE_MAX_MS = 15 * 60_000
// Señal de vida: el móvil late cada ~20 s. Pasado esto, el TPV da el móvil por apagado.
const LATIDO_VIVO_MS = 60_000

// ── Stripe (API REST con fetch, como socio-cobro-movil) ─────────────────────────────────────
type StripeResp = { ok: boolean; status: number; data: any }
async function stripe(method: 'GET' | 'POST', path: string, params?: Record<string, string>, idem?: string): Promise<StripeResp> {
  const headers: Record<string, string> = { Authorization: `Basic ${btoa(`${STRIPE_SECRET_KEY}:`)}` }
  let body: string | undefined
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(params || {}).toString()
    if (idem) headers['Idempotency-Key'] = idem
  }
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}
const leerPI = (id: string) => stripe('GET', `/payment_intents/${encodeURIComponent(id)}?expand%5B%5D=latest_charge`)
const stripeError = (r: StripeResp) => ({
  code: r.data?.error?.code || null,
  type: r.data?.error?.type || null,
  message: r.data?.error?.message || `stripe_http_${r.status}`,
})
const errorDePago = (pi: any) => {
  const e = pi?.last_payment_error
  return e ? { code: e.code || null, decline_code: e.decline_code || null, message: e.message || null } : null
}

// La Location de Stripe Terminal: la misma de todo Pidoo (la creó socio-cobro-movil).
async function locationId(sb: SB): Promise<string | null> {
  const { data } = await sb.from('configuracion_plataforma').select('valor').eq('clave', 'cobro_movil_location_id').maybeSingle()
  const v = String(data?.valor || '').trim()
  return v || null
}

// ── Quién llama ─────────────────────────────────────────────────────────────────────────────
// El dueño, alguien de su equipo (establecimiento_usuarios) o Pidoo. Igual que tpv-venta: esta
// edge corre con service_role y la RLS no mira nada, así que se comprueba a mano.
async function autorizar(req: Request, sb: SB, establecimientoId: string) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!t) return { ok: false as const, res: json({ error: 'no_autorizado' }, 401) }
  const sbUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } })
  const { data: u } = await sbUser.auth.getUser()
  if (!u?.user) return { ok: false as const, res: json({ error: 'no_autorizado' }, 401) }
  const uid = u.user.id
  const { data: est } = await sb.from('establecimientos').select('id, nombre, user_id').eq('id', establecimientoId).maybeSingle()
  if (!est) return { ok: false as const, res: json({ error: 'establecimiento_no_encontrado' }, 404) }
  if (est.user_id !== uid) {
    const [{ data: enEquipo }, { data: rolRow }] = await Promise.all([
      sb.from('establecimiento_usuarios').select('user_id').eq('establecimiento_id', establecimientoId).eq('user_id', uid).maybeSingle(),
      sb.from('usuarios').select('rol').eq('id', uid).maybeSingle(),
    ])
    const esDePidoo = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    // 409 y no 403: la app del panel no tiene que tomarlo por sesión caducada.
    if (!enEquipo && !esDePidoo) return { ok: false as const, res: json({ error: 'sin_permiso' }, 409) }
  }
  return { ok: true as const, uid, est }
}

async function activado(sb: SB, establecimientoId: string) {
  const { data } = await sb.from('tpv_config').select('cobro_lector, activo').eq('establecimiento_id', establecimientoId).maybeSingle()
  return !!(data?.cobro_lector && data?.activo)
}

// ── Datos de la tarjeta (marca, últimos 4, cómo se leyó, recibo). Best-effort. ─────────────────
function datosTarjeta(pi: any): Record<string, string> {
  const ch = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  if (!ch) return {}
  const cp = ch.payment_method_details?.card_present || ch.payment_method_details?.interac_present || null
  const datos: Record<string, string> = {}
  if (cp?.brand) datos.tarjeta_marca = String(cp.brand).slice(0, 30)
  if (cp?.last4) datos.tarjeta_ultimos4 = String(cp.last4).slice(0, 4)
  const lectura = cp?.wallet?.type || cp?.read_method
  if (lectura) datos.tarjeta_lectura = String(lectura).slice(0, 40)
  if (ch.receipt_url) datos.recibo_url = String(ch.receipt_url).slice(0, 500)
  return datos
}
async function guardarTarjeta(sb: SB, pi: any) {
  try {
    const datos = datosTarjeta(pi)
    if (!Object.keys(datos).length) return
    await sb.from('pedido_cobros_movil').update({ ...datos, updated_at: new Date().toISOString() }).eq('payment_intent_id', pi.id)
  } catch (_) { /* el vigilante los rellena después */ }
}

type Registro = { ok: boolean; already?: boolean; error?: string; revisar?: boolean; message?: string }
async function registrar(sb: SB, pedidoId: string, pi: any): Promise<Registro> {
  const { data, error } = await sb.rpc('registrar_cobro_movil', {
    p_pedido_id: pedidoId,
    p_payment_intent_id: pi.id,
    p_importe_cent: Number(pi.amount_received ?? pi.amount ?? 0),
    p_fuente: 'app',
  })
  if (error) return { ok: false, error: 'registro_fallido', message: error.message }
  await guardarTarjeta(sb, pi)
  return data as Registro
}

// Anula en Stripe (si aún se puede) y marca la fila cancelada. Si resulta que ya estaba cobrado,
// lo registra en vez de anular: un cobro real nunca se pierde.
async function anularCobro(sb: SB, fila: { id: string; pedido_id: string; payment_intent_id: string }) {
  const r = await leerPI(fila.payment_intent_id)
  if (!r.ok) return { ok: false as const, error: 'stripe_no_responde', detalle: stripeError(r) }
  const pi = r.data
  if (pi.status === 'succeeded') {
    const reg = await registrar(sb, fila.pedido_id, pi)
    return { ok: false as const, ya_cobrado: true, registro: reg }
  }
  if (pi.status === 'processing') return { ok: false as const, error: 'cobro_en_curso' }
  if (PI_ANULABLES.includes(pi.status)) {
    const an = await stripe('POST', `/payment_intents/${pi.id}/cancel`, {}, `cobro-lector-anular-${pi.id}`)
    if (!an.ok) return { ok: false as const, error: 'no_se_pudo_anular', detalle: stripeError(an) }
  }
  await sb.from('pedido_cobros_movil').update({ estado: 'cancelado', updated_at: new Date().toISOString() }).eq('id', fila.id).eq('estado', 'creado')
  return { ok: true as const }
}

// ── Acciones ────────────────────────────────────────────────────────────────────────────────
async function accionConfig(sb: SB, establecimientoId: string) {
  const [habilitado, loc, { data: estado }] = await Promise.all([
    activado(sb, establecimientoId),
    locationId(sb),
    sb.from('tpv_lector_estado').select('*').eq('establecimiento_id', establecimientoId).maybeSingle(),
  ])
  const vivo = !!estado && Date.now() - new Date(estado.visto_at).getTime() < LATIDO_VIVO_MS
  return json({
    ok: true,
    habilitado: habilitado && !!loc,
    location_id: loc,
    movil: estado ? { ...estado, vivo, listo: vivo && !!estado.conectado } : null,
  })
}

async function accionLatido(sb: SB, establecimientoId: string, b: any) {
  const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const bat = Number(b?.bateria)
  const ahora = new Date().toISOString()
  const { error } = await sb.from('tpv_lector_estado').upsert({
    establecimiento_id: establecimientoId,
    visto_at: ahora,
    conectado: b?.conectado === true,
    lector_serial: txt(b?.lector_serial, 60),
    lector_modelo: txt(b?.lector_modelo, 60),
    bateria: Number.isFinite(bat) && bat >= 0 && bat <= 1 ? bat : null,
    dispositivo: txt(b?.dispositivo, 80),
    app_version: txt(b?.app_version, 20),
    updated_at: ahora,
  }, { onConflict: 'establecimiento_id' })
  if (error) return json({ error: 'latido_fallido', message: error.message }, 500)
  return json({ ok: true })
}

async function accionCrear(sb: SB, establecimientoId: string, uid: string, nombreEst: string, b: any) {
  const pedidoId = String(b?.pedido_id || '')
  if (!pedidoId) return json({ error: 'pedido_id_requerido' }, 400)
  const loc = await locationId(sb)
  if (!loc) return json({ error: 'location_no_disponible' }, 502)

  const { data: ped } = await sb.from('pedidos')
    .select('id, codigo, estado, metodo_pago, total, establecimiento_id, stripe_payment_id, origen_pedido')
    .eq('id', pedidoId).maybeSingle()
  if (!ped || ped.establecimiento_id !== establecimientoId) return json({ error: 'pedido_no_encontrado' }, 404)
  if (ped.metodo_pago === 'tarjeta' || ped.metodo_pago === 'pagado_local' || ped.stripe_payment_id) {
    return json({ error: 'ya_pagado', metodo_pago: ped.metodo_pago }, 409)
  }
  if (!['datafono', 'efectivo'].includes(ped.metodo_pago)) return json({ error: 'metodo_no_cobrable', metodo_pago: ped.metodo_pago }, 409)
  if (['cancelado', 'fallido', 'pendiente_pago'].includes(ped.estado)) return json({ error: 'estado_no_cobrable', estado: ped.estado }, 409)
  const importeCent = Math.round((Number(ped.total) || 0) * 100)
  if (importeCent < MINIMO_CENT) return json({ error: 'importe_minimo', importe_cent: importeCent }, 409)

  // Cobros del lector a medias en este restaurante.
  const { data: abiertos } = await sb.from('pedido_cobros_movil')
    .select('id, pedido_id, payment_intent_id, estado, created_at')
    .eq('establecimiento_id', establecimientoId).eq('plataforma', PLATAFORMA).eq('estado', 'creado')
    .order('created_at', { ascending: false })

  // ¿Uno de ESTE pedido? Se reutiliza si sigue esperando tarjeta con el mismo importe; si ya se
  // cobró (el móvil murió antes de confirmar) se registra en vez de cobrar dos veces.
  for (const c of (abiertos || []).filter((x) => x.pedido_id === pedidoId)) {
    const r = await leerPI(c.payment_intent_id)
    if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
    const pi = r.data
    if (pi.status === 'succeeded') {
      const reg = await registrar(sb, pedidoId, pi)
      return json({ ok: true, ya_cobrado: true, cobro_id: c.id, importe_cent: pi.amount_received, registro: reg })
    }
    if (pi.status === 'processing') return json({ error: 'cobro_en_curso', cobro_id: c.id }, 409)
    if (PI_ANULABLES.includes(pi.status) && pi.amount === importeCent) {
      // Se «refresca» la hora: el móvil solo atiende los recientes.
      await sb.from('pedido_cobros_movil').update({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', c.id)
      return json({ ok: true, cobro_id: c.id, payment_intent_id: pi.id, importe_cent: importeCent, codigo: ped.codigo })
    }
    const an = await anularCobro(sb, c)
    if (!an.ok && (an as any).ya_cobrado) return json({ ok: true, ya_cobrado: true, cobro_id: c.id, registro: (an as any).registro })
    if (!an.ok) return json({ error: (an as any).error || 'no_se_pudo_anular_cobro_previo', detalle: (an as any).detalle }, 502)
  }
  // Los de OTROS pedidos: el lector solo atiende uno. Se anulan (o se registran si ya cobraron).
  for (const c of (abiertos || []).filter((x) => x.pedido_id !== pedidoId)) {
    await anularCobro(sb, c).catch(() => null)
  }

  const { count: intentos } = await sb.from('pedido_cobros_movil').select('id', { count: 'exact', head: true }).eq('pedido_id', pedidoId)
  const r = await stripe('POST', '/payment_intents', {
    amount: String(importeCent),
    currency: 'eur',
    'payment_method_types[]': 'card_present',
    capture_method: 'automatic',
    description: `Pidoo ${ped.codigo} · ${nombreEst} · mostrador`.slice(0, 200),
    'metadata[origen]': ORIGEN,
    'metadata[canal]': CANAL,
    'metadata[pedido_id]': ped.id,
    'metadata[pedido_codigo]': ped.codigo,
    'metadata[establecimiento_id]': establecimientoId,
    'metadata[metodo_pago_pedido]': ped.metodo_pago,
    'metadata[solicitado_por]': uid,
  }, `cobro-lector-${ped.id}-${importeCent}-${intentos || 0}`)
  if (!r.ok || !r.data?.id) return json({ error: 'no_se_pudo_preparar_cobro', detalle: stripeError(r) }, 502)
  const pi = r.data

  const { data: fila, error: insErr } = await sb.from('pedido_cobros_movil').insert({
    pedido_id: ped.id,
    socio_id: null,
    establecimiento_id: establecimientoId,
    payment_intent_id: pi.id,
    importe: importeCent / 100,
    estado: 'creado',
    metodo_pago_anterior: ped.metodo_pago,
    plataforma: PLATAFORMA,
  }).select('id').maybeSingle()
  let cobroId = fila?.id || null
  if (insErr) {
    // 23505 = la misma Idempotency-Key devolvió el mismo PaymentIntent a una llamada doble.
    if (insErr.code !== '23505') return json({ error: 'no_se_pudo_apuntar_cobro', message: insErr.message }, 500)
    const { data: ya } = await sb.from('pedido_cobros_movil').select('id').eq('payment_intent_id', pi.id).maybeSingle()
    cobroId = ya?.id || null
  }
  return json({ ok: true, cobro_id: cobroId, payment_intent_id: pi.id, importe_cent: importeCent, codigo: ped.codigo })
}

async function filaDelCobro(sb: SB, establecimientoId: string, cobroId: string) {
  if (!cobroId) return null
  const { data } = await sb.from('pedido_cobros_movil')
    .select('id, pedido_id, payment_intent_id, estado, importe, establecimiento_id, plataforma, created_at, cobrado_at, ultimo_error, tarjeta_marca, tarjeta_ultimos4, tarjeta_lectura, revisar')
    .eq('id', cobroId).maybeSingle()
  if (!data || data.establecimiento_id !== establecimientoId || data.plataforma !== PLATAFORMA) return null
  return data
}

async function accionPendiente(sb: SB, establecimientoId: string) {
  const desde = new Date(Date.now() - PENDIENTE_MAX_MS).toISOString()
  const { data: filas } = await sb.from('pedido_cobros_movil')
    .select('id, pedido_id, payment_intent_id, importe, created_at')
    .eq('establecimiento_id', establecimientoId).eq('plataforma', PLATAFORMA).eq('estado', 'creado')
    .gte('created_at', desde)
    .order('created_at', { ascending: false }).limit(1)
  const c = filas?.[0]
  if (!c) return json({ ok: true, cobro: null })
  const r = await leerPI(c.payment_intent_id)
  if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
  const pi = r.data
  if (pi.status === 'succeeded') {
    await registrar(sb, c.pedido_id, pi)
    return json({ ok: true, cobro: null })
  }
  if (pi.status === 'canceled') {
    await sb.from('pedido_cobros_movil').update({ estado: 'cancelado', updated_at: new Date().toISOString() }).eq('id', c.id).eq('estado', 'creado')
    return json({ ok: true, cobro: null })
  }
  const { data: ped } = await sb.from('pedidos').select('codigo').eq('id', c.pedido_id).maybeSingle()
  return json({
    ok: true,
    cobro: {
      id: c.id,
      pedido_id: c.pedido_id,
      codigo: ped?.codigo || pi?.metadata?.pedido_codigo || null,
      importe_cent: pi.amount,
      payment_intent_id: pi.id,
      client_secret: pi.client_secret,
      status: pi.status,
      created_at: c.created_at,
    },
  })
}

async function accionConfirmar(sb: SB, establecimientoId: string, b: any) {
  const c = await filaDelCobro(sb, establecimientoId, String(b?.cobro_id || ''))
  if (!c) return json({ error: 'cobro_no_encontrado' }, 404)
  const r = await leerPI(c.payment_intent_id)
  if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
  const pi = r.data
  if (pi?.metadata?.pedido_id !== c.pedido_id) return json({ error: 'cobro_de_otro_pedido' }, 409)
  if (pi.status === 'succeeded') {
    const reg = await registrar(sb, c.pedido_id, pi)
    const t = datosTarjeta(pi)
    return json({
      ok: true, cobrado: true, registrado: !!(reg?.ok || reg?.already), importe_cent: pi.amount_received, registro: reg,
      tarjeta: { marca: t.tarjeta_marca || null, ultimos4: t.tarjeta_ultimos4 || null, lectura: t.tarjeta_lectura || null },
    })
  }
  if (pi.status === 'processing') return json({ ok: false, pendiente: true, status: pi.status }, 202)
  const err = errorDePago(pi)
  await sb.from('pedido_cobros_movil').update({ ultimo_error: err, updated_at: new Date().toISOString() }).eq('id', c.id)
  return json({ ok: false, cobrado: false, status: pi.status, error: err }, 409)
}

async function accionCancelar(sb: SB, establecimientoId: string, b: any) {
  const c = await filaDelCobro(sb, establecimientoId, String(b?.cobro_id || ''))
  if (!c) return json({ error: 'cobro_no_encontrado' }, 404)
  if (c.estado === 'cobrado') return json({ ok: false, ya_cobrado: true }, 409)
  if (c.estado !== 'creado') return json({ ok: true, anulado: true })
  const an = await anularCobro(sb, c)
  if (an.ok) return json({ ok: true, anulado: true })
  if ((an as any).ya_cobrado) return json({ ok: false, ya_cobrado: true, registro: (an as any).registro }, 409)
  return json({ error: (an as any).error || 'no_se_pudo_anular', detalle: (an as any).detalle }, (an as any).error === 'cobro_en_curso' ? 409 : 502)
}

async function accionEstado(sb: SB, establecimientoId: string, b: any) {
  let c = await filaDelCobro(sb, establecimientoId, String(b?.cobro_id || ''))
  if (!c) return json({ error: 'cobro_no_encontrado' }, 404)
  let stripeStatus: string | null = null
  let error: unknown = c.ultimo_error || null
  if (c.estado === 'creado' && b?.verificar === true) {
    const r = await leerPI(c.payment_intent_id)
    if (r.ok) {
      const pi = r.data
      stripeStatus = pi.status
      if (pi.status === 'succeeded') {
        await registrar(sb, c.pedido_id, pi)
        c = (await filaDelCobro(sb, establecimientoId, c.id)) || c
      } else if (pi.status === 'canceled') {
        await sb.from('pedido_cobros_movil').update({ estado: 'cancelado', updated_at: new Date().toISOString() }).eq('id', c.id).eq('estado', 'creado')
        c = { ...c, estado: 'cancelado' }
      } else if (pi.last_payment_error) {
        error = errorDePago(pi)
      }
    }
  }
  return json({
    ok: true,
    estado: c.estado,
    stripe_status: stripeStatus,
    error,
    importe: c.importe,
    tarjeta: { marca: c.tarjeta_marca || null, ultimos4: c.tarjeta_ultimos4 || null, lectura: c.tarjeta_lectura || null },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!STRIPE_SECRET_KEY) return json({ error: 'sin_clave_stripe' }, 500)
  let b: any = {}
  try { b = await req.json() } catch (_) {}
  const accion = String(b?.accion || '')
  const establecimientoId = String(b?.establecimiento_id || '')
  if (!/^[0-9a-f-]{36}$/i.test(establecimientoId)) return json({ error: 'establecimiento_id_requerido' }, 400)
  const sb = admin()

  try {
    const auth = await autorizar(req, sb, establecimientoId)
    if (!auth.ok) return auth.res

    if (accion === 'config') return await accionConfig(sb, establecimientoId)
    if (accion === 'latido') return await accionLatido(sb, establecimientoId, b)

    if (!(await activado(sb, establecimientoId))) return json({ error: 'lector_desactivado' }, 409)

    if (accion === 'token') {
      const t = await stripe('POST', '/terminal/connection_tokens', {})
      if (!t.ok || !t.data?.secret) return json({ error: 'token_fallido', detalle: stripeError(t) }, 502)
      return json({ ok: true, secret: t.data.secret })
    }
    if (accion === 'crear') return await accionCrear(sb, establecimientoId, auth.uid, auth.est.nombre || '', b)
    if (accion === 'pendiente') return await accionPendiente(sb, establecimientoId)
    if (accion === 'confirmar') return await accionConfirmar(sb, establecimientoId, b)
    if (accion === 'cancelar') return await accionCancelar(sb, establecimientoId, b)
    if (accion === 'estado') return await accionEstado(sb, establecimientoId, b)
    return json({ error: 'accion_invalida' }, 400)
  } catch (e) {
    console.error('[tpv-cobro-lector]', accion, e)
    return json({ error: 'error_interno', message: (e as Error)?.message || String(e) }, 500)
  }
})
