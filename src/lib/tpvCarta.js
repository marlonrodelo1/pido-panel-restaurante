// Lo que no es componente de la carta del TPV: el icono por categoría y la
// etiqueta de bloque. Va aparte de `components/TpvCartaPiezas.jsx` porque un
// fichero de componentes que exporta también constantes rompe el refresco en
// caliente de Vite.
import {
  Sandwich, Croissant, Beef, Beer, CupSoda, Coffee, Pizza, Salad, CakeSlice, IceCream,
  Fish, Drumstick, Soup, Cookie, Utensils, Wine, Ham, Popcorn, Carrot, EggFried,
} from 'lucide-react'
import { T } from './tpvTheme'

// Icono por categoría. Se mira el nombre porque `categorias` no guarda ningún icono
// ni imagen. Con la carta de un bar (bocadillos, croissants, papas, perritos…) el
// mapa de ilustraciones que hay en `lib/food.jsx` mandaría casi todo al icono de
// pizza, así que aquí se usa lucide, que ya está en el proyecto.
const ICONOS = [
  [/bocadill|sandwi|sándwi|montad/i, Sandwich],
  [/croissa|bolleri|bollería|dulce/i, Croissant],
  [/hamburg|burger/i, Beef],
  [/perrit|salchich|hot ?dog/i, Drumstick],
  [/cervez|alcoh|copa|cubata/i, Beer],
  [/vino|tinto|blanco|rioja/i, Wine],
  [/refresc|bebid|zumo|agua/i, CupSoda],
  [/caf[eé]|infusi|t[eé]\b|desayun/i, Coffee],
  [/pizza/i, Pizza],
  [/ensalad|verdur|vegetal/i, Salad],
  [/postre|tarta|pastel/i, CakeSlice],
  [/helad|granizad/i, IceCream],
  [/pescad|marisc|at[uú]n/i, Fish],
  [/sopa|crema|caldo|guiso/i, Soup],
  [/galle|snack|aperitiv/i, Cookie],
  [/jam[oó]n|ib[eé]ric|embutid/i, Ham],
  [/papa|patata|frit/i, Popcorn],
  [/tortill|huevo/i, EggFried],
  [/extra|complement|salsa/i, Carrot],
]
export const iconoDe = (nombre) => (ICONOS.find(([re]) => re.test(nombre || ''))?.[1]) || Utensils

// Etiqueta de bloque del mostrador ("Categorías", "Productos"). Pequeña y apagada:
// tiene que separar sin robarle sitio a la carta, que es lo que se toca.
export const etiquetaBloque = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
  color: T.muted, flexShrink: 0,
}

// ── Extras ──────────────────────────────────────────────────────────────────

// `tipo` no tiene CHECK en la base: conviven 'unico' (grupos viejos) y 'single'
// (lo que guarda Carta.jsx hoy). Por eso la pregunta se hace al revés —multiple
// es lo único que admite varias— y así coincide con lo que valida el servidor.
export const esGrupoMultiple = (g) => g?.tipo === 'multiple'

// Tocar un producto lo mete DIRECTO en la venta, y los extras se ponen después
// desde la línea (Marlon, 15 sep 2026). La ventana solo sale sola cuando hay una
// pregunta que no se puede saltar: el tamaño, o un grupo de elección única («el
// punto de la carne»). Sin esa excepción se cobraría un producto a medias.
export const pideVentanaAlTocar = (tamanos, grupos) =>
  (tamanos || []).length > 0 || (grupos || []).some((g) => !esGrupoMultiple(g))

// Lo que suman unos extras, en céntimos. Mismo clamp a 0 que el servidor: un
// extra guardado en negativo no puede bajar la línea en pantalla y no en el ticket.
export const centimosExtras = (opciones) =>
  (opciones || []).reduce((s, o) => s + Math.max(0, Math.round(Number(o.precio || 0) * 100)), 0)
