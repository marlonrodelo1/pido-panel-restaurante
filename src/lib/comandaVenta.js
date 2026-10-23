// QUIÉN ES CADA VENTA DEL MOSTRADOR PARA LA COCINA (auditoría 05, a9, 23 oct 2026).
//
// 🔴 POR QUÉ EXISTE. La comanda del mostrador salía «MOSTRADOR #1, #2…» y nada
// más: con cinco pizzas en el horno, la cocina no sabía de quién era cada una ni
// a quién llamar. Ahora cada venta lleva un NÚMERO DE CLIENTE del día (1, 2, 3…,
// que vuelve a empezar a las 5:00, igual que la jornada de `lib/jornada.js`) y,
// si se lo ponen, su NOMBRE («Juan», «mesa 3»). Los dos salen grandes en la
// comanda.
//
// El número es de ESTE APARATO (se guarda en él). Con un solo mostrador, que es
// lo que se instala, no se repite en el día; con dos aparatos cobrando a la vez
// sí podrían coincidir. NO es un número fiscal: no tiene que ir seguido ni sin
// huecos (una venta que se vacía se queda con el suyo).
//
// También se recuerda qué número y nombre llevó cada venta YA COBRADA, por su
// clave de idempotencia (la misma que guarda el pedido en `pedidos.idempotency_key`):
// así «Reimprimir comanda» (a10) los vuelve a sacar en el papel.
//
// La parte que decide es pura (sin pantalla ni red) para poder probarla con node
// (`npm run test:cocina`); el almacén se pasa como parámetro y por defecto es el
// localStorage del aparato.

const CLAVE_NUMERO = (est) => `pidoo_tpv_num_cliente_${est}`
const CLAVE_QUIEN = (est) => `pidoo_tpv_quien_venta_${est}`
const MAX_RECORDADAS = 300   // con las de un par de días sobra: es para reimprimir

export const QUIEN_VACIO = Object.freeze({ numero: null, nombre: null })

function almacenDelAparato() {
  try { return globalThis.localStorage || null } catch { return null }
}

// El día de la jornada (de 5:00 a 5:00) como texto 'AAAA-MM-DD', en hora local.
// Es el mismo corte que `inicioJornada` de `lib/jornada.js` (que no se importa
// aquí porque arrastra el cliente de Supabase y esto se prueba con node).
export function claveJornada(ahora = new Date()) {
  const d = new Date(ahora)
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// El siguiente número a partir de lo guardado: sigue la cuenta dentro de la
// misma jornada y vuelve a 1 en la siguiente (o si lo guardado está roto).
export function siguienteNumero(guardado, ahora = new Date()) {
  const dia = claveJornada(ahora)
  const previo = guardado && guardado.dia === dia ? Math.floor(Number(guardado.n) || 0) : 0
  const numero = Math.max(0, previo) + 1
  return { numero, guardado: { dia, n: numero } }
}

// Si el aparato no deja guardar (modo incógnito, memoria llena), la cuenta sigue
// en memoria mientras la app esté abierta: una comanda nunca se queda sin número.
const enMemoria = new Map()

export function asignarNumeroCliente(est, almacen = almacenDelAparato(), ahora = new Date()) {
  let guardado = enMemoria.get(est) || null
  try {
    const v = almacen ? JSON.parse(almacen.getItem(CLAVE_NUMERO(est)) || 'null') : null
    if (v && typeof v === 'object') guardado = v
  } catch { /* roto: se sigue con lo de memoria */ }
  const { numero, guardado: nuevo } = siguienteNumero(guardado, ahora)
  enMemoria.set(est, nuevo)
  try { if (almacen) almacen.setItem(CLAVE_NUMERO(est), JSON.stringify(nuevo)) } catch { /* lleno */ }
  return numero
}

// ¿Hay algo que decir de esta venta? (para no guardar fichas vacías)
export function tieneQuien(q) {
  return !!q && (q.numero != null || !!q.nombre)
}

// La lista de ventas cobradas con su número y nombre: pares [clave, {numero,
// nombre}], las más nuevas al final y como mucho MAX_RECORDADAS.
export function anadirQuien(lista, clave, quien, max = MAX_RECORDADAS) {
  const base = Array.isArray(lista) ? lista.filter((p) => Array.isArray(p) && p[0] !== clave) : []
  if (!clave || !tieneQuien(quien)) return base.slice(-max)
  return [...base, [clave, { numero: quien.numero ?? null, nombre: quien.nombre || null }]].slice(-max)
}

export function buscarQuien(lista, clave) {
  if (!clave || !Array.isArray(lista)) return null
  const par = lista.find((p) => Array.isArray(p) && p[0] === clave)
  return par ? { numero: par[1]?.numero ?? null, nombre: par[1]?.nombre || null } : null
}

export function recordarQuien(est, clave, quien, almacen = almacenDelAparato()) {
  if (!almacen || !clave || !tieneQuien(quien)) return
  try {
    const lista = JSON.parse(almacen.getItem(CLAVE_QUIEN(est)) || '[]')
    almacen.setItem(CLAVE_QUIEN(est), JSON.stringify(anadirQuien(lista, clave, quien)))
  } catch { /* lleno o roto: la reimpresión saldrá sin número, nada más */ }
}

export function quienDeVenta(est, clave, almacen = almacenDelAparato()) {
  if (!almacen || !clave) return null
  try { return buscarQuien(JSON.parse(almacen.getItem(CLAVE_QUIEN(est)) || '[]'), clave) } catch { return null }
}

// El nombre que el camarero le PUSO a una venta aparcada. Las fichas de antes de
// esto no traen `nombre_venta`: su nombre vale salvo que sea la etiqueta
// automática («Sin nombre 21:05»), que no es de nadie.
export function nombrePuesto(ficha) {
  if (!ficha) return null
  if (Object.prototype.hasOwnProperty.call(ficha, 'nombre_venta')) return ficha.nombre_venta || null
  const n = String(ficha.nombre || '').trim()
  if (!n || /^Sin nombre \d{1,2}:\d{2}$/.test(n)) return null
  return n
}
