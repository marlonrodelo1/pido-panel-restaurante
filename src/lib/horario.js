/**
 * Utilidad de horarios para establecimientos
 *
 * Formato del JSONB `horario` en la tabla establecimientos:
 * {
 *   "lunes":    [{ "abre": "09:00", "cierra": "14:00" }, { "abre": "18:00", "cierra": "23:00" }],
 *   "martes":   [{ "abre": "09:00", "cierra": "14:00" }],
 *   "miercoles": [],
 *   ...
 *   "domingo":  [{ "abre": "10:00", "cierra": "22:00" }]
 * }
 *
 * Array vacío = cerrado ese día
 * Sin horario definido (null) = se usa solo el toggle `activo`
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const DIAS_LABEL = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
  jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
}
const DIAS_CORTO = {
  lunes: 'Lun', martes: 'Mar', miercoles: 'Mié',
  jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom',
}
const DIAS_ORDEN = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

export { DIAS_LABEL, DIAS_CORTO, DIAS_ORDEN }

/**
 * Obtiene el nombre del día actual en español (lunes, martes, etc.)
 */
export function getDiaActual() {
  return DIAS[new Date().getDay()]
}

/**
 * Convierte "HH:MM" a minutos desde medianoche
 */
function timeToMinutes(str) {
  if (!str) return 0
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

/**
 * Verifica si el establecimiento está abierto AHORA
 * Tiene en cuenta: el campo `activo` + el horario
 *
 * @param {Object} establecimiento - { activo, horario }
 * @returns {{ abierto: boolean, turnoActual?: object, proximaApertura?: string }}
 */
export function estaAbierto(establecimiento) {
  if (!establecimiento) return { abierto: false }

  // Si activo es false, siempre cerrado (override manual)
  if (establecimiento.activo === false) {
    return { abierto: false, razon: 'manual' }
  }

  // Si no hay horario definido, el restaurante se considera cerrado
  // (debe configurar su horario para aparecer como abierto)
  const horario = establecimiento.horario
  if (!horario || typeof horario !== 'object') {
    return { abierto: false, razon: 'sin_horario' }
  }

  const ahora = new Date()
  const dia = DIAS[ahora.getDay()]
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes()
  const turnos = horario[dia]

  // Sin turnos para hoy = cerrado hoy
  if (!turnos || !Array.isArray(turnos) || turnos.length === 0) {
    const proxima = getProximaApertura(horario, dia)
    return { abierto: false, razon: 'horario', proximaApertura: proxima }
  }

  // Buscar si estamos dentro de algún turno
  for (const turno of turnos) {
    const abre = timeToMinutes(turno.abre)
    const cierra = timeToMinutes(turno.cierra)

    // Manejar turnos que cruzan medianoche (ej: 22:00 - 02:00)
    if (cierra <= abre) {
      if (minutosAhora >= abre || minutosAhora < cierra) {
        return { abierto: true, turnoActual: turno }
      }
    } else {
      if (minutosAhora >= abre && minutosAhora < cierra) {
        return { abierto: true, turnoActual: turno }
      }
    }
  }

  // Fuera de horario hoy
  // Buscar próximo turno hoy
  const proximoHoy = turnos.find(t => timeToMinutes(t.abre) > minutosAhora)
  if (proximoHoy) {
    return { abierto: false, razon: 'horario', proximaApertura: `Abre hoy a las ${proximoHoy.abre}` }
  }

  const proxima = getProximaApertura(horario, dia)
  return { abierto: false, razon: 'horario', proximaApertura: proxima }
}

/**
 * Calcula cuándo abre próximamente
 */
function getProximaApertura(horario, diaActual) {
  const idx = DIAS_ORDEN.indexOf(diaActual)
  // Buscar el próximo día con turnos
  for (let i = 1; i <= 7; i++) {
    const nextDia = DIAS_ORDEN[(idx + i) % 7]
    const turnos = horario[nextDia]
    if (turnos && Array.isArray(turnos) && turnos.length > 0) {
      const diaNombre = i === 1 ? 'mañana' : DIAS_LABEL[nextDia]
      return `Abre ${diaNombre} a las ${turnos[0].abre}`
    }
  }
  return null
}

/**
 * Texto resumen del horario para hoy
 */
export function horarioHoyTexto(horario) {
  if (!horario || typeof horario !== 'object') return null
  const dia = DIAS[new Date().getDay()]
  const turnos = horario[dia]
  if (!turnos || turnos.length === 0) return 'Cerrado hoy'
  return turnos.map(t => `${t.abre} - ${t.cierra}`).join(' · ')
}

/**
 * Genera horario por defecto (todos los días vacíos)
 */
export function horarioVacio() {
  const h = {}
  for (const d of DIAS_ORDEN) h[d] = []
  return h
}

/**
 * Genera horario estándar (L-V 10:00-23:00, S-D 11:00-23:00)
 */
export function horarioEstandar() {
  return {
    lunes:     [{ abre: '10:00', cierra: '23:00' }],
    martes:    [{ abre: '10:00', cierra: '23:00' }],
    miercoles: [{ abre: '10:00', cierra: '23:00' }],
    jueves:    [{ abre: '10:00', cierra: '23:00' }],
    viernes:   [{ abre: '10:00', cierra: '23:00' }],
    sabado:    [{ abre: '11:00', cierra: '23:00' }],
    domingo:   [{ abre: '11:00', cierra: '23:00' }],
  }
}
