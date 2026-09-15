// La ventana de TAMAÑO y EXTRAS de un producto del TPV. La comparten el
// mostrador (`pages/Tpv.jsx`) y el reparto/recogida (`TpvNuevoPedido.jsx`).
//
// Se abre de dos maneras:
//   - AL TOCAR un producto, SOLO si hay una pregunta que no se puede saltar
//     (tamaño o grupo de elección única). Todo lo demás entra directo a la venta
//     y los extras se ponen luego desde la línea (Marlon, 15 sep 2026). La regla
//     vive en `pideVentanaAlTocar`.
//   - DESDE LA LÍNEA ya añadida, con su botón «Extras». Llega con lo que la línea
//     ya lleva marcado (`inicial`) y el botón dice «Guardar».
//
// Solo devuelve lo elegido. Lo que se cobra lo pone el servidor.
import { useState } from 'react'
import { X } from 'lucide-react'
import { T, FONT, cents, eur, btnAccion } from '../lib/tpvTheme'
import { esGrupoMultiple, centimosExtras } from '../lib/tpvCarta'

export default function TpvModalExtras({
  producto, tamanos = [], grupos = [], precioBase, inicial = null, zIndex = 900, onCerrar, onAceptar,
}) {
  const [tam, setTam] = useState(() => {
    if (inicial) {
      return tamanos.find((t) => inicial.tamano_id && t.id === inicial.tamano_id)
        || tamanos.find((t) => inicial.tamano && t.nombre === inicial.tamano)
        || null
    }
    return tamanos.length === 1 ? tamanos[0] : null
  })
  // { grupo_id: [opcion, ...] }. Al cambiar una línea se marca lo que ya lleva.
  // Un extra que se haya borrado de la carta desde entonces no sale aquí, y al
  // guardar se cae de la línea.
  const [sel, setSel] = useState(() => {
    const ids = new Set(inicial?.extras || [])
    const m = {}
    if (!ids.size) return m
    for (const g of grupos) {
      for (const o of g.extras_opciones || []) {
        if (ids.has(o.id)) (m[g.id] ||= []).push({ ...o, grupo_id: g.id })
      }
    }
    return m
  })

  const topeDe = (g) => {
    if (!esGrupoMultiple(g)) return 1
    const m = Number(g.max_selecciones)
    return Number.isFinite(m) && m > 0 ? m : Infinity   // 0 guardado = sin limite
  }

  // Los grupos de elección única se tratan como obligatorios: no hay columna que lo
  // diga, pero "el punto de la carne" es una pregunta que hay que responder.
  const faltan = grupos.filter((g) => !esGrupoMultiple(g) && !(sel[g.id] || []).length)
  const listo = (!tamanos.length || tam) && !faltan.length

  function alternar(grupo, opcion) {
    setSel((prev) => {
      const actuales = prev[grupo.id] || []
      if (!esGrupoMultiple(grupo)) return { ...prev, [grupo.id]: [opcion] }
      const ya = actuales.some((o) => o.id === opcion.id)
      if (ya) return { ...prev, [grupo.id]: actuales.filter((o) => o.id !== opcion.id) }
      if (actuales.length >= topeDe(grupo)) return prev   // el servidor también lo frena
      return { ...prev, [grupo.id]: [...actuales, opcion] }
    })
  }

  const extras = Object.values(sel).flat()
  const totalC = (tam || !tamanos.length ? precioBase(producto, tam) : 0) + centimosExtras(extras)

  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 18,
        width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 17, color: T.text }}>{producto.nombre}</strong>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.muted }}>
            <X size={20} />
          </button>
        </div>

        {tamanos.length > 0 && (
          <Bloque titulo="Tamaño" obligatorio>
            {tamanos.map((t) => (
              <Opcion key={t.id} activa={tam?.id === t.id} onClick={() => setTam(t)}
                nombre={t.nombre} precio={eur(precioBase(producto, t))} />
            ))}
          </Bloque>
        )}

        {grupos.map((g) => (
          <Bloque key={g.id} titulo={g.nombre} obligatorio={!esGrupoMultiple(g)}
            nota={esGrupoMultiple(g) && Number(g.max_selecciones) > 0 ? `hasta ${g.max_selecciones}` : null}>
            {(g.extras_opciones || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0)).map((o) => (
              <Opcion key={o.id}
                activa={(sel[g.id] || []).some((x) => x.id === o.id)}
                onClick={() => alternar(g, { ...o, grupo_id: g.id })}
                nombre={o.nombre}
                precio={Number(o.precio) > 0 ? '+' + eur(cents(o.precio)) : ''} />
            ))}
          </Bloque>
        ))}

        <button onClick={() => onAceptar(tam, extras)} disabled={!listo} style={{
          ...btnAccion, width: '100%', height: 54, fontSize: 16, marginTop: 6,
          opacity: listo ? 1 : 0.4, cursor: listo ? 'pointer' : 'not-allowed',
        }}>
          {listo
            ? `${inicial ? 'Guardar' : 'Añadir'} · ${eur(totalC)}`
            : `Elige ${faltan[0]?.nombre || 'el tamaño'}`}
        </button>
      </div>
    </div>
  )
}

function Bloque({ titulo, obligatorio, nota, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{titulo}</span>
        {obligatorio && <span style={{ fontSize: 11, color: T.accent, fontWeight: 700 }}>obligatorio</span>}
        {nota && <span style={{ fontSize: 11, color: T.muted }}>{nota}</span>}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </div>
  )
}

function Opcion({ activa, onClick, nombre, precio }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      height: 48, padding: '0 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15,
      borderRadius: 12, border: `1px solid ${activa ? T.accent : T.border}`,
      background: activa ? 'rgba(255,107,44,0.14)' : T.surface2,
      color: activa ? T.accent : T.text, fontWeight: activa ? 700 : 500,
    }}>
      <span>{nombre}</span>
      <span style={{ fontSize: 13, color: activa ? T.accent : T.muted }}>{precio}</span>
    </button>
  )
}
