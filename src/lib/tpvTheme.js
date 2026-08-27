// Paleta y piezas comunes del TPV.
//
// Vive aparte de `uiStyles.js` a propósito: el resto del panel es claro y no se
// toca. Aquí solo está lo que comparten las pantallas del TPV (mostrador, caja y
// pedidos), para no tener tres copias del mismo negro.
//
// LAS DOS REGLAS DE CONTRASTE, medidas con la fórmula de WCAG y no supuestas:
//   - El acento es `#FF6B2C` (el naranja de la app cliente), NO el terracota del
//     panel: sobre este fondo el terracota se queda en 3,7:1 y no llega a AA.
//   - Hay DOS naranjas y no es capricho. `accent` (#FF6B2C) es el brillante y solo
//     se usa en cosas finas: texto, iconos, bordes. Sobre él el blanco daria 2,84:1
//     y seria ilegible. `accentFill` (#BF4A18) es el de RELLENO, para botones y
//     pestañas activas, y con el blanco encima llega a 4,99:1. Mismo color de marca,
//     un punto mas profundo, y las letras salen blancas como tienen que salir.

// La tipografía del TPV es SUYA, no la del resto del panel.
//
// Space Grotesk es una grotesca con carácter: la 'a' y la 'g' tienen forma propia
// y los números son anchos y planos, que es justo lo que hace falta cuando alguien
// lee un total a un metro de distancia. El panel sigue en Plus Jakarta Sans; esta
// solo entra en el TPV, y por eso se declara aquí y no en `uiStyles.js`.
export const FONT = "'Space Grotesk', 'Plus Jakarta Sans', system-ui, sans-serif"

export const T = {
  bg: '#12100E',
  surface: '#1A1815',
  surface2: '#221F1B',
  border: '#332E28',
  text: '#F5F5F5',
  muted: '#A8A08F',
  accent: '#FF6B2C',        // finos: texto, iconos, bordes
  accentFill: '#BF4A18',    // superficies rellenas que llevan texto blanco encima
  onAccent: '#FFFFFF',
  danger: '#FF7A6B',
  ok: '#8FC46B',
}

// El dinero se cuenta en CÉNTIMOS enteros. Nunca en decimales: 0.1 + 0.2 no es 0.3
// y el cambio de un cliente no es sitio para descubrirlo.
export const cents = (euros) => Math.round(Number(euros || 0) * 100)
export const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €'

export const caja = {
  background: T.bg,
  color: T.text,
  borderRadius: 18,
  padding: 16,
  minHeight: '70vh',
  fontFamily: FONT,
  // Los importes se leen de un vistazo si todas las cifras ocupan lo mismo.
  fontVariantNumeric: 'tabular-nums',
}

export const btnIcono = {
  width: 32, height: 32, borderRadius: 9, cursor: 'pointer',
  border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

// Relleno naranja profundo + texto blanco: ver la nota de los dos naranjas.
export const btnAccion = {
  background: T.accentFill, color: T.onAccent, border: 'none', borderRadius: 14,
  fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

export const btnSecundario = {
  background: T.surface2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 12,
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '0 14px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

export const inputOscuro = {
  width: '100%', height: 48, padding: '0 14px', borderRadius: 12,
  border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
  fontSize: 16, fontFamily: 'inherit',
}
