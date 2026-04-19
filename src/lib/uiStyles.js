// Estilos compartidos panel-restaurante
// Design system: Inter + rojo #B91C1C discreto, 4 colores de estado, 6 tamaños tipográficos
// Inspirado en pido-super-admin/src/lib/darkStyles.js

export const colors = {
  // Superficies
  bg: '#0D0D0D',
  surface: '#1A1A1A',
  surface2: '#242424',
  elev: '#161616',
  elev2: '#1C1C1C',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',

  // Tipografía
  text: '#F5F5F5',
  textDim: 'rgba(245,245,245,0.62)',
  textMute: 'rgba(245,245,245,0.40)',
  textFaint: 'rgba(245,245,245,0.22)',

  // Primario (usado con moderación)
  primary: '#B91C1C',
  primarySoft: 'rgba(185,28,28,0.12)',
  primaryBorder: 'rgba(185,28,28,0.32)',

  // Paleta 4 estados
  stateNew: '#B91C1C',
  stateNewSoft: 'rgba(185,28,28,0.15)',
  statePrep: '#FBBF24',
  statePrepSoft: 'rgba(251,191,36,0.12)',
  stateOk: '#22C55E',
  stateOkSoft: 'rgba(34,197,94,0.12)',
  stateNeutral: '#A1A1AA',
  stateNeutralSoft: 'rgba(161,161,170,0.12)',

  // Accesorios
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.12)',
  dangerText: '#F8B4B4',
  info: '#60A5FA',
  infoSoft: 'rgba(96,165,250,0.12)',
}

// Escala tipográfica fija (6 tamaños)
export const type = {
  xxs: 11,
  xs: 12,
  sm: 13,
  base: 15,
  lg: 18,
  xl: 22,
}

const FONT = "'Inter', system-ui, -apple-system, sans-serif"

export const ds = {
  // Surfaces
  card: {
    background: colors.surface,
    borderRadius: 12,
    padding: '16px 18px',
    border: `1px solid ${colors.border}`,
  },

  // Tables (flex-based)
  table: {
    background: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    border: `1px solid ${colors.border}`,
  },
  tableHeader: {
    display: 'flex', alignItems: 'center', padding: '9px 14px', gap: 12,
    fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
    borderBottom: `1px solid ${colors.border}`,
    textTransform: 'uppercase', letterSpacing: '0.08em',
    background: colors.elev,
  },
  tableRow: {
    display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 12,
    borderBottom: `1px solid ${colors.border}`, color: colors.textDim,
    fontSize: type.sm, fontWeight: 500,
  },

  // Badges base
  badge: {
    fontSize: type.xxs, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
    letterSpacing: '0.04em', textTransform: 'uppercase',
    background: 'rgba(255,255,255,0.05)', color: colors.textDim,
    border: `1px solid ${colors.border}`, display: 'inline-flex',
    alignItems: 'center', gap: 5,
  },

  // Inputs
  input: {
    padding: '0 12px', height: 36, borderRadius: 8,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, width: '100%', outline: 'none',
    background: colors.surface, color: colors.text, boxSizing: 'border-box',
  },
  formInput: {
    width: '100%', padding: '0 12px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, background: colors.surface,
    color: colors.text, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '0 36px 0 12px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, background: colors.surface,
    color: colors.text, outline: 'none', boxSizing: 'border-box',
    appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(245,245,245,0.40)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    cursor: 'pointer',
  },
  label: {
    fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
    marginBottom: 6, display: 'block',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },

  // Buttons
  filterBtn: {
    padding: '0 12px', height: 30, borderRadius: 8,
    border: `1px solid ${colors.border}`,
    fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
    fontFamily: FONT, background: colors.surface, color: colors.textDim,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  actionBtn: {
    padding: '0 12px', height: 30, borderRadius: 8,
    border: `1px solid ${colors.border}`,
    fontSize: type.xs, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    background: colors.surface, color: colors.text,
  },
  backBtn: {
    background: 'none', border: 'none', fontSize: type.sm, fontWeight: 600,
    color: colors.primary, cursor: 'pointer', fontFamily: FONT,
    marginBottom: 16, padding: 0,
  },
  primaryBtn: {
    padding: '0 16px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.primary}`,
    background: colors.primary, color: '#fff',
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  secondaryBtn: {
    padding: '0 16px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.surface, color: colors.text,
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },

  // Typography
  h1: { fontSize: type.xl, fontWeight: 800, color: colors.text, letterSpacing: '-0.4px' },
  h2: { fontSize: type.lg, fontWeight: 700, color: colors.text, marginBottom: 12, letterSpacing: '-0.2px' },
  muted: { color: colors.textMute, fontSize: type.xs },
  dim: { color: colors.textDim, fontSize: type.sm },

  // Modal
  modal: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    zIndex: 1000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', backdropFilter: 'blur(4px)',
    padding: 16,
  },
  modalContent: {
    background: colors.surface, borderRadius: 14, padding: 22,
    width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto',
    border: `1px solid ${colors.borderStrong}`,
    boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
  },
}

// Helper: badge por estado de pedido
// Estados: nuevo | aceptado | preparando | listo | recogido | en_camino | entregado | cancelado
export function stateBadge(estado) {
  const map = {
    nuevo:      { bg: colors.stateNewSoft,     color: colors.stateNew,     label: 'Nuevo' },
    aceptado:   { bg: colors.statePrepSoft,    color: colors.statePrep,    label: 'Preparando' },
    preparando: { bg: colors.statePrepSoft,    color: colors.statePrep,    label: 'Preparando' },
    listo:      { bg: colors.stateOkSoft,      color: colors.stateOk,      label: 'Listo' },
    recogido:   { bg: colors.stateOkSoft,      color: colors.stateOk,      label: 'Recogido' },
    en_camino:  { bg: colors.stateOkSoft,      color: colors.stateOk,      label: 'En camino' },
    entregado:  { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: 'Entregado' },
    cancelado:  { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: 'Cancelado' },
    fallido:    { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: 'Fallido' },
  }
  const s = map[estado] || { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: estado || '—' }
  return {
    display: 'inline-flex', alignItems: 'center',
    background: s.bg, color: s.color,
    fontSize: type.xxs, fontWeight: 700,
    padding: '3px 8px', borderRadius: 6,
    letterSpacing: '0.04em', textTransform: 'uppercase',
    _label: s.label,
  }
}

// Helper útil para reutilizar label desde el resultado de stateBadge
export function stateLabel(estado) {
  return stateBadge(estado)._label
}
