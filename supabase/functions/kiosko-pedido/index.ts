// kiosko-pedido v1 (14-oct-2026) — el cliente pide SOLO en la pantalla táctil del local.
//
// Hermana de `tpv-venta` (de ahí salen la validación de líneas, extras y permisos),
// pero el pedido NO se cobra al crearlo: entra en cocina al momento y se cobra en
// caja antes o al entregar, como decida el personal (Marlon, 14 oct 2026).
//
// CÓMO ENTRA EL PEDIDO, y por qué así:
//   - `origen_pedido='mesa'` + `para_llevar=true` + `kiosko=true`. La mesa ya tiene
//     escrita y probada la economía de "cliente dentro del local que paga en la
//     barra": precio de BARRA (`precio_suelo_linea`), comisión 0, sin pedido mínimo,
//     fuera del anti-duplicado, de Telegram y del auto-aceptador. `para_llevar`
//     hace que el almacén gaste los empaques. `kiosko` solo dice de qué puerta vino.
//   - Nace en 'preparando' con `aceptado_at`: nadie tiene que aceptarlo, y así queda
//     fuera del auto-cancelador de los 10 minutos (ver el comentario largo de
//     `ia-mesa`, que es donde se aprendió). La comanda la imprime el TPV al ver el
//     INSERT (`PedidoAlertContext`), no esta función.
//   - `metodo_pago` es lo que eligió el cliente (efectivo o datáfono): los dos
//     "hay que cobrar", así que el TPV lo pinta con COBRAR hasta que se entregue.
//
// LOS PRECIOS NO VIENEN DE LA PANTALLA. Llegan ids de producto, tamaño y extras;
// los importes se leen aquí y `enforce_pedido_item_precio` sigue siendo la red de
// seguridad en la base de datos.
//
// Body: { establecimiento_id, nombre, metodo_pago: 'efectivo'|'datafono',
//         idempotency_key, lineas: [{ producto_id, tamano_id?, cantidad, extras?: [opcion_id], notas? }] }
// verify_jwt=true. Quien llama tiene que ser el dueño, alguien de su equipo, Pidoo o
// el service role: la pantalla del kiosko vive con la sesión del restaurante.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  if (s >= 400) console.warn('[kiosko-pedido] rechazo', s, JSON.stringify(b))
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const METODOS = ['efectivo', 'datafono']
const NOTA_COCINA = 'KIOSKO · PARA LLEVAR · COBRAR EN CAJA'

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

  // ── Entrada ──
  const establecimiento_id = String(body?.establecimiento_id || '')
  if (!/^[0-9a-f-]{36}$/i.test(establecimiento_id)) return json({ error: 'validacion', campo: 'establecimiento_id' }, 400)

  // El nombre lo teclea un cliente en una pantalla pública: se limpia de todo lo
  // que no sea texto (saltos, controles) y se recorta. Va al ticket y se dice en voz alta.
  const nombre = String(body?.nombre || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
  if (nombre.length < 2) return json({ error: 'validacion', campo: 'nombre', detalle: 'Escribe tu nombre' }, 400)

  const metodo_pago = String(body?.metodo_pago || '')
  if (!METODOS.includes(metodo_pago)) return json({ error: 'validacion', campo: 'metodo_pago' }, 400)

  const idempotency_key = String(body?.idempotency_key || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(idempotency_key)) return json({ error: 'validacion', campo: 'idempotency_key' }, 400)

  const lineasRaw = Array.isArray(body?.lineas) ? body.lineas : []
  if (!lineasRaw.length) return json({ error: 'validacion', campo: 'lineas', detalle: 'El pedido está vacío' }, 400)
  if (lineasRaw.length > 40) return json({ error: 'validacion', campo: 'lineas', detalle: 'Demasiadas líneas' }, 400)
  // Ids con formato de uuid: uno roto haría fallar la consulta entera con un 500
  // en vez de un rechazo que se pueda explicar.
  const esUuid = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x || ''))
  if (lineasRaw.some((l: any) => !esUuid(l?.producto_id)
      || (l?.tamano_id != null && !esUuid(l.tamano_id))
      || (Array.isArray(l?.extras) && l.extras.some((e: unknown) => !esUuid(e))))) {
    return json({ error: 'validacion', campo: 'lineas', detalle: 'En el kiosko solo se piden productos de la carta' }, 400)
  }

  // ── Doble toque en "Confirmar": el mismo pedido, no otro ──
  const pedidoYaHecho = async () => {
    const { data } = await sb.from('pedidos')
      .select('id, codigo, subtotal, total, metodo_pago, minutos_preparacion, establecimiento_id')
      .eq('idempotency_key', idempotency_key).maybeSingle()
    return data && data.establecimiento_id === establecimiento_id ? data : null
  }
  {
    const previo = await pedidoYaHecho()
    if (previo) return json({ ok: true, repetido: true, pedido: previo })
  }

  // ── Restaurante y permiso ──
  const { data: est, error: estErr } = await sb.from('establecimientos')
    .select('id, nombre, user_id, estado, abierto_manual, horario, auto_aceptar_min_recogida')
    .eq('id', establecimiento_id).maybeSingle()
  if (estErr || !est) return json({ error: 'establecimiento_no_encontrado' }, 404)

  if (usuarioAutenticado && est.user_id !== usuarioAutenticado) {
    const [{ data: enEquipo }, { data: rolRow }] = await Promise.all([
      sb.from('establecimiento_usuarios').select('user_id')
        .eq('establecimiento_id', establecimiento_id).eq('user_id', usuarioAutenticado).maybeSingle(),
      sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle(),
    ])
    const esDePidoo = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    if (!enEquipo && !esDePidoo) return json({ error: 'forbidden' }, 403)
  }

  // ── El módulo ──
  const { data: cfg } = await sb.from('kiosko_config')
    .select('activo, pausado_por_restaurante').eq('establecimiento_id', establecimiento_id).maybeSingle()
  if (!cfg) return json({ error: 'kiosko_no_contratado' }, 409)
  if (!cfg.activo) return json({ error: 'kiosko_no_activo' }, 409)
  if (cfg.pausado_por_restaurante) return json({ error: 'kiosko_pausado' }, 409)

  // ── ¿Está abierto? ──
  // `activo` NO se mira, a propósito: lo apaga el motor de presencia cuando la app
  // pierde la conexión, y el cliente está dentro del local. Mandan el estado de la
  // cuenta, el interruptor del dueño y el horario.
  if (est.estado !== 'activo') return json({ error: 'restaurante_no_activo' }, 409)
  if (est.abierto_manual === false) return json({ error: 'cerrado' }, 409)
  {
    const { data: utilizable } = await sb.rpc('horario_utilizable', { p_horario: est.horario })
    if (utilizable) {
      const { data: enHorario, error: hErr } = await sb.rpc('establecimiento_en_horario', { p_horario: est.horario })
      if (!hErr && enHorario === false) return json({ error: 'fuera_de_horario' }, 409)
    }
  }

  // ── Productos, tamaños y extras de ESTA carta ──
  const idsProducto = [...new Set(lineasRaw.map((l: any) => String(l.producto_id)))]
  const idsOpcion = [...new Set(
    lineasRaw.flatMap((l: any) => (Array.isArray(l?.extras) ? l.extras : [])).map(String).filter(Boolean)
  )]

  const [prods, tams, vincs] = await Promise.all([
    sb.from('productos')
      .select('id, nombre, precio, precio_local, establecimiento_id, disponible, categoria_id, categorias(activa)')
      .in('id', idsProducto),
    sb.from('producto_tamanos').select('id, producto_id, nombre, precio, precio_local').in('producto_id', idsProducto),
    sb.from('producto_extras').select('producto_id, grupo_id').in('producto_id', idsProducto),
  ])
  if (prods.error) return json({ error: 'productos_error', detalle: prods.error.message }, 500)
  const productos: any[] = prods.data || []
  const tamanosCarta: any[] = tams.data || []
  const vinculos: any[] = vincs.data || []
  if (productos.length !== idsProducto.length) return json({ error: 'producto_no_encontrado' }, 409)
  const ajeno = productos.find((p) => p.establecimiento_id !== establecimiento_id)
  if (ajeno) return json({ error: 'producto_de_otro_restaurante' }, 400)

  // Lo que el cliente ve como "Agotado" no se puede colar con una pantalla vieja:
  // apagado, sin precio (regalos de promo) o de una categoría fuera de su franja.
  const noVendible = productos.find((p) =>
    p.disponible === false || !(Number(p.precio) > 0) || p.categorias?.activa === false)
  if (noVendible) return json({ error: 'producto_no_disponible', producto: noVendible.nombre }, 409)

  // Los grupos vinculados, para saber cuáles son de elección obligatoria.
  const idsGrupo = [...new Set(vinculos.map((v) => v.grupo_id))]
  let grupos: any[] = []
  if (idsGrupo.length) {
    const { data, error } = await sb.from('grupos_extras')
      .select('id, nombre, tipo, max_selecciones, establecimiento_id').in('id', idsGrupo)
    if (error) return json({ error: 'extras_error', detalle: error.message }, 500)
    grupos = data || []
  }

  let opciones: any[] = []
  if (idsOpcion.length) {
    const { data, error } = await sb.from('extras_opciones')
      .select('id, nombre, precio, grupo_id, grupos_extras!inner(id, nombre, tipo, max_selecciones, establecimiento_id)')
      .in('id', idsOpcion)
    if (error) return json({ error: 'extras_error', detalle: error.message }, 500)
    opciones = data || []
    if (opciones.length !== idsOpcion.length) return json({ error: 'extra_no_encontrado' }, 409)
    const ajena = opciones.find((o: any) => o.grupos_extras?.establecimiento_id !== establecimiento_id)
    if (ajena) return json({ error: 'extra_de_otro_restaurante' }, 400)
  }

  const fallos: string[] = []

  const lineas = lineasRaw.map((l: any) => {
    const cantidad = Math.min(20, Math.max(1, Math.round(Number(l?.cantidad) || 1)))
    const prod = productos.find((p) => p.id === String(l.producto_id))

    const tamanosDelProducto = tamanosCarta.filter((t) => t.producto_id === prod.id)
    const tam = l?.tamano_id ? tamanosDelProducto.find((t) => t.id === String(l.tamano_id)) : null
    if (tamanosDelProducto.length && !tam) fallos.push(`Elige el tamaño de ${prod.nombre}`)
    const base = Number(tam ? (tam.precio_local ?? tam.precio) : (prod.precio_local ?? prod.precio)) || 0

    const elegidas = (Array.isArray(l?.extras) ? l.extras : [])
      .map((id: string) => opciones.find((o: any) => o.id === String(id)))
      .filter(Boolean)

    const porGrupo: Record<string, any[]> = {}
    for (const o of elegidas) (porGrupo[o.grupo_id] ||= []).push(o)

    for (const [gid, ops] of Object.entries(porGrupo)) {
      if (!vinculos.some((v) => v.producto_id === prod.id && v.grupo_id === gid)) {
        fallos.push(`"${ops[0].nombre}" no es un extra de ${prod.nombre}`)
        continue
      }
      // `tipo` no tiene CHECK: conviven 'unico' y 'single'. Multiple es lo único
      // que admite varias (mismo criterio que tpv-venta y el TPV).
      const g = ops[0].grupos_extras
      const esMultiple = g?.tipo === 'multiple'
      const max = Number(g?.max_selecciones)
      const tope = esMultiple ? (Number.isFinite(max) && max > 0 ? max : Infinity) : 1
      if (ops.length > tope) fallos.push(`En "${g?.nombre}" solo se pueden elegir ${tope}`)
    }

    // Los grupos de elección única ("Elige tu bebida") son OBLIGATORIOS: un menú sin
    // bebida es una comanda que la cocina no sabe completar.
    for (const v of vinculos.filter((x) => x.producto_id === prod.id)) {
      const g = grupos.find((x) => x.id === v.grupo_id)
      if (g && g.tipo !== 'multiple' && !(porGrupo[g.id] || []).length) {
        fallos.push(`${String(g.nombre).replace(/^\d+\s*·\s*/, '')} (${prod.nombre})`)
      }
    }

    const extras = elegidas.reduce((s: number, o: any) => s + Math.max(0, Number(o.precio) || 0), 0)

    return {
      producto_id: prod.id,
      nombre_producto: prod.nombre,
      tamano: tam ? String(tam.nombre) : null,
      precio_unitario: Math.round((base + extras) * 100) / 100,
      cantidad,
      extras_ids: elegidas.map((o: any) => o.id),
      extras: elegidas.map((o: any) => {
        const p = Math.max(0, Number(o.precio) || 0)
        return p > 0 ? `${o.nombre} (+${p.toFixed(2)}€)` : String(o.nombre)
      }),
      notas: l?.notas ? String(l.notas).replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 120) : null,
    }
  })
  if (fallos.length) return json({ error: 'pedido_incompleto', detalle: fallos.join('. ') }, 409)

  // ── Código de pedido (el mismo PD-XXXXXX de siempre) ──
  let codigo: string | null = null
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generar_codigo_pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({}),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d?.codigo) codigo = d.codigo
  } catch (_) { /* cae al guard */ }
  if (!codigo) return json({ error: 'generar_codigo_failed' }, 502)

  const minutos = Number(est.auto_aceptar_min_recogida) > 0 ? Math.min(90, Number(est.auto_aceptar_min_recogida)) : 15
  const ahora = new Date().toISOString()

  const { data: pedido, error: insErr } = await sb.from('pedidos').insert({
    codigo,
    establecimiento_id,
    usuario_id: null,
    canal: 'pido',
    origen_pedido: 'mesa',
    kiosko: true,
    // Va en el INSERT: el almacén descuenta al insertar las líneas y en ese momento
    // lee el pedido. Un UPDATE posterior ya no gastaría la bolsa ni el envase.
    para_llevar: true,
    modo_entrega: 'recogida',
    estado: 'preparando',
    aceptado_at: ahora,
    metodo_pago,
    subtotal: 0,               // lo recalculan los triggers al insertar las líneas
    coste_envio: 0,
    propina: 0,
    descuento: 0,
    total: 0,
    guest_nombre: nombre,      // así sale "Cliente: Carlos" en la comanda
    notas: NOTA_COCINA,
    minutos_preparacion: minutos,
    idempotency_key,
  }).select('id, codigo').single()

  if (insErr || !pedido) {
    if (insErr?.code === '23505' && /idempotency/i.test(insErr?.message || '')) {
      const previo = await pedidoYaHecho()
      if (previo) return json({ ok: true, repetido: true, pedido: previo })
    }
    // Los rechazos de la base de datos (PD101 restaurante suspendido, etc.) se
    // devuelven con su texto: es lo que hay que enseñar.
    return json({ error: 'pedido_insert_failed', codigo: insErr?.code, detalle: insErr?.message }, 500)
  }

  const { error: itemsErr } = await sb.from('pedido_items')
    .insert(lineas.map((l: any) => ({ ...l, pedido_id: pedido.id })))
  if (itemsErr) {
    // Un pedido sin líneas en cocina es peor que ningún pedido: se deshace.
    await sb.from('pedidos').delete().eq('id', pedido.id)
    return json({ error: 'items_insert_failed', detalle: itemsErr.message }, 500)
  }

  const { data: final } = await sb.from('pedidos')
    .select('id, codigo, subtotal, total, metodo_pago, minutos_preparacion')
    .eq('id', pedido.id).single()

  // Aviso a los aparatos del restaurante por el mismo camino que la mesa. Un push que
  // falle no tumba un pedido que ya está en cocina: manda la fila de `pedidos`.
  try {
    await sb.functions.invoke('enviar_push', {
      body: {
        target_type: 'restaurante',
        target_id: establecimiento_id,
        title: 'Kiosko · ' + nombre,
        body: final.codigo + ' · ' + Number(final.total).toFixed(2).replace('.', ',') + ' € · ya en cocina',
        data: { pedido_id: final.id, tipo: 'pedido_kiosko', urgente: true },
      },
    })
  } catch (e) {
    console.warn('[kiosko-pedido] push fallido', final?.codigo, String(e))
  }

  return json({ ok: true, pedido: final })
})
