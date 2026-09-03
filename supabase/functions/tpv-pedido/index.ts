// tpv-pedido v4 (3-sep-2026) — crear un REPARTO o una RECOGIDA desde el TPV,
// con los productos de la carta.
//
// v4: REPARTO PROPIO (`establecimientos.delivery_sin_socio`): no se exigen
// socios en linea ni se llama al dispatcher — reparte el restaurante. El pedido
// nace con `shipday_status='reparto_propio'`, la marca que ya entienden el
// Tracking del cliente, el cron y el boton "recogido" del panel. Antes, para
// esos restaurantes, esta pantalla moria SIEMPRE con sin_riders_online.
//
// v3: idempotencia. El TPV manda `idempotency_key` (uuid) y el pedido se inserta
// con ella (unique parcial en `pedidos`): un reintento tras un corte de red
// devuelve el pedido YA CREADO en vez de crear dos — que aqui son dos repartos,
// dos socios asignados y dos tarifas fijas en el corte del lunes. La clave es
// OPCIONAL para no romper a otros llamantes.
//
// Es el relevo de `crear-pedido-telefonico`, que sigue viva y sin tocar porque la
// usan restaurantes reales: aquella pide un importe a mano, esta pica productos.
//
// POR QUE `origen_pedido='telefonico'` Y NO 'tpv':
//   'tpv' es la barra: precio de local, 0 % de comision y fuera del corte de los
//   lunes. Un reparto NO es eso — lleva envio, reparte un socio y Pidoo cobra su
//   tarifa fija por pedido. El carril 'telefonico' ya tiene ese modelo economico
//   escrito y probado (tarifa fija, exento de minimo y de restaurante cerrado, y
//   con dispatcher). Reusarlo es correcto; inventar un carril nuevo seria repetir
//   por tercera vez las mismas reglas de dinero.
//
// LOS PRECIOS LOS PONE EL SERVIDOR, igual que en el mostrador: las lineas se
// insertan a 0 y `enforce_pedido_item_precio` las sube al suelo que corresponde a
// este origen — que aqui es el precio de domicilio, no el de barra.
//
// Body: { establecimiento_id, modo: 'reparto'|'recogida', lineas: [...],
//         cliente: { telefono, nombre?, direccion?, lat?, lng? },
//         metodo_pago: 'efectivo'|'datafono'|'pagado_local',
//         minutos_preparacion?, notas?, idempotency_key?,
//         asignacion?: {modo:'auto'} | {modo:'socio', socio_id} }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Mismo normalizador que `crear-pedido-telefonico`: el telefono es la clave con la
// que se reconoce al cliente, y '600 12 34 56' y '+34600123456' son el mismo.
function normalizarTelefonoES(raw: string): string | null {
  let t = String(raw || '').replace(/[\s\-().]/g, '')
  if (t.startsWith('0034')) t = '+34' + t.slice(4)
  else if (t.startsWith('34') && t.length === 11) t = '+' + t
  else if (/^[6789]\d{8}$/.test(t)) t = '+34' + t
  return /^\+34[6789]\d{8}$/.test(t) ? t : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: any = {}
  try { body = await req.json() } catch (_) {}

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const esServidor = !!SERVICE_KEY && bearer === SERVICE_KEY
  let usuarioAutenticado: string | null = null
  if (!esServidor) {
    if (!bearer) return json({ error: 'no_autorizado' }, 401)
    const sbUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUser.auth.getUser()
    if (!u?.user) return json({ error: 'no_autorizado' }, 401)
    usuarioAutenticado = u.user.id
  }

  const establecimiento_id = body?.establecimiento_id
  const modo = body?.modo
  if (!establecimiento_id) return json({ error: 'validacion', campo: 'establecimiento_id' }, 400)
  if (modo !== 'reparto' && modo !== 'recogida') return json({ error: 'validacion', campo: 'modo' }, 400)

  const metodo_pago = body?.metodo_pago
  if (!['efectivo', 'datafono', 'pagado_local'].includes(metodo_pago)) {
    return json({ error: 'validacion', campo: 'metodo_pago' }, 400)
  }

  // v3: clave de idempotencia OPCIONAL (el TPV la manda siempre; otros llamantes
  // pueden no mandarla y siguen funcionando como hasta hoy).
  const idempotency_key = body?.idempotency_key ? String(body.idempotency_key).trim() : null
  if (idempotency_key && !/^[0-9a-f-]{36}$/i.test(idempotency_key)) {
    return json({ error: 'validacion', campo: 'idempotency_key' }, 400)
  }

  const lineasRaw = Array.isArray(body?.lineas) ? body.lineas : []
  if (!lineasRaw.length) return json({ error: 'validacion', campo: 'lineas', detalle: 'El pedido esta vacio' }, 400)
  if (lineasRaw.length > 100) return json({ error: 'validacion', campo: 'lineas' }, 400)

  // En reparto el telefono es obligatorio: sin el, el repartidor no puede llamar
  // al llegar. En recogida basta el nombre — el cliente viene a por ello.
  const telefono = body?.cliente?.telefono ? normalizarTelefonoES(body.cliente.telefono) : null
  const nombre = String(body?.cliente?.nombre || '').trim() || null
  if (modo === 'reparto' && !telefono) {
    return json({ error: 'validacion', campo: 'telefono', detalle: 'Telefono espanol no valido' }, 400)
  }
  if (modo === 'recogida' && !nombre && !telefono) {
    return json({ error: 'validacion', campo: 'nombre', detalle: 'Pon al menos un nombre' }, 400)
  }

  const direccion = String(body?.cliente?.direccion || '').trim()
  const lat = Number(body?.cliente?.lat), lng = Number(body?.cliente?.lng)
  if (modo === 'reparto' && (!direccion || !Number.isFinite(lat) || !Number.isFinite(lng))) {
    return json({ error: 'validacion', campo: 'direccion', detalle: 'Falta la direccion en el mapa' }, 400)
  }

  let minutos = Number(body?.minutos_preparacion)
  if (!Number.isFinite(minutos)) minutos = 20
  minutos = Math.min(120, Math.max(5, Math.round(minutos)))
  const notas = String(body?.notas || '').trim() || null

  const asignacion = body?.asignacion?.modo === 'socio'
    ? { modo: 'socio' as const, socio_id: body.asignacion.socio_id }
    : { modo: 'auto' as const }

  // ── Establecimiento + ownership ──
  const { data: est } = await sb.from('establecimientos')
    .select('id, nombre, user_id, razon_social, nif, direccion, direccion_fiscal, ciudad_fiscal, telefono, delivery_sin_socio')
    .eq('id', establecimiento_id).maybeSingle()
  if (!est) return json({ error: 'establecimiento_no_encontrado' }, 404)
  // v4: el REPARTO PROPIO (Max's Pizza, Drink2Home) reparte el propio
  // restaurante: no se le exigen socios en linea ni se llama al dispatcher.
  // Antes el boton "Nuevo reparto" les moria SIEMPRE con sin_riders_online.
  const repartoPropio = est.delivery_sin_socio === true
  // Quien puede crear un pedido aqui: el DUENO, alguien de su EQUIPO, o Pidoo.
  //
  // El equipo (`establecimiento_usuarios`) se anadio el 31 ago 2026. Esta edge corre
  // con service_role, asi que la RLS NO la mira: la comprobacion hay que hacerla a
  // mano, y por eso existe este bloque. Sin la parte del equipo, un companero entra
  // al panel, marca el pedido... y al mandarlo le sale "esta cuenta no puede cobrar
  // en este restaurante" con el cliente al telefono.
  if (usuarioAutenticado && est.user_id !== usuarioAutenticado) {
    const [{ data: enEquipo }, { data: rolRow }] = await Promise.all([
      sb.from('establecimiento_usuarios').select('user_id')
        .eq('establecimiento_id', establecimiento_id).eq('user_id', usuarioAutenticado).maybeSingle(),
      sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle(),
    ])
    const esDePidoo = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    if (!enEquipo && !esDePidoo) return json({ error: 'forbidden' }, 403)
  }

  // ── El pedido ya creado con esta clave, con la MISMA forma que uno nuevo ──
  const pedidoYaCreado = async () => {
    if (!idempotency_key) return null
    const { data: p } = await sb.from('pedidos')
      .select('id, codigo, subtotal, coste_envio, total, metodo_pago, created_at, minutos_preparacion, socio_id, guest_nombre, guest_telefono, direccion_entrega')
      .eq('idempotency_key', idempotency_key).maybeSingle()
    if (!p) return null
    const { data: itemsRep } = await sb.from('pedido_items')
      .select('nombre_producto, tamano, extras, precio_unitario, cantidad, notas')
      .eq('pedido_id', p.id)
    const { socio_id, guest_nombre, guest_telefono, direccion_entrega, ...pedidoRep } = p as any
    return json({
      ok: true,
      repetido: true,
      pedido: pedidoRep,
      items: itemsRep || [],
      establecimiento: est,
      cliente: { nombre: guest_nombre, telefono: guest_telefono, direccion: direccion_entrega },
      // Si ya tiene socio, la asignacion del primer intento llego a buen puerto.
      asignacion: { ok: !!socio_id, repetido: true },
      online_count: null,
    })
  }
  {
    // ANTES de tocar nada mas: un reintento no debe volver a pasar por el
    // calculo de envio ni por el dispatcher, y menos morir en `sin_riders_online`
    // por un pedido que YA existe.
    const repetido = await pedidoYaCreado()
    if (repetido) return repetido
  }

  // ── Productos de ESTA carta ──
  const idsProducto = [...new Set(lineasRaw.map((l: any) => l?.producto_id).filter(Boolean))]
  let productos: any[] = []
  if (idsProducto.length) {
    const { data: prods, error } = await sb.from('productos')
      .select('id, nombre, establecimiento_id').in('id', idsProducto)
    if (error) return json({ error: 'productos_error', detalle: error.message }, 500)
    productos = prods || []
    if (productos.some((p) => p.establecimiento_id !== establecimiento_id)) {
      return json({ error: 'producto_de_otro_restaurante' }, 400)
    }
    if (productos.length !== idsProducto.length) return json({ error: 'producto_no_encontrado' }, 400)
  }

  const lineas = lineasRaw.map((l: any) => {
    const cantidad = Math.min(100, Math.max(1, Math.round(Number(l?.cantidad) || 1)))
    const prod = l?.producto_id ? productos.find((p) => p.id === l.producto_id) : null
    if (!prod) return null
    return {
      producto_id: prod.id,
      nombre_producto: prod.nombre,
      tamano: l?.tamano ? String(l.tamano) : null,
      precio_unitario: 0,          // lo pone el servidor (ver cabecera)
      cantidad,
      notas: l?.notas ? String(l.notas).slice(0, 200) : null,
    }
  })
  if (lineas.some((l) => l === null)) return json({ error: 'validacion', campo: 'lineas' }, 400)

  // ── Reparto: repartidores en linea y coste del envio ──
  let envio = 0
  let online = 0
  if (modo === 'reparto' && repartoPropio) {
    // Solo el envio: quien reparte es el restaurante. La tarifa la sigue
    // poniendo la edge de envios, que es la fuente unica.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calcular_envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ canal: 'pido', establecimiento_id, lat_cliente: lat, lng_cliente: lng }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.fuera_de_radio) return json({ error: 'fuera_de_radio', distancia_km: d.distancia_km, radio_km: d.radio_km }, 400)
      if (!res.ok || typeof d?.envio !== 'number') return json({ error: 'calcular_envio_failed' }, 502)
      envio = d.envio
    } catch (_) {
      return json({ error: 'calcular_envio_timeout' }, 502)
    }
  } else if (modo === 'reparto') {
    // Mismo criterio que el dispatcher: activo + en servicio + GPS fresco (12 min)
    // + vinculo con reparto activo + que acepte esta fuente.
    const MAX_LOC_AGE_MS = 12 * 60 * 1000
    const ahora = Date.now()
    const { data: vinc } = await sb.from('socio_establecimiento')
      .select('socio_id, reparto_activo, socios!inner(id, en_servicio, activo, last_location_at, acepta_telefonicos)')
      .eq('establecimiento_id', establecimiento_id).eq('estado', 'activa')
    const disponibles = (vinc || [])
      .filter((v: any) => v.reparto_activo !== false)
      .map((v: any) => v.socios)
      .filter((s: any) => {
        if (!s || !s.activo || !s.en_servicio || s.acepta_telefonicos === false) return false
        const ts = s.last_location_at ? new Date(s.last_location_at).getTime() : NaN
        return Number.isFinite(ts) && (ahora - ts) <= MAX_LOC_AGE_MS
      })
    online = disponibles.length
    if (!online) return json({ error: 'sin_riders_online', online_count: 0 }, 409)
    if (asignacion.modo === 'socio' && !disponibles.some((s: any) => s.id === asignacion.socio_id)) {
      return json({ error: 'socio_offline', online_count: online }, 409)
    }

    // La tarifa SIEMPRE la calcula la edge de envios: es la fuente unica y ya
    // aplica lo que el restaurante tenga configurado.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calcular_envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ canal: 'pido', establecimiento_id, lat_cliente: lat, lng_cliente: lng }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.fuera_de_radio) return json({ error: 'fuera_de_radio', distancia_km: d.distancia_km, radio_km: d.radio_km }, 400)
      if (!res.ok || typeof d?.envio !== 'number') return json({ error: 'calcular_envio_failed' }, 502)
      envio = d.envio
    } catch (_) {
      return json({ error: 'calcular_envio_timeout' }, 502)
    }
  }

  // ── Memoria del cliente: la proxima vez basta el telefono ──
  if (telefono) {
    try {
      const ts = new Date().toISOString()
      const datos: any = { telefono_raw: String(body?.cliente?.telefono || ''), nombre, last_pedido_at: ts, updated_at: ts }
      if (modo === 'reparto') { datos.direccion = direccion; datos.lat = lat; datos.lng = lng }
      const { data: prev } = await sb.from('clientes_telefonicos')
        .select('id, pedidos_count').eq('establecimiento_id', establecimiento_id)
        .eq('telefono_normalizado', telefono).maybeSingle()
      if (prev) {
        await sb.from('clientes_telefonicos')
          .update({ ...datos, pedidos_count: (prev.pedidos_count || 0) + 1 }).eq('id', prev.id)
      } else {
        await sb.from('clientes_telefonicos')
          .insert({ establecimiento_id, telefono_normalizado: telefono, ...datos, pedidos_count: 1 })
      }
    } catch (_) { /* la agenda nunca bloquea un pedido */ }
  }

  // ── Codigo ──
  let codigo: string | null = null
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generar_codigo_pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({}),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d?.codigo) codigo = d.codigo
  } catch (_) {}
  if (!codigo) return json({ error: 'generar_codigo_failed' }, 502)

  // ── El pedido ──
  const now = new Date().toISOString()
  const { data: pedido, error: insErr } = await sb.from('pedidos').insert({
    codigo,
    establecimiento_id,
    usuario_id: null,
    canal: 'pido',
    origen_pedido: 'telefonico',
    modo_entrega: modo === 'reparto' ? 'delivery' : 'recogida',
    // Nace aceptado: lo esta creando el propio restaurante, no hay nada que
    // aceptar. Ademas eso lo saca del timbre y del auto-cancelador.
    estado: 'preparando',
    metodo_pago,
    subtotal: 0,                 // lo recalculan los triggers con las lineas
    coste_envio: envio,
    propina: 0,
    total: 0,
    guest_nombre: nombre,
    guest_telefono: telefono,
    cliente_telefono: telefono,
    direccion_entrega: modo === 'reparto' ? direccion : null,
    lat_entrega: modo === 'reparto' ? lat : null,
    lng_entrega: modo === 'reparto' ? lng : null,
    notas,
    minutos_preparacion: minutos,
    aceptado_at: now,
    comision_pidoo_pct_override: 0,   // Pidoo cobra tarifa fija por pedido, no %
    // v3: con clave, el doble envio choca en el unique en vez de duplicarse.
    ...(idempotency_key ? { idempotency_key } : {}),
    // v4: con reparto propio, la marca que ya usa todo el sistema (Tracking, el
    // cron y el boton "recogido" del panel) va puesta desde el nacimiento — sin
    // pasar por el dispatcher ni por el reetiquetado de no_rider.
    ...(modo === 'reparto' && repartoPropio ? { shipday_status: 'reparto_propio' } : {}),
  }).select('id, codigo').single()
  if (insErr || !pedido) {
    if (insErr?.code === '23505' && /idempotency/i.test(insErr?.message || '')) {
      // Otro envio con la misma clave gano la carrera: se devuelve SU pedido.
      const repetido = await pedidoYaCreado()
      if (repetido) return repetido
    }
    return json({ error: 'pedido_insert_failed', detalle: insErr?.message }, 500)
  }

  const { error: itemsErr } = await sb.from('pedido_items')
    .insert(lineas.map((l: any) => ({ ...l, pedido_id: pedido.id })))
  if (itemsErr) {
    await sb.from('pedidos').delete().eq('id', pedido.id)
    return json({ error: 'items_insert_failed', detalle: itemsErr.message }, 500)
  }

  const { data: pedidoFinal } = await sb.from('pedidos')
    .select('id, codigo, subtotal, coste_envio, total, metodo_pago, created_at, minutos_preparacion')
    .eq('id', pedido.id).single()

  // ── Reparto: buscar quien lo lleva ──
  let resultadoAsignacion: any = { ok: false, reason: 'no_aplica' }
  if (modo === 'reparto' && repartoPropio) {
    resultadoAsignacion = { ok: true, reparto_propio: true }
  } else if (modo === 'reparto') {
    try {
      if (asignacion.modo === 'socio') {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/assign-pedido-restaurante`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ pedido_id: pedido.id, socio_id: asignacion.socio_id, motivo: 'Reparto creado en el TPV' }),
        })
        const d = await res.json().catch(() => ({}))
        resultadoAsignacion = res.ok && d?.ok ? { ok: true, ...d } : { ok: false, reason: d?.reason || d?.error }
      } else {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/create-shipday-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ pedido_id: pedido.id }),
        })
        const d = await res.json().catch(() => ({}))
        resultadoAsignacion = res.ok && (d?.ok || d?.success) ? { ok: true, ...d } : { ok: false, reason: d?.reason || d?.error }
      }
    } catch (_) {
      resultadoAsignacion = { ok: false, reason: 'asignacion_timeout' }
    }
  }
  // Que falle la asignacion NO revierte el pedido: se puede reasignar desde el panel.

  const { data: items } = await sb.from('pedido_items')
    .select('nombre_producto, tamano, extras, precio_unitario, cantidad, notas')
    .eq('pedido_id', pedido.id)

  return json({
    ok: true,
    pedido: pedidoFinal,
    items: items || [],
    establecimiento: est,
    cliente: { nombre, telefono, direccion: modo === 'reparto' ? direccion : null },
    asignacion: resultadoAsignacion,
    online_count: online,
  })
})
