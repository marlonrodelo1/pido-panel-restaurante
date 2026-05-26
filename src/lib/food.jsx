// Pidoo food illustrations — SVG cálidos coherentes con la paleta terracotta/sage/cream.
// Sustituyen emojis 🍕🍝🍰 por illustrations CSS hechas a mano.
//
// Uso:
//   import { FoodIcon, FoodChip, FoodPizza, FoodPasta, ... } from './lib/food'
//   <FoodIcon kw="pizza" kind="margarita" size={86} />
//   <FoodChip cat="Pizzas" size={56} />

export const FoodPizza = ({ size = 86, kind = 'margarita' }) => {
  const toppings = {
    margarita: [
      { x: 30, y: 35, r: 5, c: '#C5562C' }, { x: 60, y: 30, r: 5, c: '#C5562C' },
      { x: 50, y: 55, r: 6, c: '#C5562C' }, { x: 25, y: 60, r: 5, c: '#C5562C' },
      { x: 70, y: 60, r: 4, c: '#C5562C' },
      { x: 40, y: 45, r: 4, c: '#8B9D7A' }, { x: 65, y: 45, r: 3, c: '#8B9D7A' },
    ],
    diavola: [
      { x: 32, y: 35, r: 6, c: '#A8451F' }, { x: 60, y: 32, r: 6, c: '#A8451F' },
      { x: 45, y: 52, r: 7, c: '#A8451F' }, { x: 28, y: 60, r: 5, c: '#A8451F' },
      { x: 68, y: 60, r: 6, c: '#A8451F' }, { x: 50, y: 70, r: 5, c: '#A8451F' },
    ],
    quesos: [
      { x: 30, y: 30, r: 7, c: '#F0E1C8' }, { x: 60, y: 30, r: 7, c: '#FBF8F2' },
      { x: 45, y: 55, r: 8, c: '#C99551' }, { x: 25, y: 65, r: 6, c: '#F0E1C8' },
      { x: 70, y: 65, r: 6, c: '#FBF8F2' },
    ],
    prosciutto: [
      { x: 30, y: 35, r: 6, c: '#A8451F' }, { x: 60, y: 30, r: 5, c: '#A8451F' },
      { x: 45, y: 55, r: 7, c: '#A8451F' }, { x: 25, y: 65, r: 4, c: '#8B9D7A' },
      { x: 70, y: 60, r: 5, c: '#8B9D7A' }, { x: 50, y: 45, r: 3, c: '#8B9D7A' },
    ],
  };
  const t = toppings[kind] || toppings.margarita;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="#C99551"/>
      <circle cx="50" cy="50" r="40" fill="#F0E1C8"/>
      <circle cx="50" cy="50" r="38" fill="#E6CBA0"/>
      {t.map((tp, i) => <circle key={i} cx={tp.x} cy={tp.y} r={tp.r} fill={tp.c}/>)}
    </svg>
  );
};

export const FoodPasta = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="68" rx="42" ry="16" fill="#FBF8F2"/>
    <ellipse cx="50" cy="64" rx="38" ry="14" fill="#F0E1C8"/>
    {[0,1,2,3,4,5].map(i => (
      <path key={i}
        d={`M${20 + i*10} 60 Q${25 + i*10} 50, ${30 + i*10} 60`}
        stroke="#C99551" strokeWidth="2" fill="none" strokeLinecap="round"/>
    ))}
    <path d="M20 60 Q50 30, 80 60" stroke="#E6CBA0" strokeWidth="3" fill="none"/>
    <circle cx="38" cy="55" r="5" fill="#A8451F"/>
    <circle cx="58" cy="52" r="4" fill="#A8451F"/>
    <circle cx="48" cy="58" r="3" fill="#8B9D7A"/>
  </svg>
);

