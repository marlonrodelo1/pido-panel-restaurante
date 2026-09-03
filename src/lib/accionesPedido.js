// Las ACCIONES sobre un pedido (aceptar, rechazar, cancelar, avanzar de
// estado), extraídas para que la sección Pedidos del TPV pueda gestionarlos
// sin salir del mostrador.
//
// 🔴 Los CANDADOS son la parte importante y vienen de `PedidosEnVivo.jsx`
// (que sigue usándose en la tablet de los restaurantes sin TPV): cada update
// va condicionado al estado actual (`.eq('estado', ...)` + `.select('id')`),
// así dos aparatos no gestionan el mismo pedido dos veces, nada se arrastra
// hacia atrás, y un reembolso no se dispara dos veces. Si se toca aquí, mirar
// antes esa pantalla: la lógica tiene que decir lo mismo en las dos.
//
// Todas devuelven `{ ok, motivo? }`; el aviso al usuario lo pone el llamante.
//   motivo 'gestionado' = otro aparato (o el auto-cancelador) llegó primero.
import { supabase } from './supabase'
import { sendPush } from './webPush'
import { imprimirPedido, hayImpresoraNativa } from './printService'
import { reservarImpresion, soltarImpresion } from './ticketsImpresos'
import { crearDestinoDe } from './destinosImpresion'
import { toast } from '../App'

export const MOTIVOS_RECHAZO = [
  { id: 'sin_personal', label: 'No tenemos personal' },
  { id: 'sin_productos', label: 'No hay productos disponibles' },
  { id: 'mucha_demanda', label: 'Mucha demanda ahora mismo' },
]

// `soloDelivery` = motivos que no pueden salir en un pedido de RECOGIDA (en
// recogida no interviene repartidor; ofrecerlo acaba guardando motivos falsos).
export const MOTIVOS_CANCELACION = [
  { id: 'sin_rider', label: 'Sin repartidor disponible', soloDelivery: true },
  { id: 'sin_stock', label: 'Producto agotado' },
  { id: 'problema_cocina', label: 'Problema en cocina' },
  { id: 'cliente_no_contesta', label: 'Cliente no contesta' },
  { id: 'otro', label: 'Otro motivo' },
]

// Estados en los que un pedido sigue VIVO. Candado al cancelar: sin él,
// cancelar uno ya entregado lo revive como cancelado y —si fue con tarjeta—
// devuelve el dinero de una comida ya servida.
export const ESTADOS_VIVOS = ['nuevo', 'aceptado', 'preparando', 'listo', 'recogido', 'en_camino']

// Reembolso Stripe con aviso visible si falla (tragarse ese error deja a un
// cliente sin su dinero y a nadie enterado).
function reembolsarConAviso(pedidoId) {
  supabase.functions.invoke('crear_reembolso_stripe', { body: { pedido_id: pedidoId } })
    .then(({ error }) => { if (error) { console.error('[Reembolso]', error); toast('Pedido cancelado, pero el reembolso automático falló. Revísalo en Stripe.', 'error') } })
    .catch((err) => { console.error('[Reembolso]', err); toast('Pedido cancelado, pero el reembolso automático falló. Revísalo en Stripe.', 'error') })
}

// El dispatcher con reintentos, igual que en PedidosEnVivo: 4 intentos con
// espera exponencial y, si se agotan, marca el pedido y avisa al super-admin.
async function lanzarDispatcher(pedido, restaurante) {
  const MAX_RETRIES = 3
  const RETRY_DELAYS = [2000, 4000, 8000]
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabase.functions.invoke('create-shipday-order', { body: { pedido_id: pedido.id } })
      if (!error) return
      throw error
    } catch (err) {
      console.error(`[Dispatcher] Intento ${attempt + 1}/${MAX_RETRIES + 1} fallido para pedido ${pedido.id}:`, err)
      if (attempt === MAX_RETRIES) {
        toast(`No se pudo asignar repartidor tras 4 intentos para ${pedido.codigo}. Super-admin avisado.`, 'error')
        try {
          await supabase.from('pedidos').update({ shipday_status: 'error_crear_orden' }).eq('id', pedido.id)
        } catch (e) { console.error('[Dispatcher] Error marcando error_crear_orden:', e) }
        try {
          const { data: admins } = await supabase.from('usuarios').select('id').eq('rol', 'superadmin')
          for (const a of admins || []) {
            await supabase.functions.invoke('enviar_push', {
              body: {
                usuarioId: a.id,
                titulo: 'Pedido con error delivery',
                cuerpo: `${restaurante?.nombre} aceptó pedido ${pedido.codigo} pero el dispatcher falló 4 veces. Revisar manualmente.`,
                tipo: 'admin_alert',
              },
            })
          }
        } catch (e) { console.error('[Dispatcher] Error notificando superadmin:', e) }
        return
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }
}

