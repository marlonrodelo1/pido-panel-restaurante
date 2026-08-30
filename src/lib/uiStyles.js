// Estilos compartidos panel-restaurante
// Design system: Plus Jakarta Sans + paleta cream/terracotta/sage
// Pivote SaaS — paleta artesanal cálida (mayo 2026)
//
// API: mantenemos nombres de tokens existentes (colors.bg, colors.primary, etc.)
// para no romper imports. Solo cambian los valores hex.
// Tokens nuevos añadidos: cream, paper, ink, stone, terracotta, sage + variantes.

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

export const colors = {
  // === Bases (cream world) ===
  cream:    '#F7F3EC',   // fondo principal
  cream2:   '#EFE9DD',   // filas/secciones secundarias
  paper:    '#FBF8F2',   // cards, inputs

  // === Tinta ===
  ink:      '#1A1815',
  ink2:     '#2B2823',
  stone:    '#6B6356',
  stone2:   '#8A8174',

  // === Acentos ===
  terracotta:      '#C5562C',
  terracotta2:     '#A8451F',
  terracottaSoft:  '#F1D9CC',

  sage:      '#8B9D7A',
  sage2:     '#6F8460',
  sageSoft:  '#DDE3D3',

  // === Funcionales ===
  info:        '#7B8FA8',
  infoSoft:    '#DBE0E8',
  danger:      '#B5564A',
  dangerSoft:  '#F1D0CB',
  warning:     '#C99551',
  warningSoft: '#F0E1C8',

  // === Compatibilidad hacia atrás (alias a la nueva paleta) ===
  // Superficies
  bg:           '#F7F3EC',  // alias cream
  surface:      '#FBF8F2',  // alias paper
  surface2:     '#EFE9DD',  // alias cream2
  elev:         '#FBF8F2',  // alias paper
  elev2:        '#EFE9DD',  // alias cream2
  border:       '#E8E1D3',
  borderStrong: '#D8CDB8',

  // Tipografía
  text:      '#1A1815',  // alias ink
  textDim:   '#2B2823',  // alias ink2
  textMute:  '#6B6356',  // alias stone
  textFaint: '#8A8174',  // alias stone2

  // Primario (antes naranja Pidoo #FF6B2C → ahora terracotta)
  primary:       '#C5562C',
  primaryDark:   '#A8451F',
  primarySoft:   '#F1D9CC',
  primaryBorder: 'rgba(197,86,44,0.32)',

  // Estados (mapeados a paleta nueva)
  stateNew:        '#B5564A',  // danger
  stateNewSoft:    '#F1D0CB',
  statePrep:       '#C99551',  // warning
  statePrepSoft:   '#F0E1C8',
  stateOk:         '#8B9D7A',  // sage
  stateOkSoft:     '#DDE3D3',
  stateNeutral:    '#6B6356',  // stone
  stateNeutralSoft:'#EFE9DD',

  // Otros
  dangerText: '#A8451F',

  // === Sombras ===
  shadow:   '0 1px 3px rgba(26,24,21,0.05), 0 1px 1px rgba(26,24,21,0.03)',
  shadowMd: '0 4px 12px rgba(26,24,21,0.06), 0 1px 3px rgba(26,24,21,0.04)',
  shadowLg: '0 14px 40px rgba(26,24,21,0.10), 0 4px 12px rgba(26,24,21,0.06)',
  shadowGlossy: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(26,24,21,0.20)',
}

// Escala tipográfica fija (6 tamaños) — mantiene API existente
export const type = {
  xxs: 11,
  xs:  12,
  sm:  13,
  base:15,
  lg:  18,
  xl:  22,

  // Familia tipográfica (nuevo)
  family: FONT,
  mono:   'ui-monospace, SFMono-Regular, "JetBrains Mono", monospace',
}

// === Radios ===
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 }