export const FoodDessert = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <rect x="22" y="35" width="56" height="48" rx="4" fill="#FBF8F2"/>
    <rect x="22" y="35" width="56" height="12" fill="#8B4513" opacity="0.4"/>
    <rect x="22" y="50" width="56" height="14" fill="#F0E1C8"/>
    <rect x="22" y="68" width="56" height="15" fill="#8B4513" opacity="0.5"/>
    <ellipse cx="50" cy="35" rx="28" ry="6" fill="#FBF8F2"/>
    <circle cx="35" cy="33" r="1" fill="#5A3010"/>
    <circle cx="45" cy="34" r="1" fill="#5A3010"/>
    <circle cx="55" cy="33" r="1" fill="#5A3010"/>
    <circle cx="65" cy="34" r="1" fill="#5A3010"/>
  </svg>
);

export const FoodBurger = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="35" rx="36" ry="14" fill="#E6CBA0"/>
    <ellipse cx="50" cy="32" rx="36" ry="11" fill="#F0E1C8"/>
    <circle cx="40" cy="28" r="1.5" fill="#FBF8F2"/>
    <circle cx="55" cy="26" r="1.5" fill="#FBF8F2"/>
    <circle cx="62" cy="30" r="1.5" fill="#FBF8F2"/>
    <rect x="14" y="44" width="72" height="6" fill="#8B9D7A"/>
    <rect x="14" y="48" width="72" height="10" rx="2" fill="#A8451F"/>
    <rect x="14" y="56" width="72" height="6" fill="#C99551"/>
    <ellipse cx="50" cy="72" rx="36" ry="12" fill="#C99551"/>
  </svg>
);

export const FoodSushi = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="78" rx="40" ry="6" fill="#1A1815" opacity="0.1"/>
    {[20, 50, 80].map((x, i) => (
      <g key={i}>
        <rect x={x-12} y="40" width="24" height="22" rx="6" fill="#F0E1C8"/>
        <rect x={x-13} y="35" width="26" height="12" rx="5" fill={i === 0 ? '#C5562C' : i === 1 ? '#A8451F' : '#8B9D7A'}/>
        <rect x={x-11} y="48" width="22" height="3" fill="#1A1815" opacity="0.5"/>
      </g>
    ))}
  </svg>
);

export const FoodSalad = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="68" rx="42" ry="16" fill="#FBF8F2"/>
    <path d="M8 64 Q50 92 92 64" stroke="#E2DCCE" strokeWidth="1.5" fill="none"/>
    <path d="M20 60 Q30 45 42 56" fill="#8B9D7A"/>
    <path d="M40 50 Q55 38 65 52" fill="#6F8460"/>
    <path d="M58 56 Q72 44 82 60" fill="#8B9D7A"/>
    <path d="M28 62 Q42 52 50 65" fill="#6F8460"/>
    <circle cx="35" cy="60" r="5" fill="#C5562C"/>
    <circle cx="62" cy="58" r="4" fill="#C5562C"/>
    <ellipse cx="50" cy="62" rx="3" ry="2" fill="#1A1815" opacity="0.6"/>
    <ellipse cx="72" cy="65" rx="3" ry="2" fill="#1A1815" opacity="0.6"/>
  </svg>
);

export const FoodCoffee = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="80" rx="38" ry="5" fill="#FBF8F2"/>
    <ellipse cx="50" cy="78" rx="36" ry="4" fill="#F0E1C8"/>
    <path d="M22 40 L26 78 Q26 82 30 82 L70 82 Q74 82 74 78 L78 40 Z" fill="#FBF8F2"/>
    <path d="M22 40 L26 78 Q26 82 30 82 L70 82 Q74 82 74 78 L78 40 Z" stroke="#E2DCCE" strokeWidth="1.5" fill="none"/>
    <path d="M78 50 Q90 55 86 68 Q82 72 76 70" stroke="#FBF8F2" strokeWidth="6" fill="none" strokeLinecap="round"/>
    <ellipse cx="50" cy="42" rx="26" ry="4" fill="#5A3010"/>
    <ellipse cx="50" cy="41" rx="14" ry="2" fill="#F0E1C8" opacity="0.6"/>
    <path d="M40 41 Q50 38 60 41" stroke="#FBF8F2" strokeWidth="0.8" fill="none"/>
    <path d="M38 28 Q34 22 38 16" stroke="#D8D2C5" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6"/>
    <path d="M50 26 Q46 20 50 14" stroke="#D8D2C5" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7"/>
    <path d="M62 28 Q58 22 62 16" stroke="#D8D2C5" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6"/>
  </svg>
);

