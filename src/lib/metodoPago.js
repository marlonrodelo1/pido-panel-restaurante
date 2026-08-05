// Cómo se paga un pedido, en un solo sitio.
//
// REGLA DE SEGURIDAD: solo `tarjeta` y `pagado_local` están COBRADOS. Cualquier
// otro método —incluido uno que no conozcamos todavía— se trata como "hay que
// cobrar". Al revés el fallo es silencioso y cuesta dinero: antes, un pedido
// con datáfono caía en el `else` y el ticket imprimía "TARJETA", así que se
// entregaba sin cobrar.
//
// El datáfono se liquida como el efectivo: lo importante para la liquidación es
// que el dinero NO pasó por Stripe (ver calcular_liquidacion_restaurante).

export const METODOS = {
  efectivo:     { etiqueta: 'Efectivo',           ticket: 'EFECTIVO',  cobrar: true },
  datafono:     { etiqueta: 'Datáfono',           ticket: 'DATAFONO',  cobrar: true },
  tarjeta:      { etiqueta: 'Tarjeta (online)',   ticket: 'TARJETA',   cobrar: false },
  pagado_local: { etiqueta: 'Pagado en el local', ticket: 'YA PAGADO', cobrar: false },
}

// ¿Hay que cobrarle a este cliente al entregar?
export function hayQueCobrar(metodo) {
  return METODOS[metodo]?.cobrar ?? true
}

export function etiquetaPago(metodo) {
  return METODOS[metodo]?.etiqueta || metodo || '—'
}

// Sin acentos ni eñes: las impresoras térmicas ESC/POS no los pintan bien
export function textoTicket(metodo) {
  return METODOS[metodo]?.ticket || 'COBRAR AL CLIENTE'
}
