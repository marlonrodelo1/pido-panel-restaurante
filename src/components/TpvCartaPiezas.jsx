// Las piezas de la CARTA del TPV que comparten el mostrador (`pages/Tpv.jsx`) y
// el nuevo reparto/recogida (`TpvNuevoPedido.jsx`).
//
// Vivían dentro de `Tpv.jsx`, privadas, y el nuevo reparto se pintaba con otras
// suyas: chips de texto y productos sin foto. Marlon (14 sep 2026): «los
// productos deben tener las fotos como en el mostrador». Con las piezas en un
// solo sitio, las dos cartas no se vuelven a separar. El icono por categoría y la
// etiqueta de bloque están en `lib/tpvCarta.js`.
import { createElement } from 'react'
import { T, eur } from '../lib/tpvTheme'
import { iconoDe } from '../lib/tpvCarta'

// El botón de una categoría: icono, nombre y cuántos productos tiene.
// `tam(movil, tablet, monitor)` lo pone quien lo pinta, porque cada pantalla sabe
// en qué hueco vive.
export function BotonCategoria({ nombre, cuantos, activa, esMovil, esMonitor, tam, onClick }) {
  return (
    <button onClick={onClick} title={nombre} style={{
      // No encoge en ninguno de los dos: cada categoria ocupa lo que
      // mide su nombre. Un tope evita que "Bebidas Alcoholicas" se lleve
      // media fila.
      flex: '0 0 auto', minWidth: 0, maxWidth: esMonitor ? 230 : '100%',
      height: tam(46, 56, 44), padding: esMovil ? '0 12px' : '0 12px', cursor: 'pointer',
      scrollSnapAlign: 'start', fontFamily: 'inherit',
      border: `1px solid ${activa ? T.accent : T.border}`,
      borderRadius: 12,
      background: activa ? T.accentFill : T.surface2,
      color: activa ? T.onAccent : T.text,
      display: 'flex', alignItems: 'center', gap: 9,
      fontSize: tam(13, 14, 13), fontWeight: activa ? 700 : 500,
    }}>
      {/* `createElement` y no `<Icono />`: el icono sale de un mapa ya hecho, pero
          la regla de componentes estáticos de React no puede saberlo. */}
      {createElement(iconoDe(nombre), {
        size: tam(16, 18, 15), color: activa ? T.onAccent : T.accent, style: { flexShrink: 0 },
      })}
      <span style={{
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', textAlign: 'left', flex: 1,
      }}>{nombre}</span>
      <span style={{
        fontSize: 12, opacity: 0.65, fontWeight: 500, flexShrink: 0,
      }}>{cuantos}</span>
    </button>
  )
}

// La tarjeta de un producto en el mostrador.
//
// CON FOTO: la foto ocupa la tarjeta entera y el nombre va ENCIMA, abajo, sobre un
// degradado. Se busca el plato mirando la foto, no leyendo: la foto tiene que mandar.
// Antes la imagen era una franja y debajo habia otra franja de texto casi igual de
// alta, y en un monitor eso deja la foto diminuta.
//
// SIN FOTO: hoy 122 de 160 productos no tienen. Una tarjeta alta y negra con el nombre
// perdido en medio se lee peor que una fila compacta, asi que esas mantienen el
// formato de texto de siempre. Dos formas para dos casos, a proposito.
export function TarjetaProducto({ p, tams, tieneExtras, yaLleva, esMovil, tam, precioBarra, onClick }) {
  // 🔴 En TELEFONO no: ahi la rejilla es de 2-3 columnas y una tarjeta de 126 px de
  // alto deja ver media carta, asi que se queda la fila compacta de texto.
  // En TABLET SI. Es el aparato con el que se cobra en la barra, y era justo donde
  // no se veia ni una foto: esto pedia `esMonitor` (>=1280 px) y una tablet de 800
  // o de 1024 se quedaba fuera. Hay fotos de sobra para ello — en BD (1 sep 2026):
  // Duende Burger 77 de 77 productos, Burger House 38 de 38 a la venta.
  const conFoto = !!p.imagen_url && !esMovil
  const precio = (
    <>
      {tams.length ? 'desde ' : ''}
      {eur(tams.length ? Math.min(...tams.map((t) => precioBarra(p, t))) : precioBarra(p))}
    </>
  )

  const contador = yaLleva > 0 && (
    <span style={{
      position: 'absolute', top: 6, right: 6,
      minWidth: esMovil ? 20 : 24, height: esMovil ? 20 : 24,
      padding: '0 5px', borderRadius: 7, background: T.accentFill, color: T.onAccent,
      fontSize: esMovil ? 11 : 13, fontWeight: 800,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Sobre una foto clara, el naranja solo no separa: hace falta la sombra.
      boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
    }}>{yaLleva}</span>
  )

  const marco = {
    position: 'relative', overflow: 'hidden', padding: 0, textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit', color: T.text,
    border: `1px solid ${yaLleva ? T.accent : T.border}`,
    borderRadius: esMovil ? 10 : 12,
    background: T.surface2,
    display: 'flex', flexDirection: 'column',
  }

  if (!conFoto) {
    return (
      <button onClick={onClick} style={{ ...marco, minHeight: tam(64, 78, 68) }}>
        {contador}
        <span style={{
          padding: esMovil ? '8px 9px' : '10px 11px',
          display: 'flex', flexDirection: 'column', gap: esMovil ? 3 : 5,
          flex: 1, justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: tam(12, 14, 12.5), fontWeight: 500, lineHeight: 1.25 }}>{p.nombre}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: tam(13, 15, 13.5), fontWeight: 700, color: T.accent }}>{precio}</span>
            {tieneExtras && <span style={{ fontSize: esMovil ? 10 : 11, color: T.muted }}>+ extras</span>}
          </span>
        </span>
      </button>
    )
  }

  return (
    <button onClick={onClick} title={p.nombre} style={{ ...marco, height: tam(126, 150, 132) }}>
      <img src={p.imagen_url} alt="" loading="lazy" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', display: 'block',
      }} />
      {/* El degradado NO es adorno: sin el, un nombre blanco sobre una foto clara
          (unas papas, un plato con luz) no se lee. Sube casi hasta media tarjeta
          porque el texto puede ocupar dos lineas. */}
      <span style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, top: '38%',
        background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.88) 100%)',
        pointerEvents: 'none',
      }} />
      {contador}
      <span style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: esMovil ? '0 8px 8px' : '0 10px 10px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <span style={{
          fontSize: tam(12, 14, 12.5), fontWeight: 600, lineHeight: 1.25, color: '#FFFFFF',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          // Por si el degradado se queda corto con una foto muy blanca.
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>{p.nombre}</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: tam(13, 15, 13.5), fontWeight: 800, color: T.accent,
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          }}>{precio}</span>
          {tieneExtras && (
            <span style={{ fontSize: esMovil ? 10 : 11, color: 'rgba(255,255,255,0.75)' }}>+ extras</span>
          )}
        </span>
      </span>
    </button>
  )
}
