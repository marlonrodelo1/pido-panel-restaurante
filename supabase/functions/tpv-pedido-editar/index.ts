// tpv-pedido-editar v2 (5-sep-2026) — EDITAR un pedido telefonico ya creado.
// v2: las notas cambiadas llevan `producto_id`, para que ese papel salga por su
// impresora (cocina o barra) y no siempre por la de caja.
//
// El cliente llama otra vez: "anademe unas patatas", "quita el refresco", "me
// equivoque de portal". Hasta hoy no habia forma de hacerlo, y no por falta de
// boton: estaba prohibido en tres capas.
//   1. RLS de `pedido_items`: solo hay INSERT para el cliente dueno del pedido.
//      No existe UPDATE ni DELETE para NADIE, asi que un delete desde el panel
//      afectaba 0 filas SIN dar error.
//   2. `recalculate_pedido_subtotal` levanta PD281 si el subtotal cambiaria y
//      quien escribe no es de confianza.
//   3. `pedidos_guard_update` mata cualquier cambio de total/subtotal/envio.
//
// POR QUE UNA EDGE Y NO ABRIR LA RLS: `_ctx_is_trusted_writer()` ya da via libre
// a `service_role`. Editando desde aqui no hay que debilitar ni uno de esos tres
// candados — siguen protegiendo a la app del cliente exactamente igual que ayer.
//
// LO QUE NO SE TOCA DESDE AQUI:
//   - El mostrador (`origen_pedido='tpv'`). Esa venta ya tiene ticket FISCAL con
//     numero correlativo: el camino es anularla con rectificativa
//     (`tpv_anular_ticket`), que ya existe. PD290.
//   - Los precios. Las lineas nuevas se insertan a 0 y las sube el trigger, igual
//     que al crear. Aqui no viaja ni un importe.
//
// Body: { pedido_id, lineas: [{ id?, producto_id, tamano?, cantidad, notas? }],
//         modo?: 'reparto'|'recogida',
//         cliente?: { telefono?, nombre?, direccion?, lat?, lng? },
//         minutos_preparacion?, notas?, motivo? }
//
// Devuelve el pedido, sus lineas, el DELTA (lo que hay que mandar a la plancha)
// y los avisos: si hay que cobrar una diferencia, si el socio ya iba de camino.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function err(codigo: string, mensaje: string, s = 400, extra: Record<string, unknown> = {}) {
  return json({ error: codigo, codigo, mensaje, ...extra }, s)
}

// El mismo normalizador que `tpv-pedido`: '600 12 34 56' y '+34600123456' son
// el mismo cliente, y el telefono es la clave de la agenda.
function normalizarTelefonoES(raw: string): string | null {
  let t = String(raw || '').replace(/[\s\-().]/g, '')
  if (t.startsWith('0034')) t = '+34' + t.slice(4)
  else if (t.startsWith('34') && t.length === 11) t = '+' + t
  else if (/^[6789]\d{8}$/.test(t)) t = '+34' + t
  return /^\+34[6789]\d{8}$/.test(t) ? t : null
}

// Solo mientras la comida no ha salido por la puerta. En cuanto se marca
// recogido / en camino / entregado, el pedido ya no es del mostrador: es del
// repartidor o del cliente, y cambiarlo por detras descuadra lo que se cobra.
const ESTADOS_EDITABLES = ['preparando', 'listo']

