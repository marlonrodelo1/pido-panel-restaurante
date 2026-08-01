import { createClient } from 'jsr:@supabase/supabase-js@2';

// presencia-restaurante v1 (1 ago 2026)
// Avisa cuando el motor de presencia cierra o reabre un restaurante solo.
// La llama motor_presencia_restaurantes() (cron del minuto) via _presencia_avisar().
//
// Por que existe: si cerramos la tienda de alguien automaticamente y no se
// entera, le estamos costando ventas en silencio. El push llega aunque la
// conexion realtime este caida (que es justo el caso). Si el movil esta
// apagado no llega, pero entonces estan cerrados de verdad.
//
// La campana in-app la escribe SQL directamente (_presencia_avisar), asi que
// esta funcion solo aporta el push. Si no esta desplegada, el sistema sigue
// funcionando: el restaurante se cierra y se reabre igual, solo que sin push.
//
// Auth: header x-cron-secret == CRON_SECRET (mismo patron que notificar-nuevo-pedido).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const TEXTOS: Record<string, { titulo: string; cuerpo: string }> = {
  cerrado: {
    titulo: 'Tu tienda se ha cerrado sola',
    cuerpo:
      'No detectamos la app de pedidos conectada, asi que hemos puesto tu tienda como cerrada para que nadie pida sin que te suene. Abre la app y volvera a abrirse sola.',
  },
  reabierto: {
    titulo: 'Tu tienda vuelve a estar abierta',
    cuerpo: 'Hemos vuelto a detectar tu app conectada. Ya puedes recibir pedidos con normalidad.',
  },
  aviso: {
    titulo: 'Tu app de pedidos no esta conectada',
    cuerpo:
      'Tu tienda sigue abierta, pero no vemos la app de pedidos conectada. Si entra un pedido puede que no te suene.',
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'no_autorizado' }, 401);

    const { establecimiento_id, evento } = await req.json();
    if (!establecimiento_id) return json({ error: 'establecimiento_id_requerido' }, 400);
    const txt = TEXTOS[evento as string];
    if (!txt) return json({ error: 'evento_invalido', evento }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: est, error } = await admin
      .from('establecimientos')
      .select('id, nombre')
      .eq('id', establecimiento_id)
      .maybeSingle();
    if (error) return json({ error: 'select_failed', message: error.message }, 500);
    if (!est) return json({ error: 'establecimiento_no_encontrado' }, 404);

    // 1) Push al dispositivo del restaurante.
    let pushStatus = 0;
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          target_type: 'restaurante',
          target_id: est.id,
          title: txt.titulo,
          body: txt.cuerpo,
          data: { tipo: 'presencia_' + evento, establecimiento_id: est.id },
        }),
      });
      pushStatus = r.status;
      if (!r.ok) console.error('[presencia-restaurante] push', r.status, await r.text());
    } catch (e) {
      console.error('[presencia-restaurante] push', e);
    }

    // 2) Si le hemos cerrado la tienda, que lo sepa tambien el super-admin.
    let pushAdmin = 0;
    if (evento === 'cerrado') {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            target_type: 'superadmin',
            title: 'Restaurante cerrado automaticamente',
            body: `${est.nombre}: su app de pedidos no esta conectada y estaba en horario. Tienda cerrada para no perder pedidos.`,
            data: { tipo: 'tienda_cerrada_sin_app', establecimiento_id: est.id },
          }),
        });
        pushAdmin = r.status;
      } catch (e) {
        console.error('[presencia-restaurante] push admin', e);
      }
    }

    return json({ ok: true, establecimiento: est.nombre, evento, push_status: pushStatus, push_admin: pushAdmin });
  } catch (err) {
    console.error('[presencia-restaurante]', err);
    return json({ error: 'internal_error', message: (err as { message?: string })?.message || String(err) }, 500);
  }
});
