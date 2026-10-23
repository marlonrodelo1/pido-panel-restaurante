// IMPRESORAS, COMANDAS Y CAJÓN SIN INTERNET: la parte que DECIDE (auditoría 05,
// a8, 22 oct 2026).
//
// Sin pantalla, sin red y sin localStorage, para poder probarla con node
// (`npm run test:cola`). Lo usan `printService.js` y `destinosImpresion.js`.
//
// 🔴 POR QUÉ EXISTE. Con la fibra caída:
//   - QUÉ VA A CADA IMPRESORA se leía del servidor en cada comanda y no se
//     guardaba en el aparato: sin red, toda la comanda salía por la de caja (con
//     dos impresoras, la cocina no recibía nada).
//   - Si la impresora de cocina cambiaba de IP (DHCP), el aparato la encontraba
//     escaneando la red, pero la dirección nueva solo se usaba si se podía
//     guardar en la nube: sin internet, cada comanda volvía a fallar.
//   - El cajón leía un ajuste que no existe (`abrir_cajon`): se abría siempre en
//     efectivo aunque estuviera configurado para no abrirse, y nunca con datáfono.

// ── El cajón ─────────────────────────────────────────────────────────────────
// Lo mismo que decide el servidor (`tpv-venta`: efectivo → abrir_cajon_efectivo,
// datáfono → abrir_cajon_datafono), con los valores por defecto de la tabla
// (efectivo sí, datáfono no) si el aparato no tiene la configuración.
export function abreCajonSinRed(cfg, metodo) {
  if (metodo === 'efectivo') return cfg?.abrir_cajon_efectivo !== false
  if (metodo === 'datafono') return cfg?.abrir_cajon_datafono === true
  return false
}

// ── Qué va a cada impresora, guardado en el aparato ──────────────────────────
// En memoria son dos Map (producto → categoría, categoría → destino); en el
// aparato, pares [clave, valor].
export function destinosAGuardar({ catDe, destinoCat }, ahora = Date.now()) {
  return { catDe: [...(catDe || new Map())], destinoCat: [...(destinoCat || new Map())], guardado_at: ahora }
}

export function destinosDeGuardado(v) {
  if (!v || !Array.isArray(v.catDe) || !Array.isArray(v.destinoCat)) return null
  try {
    return { catDe: new Map(v.catDe), destinoCat: new Map(v.destinoCat) }
  } catch { return null }
}

// ── Las IP corregidas en ESTE aparato ────────────────────────────────────────
// `pendientes` = { [impresoraId]: { ip, desde, at, subida_at } }: la IP con la
// que la ha encontrado este aparato (`ip`) y la que tenía la nube cuando se
// encontró (`desde`). Vive hasta que la nube tiene la nueva, hasta que alguien
// pone otra a mano en la nube, o 12 h como mucho.
export const VIDA_IP_LOCAL_MS = 12 * 60 * 60 * 1000

export function anotarIpLocal(pendientes, imp, nuevaIp, ahora = Date.now()) {
  const p = { ...(pendientes || {}) }
  if (!imp?.id || !nuevaIp) return p
  const previa = p[imp.id]
  // Si cambia dos veces sin internet, `desde` sigue siendo la de la nube.
  p[imp.id] = { ip: nuevaIp, desde: previa?.desde ?? imp.ip ?? null, at: ahora, subida_at: previa?.subida_at ?? null }
  return p
}

export function quitarIpLocal(pendientes, id) {
  const p = { ...(pendientes || {}) }
  delete p[id]
  return p
}

// La lista con las IP de este aparato puestas encima, sin decidir nada (para el
// espejo del aparato, que no es la nube).
export function ponerIpsLocales(lista, pendientes, ahora = Date.now()) {
  if (!Array.isArray(lista)) return lista
  const p = pendientes || {}
  return lista.map((imp) => {
    const x = p[imp?.id]
    if (!x || !x.ip || (x.at && ahora - x.at > VIDA_IP_LOCAL_MS)) return imp
    return imp.ip === x.ip ? imp : { ...imp, ip: x.ip }
  })
}

// Con la lista RECIÉN LEÍDA DE LA NUBE. Devuelve { lista, pendientes, porSubir }:
//   - la nube ya tiene la nueva            → se olvida (ya está guardada);
//   - la nube sigue con la vieja (`desde`) → manda la de este aparato, y se
//     intenta subir (como mucho cada 10 min: puede que esta cuenta no tenga
//     permiso para escribir y no hay que machacar al servidor);
//   - la nube tiene OTRA                   → alguien la ha cambiado a mano: manda
//     la nube y se olvida la de aquí;
//   - la impresora ya no está, o han pasado más de 12 h → se olvida.
// Sin nada pendiente devuelve la lista TAL CUAL (con internet, lo de siempre).
export function conciliarIpsLocales(lista, pendientes, ahora = Date.now()) {
  const p = { ...(pendientes || {}) }
  const porSubir = []
  if (!Array.isArray(lista) || !Object.keys(p).length) return { lista, pendientes: p, porSubir }
  const ids = new Set(lista.map((i) => i?.id))
  for (const id of Object.keys(p)) {
    if (!ids.has(id) || (p[id]?.at && ahora - p[id].at > VIDA_IP_LOCAL_MS)) delete p[id]
  }
  const nueva = lista.map((imp) => {
    const x = p[imp?.id]
    if (!x) return imp
    if (imp.ip === x.ip) { delete p[imp.id]; return imp }
    if (imp.ip === x.desde) {
      if (!x.subida_at || ahora - x.subida_at > 10 * 60 * 1000) {
        porSubir.push({ id: imp.id, ip: x.ip })
        p[imp.id] = { ...x, subida_at: ahora }
      }
      return { ...imp, ip: x.ip }
    }
    delete p[imp.id]
    return imp
  })
  return { lista: nueva, pendientes: p, porSubir }
}

export function cambiarIpEnLista(lista, id, ip) {
  if (!Array.isArray(lista)) return lista
  return lista.map((i) => (i?.id === id ? { ...i, ip } : i))
}

// ── Una consulta que NO se puede quedar colgada ──────────────────────────────
// Con la fibra caída y el router encendido una consulta no falla: se queda
// esperando (y antes, esperando a renovar la sesión). La comanda estaba detrás.
// Si en `ms` no ha contestado, se sigue con `valorVencido` y se avisa con
// `alVencer` (para que se compruebe la red). Con internet contesta antes y esto
// no cambia nada.
export function conLimite(promesa, ms, valorVencido, alVencer) {
  let reloj = null
  const limite = new Promise((resolver) => {
    reloj = setTimeout(() => {
      try { alVencer?.() } catch { /* nada */ }
      resolver(valorVencido)
    }, ms)
  })
  return Promise.race([
    Promise.resolve(promesa).finally(() => clearTimeout(reloj)),
    limite,
  ])
}