// La firma de una linea para el DELTA de cocina: el mismo plato con el mismo
// tamano es la misma cosa aunque esten en dos filas distintas.
const firma = (l: any) => `${l.producto_id || ''}|${l.tamano || ''}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: any = {}
  try { body = await req.json() } catch (_) {}

  // ── Quien llama ────────────────────────────────────────────────────────────
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

  const pedido_id = body?.pedido_id
  if (!pedido_id) return json({ error: 'validacion', campo: 'pedido_id' }, 400)

  // ── El pedido tal y como esta ahora ───────────────────────────────────────
  const { data: ped } = await sb.from('pedidos')
    .select('id, codigo, establecimiento_id, origen_pedido, estado, modo_entrega, metodo_pago, ' +
            'subtotal, coste_envio, propina, descuento, total, socio_id, rider_account_id, shipday_status, ' +
            'guest_nombre, guest_telefono, cliente_telefono, direccion_entrega, lat_entrega, lng_entrega, ' +
            'notas, minutos_preparacion, reembolsado_at')
    .eq('id', pedido_id).maybeSingle()
  if (!ped) return json({ error: 'pedido_no_encontrado' }, 404)

  // ── Permisos: el DUENO, su EQUIPO, o Pidoo ────────────────────────────────
  // Esta edge corre con service_role, asi que la RLS no la mira: la comprobacion
  // va a mano, igual que en `tpv-pedido`.
  const { data: est } = await sb.from('establecimientos')
    .select('id, nombre, user_id, delivery_sin_socio, razon_social, nif, direccion, telefono')
    .eq('id', ped.establecimiento_id).maybeSingle()
  if (!est) return json({ error: 'establecimiento_no_encontrado' }, 404)

  if (usuarioAutenticado && est.user_id !== usuarioAutenticado) {
    const [{ data: enEquipo }, { data: rolRow }] = await Promise.all([
      sb.from('establecimiento_usuarios').select('user_id')
        .eq('establecimiento_id', ped.establecimiento_id).eq('user_id', usuarioAutenticado).maybeSingle(),
      sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle(),
    ])
    const esDePidoo = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    if (!enEquipo && !esDePidoo) return json({ error: 'forbidden' }, 403)
  }

  // ── Que se puede editar y que no ──────────────────────────────────────────
  if (ped.origen_pedido !== 'telefonico') {
    return err('PD290', ped.origen_pedido === 'tpv'
      ? 'Una venta del mostrador no se edita: ya tiene ticket con numero. Anulala desde Tickets del dia y cobra de nuevo.'
      : 'Solo se pueden editar los pedidos que has tomado tu por telefono.', 409)
  }
  if (!ESTADOS_EDITABLES.includes(ped.estado)) {
    return err('PD291', `Este pedido esta en "${ped.estado}" y ya no se puede tocar. Solo se edita mientras se prepara o esta listo.`, 409)
  }
  if (ped.reembolsado_at) {
    return err('PD292', 'Este pedido tiene un reembolso: no se puede editar.', 409)
  }
  {
    // Cinturon: hoy ningun telefonico emite ticket fiscal, pero si algun dia lo
    // hiciera, editarlo por detras romperia la serie.
    const { data: tk } = await sb.from('tpv_tickets').select('id').eq('pedido_id', ped.id).limit(1).maybeSingle()
    if (tk) return err('PD292', 'Este pedido ya tiene ticket emitido: anulalo con una rectificativa en vez de editarlo.', 409)
  }

  // ── Las lineas que se piden ───────────────────────────────────────────────
  const lineasRaw = Array.isArray(body?.lineas) ? body.lineas : []
  if (!lineasRaw.length) {
    return err('PD293', 'Un pedido no puede quedarse sin nada. Si el cliente lo anula, cancela el pedido entero.', 400)
  }
  if (lineasRaw.length > 100) return json({ error: 'validacion', campo: 'lineas' }, 400)

  const idsProducto = [...new Set(lineasRaw.map((l: any) => l?.producto_id).filter(Boolean))]
  let productos: any[] = []
  if (idsProducto.length) {
    const { data: prods, error: pErr } = await sb.from('productos')
      .select('id, nombre, establecimiento_id').in('id', idsProducto)
    if (pErr) return json({ error: 'productos_error', detalle: pErr.message }, 500)
    productos = prods || []
    if (productos.some((p) => p.establecimiento_id !== ped.establecimiento_id)) {
      return json({ error: 'producto_de_otro_restaurante' }, 400)
    }
    if (productos.length !== idsProducto.length) return json({ error: 'producto_no_encontrado' }, 400)
  }

  const { data: actualesRaw } = await sb.from('pedido_items')
    .select('id, producto_id, nombre_producto, tamano, cantidad, notas, precio_unitario, extras')
    .eq('pedido_id', ped.id)
  const actuales = actualesRaw || []
  const porId = new Map(actuales.map((l: any) => [l.id, l]))

  // Lo que pide el TPV, ya saneado. `id` presente = linea que ya existia.
  const deseadas = lineasRaw.map((l: any) => {
    const prod = l?.producto_id ? productos.find((p) => p.id === l.producto_id) : null
    if (!prod) return null
    const id = l?.id && porId.has(l.id) ? l.id : null
    return {
      id,
      producto_id: prod.id,
      nombre_producto: prod.nombre,
      tamano: l?.tamano ? String(l.tamano) : null,
      cantidad: Math.min(100, Math.max(1, Math.round(Number(l?.cantidad) || 1))),
      notas: l?.notas ? String(l.notas).slice(0, 200) : null,
    }
  })
  if (deseadas.some((l) => l === null)) return json({ error: 'validacion', campo: 'lineas' }, 400)

  // ── Reparto o recogida ────────────────────────────────────────────────────
  const eraReparto = ped.modo_entrega === 'delivery'
  const modoPedido = body?.modo === 'reparto' ? 'reparto' : body?.modo === 'recogida' ? 'recogida' : null
  const seraReparto = modoPedido ? modoPedido === 'reparto' : eraReparto
  const cambiaModo = seraReparto !== eraReparto

  const telefonoEntrante = body?.cliente?.telefono !== undefined
    ? (body.cliente.telefono ? normalizarTelefonoES(body.cliente.telefono) : null)
    : (ped.guest_telefono || ped.cliente_telefono || null)
  const nombreEntrante = body?.cliente?.nombre !== undefined
    ? (String(body.cliente.nombre || '').trim() || null)
    : (ped.guest_nombre || null)

  const direccionEntrante = body?.cliente?.direccion !== undefined
    ? String(body.cliente.direccion || '').trim()
    : String(ped.direccion_entrega || '')
  const latEntrante = body?.cliente?.lat !== undefined ? Number(body.cliente.lat) : Number(ped.lat_entrega)
  const lngEntrante = body?.cliente?.lng !== undefined ? Number(body.cliente.lng) : Number(ped.lng_entrega)

  if (seraReparto) {
    if (!telefonoEntrante) {
      return err('PD294', 'Sin telefono el repartidor no puede llamar al llegar. Ponlo antes de guardar.', 400)
    }
    if (!direccionEntrante || !Number.isFinite(latEntrante) || !Number.isFinite(lngEntrante)) {
      return err('PD294', 'Falta la direccion en el mapa para poder repartir.', 400)
    }
  }
  if (!seraReparto && !nombreEntrante && !telefonoEntrante) {
    return err('PD294', 'Pon al menos un nombre para saber de quien es la recogida.', 400)
  }

  const cambiaDireccion = seraReparto && (
    direccionEntrante !== String(ped.direccion_entrega || '') ||
    (Number.isFinite(latEntrante) && latEntrante !== Number(ped.lat_entrega)) ||
    (Number.isFinite(lngEntrante) && lngEntrante !== Number(ped.lng_entrega))
  )

  // El envio SOLO se recalcula si hace falta: pasar a reparto, o mover el pin.
  // Si el pedido sigue igual de sitio, se respeta la tarifa con la que nacio —
  // ya se le dijo un precio al cliente por telefono.
  let costeEnvio = Number(ped.coste_envio) || 0
  if (!seraReparto) {
    costeEnvio = 0
  } else if (cambiaModo || cambiaDireccion) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calcular_envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ canal: 'pido', establecimiento_id: ped.establecimiento_id, lat_cliente: latEntrante, lng_cliente: lngEntrante }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.fuera_de_radio) {
        return err('PD295', 'Esa direccion esta fuera de tu zona de reparto.', 400,
          { distancia_km: d.distancia_km, radio_km: d.radio_km })
      }
      if (!res.ok || typeof d?.envio !== 'number') return json({ error: 'calcular_envio_failed' }, 502)
      costeEnvio = d.envio
    } catch (_) {
      return json({ error: 'calcular_envio_timeout' }, 502)
    }
  }

  // ── A partir de aqui SE ESCRIBE ───────────────────────────────────────────
  const antes = {
    subtotal: Number(ped.subtotal) || 0,
    coste_envio: Number(ped.coste_envio) || 0,
    total: Number(ped.total) || 0,
    modo_entrega: ped.modo_entrega,
    direccion_entrega: ped.direccion_entrega,
    lineas: actuales.map((l: any) => ({
      id: l.id, producto_id: l.producto_id, nombre: l.nombre_producto,
      tamano: l.tamano, cantidad: l.cantidad, notas: l.notas, precio_unitario: l.precio_unitario,
    })),
  }

  // 1) Fuera las lineas que ya no estan. El almacen las devuelve solo
  //    (`tg_stock_pedido_item` en DELETE).
  const idsDeseados = new Set(deseadas.filter((l: any) => l.id).map((l: any) => l.id))
  const aBorrar = actuales.filter((l: any) => !idsDeseados.has(l.id)).map((l: any) => l.id)
  if (aBorrar.length) {
    const { error: dErr } = await sb.from('pedido_items').delete().in('id', aBorrar)
    if (dErr) return json({ error: 'lineas_borrar_failed', detalle: dErr.message }, 500)
  }

  // 2) Las que cambian de cantidad o de nota. El precio NO se toca: es el que se
  //    le dijo al cliente. (Si la carta subio por encima, el trigger lo sube
  //    solo, como hace con todo lo del telefono.)
  for (const l of deseadas as any[]) {
    if (!l.id) continue
    const vieja: any = porId.get(l.id)
    if (!vieja) continue
    if (vieja.cantidad === l.cantidad && (vieja.notas || null) === (l.notas || null)) continue
    const { error: uErr } = await sb.from('pedido_items')
      .update({ cantidad: l.cantidad, notas: l.notas }).eq('id', l.id).select('id')
    if (uErr) return json({ error: 'lineas_actualizar_failed', detalle: uErr.message }, 500)
  }

  // 3) Las nuevas, a 0: el precio lo pone el servidor, igual que al crear.
  const aInsertar = (deseadas as any[]).filter((l) => !l.id).map((l) => ({
    pedido_id: ped.id,
    producto_id: l.producto_id,
    nombre_producto: l.nombre_producto,
    tamano: l.tamano,
    precio_unitario: 0,
    cantidad: l.cantidad,
    notas: l.notas,
  }))
  if (aInsertar.length) {
    const { error: iErr } = await sb.from('pedido_items').insert(aInsertar)
    if (iErr) return json({ error: 'lineas_insertar_failed', detalle: iErr.message }, 500)
  }

  // 4) La cabecera: envio, modo, datos del cliente. El subtotal ya lo ha puesto
  //    el trigger de las lineas, y el total lo recalcula `enforce_pedido_total`.
  const cambiosPedido: Record<string, unknown> = {
    coste_envio: costeEnvio,
    modo_entrega: seraReparto ? 'delivery' : 'recogida',
    guest_nombre: nombreEntrante,
    guest_telefono: telefonoEntrante,
    cliente_telefono: telefonoEntrante,
    direccion_entrega: seraReparto ? direccionEntrante : null,
    lat_entrega: seraReparto && Number.isFinite(latEntrante) ? latEntrante : null,
    lng_entrega: seraReparto && Number.isFinite(lngEntrante) ? lngEntrante : null,
  }
  if (body?.minutos_preparacion !== undefined) {
    const m = Number(body.minutos_preparacion)
    if (Number.isFinite(m)) cambiosPedido.minutos_preparacion = Math.min(120, Math.max(5, Math.round(m)))
  }
  if (body?.notas !== undefined) cambiosPedido.notas = String(body.notas || '').trim() || null

  // Pasar a recogida: el socio se queda sin pedido. Hay que soltarlo de verdad,
  // o seguira apareciendo como suyo en su app y en el corte.
  const socioSoltado = eraReparto && !seraReparto && !!ped.socio_id
  if (eraReparto && !seraReparto) {
    cambiosPedido.socio_id = null
    cambiosPedido.rider_account_id = null
    cambiosPedido.shipday_status = null
  }

  const { error: upErr } = await sb.from('pedidos').update(cambiosPedido).eq('id', ped.id).select('id')
  if (upErr) return json({ error: 'pedido_actualizar_failed', detalle: upErr.message }, 500)

  if (eraReparto && !seraReparto) {
    await sb.from('pedido_asignaciones')
      .update({ estado: 'cancelado_manual', motivo_rechazo: 'El pedido paso a recogida', resolved_at: new Date().toISOString() })
      .eq('pedido_id', ped.id).in('estado', ['esperando_aceptacion', 'aceptado'])
  }

  // ── Pasar a reparto: hay que buscar quien lo lleve ────────────────────────
  let asignacion: any = { ok: true, sin_cambios: true }
  if (!eraReparto && seraReparto) {
    if (est.delivery_sin_socio === true) {
      // Reparto propio: la marca que ya entienden el Tracking, el cron y el panel.
      await sb.from('pedidos').update({ shipday_status: 'reparto_propio' }).eq('id', ped.id).select('id')
      asignacion = { ok: true, reparto_propio: true }
    } else {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/create-shipday-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ pedido_id: ped.id }),
        })
        const d = await res.json().catch(() => ({}))
        asignacion = res.ok && (d?.ok || d?.success) ? { ok: true, ...d } : { ok: false, reason: d?.reason || d?.error }
      } catch (_) {
        asignacion = { ok: false, reason: 'asignacion_timeout' }
      }
    }
    // Que no haya repartidor NO deshace la edicion: el pedido ya esta cambiado y
    // se reasigna desde Pedidos. Deshacerlo dejaria al cliente con lo viejo.
  }

  // ── Como queda ────────────────────────────────────────────────────────────
  const { data: pedidoFinal } = await sb.from('pedidos')
    .select('id, codigo, estado, modo_entrega, metodo_pago, subtotal, coste_envio, propina, descuento, total, ' +
            'guest_nombre, guest_telefono, cliente_telefono, direccion_entrega, lat_entrega, lng_entrega, ' +
            'notas, minutos_preparacion, socio_id, shipday_status, origen_pedido, created_at')
    .eq('id', ped.id).single()

  const { data: itemsFinal } = await sb.from('pedido_items')
    .select('id, producto_id, nombre_producto, tamano, extras, precio_unitario, cantidad, notas')
    .eq('pedido_id', ped.id)

  // ── El DELTA: lo unico que tiene que ver la plancha ───────────────────────
  // Se calcula AQUI, comparando lo que habia con lo que hay, no con lo que la
  // pantalla creia: si el servidor corrigio algo, la comanda lo refleja.
  const acumular = (filas: any[]) => {
    const m = new Map<string, any>()
    for (const l of filas) {
      const k = firma(l)
      const prev = m.get(k)
      if (prev) prev.cantidad += l.cantidad
      else m.set(k, { producto_id: l.producto_id, nombre: l.nombre_producto || l.nombre, tamano: l.tamano, cantidad: l.cantidad })
    }
    return m
  }
  const mAntes = acumular(actuales)
  const mDespues = acumular(itemsFinal || [])
  const anadidas: any[] = []
  const quitadas: any[] = []
  for (const [k, v] of mDespues) {
    const a = mAntes.get(k)
    const dif = v.cantidad - (a?.cantidad || 0)
    if (dif > 0) anadidas.push({ ...v, cantidad: dif })
  }
  for (const [k, v] of mAntes) {
    const d = mDespues.get(k)
    const dif = v.cantidad - (d?.cantidad || 0)
    if (dif > 0) quitadas.push({ ...v, cantidad: dif })
  }
  // Notas que cambian sin cambiar cantidades: cocina tiene que enterarse igual.
  const notasCambiadas: any[] = []
  for (const l of (itemsFinal || []) as any[]) {
    const vieja: any = porId.get(l.id)
    if (vieja && (vieja.notas || null) !== (l.notas || null)) {
      // `producto_id` va aqui a proposito: es lo que usa el panel para saber si
      // ese papel es de cocina o de barra.
      notasCambiadas.push({
        producto_id: l.producto_id, nombre: l.nombre_producto,
        tamano: l.tamano, cantidad: l.cantidad, notas: l.notas,
      })
    }
  }
  const delta = { anadidas, quitadas, notas_cambiadas: notasCambiadas }
  const hayCambioEnCocina = anadidas.length > 0 || quitadas.length > 0 || notasCambiadas.length > 0

  const despues = {
    subtotal: Number(pedidoFinal?.subtotal) || 0,
    coste_envio: Number(pedidoFinal?.coste_envio) || 0,
    total: Number(pedidoFinal?.total) || 0,
    modo_entrega: pedidoFinal?.modo_entrega,
    direccion_entrega: pedidoFinal?.direccion_entrega,
    lineas: (itemsFinal || []).map((l: any) => ({
      id: l.id, producto_id: l.producto_id, nombre: l.nombre_producto,
      tamano: l.tamano, cantidad: l.cantidad, notas: l.notas, precio_unitario: l.precio_unitario,
    })),
  }

  // ── Rastro. Editar mueve dinero y comida: tiene que quedar escrito ────────
  try {
    await sb.from('pedido_ediciones').insert({
      pedido_id: ped.id,
      establecimiento_id: ped.establecimiento_id,
      editado_por: usuarioAutenticado,
      motivo: body?.motivo ? String(body.motivo).slice(0, 300) : null,
      antes, despues, delta,
    })
  } catch (_) { /* el rastro nunca tumba una edicion ya aplicada */ }

  // ── Avisos ───────────────────────────────────────────────────────────────
  const diferencia = Number((despues.total - antes.total).toFixed(2))

  // El socio que ya lo tenia asignado tiene que enterarse: lleva un pedido que
  // ha cambiado de importe, de sitio, o que ya no es suyo.
  let avisoSocio = false
  const socioAfectado = ped.socio_id
  if (socioAfectado && (socioSoltado || diferencia !== 0 || cambiaDireccion)) {
    avisoSocio = true
    try {
      const { data: socio } = await sb.from('socios').select('user_id').eq('id', socioAfectado).maybeSingle()
      if (socio?.user_id) {
        const titulo = socioSoltado ? 'Pedido cancelado para ti' : 'Pedido modificado'
        const cuerpo = socioSoltado
          ? `${ped.codigo} pasa a recogida en ${est.nombre}: ya no hay que repartirlo.`
          : `${ped.codigo} de ${est.nombre} ha cambiado${cambiaDireccion ? ' de direccion' : ''}${diferencia !== 0 ? ` y de importe (ahora ${despues.total.toFixed(2)} EUR)` : ''}.`
        await sb.from('notificaciones').insert({
          usuario_id: socio.user_id, titulo, descripcion: cuerpo, tipo: 'pedido', leida: false,
          data: { pedido_id: ped.id, codigo: ped.codigo, editado: true },
          establecimiento_id: ped.establecimiento_id,
        })
        await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ usuarioId: socio.user_id, titulo, cuerpo, tipo: 'pedido' }),
        })
      }
    } catch (_) { /* avisar nunca tumba la edicion */ }
  }

  return json({
    ok: true,
    pedido: pedidoFinal,
    items: itemsFinal || [],
    establecimiento: est,
    delta,
    hay_cambio_en_cocina: hayCambioEnCocina,
    antes: { total: antes.total, subtotal: antes.subtotal, coste_envio: antes.coste_envio },
    diferencia,
    // Ya cobrado en el local: si el total sube, hay que cobrar la diferencia en
    // mano; si baja, hay que devolverla. El TPV lo dice en pantalla.
    aviso_cobro: ped.metodo_pago === 'pagado_local' && diferencia !== 0 ? { diferencia } : null,
    aviso_socio: avisoSocio,
    socio_soltado: socioSoltado,
    asignacion,
  })
})
