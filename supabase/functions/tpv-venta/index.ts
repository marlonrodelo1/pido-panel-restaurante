// tpv-venta v1 (26-ago-2026) — el RESTAURANTE cobra una venta en su MOSTRADOR.
//
// Por que una edge con service_role y no un RPC, que seria mas rapido y atomico:
// `trg_00_blindar_origen_pedido` reescribe el origen a 'pido' para cualquier
// escritor que no sea de confianza, y dentro de un RPC SECURITY DEFINER llamado
// con el JWT del dueno los claims siguen puestos, asi que NO es de confianza. La
// alternativa era ampliar ese trigger, que es codigo de seguridad escrito
// despues de un incidente real de fraude. No se toca con prisa.
//
// Lo que hace especial a una venta de mostrador:
//   - `origen_pedido='tpv'`  → precio de BARRA (`precio_local`), comision 0 %,
//     fuera del corte de los lunes, exenta del pedido minimo, del anti-duplicado
//     y de exigir que el reparto este abierto. Todo eso vive en la BD.
//   - Nace en `estado='entregado'`: el cliente ya tiene su comida y ya ha pagado.
//     Ademas eso la saca del timbre (`trg_zz_notificar_pedido_nuevo` solo dispara
//     con 'nuevo'), del auto-cancelador y del dispatcher. Tu propia venta no hace
//     sonar tu propia tablet.
//
// LOS PRECIOS NO VIENEN DE LA TABLET. Las lineas se insertan con
// `precio_unitario: 0` y es `enforce_pedido_item_precio` quien sube cada una al
// suelo que devuelve `precio_suelo_linea(producto,'tpv',tamano)`. Luego
// `trg_recalculate_subtotal` recalcula el subtotal y `enforce_pedido_total` el
// total. Aunque alguien manipulase la app, no puede cobrar un precio inventado.
//
// Body: { establecimiento_id, lineas: [{producto_id?, nombre?, cantidad, tamano?,
//         precio_unitario?, notas?}], metodo_pago: 'efectivo'|'datafono',
//         entregado_efectivo?, idempotency_key }
// verify_jwt=true. Candado adicional en codigo: dueno del establecimiento,
// admin/superadmin, o service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const METODOS_VALIDOS = ['efectivo', 'datafono']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: any = {}
  try { body = await req.json() } catch (_) {}

  // ── Auth ──
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const esServidor = !!SERVICE_KEY && bearer === SERVICE_KEY
  let usuarioAutenticado: string | null = null
  if (!esServidor) {
    if (!bearer) return json({ error: 'no_autorizado' }, 401)
    const sbUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    })
    const { data: u } = await sbUser.auth.getUser()
    if (!u?.user) return json({ error: 'no_autorizado' }, 401)
    usuarioAutenticado = u.user.id
  }

  // ── Validaciones de entrada ──
  const establecimiento_id = body?.establecimiento_id
  if (!establecimiento_id) return json({ error: 'validacion', campo: 'establecimiento_id' }, 400)

  const metodo_pago = body?.metodo_pago
  if (!METODOS_VALIDOS.includes(metodo_pago)) {
    return json({ error: 'validacion', campo: 'metodo_pago', detalle: 'efectivo o datafono' }, 400)
  }

  const idempotency_key = String(body?.idempotency_key || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(idempotency_key)) {
    return json({ error: 'validacion', campo: 'idempotency_key', detalle: 'Falta el uuid de la venta' }, 400)
  }

  const lineasRaw = Array.isArray(body?.lineas) ? body.lineas : []
  if (lineasRaw.length === 0) return json({ error: 'validacion', campo: 'lineas', detalle: 'La venta esta vacia' }, 400)
  if (lineasRaw.length > 100) return json({ error: 'validacion', campo: 'lineas', detalle: 'Demasiadas lineas' }, 400)

  let entregado_efectivo: number | null = null
  if (body?.entregado_efectivo != null) {
    const n = Number(body.entregado_efectivo)
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return json({ error: 'validacion', campo: 'entregado_efectivo' }, 400)
    }
    entregado_efectivo = n
  }

  // ── Idempotencia ANTES de crear nada ──
  // La RPC tambien la comprueba, pero si dejasemos llegar hasta alli un segundo
  // toque ya habriamos creado un pedido huerfano sin ticket. Aqui se corta antes.
  {
    const { data: yaEmitido } = await sb.from('tpv_tickets')
      .select('*, pedidos(id, codigo, subtotal, total, metodo_pago, created_at)')
      .eq('idempotency_key', idempotency_key).maybeSingle()
    if (yaEmitido) {
      // Se devuelve con la MISMA forma que una venta nueva (`pedido`, `items`,
      // `establecimiento`): quien llama no deberia tener que distinguir el caso.
      // La primera version devolvia solo el ticket y la pantalla reventaba al leer
      // `pedido.total` — justo en el escenario para el que existe la idempotencia.
      const { pedidos: pedidoRepetido, ...ticketRepetido } = yaEmitido as any
      const [{ data: itemsRep }, { data: estRep }] = await Promise.all([
        sb.from('pedido_items')
          .select('nombre_producto, tamano, extras, precio_unitario, cantidad, notas')
          .eq('pedido_id', ticketRepetido.pedido_id),
        sb.from('establecimientos')
          .select('id, nombre, razon_social, nif, direccion, direccion_fiscal, ciudad_fiscal, telefono')
          .eq('id', ticketRepetido.establecimiento_id).maybeSingle(),
      ])
      return json({
        ok: true,
        repetida: true,
        ticket: ticketRepetido,
        pedido: pedidoRepetido,
        items: itemsRep || [],
        establecimiento: estRep,
      })
    }
  }

  // ── Establecimiento + ownership ──
  const { data: est, error: estErr } = await sb.from('establecimientos')
    .select('id, nombre, user_id, razon_social, nif, direccion, direccion_fiscal, ciudad_fiscal, telefono')
    .eq('id', establecimiento_id).maybeSingle()
  if (estErr || !est) return json({ error: 'establecimiento_no_encontrado' }, 404)

  if (usuarioAutenticado && est.user_id !== usuarioAutenticado) {
    const { data: rolRow } = await sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle()
    if (rolRow?.rol !== 'admin' && rolRow?.rol !== 'superadmin') return json({ error: 'forbidden' }, 403)
  }

  // ── El modulo tiene que estar encendido ──
  const { data: cfg } = await sb.from('tpv_config')
    .select('*').eq('establecimiento_id', establecimiento_id).maybeSingle()
  if (!cfg) return json({ error: 'tpv_no_contratado' }, 403)
  if (!cfg.activo) return json({ error: 'tpv_no_activo' }, 403)
  if (cfg.pausado_por_restaurante) return json({ error: 'tpv_pausado' }, 409)

  // ── Las lineas: productos de ESTA carta (o importe libre) y sus extras ──
  //
  // El frontend manda IDS de opciones, nunca importes: el precio de cada extra se
  // lee aqui de la base de datos. Si la tablet pudiera decir cuanto vale un extra,
  // se acabaria la garantia de que los precios los pone el servidor.
  const idsProducto = [...new Set(lineasRaw.map((l: any) => l?.producto_id).filter(Boolean))]
  const idsOpcion = [...new Set(
    lineasRaw.flatMap((l: any) => (Array.isArray(l?.extras) ? l.extras : [])).filter(Boolean)
  )]

  let productos: any[] = []
  let tamanosCarta: any[] = []
  let vinculos: any[] = []
  let opciones: any[] = []

  if (idsProducto.length) {
    const [prods, tams, vincs] = await Promise.all([
      sb.from('productos').select('id, nombre, precio, precio_local, establecimiento_id').in('id', idsProducto),
      sb.from('producto_tamanos').select('producto_id, nombre, precio, precio_local').in('producto_id', idsProducto),
      sb.from('producto_extras').select('producto_id, grupo_id').in('producto_id', idsProducto),
    ])
    if (prods.error) return json({ error: 'productos_error', detalle: prods.error.message }, 500)
    productos = prods.data || []
    tamanosCarta = tams.data || []
    vinculos = vincs.data || []
    const ajeno = productos.find((p) => p.establecimiento_id !== establecimiento_id)
    if (ajeno) return json({ error: 'producto_de_otro_restaurante', producto_id: ajeno.id }, 400)
    if (productos.length !== idsProducto.length) return json({ error: 'producto_no_encontrado' }, 400)
  }

  if (idsOpcion.length) {
    const { data, error } = await sb.from('extras_opciones')
      .select('id, nombre, precio, grupo_id, grupos_extras!inner(id, nombre, tipo, max_selecciones, establecimiento_id)')
      .in('id', idsOpcion)
    if (error) return json({ error: 'extras_error', detalle: error.message }, 500)
    opciones = data || []
    if (opciones.length !== idsOpcion.length) return json({ error: 'extra_no_encontrado' }, 400)
    const ajena = opciones.find((o: any) => o.grupos_extras?.establecimiento_id !== establecimiento_id)
    if (ajena) return json({ error: 'extra_de_otro_restaurante', extra_id: ajena.id }, 400)
  }

  const fallosExtras: string[] = []

  const lineas = lineasRaw.map((l: any) => {
    const cantidad = Math.min(100, Math.max(1, Math.round(Number(l?.cantidad) || 1)))
    const prod = l?.producto_id ? productos.find((p) => p.id === l.producto_id) : null
    if (prod) {
      // Precio de BARRA del producto (o de su tamano). Se calcula aqui porque hay
      // que poder SUMARLE los extras; el trigger `enforce_pedido_item_precio` sigue
      // siendo la red de seguridad: nunca deja que una linea baje de su suelo.
      const tam = l?.tamano
        ? tamanosCarta.find((t) => t.producto_id === prod.id &&
            String(t.nombre).trim().toLowerCase() === String(l.tamano).trim().toLowerCase())
        : null
      const base = Number(tam ? (tam.precio_local ?? tam.precio) : (prod.precio_local ?? prod.precio)) || 0

      const elegidas = (Array.isArray(l?.extras) ? l.extras : [])
        .map((id: string) => opciones.find((o: any) => o.id === id))
        .filter(Boolean)

      // Cada opcion tiene que ser de un grupo VINCULADO A ESTE PRODUCTO, y hay que
      // respetar si el grupo es de eleccion unica o cuantas admite.
      const porGrupo: Record<string, any[]> = {}
      for (const o of elegidas) (porGrupo[o.grupo_id] ||= []).push(o)
      for (const [gid, ops] of Object.entries(porGrupo)) {
        if (!vinculos.some((v) => v.producto_id === prod.id && v.grupo_id === gid)) {
          fallosExtras.push(`"${ops[0].nombre}" no es un extra de ${prod.nombre}`)
          continue
        }
        const g = ops[0].grupos_extras
        // OJO con `tipo`: la columna no tiene CHECK y `Carta.jsx` guarda 'single'
        // mientras que los grupos viejos tienen 'unico'. Comparar contra 'unico' a
        // secas convertiria cualquier grupo nuevo de eleccion unica en uno multiple
        // sin tope. Se decide al reves: multiple es lo unico que admite varias.
        const esMultiple = g?.tipo === 'multiple'
        const max = Number(g?.max_selecciones)
        // Hay grupos guardados con max_selecciones = 0. Tomarlo al pie de la letra
        // dejaria el grupo mudo; 0 o menos significa "sin limite".
        const tope = esMultiple ? (Number.isFinite(max) && max > 0 ? max : Infinity) : 1
        if (ops.length > tope) {
          fallosExtras.push(`En "${g?.nombre}" solo puedes elegir ${tope}`)
        }
      }

      // Clamp a 0: `extras_opciones.precio` no tiene CHECK de no negativo. Un extra
      // con precio negativo bajaria la linea por debajo de su suelo, el trigger la
      // subiria de vuelta y el cliente acabaria pagando mas de lo que dijo la
      // pantalla. Ignorarlo aqui y en la tablet mantiene a los dos de acuerdo.
      const extras = elegidas.reduce((s: number, o: any) => s + Math.max(0, Number(o.precio) || 0), 0)

      return {
        producto_id: prod.id,
        nombre_producto: prod.nombre,
        tamano: l?.tamano ? String(l.tamano) : null,
        precio_unitario: Math.round((base + extras) * 100) / 100,
        cantidad,
        // Formato legado, el mismo que ya hay en `pedido_items` de otros canales:
        // "Queso (+0.50€)" cuando cuesta, y solo "Al punto" cuando es gratis. Un
        // tercio de las opciones valen 0 EUR: no son extras, son elecciones
        // ("al punto", "sin cebolla") y llevarles un "+0.00€" es ruido en el ticket.
        extras: elegidas.map((o: any) => {
          const p = Math.max(0, Number(o.precio) || 0)
          return p > 0 ? `${o.nombre} (+${p.toFixed(2)}€)` : String(o.nombre)
        }),
        notas: l?.notas ? String(l.notas).slice(0, 200) : null,
      }
    }
    // Linea libre: lo que un cliente pide y no esta en la carta. Sin producto_id
    // no hay suelo que aplicar, asi que aqui SI manda el importe tecleado.
    const precio = Number(l?.precio_unitario)
    if (!Number.isFinite(precio) || precio < 0 || precio > 500) return null
    return {
      producto_id: null,
      nombre_producto: String(l?.nombre || 'Varios').slice(0, 80),
      tamano: null,
      precio_unitario: precio,
      cantidad,
      notas: l?.notas ? String(l.notas).slice(0, 200) : null,
    }
  })
  if (lineas.some((l) => l === null)) {
    return json({ error: 'validacion', campo: 'lineas', detalle: 'Linea libre con importe no valido' }, 400)
  }
  if (fallosExtras.length) {
    return json({ error: 'extras_invalidos', detalle: fallosExtras.join('. ') }, 400)
  }

  // ── Codigo de pedido ──
  let codigo: string | null = null
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generar_codigo_pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({}),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d?.codigo) codigo = d.codigo
  } catch (_) { /* cae al guard de abajo */ }
  if (!codigo) return json({ error: 'generar_codigo_failed' }, 502)

  // ── El pedido ──
  const now = new Date().toISOString()
  const { data: pedido, error: insPedErr } = await sb.from('pedidos').insert({
    codigo,
    establecimiento_id,
    usuario_id: null,
    canal: 'pido',
    origen_pedido: 'tpv',
    modo_entrega: 'recogida',
    estado: 'entregado',        // se cobra y se entrega en el acto
    metodo_pago,
    subtotal: 0,                // lo recalculan los triggers al insertar las lineas
    coste_envio: 0,
    propina: 0,
    total: 0,
    guest_nombre: 'Mostrador',
    aceptado_at: now,
    entregado_at: now,
  }).select('id, codigo').single()
  if (insPedErr || !pedido) return json({ error: 'pedido_insert_failed', detalle: insPedErr?.message }, 500)

  // ── Las lineas ──
  const { error: insItemsErr } = await sb.from('pedido_items')
    .insert(lineas.map((l: any) => ({ ...l, pedido_id: pedido.id })))
  if (insItemsErr) {
    // Un pedido sin lineas es un pedido a 0 EUR que ensuciaria el historial y el
    // informe de ventas. Se deshace, que aun no se ha cobrado nada.
    await sb.from('pedidos').delete().eq('id', pedido.id)
    return json({ error: 'items_insert_failed', detalle: insItemsErr.message }, 500)
  }

  // ── Importes definitivos, ya puestos por el servidor ──
  const { data: pedidoFinal } = await sb.from('pedidos')
    .select('id, codigo, subtotal, total, metodo_pago, created_at')
    .eq('id', pedido.id).single()

  if (entregado_efectivo != null && entregado_efectivo < Number(pedidoFinal?.total || 0)) {
    // No se revierte la venta: el dinero puede estar ya en el cajon. Solo se
    // ignora el importe entregado para no imprimir un cambio negativo.
    entregado_efectivo = null
  }

  // ── El ticket fiscal (correlativo bajo lock, idempotente) ──
  const { data: ticket, error: tickErr } = await sb.rpc('tpv_emitir_ticket', {
    p_pedido_id: pedido.id,
    p_metodo_pago: metodo_pago,
    p_entregado_efectivo: entregado_efectivo,
    p_idempotency_key: idempotency_key,
  })
  if (tickErr) {
    // La VENTA ya esta grabada y es lo que importa: el dinero entro. El ticket
    // se puede reemitir despues. No se revierte nada por esto.
    return json({
      ok: true,
      sin_ticket: true,
      aviso: 'La venta se ha guardado pero no se pudo numerar el ticket.',
      detalle: tickErr.message,
      pedido: pedidoFinal,
      establecimiento: est,
    })
  }

  // ── Lo que la tablet necesita para imprimir ──
  const { data: items } = await sb.from('pedido_items')
    .select('nombre_producto, tamano, extras, precio_unitario, cantidad, notas')
    .eq('pedido_id', pedido.id)

  return json({
    ok: true,
    pedido: pedidoFinal,
    items: items || [],
    ticket,
    establecimiento: est,
    config: {
      pie_ticket: cfg.pie_ticket,
      abrir_cajon: metodo_pago === 'efectivo' ? cfg.abrir_cajon_efectivo : cfg.abrir_cajon_datafono,
    },
  })
})
