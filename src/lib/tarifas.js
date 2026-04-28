// Helpers de tarifas pactadas socio ↔ restaurante.

function fmtEur(n) {
  if (n === null || n === undefined || n === '') return '—'
  const v = Number(n)
  if (Number.isNaN(v)) return '—'
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function isTarifaCompleta(t) {
  if (!t) return false
  return [t.tarifa_base, t.tarifa_radio_base_km, t.tarifa_precio_km, t.tarifa_maxima]
    .every(v => v !== null && v !== undefined && v !== '')
}

// Devuelve string compacto. Si no hay tarifa congelada, devuelve null para que el caller decida.
export function formatTarifa(t) {
  if (!isTarifaCompleta(t)) return null
  return `${fmtEur(t.tarifa_base)} (≤${t.tarifa_radio_base_km} km) · +${fmtEur(t.tarifa_precio_km)}/km · máx ${fmtEur(t.tarifa_maxima)}`
}

// Compara dos tarifas y devuelve un array de diffs por campo.
// Cada item: { campo, label, actual, propuesta, sube (bool|null), igual (bool) }
export function compararTarifas(actual, propuesta) {
  const campos = [
    { campo: 'tarifa_base', label: 'Tarifa base' },
    { campo: 'tarifa_radio_base_km', label: 'Radio base (km)' },
    { campo: 'tarifa_precio_km', label: '€/km adicional' },
    { campo: 'tarifa_maxima', label: 'Tarifa máxima' },
  ]
  return campos.map(({ campo, label }) => {
    const a = actual?.[campo]
    const p = propuesta?.[campo]
    const aN = a === null || a === undefined || a === '' ? null : Number(a)
    const pN = p === null || p === undefined || p === '' ? null : Number(p)
    let sube = null
    let igual = false
    if (aN !== null && pN !== null) {
      if (aN === pN) igual = true
      else sube = pN > aN
    }
    return { campo, label, actual: a, propuesta: p, sube, igual }
  })
}

// "X días Y horas" (o "Y horas Z minutos" si <1 día). Devuelve "expirada" si pasó.
export function formatCuentaAtras(timestamp) {
  if (!timestamp) return '—'
  const target = new Date(timestamp).getTime()
  const now = Date.now()
  const diff = target - now
  if (diff <= 0) return 'expirada'
  const min = Math.floor(diff / 60000)
  const horas = Math.floor(min / 60)
  const dias = Math.floor(horas / 24)
  if (dias >= 1) {
    const horasResto = horas - dias * 24
    return `${dias} día${dias === 1 ? '' : 's'}${horasResto > 0 ? ` ${horasResto} h` : ''}`
  }
  if (horas >= 1) {
    const minResto = min - horas * 60
    return `${horas} h${minResto > 0 ? ` ${minResto} min` : ''}`
  }
  return `${min} min`
}

export function formatFechaCorta(timestamp) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