export async function aceptarPedido({ pedido, minutos, restaurante, items = [] }) {
  const now = new Date().toISOString()
  // Solo transiciona si sigue en 'nuevo': dos aparatos aceptando a la vez no
  // pueden disparar el dispatcher dos veces.
  const { data: filas, error } = await supabase.from('pedidos').update({
    estado: 'preparando', minutos_preparacion: minutos, aceptado_at: now,
  }).eq('id', pedido.id).eq('estado', 'nuevo').select('id')
  if (error) { console.error('[aceptarPedido]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }

  if (pedido.usuario_id) {
    sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido aceptado', body: `Tu pedido ${pedido.codigo} está siendo preparado (~${minutos} min)` })
  }
  // La comanda, con el registro anti-duplicados: un fallo a mitad no puede
  // acabar en dos papeles iguales en cocina.
  if (hayImpresoraNativa && reservarImpresion(pedido.id)) {
    crearDestinoDe(restaurante?.id)
      .then((destinoDe) => imprimirPedido({ ...pedido, minutos_preparacion: minutos }, items, restaurante, destinoDe))
      .then((r) => {
        if (!r?.cocina) {
          soltarImpresion(pedido.id)
          toast('La comanda no ha salido por la impresora. Usa Reimprimir.')
        } else if (!r?.cliente) {
          toast('Comanda impresa; el ticket del cliente no salió. Usa Reimprimir.')
        }
      })
      .catch(() => soltarImpresion(pedido.id))
  }
  if (pedido.modo_entrega === 'delivery') {
    lanzarDispatcher(pedido, restaurante) // en segundo plano, con sus reintentos
  }
  return { ok: true }
}

export async function rechazarPedido({ pedido, motivoId }) {
  const motivoTexto = MOTIVOS_RECHAZO.find((m) => m.id === motivoId)?.label || motivoId || 'El restaurante no pudo aceptar tu pedido'
  // 🔴 Candado `.eq('estado','nuevo')`: si el auto-cancelador (u otro aparato)
  // ya canceló Y REEMBOLSÓ, esto no puede reembolsar por segunda vez.
  const { data: filas, error } = await supabase.from('pedidos')
    .update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() })
    .eq('id', pedido.id).eq('estado', 'nuevo').select('id')
  if (error) { console.error('[rechazarPedido]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }
  if (pedido.usuario_id) {
    sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido rechazado', body: `Tu pedido ${pedido.codigo} fue rechazado: ${motivoTexto}. Disculpa las molestias.` })
  }
  if (pedido.metodo_pago === 'tarjeta') reembolsarConAviso(pedido.id)
  return { ok: true }
}

export async function cancelarPedido({ pedido, motivoId }) {
  const motivoTexto = MOTIVOS_CANCELACION.find((m) => m.id === motivoId)?.label || 'Cancelado por el restaurante'
  // 🔴 Solo se cancela lo que sigue vivo: cancelar dos veces son dos
  // reembolsos, y cancelar algo entregado devuelve una comida servida.
  const { data: filas, error } = await supabase.from('pedidos')
    .update({ estado: 'cancelado', motivo_cancelacion: motivoTexto, cancelado_at: new Date().toISOString() })
    .eq('id', pedido.id).in('estado', ESTADOS_VIVOS).select('id')
  if (error) { console.error('[cancelarPedido]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }
  if (pedido.usuario_id) {
    sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido cancelado', body: `Tu pedido ${pedido.codigo} fue cancelado: ${motivoTexto}` })
  }
  if (pedido.metodo_pago === 'tarjeta') reembolsarConAviso(pedido.id)
  return { ok: true }
}

export async function marcarListo({ pedido }) {
  // 🔴 Candado: sin él, uno ya 'recogido' se arrastraba HACIA ATRÁS a 'listo'
  // desde otro aparato y al cliente le volvía a sonar "tu pedido está listo".
  const { data: filas, error } = await supabase.from('pedidos')
    .update({ estado: 'listo' })
    .eq('id', pedido.id).in('estado', ['aceptado', 'preparando']).select('id')
  if (error) { console.error('[marcarListo]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }
  if (pedido.usuario_id) {
    const esRecogida = pedido.modo_entrega === 'recogida'
    sendPush({
      targetType: 'cliente', targetId: pedido.usuario_id,
      title: esRecogida ? 'Pedido listo para recoger' : 'Pedido listo',
      body: esRecogida
        ? `Tu pedido ${pedido.codigo} está listo. Pásate cuando puedas.`
        : `Tu pedido ${pedido.codigo} está listo. El rider lo recogerá enseguida.`,
    })
  }
  return { ok: true }
}

export async function marcarRecogido({ pedido }) {
  const { data: filas, error } = await supabase.from('pedidos')
    .update({ estado: 'recogido', recogido_at: new Date().toISOString() })
    .eq('id', pedido.id).eq('estado', 'listo').select('id')
  if (error) { console.error('[marcarRecogido]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }
  if (pedido.usuario_id && pedido.modo_entrega !== 'recogida') {
    sendPush({
      targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido en camino',
      // Sin socio reparte el propio restaurante: hablar de "el rider" sería
      // mentirle al cliente justo en los locales que reparten ellos mismos.
      body: pedido.socio_id
        ? `El rider tiene tu pedido ${pedido.codigo} y va de camino.`
        : `Tu pedido ${pedido.codigo} ya va de camino.`,
    })
  }
  return { ok: true }
}

export async function marcarEntregado({ pedido }) {
  // Mismo candado: solo se entrega lo no entregado; dos aparatos no pueden
  // re-congelar la liquidación del socio con una fecha nueva.
  const { data: filas, error } = await supabase.from('pedidos')
    .update({ estado: 'entregado', entregado_at: new Date().toISOString() })
    .eq('id', pedido.id).in('estado', ['listo', 'recogido', 'en_camino']).select('id')
  if (error) { console.error('[marcarEntregado]', error); return { ok: false, motivo: 'error' } }
  if (!filas?.length) return { ok: false, motivo: 'gestionado' }
  if (pedido.usuario_id) {
    sendPush({ targetType: 'cliente', targetId: pedido.usuario_id, title: 'Pedido entregado', body: `Tu pedido ${pedido.codigo} ha sido entregado. ¡Gracias!` })
  }
  return { ok: true }
}
