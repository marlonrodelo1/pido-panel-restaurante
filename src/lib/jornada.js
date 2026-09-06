// LA JORNADA: un solo sitio donde se calcula lo que se ha vendido hoy.
//
// 🔴 POR QUE EXISTE ESTE FICHERO (5 sep 2026)
//
// Marlon miro el informe del dia y le salieron 73 EUR cuando habia vendido 193.
// No estaba mal calculado: contaba solo una cuarta parte del negocio. Y al
// auditarlo aparecieron CUATRO cifras distintas de "ventas del dia" en el mismo
// panel, cada una con su criterio:
//   - Informe del dia .... 73,00  (solo `tpv_tickets`, que POR DISENO solo puede
//                                  tener mostrador: `tpv_emitir_ticket` lanza
//                                  PD195 si el origen no es 'tpv')
//   - Informe X / Cierre Z  0,00  (solo tickets con `caja_id` de la caja abierta)
//   - Contabilidad ...... 178,10  (todas las vias, pero sumando SUBTOTAL, sin
//                                  envios, y con dia natural 00:00-23:59)
//   - Finanzas .......... 193,10  (todas las vias, dia natural)
// Cuatro pantallas, cuatro numeros, ninguno utilizable para cuadrar un cajon.
//
// A partir de ahora la venta del dia se calcula AQUI y solo aqui. Si hay que
// cambiar el criterio, se cambia en un sitio y todas las pantallas se mueven
// juntas.
//
// LAS DOS CIFRAS QUE NO HAY QUE CONFUNDIR
//
//   VENTA DEL DIA  = todo lo vendido, lo cobre quien lo cobre.
//   EN EL CAJON    = solo lo cobrado en mano, en billetes.
//
// No son la misma: el datafono se va al banco y la tarjeta de la app se cobra
// por Stripe y se liquida el lunes. Si al cerrar cuentas el cajon esperando la
// venta entera, SIEMPRE va a faltar dinero.

import { supabase } from './supabase'

// La jornada de un bar no empieza a medianoche: a la 1 de la madrugada se sigue
// sirviendo. Va de las 5:00 a las 5:00, igual que la pantalla de Pedidos, para
// que el informe que se imprime al cerrar lleve el servicio de la noche entero.
export function inicioJornada(ref = new Date()) {
  const d = new Date(ref)
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  d.setHours(5, 0, 0, 0)
  return d
}

// Como se llama cada via en el papel y en la pantalla.
export const VIAS = {
  tpv: 'Mostrador',
  telefonico: 'Teléfono',
  pido: 'App Pidoo',
  tienda_publica: 'Web del local',
  mesa: 'Mesa (QR)',
}

// Donde acaba el dinero de cada forma de pago. Es lo que decide si cuenta o no
// para el arqueo del cajon.
export const DESTINO_PAGO = {
  efectivo: 'cajon',      // billetes: entran en el cajon
  datafono: 'banco',      // el TPV fisico del banco, no pasa por el cajon
  tarjeta: 'stripe',      // pagado online, se liquida en el corte del lunes
  pagado_local: 'cajon',  // ya cobrado en el local antes de entregar
}

/**
 * Lo vendido en una jornada, por todas las vias.
 *
 * `estado='entregado'` es lo que hace que una venta sea venta: un pedido que
 * esta en la plancha todavia no se ha cobrado. Y los reembolsados se caen, que
 * si no el dia cuadra de mas.
 *
 * Devuelve `null` si la consulta falla, para que quien llame lo pueda decir en
 * vez de enseñar un cero que parece un dia sin ventas.
 */
export async function resumenJornada(establecimientoId, desde = inicioJornada()) {
  const { data, error } = await supabase.from('pedidos')
    .select('total, subtotal, coste_envio, propina, metodo_pago, origen_pedido')
    .eq('establecimiento_id', establecimientoId)
    .eq('estado', 'entregado')
    .is('reembolsado_at', null)
    .gte('created_at', desde.toISOString())
    // Tope explicito y AVISADO por quien llama: sin el, PostgREST cortaria por
    // max-rows y el informe sumaria de menos sin dar ninguna señal.
    .limit(2000)
  if (error) return null

  const filas = data || []
  const sumaSi = (cond) => filas.filter(cond).reduce((s, p) => s + Number(p.total || 0), 0)

  const porVia = {}
  for (const clave of Object.keys(VIAS)) {
    const suyas = filas.filter((p) => p.origen_pedido === clave)
    if (suyas.length) {
      porVia[clave] = {
        etiqueta: VIAS[clave],
        pedidos: suyas.length,
        total: suyas.reduce((s, p) => s + Number(p.total || 0), 0),
      }
    }
  }

  const efectivo = sumaSi((p) => DESTINO_PAGO[p.metodo_pago] === 'cajon')
  const datafono = sumaSi((p) => DESTINO_PAGO[p.metodo_pago] === 'banco')
  const online = sumaSi((p) => DESTINO_PAGO[p.metodo_pago] === 'stripe')

  return {
    desde,
    pedidos: filas.length,
    total: filas.reduce((s, p) => s + Number(p.total || 0), 0),
    comida: filas.reduce((s, p) => s + Number(p.subtotal || 0), 0),
    envios: filas.reduce((s, p) => s + Number(p.coste_envio || 0), 0),
    propinas: filas.reduce((s, p) => s + Number(p.propina || 0), 0),
    efectivo,          // esto es lo que TIENE que estar en el cajon
    datafono,          // esto se va al banco
    online,            // esto llega por Stripe en el corte del lunes
    porVia,
    truncado: filas.length >= 2000,
  }
}