// Columna de ancho fijo dentro de una fila flex.
//
// `flexShrink: 0` NO es decorativo: sin el, flex comprime las columnas numericas
// cuando algo mas pide sitio y los importes salen CORTADOS a media cifra ("7,3"
// en vez de "7,35"). Un inventario que enseña importes truncados no sirve.
// Tabla ancha en pantalla estrecha.
//
// Con las columnas ya sin encoger (ver `col`), una fila que no cabe DESBORDA, y con el
// `overflow: hidden` de la tarjeta los botones acaban montados encima del importe.
// Antes de aplastar las cifras hasta hacerlas ilegibles, que la tabla se desplace.
//
// `tablaScroll` va en el contenedor y `filaMin` en la cabecera Y en cada fila: si solo
// se pone en el contenedor, las filas se encogen igual y no se arregla nada.
export const tablaScroll = { overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' }
export const filaMin = (min = 700) => ({ minWidth: min })

export const col = (w, alinear = 'right') => ({
  width: w, flexShrink: 0, textAlign: alinear,
  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
})

export const ds = {
  // Surfaces
  card: {
    background: colors.paper,
    borderRadius: radius.md,
    padding: '16px 18px',
    border: `1px solid ${colors.border}`,
    boxShadow: colors.shadow,
  },

  // Tables (flex-based)
  table: {
    background: colors.paper,
    borderRadius: radius.md,
    overflow: 'hidden',
    border: `1px solid ${colors.border}`,
    boxShadow: colors.shadow,
  },
  tableHeader: {
    display: 'flex', alignItems: 'center', padding: '9px 14px', gap: 12,
    fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
    borderBottom: `1px solid ${colors.border}`,
    textTransform: 'uppercase', letterSpacing: '0.08em',
    background: colors.elev2,
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
    background: colors.surface2, color: colors.textDim,
    border: `1px solid ${colors.border}`, display: 'inline-flex',
    alignItems: 'center', gap: 5,
  },

  // Inputs
  input: {
    padding: '0 12px', height: 36, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, width: '100%', outline: 'none',
    background: colors.paper, color: colors.text, boxSizing: 'border-box',
  },
  formInput: {
    width: '100%', padding: '0 12px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, background: colors.paper,
    color: colors.text, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '0 36px 0 12px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`, fontSize: type.sm,
    fontFamily: FONT, background: colors.paper,
    color: colors.text, outline: 'none', boxSizing: 'border-box',
    appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6356" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`,
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
    padding: '0 12px', height: 30, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
    fontFamily: FONT, background: colors.paper, color: colors.textDim,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  actionBtn: {
    padding: '0 12px', height: 30, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    fontSize: type.xs, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    background: colors.paper, color: colors.text,
  },
  backBtn: {
    background: 'none', border: 'none', fontSize: type.sm, fontWeight: 600,
    color: colors.primary, cursor: 'pointer', fontFamily: FONT,
    marginBottom: 16, padding: 0,
  },
  primaryBtn: {
    padding: '0 16px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.primary}`,
    background: colors.primary, color: colors.cream,
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  // CTA glossy ink — botón hero del nuevo sistema
  glossyBtn: {
    padding: '0 18px', height: 42, borderRadius: radius.sm,
    background: `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
    color: colors.cream,
    border: '1px solid #000',
    boxShadow: colors.shadowGlossy,
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  secondaryBtn: {
    padding: '0 16px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.paper, color: colors.text,
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  // Ghost button — outline cream estilo bundle
  ghostBtn: {
    padding: '0 14px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.borderStrong}`,
    background: colors.paper, color: colors.ink,
    fontSize: type.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  // Mini button — compacto para acciones de fila (Editar / Eliminar)
  miniBtn: {
    padding: '4px 10px', height: 26, borderRadius: 7,
    border: `1px solid ${colors.border}`,
    background: colors.paper, color: colors.ink2,
    fontSize: type.xxs, fontWeight: 700, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  miniBtnDanger: {
    padding: '4px 10px', height: 26, borderRadius: 7,
    border: `1px solid ${colors.dangerSoft}`,
    background: colors.dangerSoft, color: colors.danger,
    fontSize: type.xxs, fontWeight: 700, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  // Section label — uppercase muted
  sectionLabel: {
    fontSize: type.xxs, fontWeight: 800, color: colors.stone2,
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 10,
  },

  // Typography
  h1: { fontSize: type.xl, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em', fontFamily: FONT },
  h2: { fontSize: type.lg, fontWeight: 700, color: colors.text, marginBottom: 12, letterSpacing: '-0.015em', fontFamily: FONT },
  muted: { color: colors.textMute, fontSize: type.xs },
  dim: { color: colors.textDim, fontSize: type.sm },

  // Modal
  modal: {
    position: 'fixed', inset: 0, background: 'rgba(26,24,21,0.45)',
    zIndex: 1000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', backdropFilter: 'blur(4px)',
    padding: 16,
  },
  modalContent: {
    background: colors.paper, borderRadius: radius.lg, padding: 22,
    width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto',
    border: `1px solid ${colors.borderStrong}`,
    boxShadow: colors.shadowLg,
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
    en_camino:  { bg: colors.infoSoft,         color: colors.info,         label: 'En camino' },
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

// Chip — pill compacto coloreado por tono
// Uso: <span style={chip('sage', { dot: true })}>Online</span>
export function chip(tone = 'paper', { dot = false } = {}) {
  const tones = {
    paper:      { bg: colors.paper,        fg: colors.ink2,    bd: colors.border       },
    sage:       { bg: colors.sageSoft,     fg: colors.sage2,   bd: colors.sageSoft     },
    terracotta: { bg: colors.terracottaSoft,fg: colors.terracotta2, bd: colors.terracottaSoft },
    warning:    { bg: colors.warningSoft,  fg: '#8B6126',      bd: colors.warningSoft  },
    danger:     { bg: colors.dangerSoft,   fg: colors.danger,  bd: colors.dangerSoft   },
    info:       { bg: colors.infoSoft,     fg: '#4A6480',      bd: colors.infoSoft     },
    ink:        { bg: colors.ink2,         fg: colors.cream,   bd: colors.ink          },
  }
  const t = tones[tone] || tones.paper
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
    fontSize: type.xxs, fontWeight: 700,
    padding: dot ? '3px 9px' : '3px 8px',
    borderRadius: 999, letterSpacing: '0.02em',
    fontFamily: FONT,
  }
}

// Dot interior para chips con dot=true (renderizado con un <span> antes del texto)
export const chipDot = {
  width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0,
}