export const FoodDrink = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <path d="M30 22 L35 82 Q35 86 38 86 L62 86 Q65 86 65 82 L70 22 Z" fill="#F0E1C8" opacity="0.4"/>
    <path d="M30 22 L35 82 Q35 86 38 86 L62 86 Q65 86 65 82 L70 22 Z" stroke="#C99551" strokeWidth="1.5" fill="none"/>
    <path d="M32 30 L36 78 Q36 80 38 80 L62 80 Q64 80 64 78 L68 30 Z" fill="#C5562C" opacity="0.7"/>
    <ellipse cx="50" cy="30" rx="19" ry="3" fill="#A8451F" opacity="0.6"/>
    <rect x="42" y="40" width="9" height="9" rx="1" fill="#FBF8F2" opacity="0.7" transform="rotate(15 46 44)"/>
    <rect x="52" y="52" width="8" height="8" rx="1" fill="#FBF8F2" opacity="0.7" transform="rotate(-10 56 56)"/>
    <rect x="48" y="10" width="4" height="28" rx="1.5" fill="#8B9D7A"/>
  </svg>
);

export const FoodBread = ({ size = 86 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="55" rx="40" ry="28" fill="#C99551"/>
    <ellipse cx="50" cy="50" rx="38" ry="24" fill="#E6CBA0"/>
    <path d="M30 45 L42 60" stroke="#A8451F" strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M45 38 L58 55" stroke="#A8451F" strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M60 42 L72 58" stroke="#A8451F" strokeWidth="2" fill="none" strokeLinecap="round"/>
    <circle cx="32" cy="50" r="1" fill="#5A3010"/>
    <circle cx="38" cy="45" r="1" fill="#5A3010"/>
    <circle cx="55" cy="48" r="1" fill="#5A3010"/>
    <circle cx="65" cy="52" r="1" fill="#5A3010"/>
  </svg>
);

// Dispatcher por keyword/categoría — devuelve la illustration adecuada.
export const FoodIcon = ({ kw, kind, size = 86 }) => {
  const k = (kw || '').toLowerCase();
  if (k.includes('pizza')) return <FoodPizza kind={kind} size={size}/>;
  if (k.includes('pasta'))  return <FoodPasta size={size}/>;
  if (k.includes('postre') || k.includes('dolce') || k.includes('dessert')) return <FoodDessert size={size}/>;
  if (k.includes('burger') || k.includes('hamburg')) return <FoodBurger size={size}/>;
  if (k.includes('sushi') || k.includes('japo'))    return <FoodSushi size={size}/>;
  if (k.includes('ensalada') || k.includes('salad'))return <FoodSalad size={size}/>;
  if (k.includes('café') || k.includes('cafe') || k.includes('coffee') || k.includes('brunch')) return <FoodCoffee size={size}/>;
  if (k.includes('bebida') || k.includes('drink') || k.includes('refresco'))  return <FoodDrink size={size}/>;
  if (k.includes('pan') || k.includes('bread') || k.includes('panader'))     return <FoodBread size={size}/>;
  return <FoodPizza size={size}/>;
};

// Variante con fondo paper y borde redondeado, para tablas/cards densas.
export const FoodChip = ({ cat, kind, size = 56, bg = '#FBF8F2' }) => (
  <div style={{
    width: size, height: size, borderRadius: 10,
    background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }}>
    <div style={{ transform: `scale(${(size - 8) / 86})`, transformOrigin: 'center', display: 'flex' }}>
      <FoodIcon kw={cat} kind={kind}/>
    </div>
  </div>
);
