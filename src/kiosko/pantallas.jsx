// Las pantallas del KIOSKO, tal cual la maqueta aprobada por Marlon el 14 oct 2026
// (https://claude.ai/artifact/PpbpY1qq7odvcRDGmsbvkn). Todo se dibuja sobre un
// lienzo FIJO de 1080 x 1920 que `KioskoApp` escala a la pantalla: así el monitor
// vertical del local enseña exactamente lo que se aprobó, tenga la resolución que tenga.
//
// Estilo de la tienda pública (pidoo.es/<slug>): fondo crema, tarjetas beige, tinta
// casi negra, precios y botones en terracota; DM Sans 800 para titulares y precios,
// Plus Jakarta Sans para el resto.

import {
  ShoppingBag, ArrowLeft, ArrowRight, X, Plus, Minus, Check, CreditCard, Banknote,
  Lock, Info, Utensils, Pause, Play, RefreshCw,
} from 'lucide-react'
import { eur, sinPrefijo, precioUnidad, queFalta, textoExtras } from './carta'

export const C = {
  bg: '#F7F3EC', card: '#EFE9DD', ink: '#1A1815', muted: '#6B6356', terra: '#C5562C',
  line: '#E7DFD0', hueco: '#E4DCCD', apagado: '#CFC5B4', ok: '#2F8F5B', blanco: '#FFFFFF',
}
const DM = "'DM Sans', 'Plus Jakarta Sans', sans-serif"

const abs = { position: 'absolute', inset: 0 }
const titulo = (size) => ({ margin: 0, fontFamily: DM, fontWeight: 800, fontSize: size, lineHeight: 1, letterSpacing: -2 })
const btnPrimario = (alto, size, activo = true) => ({
  height: alto, border: 0, borderRadius: 999, background: activo ? C.terra : C.apagado, color: C.blanco,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
  fontFamily: DM, fontWeight: 800, fontSize: size, cursor: activo ? 'pointer' : 'default', padding: '0 40px',
})
const btnSecundario = (alto, size) => ({
  height: alto, borderRadius: 999, background: C.blanco, border: `3px solid ${C.ink}`, color: C.ink,
  fontFamily: DM, fontWeight: 800, fontSize: size, cursor: 'pointer', padding: '0 32px',
})
const btnRedondo = (lado) => ({
  width: lado, height: lado, borderRadius: '50%', background: C.blanco, border: `2px solid ${C.line}`,
  color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
})
const chip = {
  display: 'flex', alignItems: 'center', gap: 12, background: C.card, borderRadius: 999,
  padding: '16px 28px', fontSize: 27, fontWeight: 700,
}

function Foto({ src, alt = '', estilo, filtro }) {
  if (!src) {
    return (
      <span style={{ ...estilo, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.hueco, color: '#B9AE9C' }}>
        <Utensils size={96} strokeWidth={1.6} aria-hidden="true" />
      </span>
    )
  }
  return <img src={src} alt={alt} draggable={false} style={{ ...estilo, objectFit: 'cover', display: 'block', filter: filtro }} />
}

// Las fotos de Unsplash admiten tamaño y recorte en la URL: para el fondo vertical
// se piden ya en 1080x1920. Las del almacén de Pidoo se dejan como están.
export const fotoGrande = (url) => (/images\.unsplash\.com/.test(url || '')
  ? url.replace(/([?&])w=\d+/, '$1w=1080').replace(/([?&])h=\d+/, '$1') + '&h=1920&fit=crop'
  : url)

// ── Fondo de fotos en bucle (inicio y cerrado) ─────────────────────────────────
export function Fondo({ slides, slide, oscuro = false }) {
  return (
    <div style={{ ...abs, background: C.ink, overflow: 'hidden' }}>
      {slides.map((s, i) => (
        <img key={s.id} src={s.img} alt="" draggable={false}
          className={'kz-slide' + (i === slide ? ' kz-slide-activa' : '')} />
      ))}
      <div style={{ ...abs, background: 'linear-gradient(180deg, rgba(26,24,21,0.62) 0%, rgba(26,24,21,0.06) 22%, rgba(26,24,21,0.1) 42%, rgba(26,24,21,0.86) 72%, #1A1815 100%)' }} />
      {oscuro && <div style={{ ...abs, background: 'rgba(26,24,21,0.62)' }} />}
    </div>
  )
}

function Logo({ src, lado, borde = 6 }) {
  return src
    ? <img src={src} alt="" draggable={false} style={{ width: lado, height: lado, borderRadius: '50%', objectFit: 'cover', border: `${borde}px solid #fff`, background: '#fff', boxShadow: '0 12px 32px rgba(0,0,0,0.3)', flexShrink: 0 }} />
    : null
}

// ── 1. Inicio ─────────────────────────────────────────────────────────────────
export function Inicio({ est, slides, slide, horarioTexto, onEmpezar }) {
  const s = slides[slide]
  return (
    <>
      <Fondo slides={slides} slide={slide} />
      <div style={{ ...abs, boxSizing: 'border-box', padding: '72px 64px 80px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Logo src={est.logo_url} lado={136} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 60, lineHeight: 1, letterSpacing: -1, color: '#fff' }}>{est.nombre}</div>
            {horarioTexto && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', color: C.ink, borderRadius: 999, padding: '10px 24px', fontSize: 26, fontWeight: 700 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: C.ok }} />Abierto · {horarioTexto}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          {s && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>{s.categoria}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24 }}>
                <div style={{ fontFamily: DM, fontWeight: 700, fontSize: 40, lineHeight: 1.15, color: '#fff' }}>{s.nombre}</div>
                <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 44, color: '#fff', whiteSpace: 'nowrap' }}>{eur(s.precioC)}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                {slides.map((x, i) => (
                  <span key={x.id} style={{ height: 8, width: i === slide ? 56 : 16, borderRadius: 4, background: i === slide ? '#fff' : 'rgba(255,255,255,0.45)', transition: 'width .5s ease' }} />
                ))}
              </div>
            </div>
          )}
          <h1 style={{ ...titulo(168), lineHeight: 0.9, letterSpacing: -6, color: '#fff', marginTop: 12 }}>Pide aquí.</h1>
          <p style={{ margin: 0, maxWidth: 860, fontSize: 38, lineHeight: 1.35, fontWeight: 500, color: 'rgba(255,255,255,0.86)' }}>
            Elige en la pantalla, paga en caja y te llamamos por tu nombre.
          </p>
          <button onClick={onEmpezar} style={{ ...btnPrimario(184, 64), marginTop: 16, gap: 28, boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.2), 0 22px 50px rgba(197,86,44,0.5)' }}>
            <ShoppingBag size={68} strokeWidth={2} aria-hidden="true" /> Para llevar
          </button>
          <div style={{ textAlign: 'center', fontSize: 28, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Toca para empezar tu pedido</div>
        </div>
      </div>
    </>
  )
}

// ── 2. Nombre ─────────────────────────────────────────────────────────────────
const FILAS = ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM']
export const bonito = (n) => String(n || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())

export function Nombre({ nombre, onTecla, onBorrar, onVolver, onContinuar }) {
  const puede = nombre.trim().length >= 2
  const tecla = (label, onClick, extra = {}) => (
    <button key={label} onClick={onClick} aria-label={extra.aria || label} style={{
      flex: extra.flex || 1, minWidth: 0, height: 118, border: 0, borderRadius: 22,
      background: extra.bg || '#fff', color: extra.color || C.ink, boxShadow: '0 4px 0 rgba(26,24,21,0.12)',
      fontFamily: DM, fontWeight: 700, fontSize: extra.fs || 46, cursor: 'pointer',
    }}>{label}</button>
  )
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: '56px 48px 48px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onVolver} aria-label="Volver al inicio" style={btnRedondo(104)}><ArrowLeft size={48} strokeWidth={2.4} /></button>
        <div style={{ ...chip, padding: '18px 32px', fontSize: 30 }}><ShoppingBag size={34} aria-hidden="true" />Para llevar</div>
        <div style={{ width: 104 }} />
      </div>
      <h1 style={{ ...titulo(92), marginTop: 88 }}>¿Cómo te llamas?</h1>
      <p style={{ margin: '22px 0 0', fontSize: 36, lineHeight: 1.35, color: C.muted }}>Te llamaremos por tu nombre cuando tu pedido esté listo.</p>
      <div style={{ marginTop: 56, height: 176, boxSizing: 'border-box', background: '#fff', border: `4px solid ${C.ink}`, borderRadius: 36, display: 'flex', alignItems: 'center', padding: '0 44px' }}>
        <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 88, letterSpacing: -1, whiteSpace: 'pre' }}>{bonito(nombre)}</span>
        <span className="kz-caret" style={{ width: 6, height: 96, margin: '0 10px 0 6px', borderRadius: 3, background: C.terra }} />
        {!nombre && <span style={{ fontFamily: DM, fontWeight: 700, fontSize: 64, color: '#B9AE9C' }}>Tu nombre</span>}
      </div>
      <div style={{ marginTop: 'auto', background: C.card, borderRadius: 44, padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {FILAS.map((f, i) => (
          <div key={f} style={{ display: 'flex', gap: 12 }}>
            {f.split('').map((k) => tecla(k, () => onTecla(k)))}
            {i === 2 && tecla('Borrar', onBorrar, { flex: 2.4, fs: 32, bg: C.ink, color: C.bg, aria: 'Borrar la última letra' })}
          </div>
        ))}
        <div style={{ display: 'flex' }}>{tecla('Espacio', () => onTecla(' '), { fs: 32, color: C.muted })}</div>
      </div>
      <button onClick={onContinuar} disabled={!puede} style={{ ...btnPrimario(160, 52, puede), marginTop: 32, flexShrink: 0 }}>
        Continuar <ArrowRight size={52} strokeWidth={2.6} aria-hidden="true" />
      </button>
    </div>
  )
}

// ── 3. Carta ──────────────────────────────────────────────────────────────────
export function Carta({ est, nombre, categorias, catSel, onCat, productos, cantPorProd, onTocar, onCancelar, totalC, nItems, onVerPedido }) {
  const cat = categorias.find((c) => c.id === catSel)
  const lista = productos.filter((p) => p.categoria_id === catSel)
  const ordenada = [...lista.filter((p) => p.ok), ...lista.filter((p) => !p.ok)]
  return (
    <div style={{ ...abs, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '44px 40px 0', flexShrink: 0 }}>
        <Logo src={est.logo_url} lado={108} borde={4} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 48, lineHeight: 1, letterSpacing: -1 }}>{est.nombre}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 26, fontWeight: 600, color: C.muted }}>
            <ShoppingBag size={28} aria-hidden="true" />Para llevar · {bonito(nombre)}
          </div>
        </div>
        <button onClick={onCancelar} style={{ height: 88, padding: '0 30px', borderRadius: 999, background: '#fff', border: `2px solid ${C.line}`, color: C.ink, display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit', fontSize: 26, fontWeight: 700, cursor: 'pointer' }}>
          <X size={30} strokeWidth={2.4} aria-hidden="true" />Empezar de nuevo
        </button>
      </div>

      <div className="kz-sin-barra" style={{ display: 'flex', gap: 14, padding: '32px 40px 0', overflowX: 'auto', flexShrink: 0 }}>
        {categorias.map((c) => {
          const activa = c.id === catSel
          return (
            <button key={c.id} onClick={() => onCat(c.id)} style={{
              flexShrink: 0, height: 88, padding: '0 36px', borderRadius: 999,
              border: `2px solid ${activa ? C.ink : C.line}`, background: activa ? C.ink : '#fff', color: activa ? C.bg : C.muted,
              fontFamily: DM, fontWeight: 700, fontSize: 30, whiteSpace: 'nowrap', cursor: 'pointer',
            }}>{c.nombre}</button>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '32px 40px 20px', flexShrink: 0 }}>
        <h2 style={{ ...titulo(50), letterSpacing: -1 }}>{cat?.nombre || ''}</h2>
        <span style={{ fontSize: 26, fontWeight: 600, color: C.muted }}>{lista.length === 1 ? '1 producto' : `${lista.length} productos`}</span>
      </div>

      <div className="kz-sin-barra" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 40px 240px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24, alignContent: 'start' }}>
        {ordenada.map((p) => {
          const n = cantPorProd[p.id] || 0
          return (
            <div key={p.id} style={{ background: C.card, borderRadius: 30, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, opacity: p.ok ? 1 : 0.6 }}>
              <button onClick={() => onTocar(p)} disabled={!p.ok} aria-label={'Ver ' + p.nombre} style={{ position: 'relative', display: 'block', width: '100%', height: 300, padding: 0, border: 0, borderRadius: 22, overflow: 'hidden', background: C.hueco, cursor: p.ok ? 'pointer' : 'default' }}>
                <Foto src={p.img} estilo={{ width: '100%', height: '100%' }} filtro={p.ok ? 'none' : 'grayscale(1)'} />
                {!p.ok && <span style={{ position: 'absolute', top: 16, left: 16, background: C.ink, color: C.bg, borderRadius: 999, padding: '10px 22px', fontSize: 24, fontWeight: 700 }}>Agotado</span>}
                {n > 0 && <span style={{ position: 'absolute', top: 16, right: 16, minWidth: 64, height: 64, boxSizing: 'border-box', padding: '0 16px', borderRadius: 999, background: C.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DM, fontWeight: 800, fontSize: 30, boxShadow: '0 6px 16px rgba(0,0,0,0.25)' }}>{n}</span>}
              </button>
              <div className="kz-2lineas" style={{ fontFamily: DM, fontWeight: 800, fontSize: 31, lineHeight: 1.18, height: 73 }}>{p.nombre}</div>
              <div className="kz-2lineas" style={{ fontSize: 23, lineHeight: 1.35, color: C.muted, height: 62 }}>{p.descripcion}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 88 }}>
                <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 40, color: C.terra }}>{eur(p.precioC)}</div>
                {p.ok && (
                  <button onClick={() => onTocar(p)} aria-label={'Añadir ' + p.nombre} style={{ width: 88, height: 88, borderRadius: '50%', border: 0, background: C.terra, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 6px 14px rgba(0,0,0,0.18)', cursor: 'pointer' }}>
                    <Plus size={44} strokeWidth={2.8} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ position: 'absolute', left: 32, right: 32, bottom: 32, height: 172, boxSizing: 'border-box', background: C.ink, borderRadius: 44, display: 'flex', alignItems: 'center', gap: 26, padding: '0 22px 0 36px', boxShadow: '0 24px 60px rgba(26,24,21,0.38)' }}>
        <div style={{ position: 'relative', width: 96, height: 96, borderRadius: '50%', background: '#2E2A25', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ShoppingBag size={46} aria-hidden="true" />
          {nItems > 0 && <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 44, height: 44, boxSizing: 'border-box', padding: '0 10px', borderRadius: 999, background: C.terra, color: '#fff', fontFamily: DM, fontWeight: 800, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{nItems}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 600, color: 'rgba(255,255,255,0.66)' }}>
            {nItems ? `Tu pedido · ${nItems === 1 ? '1 producto' : nItems + ' productos'}` : 'Toca un producto para añadirlo'}
          </span>
          <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 48, color: '#fff' }}>{eur(totalC)}</span>
        </div>
        <button onClick={onVerPedido} disabled={!nItems} style={{ ...btnPrimario(128, 38, nItems > 0), background: nItems ? C.terra : '#4A443D', padding: '0 48px' }}>
          Ver pedido <ArrowRight size={40} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// ── 4. Ficha del producto (extras) ──────────────────────────────────────────────
export function Ficha({ p, sel, onTamano, onOp, onMas, onMenos, onAnadir, onCerrar }) {
  const falta = queFalta(p, sel)
  const totalC = precioUnidad(p, sel) * sel.cant
  const marca = (marcado, redondo) => (
    <span style={{ width: 46, height: 46, boxSizing: 'border-box', flexShrink: 0, borderRadius: redondo ? '50%' : 12, background: marcado ? C.ink : '#fff', border: `3px solid ${marcado ? C.ink : '#D9D0BF'}`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {marcado && <Check size={28} strokeWidth={3.4} aria-hidden="true" />}
    </span>
  )
  const opcion = (key, nombre, precioTxt, marcado, redondo, onClick) => (
    <button key={key} onClick={onClick} aria-pressed={marcado} style={{ minHeight: 112, boxSizing: 'border-box', borderRadius: 24, background: '#fff', border: `3px solid ${marcado ? C.ink : '#fff'}`, display: 'flex', alignItems: 'center', gap: 18, padding: '14px 22px', textAlign: 'left', fontFamily: 'inherit', color: C.ink, cursor: 'pointer' }}>
      {marca(marcado, redondo)}
      <span style={{ flex: 1, minWidth: 0, fontSize: 27, fontWeight: 600, lineHeight: 1.2 }}>{nombre}</span>
      <span style={{ flexShrink: 0, fontSize: 25, fontWeight: 700, color: C.muted }}>{precioTxt}</span>
    </button>
  )
  const cabecera = (texto, badge, oscuro) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
      <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 36 }}>{texto}</div>
      <span style={{ flexShrink: 0, borderRadius: 999, padding: '10px 22px', fontSize: 23, fontWeight: 700, background: oscuro === 'falta' ? C.ink : oscuro === 'ok' ? '#DCEFE3' : C.card, color: oscuro === 'falta' ? C.bg : oscuro === 'ok' ? '#1F6B43' : C.muted }}>{badge}</span>
    </div>
  )
  return (
    <div style={{ ...abs, zIndex: 20, background: 'rgba(26,24,21,0.62)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div className="kz-sube" style={{ height: 1760, background: C.bg, borderRadius: '52px 52px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', height: 560, flexShrink: 0, background: C.hueco }}>
          <Foto src={p.img} alt={p.nombre} estilo={{ width: '100%', height: '100%' }} />
          <button onClick={onCerrar} aria-label="Cerrar" style={{ position: 'absolute', top: 32, right: 32, width: 100, height: 100, borderRadius: '50%', border: 0, background: '#fff', color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', cursor: 'pointer' }}>
            <X size={48} strokeWidth={2.6} />
          </button>
        </div>
        <div className="kz-sin-barra" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ ...titulo(56), lineHeight: 1.08, letterSpacing: -1 }}>{p.nombre}</h2>
            {p.descripcion && <p style={{ margin: 0, fontSize: 29, lineHeight: 1.4, color: C.muted }}>{p.descripcion}</p>}
            <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 46, color: C.terra }}>{eur(p.precioC)}</div>
          </div>

          {p.tamanos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {cabecera('Tamaño', sel.tamanoId ? 'Elegido' : 'Obligatorio', sel.tamanoId ? 'ok' : 'falta')}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                {p.tamanos.map((t) => opcion(t.id, t.nombre, eur(t.precioC), sel.tamanoId === t.id, true, () => onTamano(t.id)))}
              </div>
            </div>
          )}

          {p.grupos.map((g) => {
            const elegidos = sel.ops[g.id] || []
            const badge = g.unico
              ? (elegidos.length ? 'Elegido' : 'Obligatorio')
              : (elegidos.length ? `${elegidos.length} de ${g.max}` : `Opcional · hasta ${g.max}`)
            return (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {cabecera(g.nombre, badge, g.unico ? (elegidos.length ? 'ok' : 'falta') : null)}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                  {g.opciones.map((o) => opcion(o.id, o.nombre, o.precioC > 0 ? '+' + eur(o.precioC) : '', elegidos.includes(o.id), g.unico, () => onOp(g, o.id)))}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 24, padding: '28px 48px 48px', borderTop: `2px solid ${C.line}` }}>
          <button onClick={onMenos} aria-label="Uno menos" style={btnRedondo(104)}><Minus size={44} strokeWidth={2.8} /></button>
          <div style={{ width: 72, textAlign: 'center', fontFamily: DM, fontWeight: 800, fontSize: 54 }}>{sel.cant}</div>
          <button onClick={onMas} aria-label="Uno más" style={btnRedondo(104)}><Plus size={44} strokeWidth={2.8} /></button>
          <button onClick={onAnadir} disabled={!!falta} style={{ ...btnPrimario(136, 38, !falta), flex: 1, background: falta ? '#B9AE9C' : C.terra, padding: '0 28px' }}>
            {falta || 'Añadir · ' + eur(totalC)}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cabecera de las pantallas de cierre del pedido ─────────────────────────────
function Cabecera({ textoVolver, onVolver, derecha }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <button onClick={onVolver} style={{ height: 96, padding: '0 32px 0 22px', borderRadius: 999, background: '#fff', border: `2px solid ${C.line}`, color: C.ink, display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit', fontSize: 28, fontWeight: 700, cursor: 'pointer' }}>
        <ArrowLeft size={40} strokeWidth={2.4} aria-hidden="true" />{textoVolver}
      </button>
      {derecha}
    </div>
  )
}

// ── 5. Tu pedido ────────────────────────────────────────────────────────────────
export function Resumen({ lineas, nombre, totalC, nItems, onMas, onMenos, onSeguir, onContinuar }) {
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: '56px 48px 0', display: 'flex', flexDirection: 'column' }}>
      <Cabecera textoVolver="Seguir pidiendo" onVolver={onSeguir}
        derecha={<div style={chip}><ShoppingBag size={30} aria-hidden="true" />Para llevar · {bonito(nombre)}</div>} />
      <h1 style={{ ...titulo(92), marginTop: 64 }}>Tu pedido</h1>
      <p style={{ margin: '18px 0 0', fontSize: 32, color: C.muted }}>Revisa que esté todo bien antes de seguir.</p>
      <div className="kz-sin-barra" style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 40, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {lineas.map((l) => (
          <div key={l.key} style={{ background: '#fff', borderRadius: 32, padding: 22, display: 'flex', alignItems: 'center', gap: 26 }}>
            <Foto src={l.p.img} estilo={{ width: 168, height: 168, borderRadius: 24, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 32, lineHeight: 1.15 }}>{l.p.nombre}</div>
              {l.extras && <div style={{ fontSize: 24, lineHeight: 1.35, color: C.muted }}>{l.extras}</div>}
              <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 34, color: C.terra }}>{eur(l.totalC)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: C.bg, borderRadius: 999, padding: 8 }}>
              <button onClick={() => onMenos(l.key)} aria-label={'Uno menos de ' + l.p.nombre} style={{ ...btnRedondo(80), border: 0, boxShadow: '0 2px 6px rgba(26,24,21,0.12)' }}><Minus size={36} strokeWidth={2.8} /></button>
              <span style={{ width: 52, textAlign: 'center', fontFamily: DM, fontWeight: 800, fontSize: 38 }}>{l.cant}</span>
              <button onClick={() => onMas(l.key)} aria-label={'Uno más de ' + l.p.nombre} style={{ ...btnRedondo(80), border: 0, boxShadow: '0 2px 6px rgba(26,24,21,0.12)' }}><Plus size={36} strokeWidth={2.8} /></button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flexShrink: 0, borderTop: `2px solid ${C.line}`, padding: '32px 0 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 34, fontWeight: 600, color: C.muted }}>Total · {nItems === 1 ? '1 producto' : nItems + ' productos'}</span>
          <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 76, letterSpacing: -1 }}>{eur(totalC)}</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <button onClick={onSeguir} style={{ ...btnSecundario(144, 36), flex: 1 }}>Añadir más</button>
          <button onClick={onContinuar} style={{ ...btnPrimario(144, 40), flex: 1.4 }}>Continuar <ArrowRight size={44} strokeWidth={2.6} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  )
}

// ── 6. ¿Le añades algo? ─────────────────────────────────────────────────────────
export function Sugerencia({ sugeridos, anadidos, nombre, totalC, onToggle, onVolver, onContinuar }) {
  const alguno = sugeridos.some((p) => anadidos.has(p.id))
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: '56px 48px 0', display: 'flex', flexDirection: 'column' }}>
      <Cabecera textoVolver="Volver" onVolver={onVolver}
        derecha={<div style={{ fontFamily: DM, fontWeight: 800, fontSize: 40 }}>{eur(totalC)}</div>} />
      <h1 style={{ ...titulo(80), lineHeight: 1.02, marginTop: 56 }}>¿Le añades algo, {bonito(nombre)}?</h1>
      <p style={{ margin: '18px 0 0', fontSize: 32, color: C.muted }}>Para acompañar tu pedido. Toca para añadir.</p>
      <div style={{ marginTop: 40, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
        {sugeridos.map((p) => {
          const an = anadidos.has(p.id)
          return (
            <div key={p.id} style={{ background: '#fff', borderRadius: 32, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, border: `4px solid ${an ? C.ink : '#fff'}` }}>
              <Foto src={p.img} estilo={{ height: 290, borderRadius: 24 }} />
              <div style={{ padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 76 }}>
                <div className="kz-2lineas" style={{ fontFamily: DM, fontWeight: 800, fontSize: 31, lineHeight: 1.15 }}>{p.nombre}</div>
                <div style={{ fontFamily: DM, fontWeight: 800, fontSize: 34, color: C.terra, whiteSpace: 'nowrap' }}>{eur(p.precioC)}</div>
              </div>
              <button onClick={() => onToggle(p)} aria-pressed={an} style={{ height: 104, border: 0, borderRadius: 999, background: an ? C.ink : C.card, color: an ? '#fff' : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: DM, fontWeight: 800, fontSize: 32, cursor: 'pointer' }}>
                {an ? <Check size={36} strokeWidth={3} aria-hidden="true" /> : <Plus size={36} strokeWidth={3} aria-hidden="true" />}
                {an ? 'Añadido' : 'Añadir'}
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 'auto', padding: '32px 0 48px', display: 'flex', gap: 20 }}>
        {!alguno && <button onClick={onContinuar} style={{ ...btnSecundario(144, 36), flex: 1 }}>No, gracias</button>}
        <button onClick={onContinuar} style={{ ...btnPrimario(144, 40), flex: 1.4 }}>
          {alguno ? 'Continuar · ' + eur(totalC) : 'Continuar'} <ArrowRight size={44} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// ── 7. Forma de pago ────────────────────────────────────────────────────────────
export function Pago({ pago, onPago, nombre, totalC, nItems, enviando, error, onVolver, onConfirmar }) {
  const tarjeta = (id, Icono, tituloTxt, sub) => {
    const sel = pago === id
    return (
      <button onClick={() => onPago(id)} aria-pressed={sel} disabled={enviando} style={{ height: 300, boxSizing: 'border-box', borderRadius: 44, background: '#fff', border: `5px solid ${sel ? C.ink : C.line}`, display: 'flex', alignItems: 'center', gap: 40, padding: '0 48px', textAlign: 'left', fontFamily: 'inherit', color: C.ink, cursor: 'pointer' }}>
        <span style={{ width: 168, height: 168, borderRadius: 40, flexShrink: 0, background: sel ? C.terra : C.card, color: sel ? '#fff' : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icono size={88} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 64, lineHeight: 1 }}>{tituloTxt}</span>
          <span style={{ fontSize: 32, color: C.muted }}>{sub}</span>
        </span>
        <span style={{ width: 72, height: 72, boxSizing: 'border-box', borderRadius: '50%', flexShrink: 0, border: `4px solid ${sel ? C.ink : '#D9D0BF'}`, background: sel ? C.ink : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {sel && <Check size={40} strokeWidth={3.2} aria-hidden="true" />}
        </span>
      </button>
    )
  }
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: '56px 48px 0', display: 'flex', flexDirection: 'column' }}>
      <Cabecera textoVolver="Ver mi pedido" onVolver={enviando ? () => {} : onVolver}
        derecha={<div style={chip}><ShoppingBag size={30} aria-hidden="true" />Para llevar · {bonito(nombre)}</div>} />
      <h1 style={{ ...titulo(92), marginTop: 64 }}>¿Cómo vas a pagar?</h1>
      <p style={{ margin: '18px 0 0', fontSize: 32, color: C.muted }}>El pago se hace en caja.</p>
      <div style={{ marginTop: 56, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {tarjeta('datafono', CreditCard, 'Datáfono', 'Tarjeta o móvil, en caja')}
        {tarjeta('efectivo', Banknote, 'Efectivo', 'Billetes o monedas, en caja')}
      </div>
      <div style={{ marginTop: 44, background: C.card, borderRadius: 36, padding: '36px 44px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 700 }}>{nItems === 1 ? '1 producto' : nItems + ' productos'} · Para llevar</span>
          <span style={{ fontSize: 26, color: C.muted }}>A nombre de {bonito(nombre)}</span>
        </div>
        <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 72, letterSpacing: -1 }}>{eur(totalC)}</span>
      </div>
      <div style={{ marginTop: 'auto', paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {error
          ? <div role="alert" style={{ background: '#FBE3DD', color: '#8A2A12', borderRadius: 28, padding: '22px 30px', fontSize: 28, fontWeight: 700, lineHeight: 1.35 }}>{error}</div>
          : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, fontSize: 28, fontWeight: 600, color: C.muted }}>
              <Info size={32} aria-hidden="true" />Al confirmar, tu pedido pasa a cocina.
            </div>
          )}
        <button onClick={onConfirmar} disabled={!pago || enviando} style={btnPrimario(168, 56, !!pago && !enviando)}>
          {enviando ? 'Enviando a cocina…' : 'Confirmar pedido'}
        </button>
      </div>
    </div>
  )
}

// ── 8. Pedido enviado ───────────────────────────────────────────────────────────
export function Listo({ codigo, nombre, pago, totalC, cuenta, onTerminar }) {
  const paso = (n, texto, derecha) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <span style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, background: C.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DM, fontWeight: 800, fontSize: 36 }}>{n}</span>
      <span style={{ flex: 1, fontSize: 34, fontWeight: 600, lineHeight: 1.3 }}>{texto}</span>
      {derecha}
    </div>
  )
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: '96px 64px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="kz-pop" style={{ width: 176, height: 176, borderRadius: '50%', background: C.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 18px 40px rgba(47,143,91,0.35)' }}>
        <Check size={104} strokeWidth={2.6} aria-hidden="true" />
      </div>
      <h1 style={{ ...titulo(80), lineHeight: 1.05, textAlign: 'center', marginTop: 44 }}>¡Pedido enviado<br />a cocina!</h1>
      <div style={{ marginTop: 56, width: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 48, padding: '52px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 20px 50px rgba(26,24,21,0.08)' }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 6, textTransform: 'uppercase', color: C.muted }}>Tu pedido</span>
        <span style={{ margin: '18px 0 10px', fontFamily: DM, fontWeight: 800, fontSize: 136, lineHeight: 1, letterSpacing: -2, whiteSpace: 'nowrap' }}>{codigo}</span>
        <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 64 }}>{bonito(nombre)}</span>
        <span style={{ ...chip, marginTop: 20, padding: '14px 28px', fontSize: 28 }}><ShoppingBag size={30} aria-hidden="true" />Para llevar</span>
        <div style={{ alignSelf: 'stretch', margin: '44px 0 36px', borderTop: `4px dashed ${C.hueco}` }} />
        <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 28 }}>
          {paso(1, `Pasa por caja y paga ${pago === 'efectivo' ? 'en efectivo' : 'con datáfono'}`,
            <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 44, whiteSpace: 'nowrap' }}>{eur(totalC)}</span>)}
          {paso(2, 'Te llamamos por tu nombre cuando esté listo.')}
        </div>
      </div>
      <div style={{ marginTop: 'auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <span style={{ fontSize: 28, fontWeight: 600, color: C.muted }}>Volviendo al inicio en {cuenta} s</span>
        <button onClick={onTerminar} style={{ height: 120, padding: '0 56px', border: 0, borderRadius: 999, background: C.ink, color: C.bg, fontFamily: DM, fontWeight: 800, fontSize: 36, cursor: 'pointer' }}>Terminar</button>
      </div>
    </div>
  )
}

// ── Cerrado / en pausa ──────────────────────────────────────────────────────────
export function Cerrado({ est, slides, slide, tituloTxt, sub, horarioHoy }) {
  return (
    <>
      <Fondo slides={slides} slide={slide} oscuro />
      <div style={{ ...abs, boxSizing: 'border-box', padding: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#fff' }}>
        <Logo src={est.logo_url} lado={200} />
        <h1 style={{ ...titulo(104), letterSpacing: -3, color: '#fff', marginTop: 56 }}>{tituloTxt}</h1>
        {sub && <p style={{ margin: '28px 0 0', maxWidth: 820, fontSize: 42, lineHeight: 1.35, color: 'rgba(255,255,255,0.88)' }}>{sub}</p>}
        {horarioHoy && (
          <div style={{ marginTop: 64, background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.22)', borderRadius: 36, padding: '32px 56px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Horario de hoy</span>
            <span style={{ fontFamily: DM, fontWeight: 800, fontSize: 48, color: '#fff' }}>{horarioHoy}</span>
          </div>
        )}
      </div>
    </>
  )
}

// ── Capas encima de cualquier pantalla ──────────────────────────────────────────
function Capa({ z, oscuro, children }) {
  return (
    <div style={{ ...abs, zIndex: z, boxSizing: 'border-box', padding: 64, background: oscuro ? 'rgba(18,16,14,0.88)' : 'rgba(26,24,21,0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </div>
  )
}

export function AvisoInactividad({ segundos, de, onSeguir, onReiniciar }) {
  const offset = (628.3 * (1 - segundos / de)).toFixed(1)
  return (
    <Capa z={40}>
      <div style={{ width: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 56, padding: '72px 64px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, textAlign: 'center' }}>
        <svg width="240" height="240" viewBox="0 0 240 240" role="img" aria-label={`Quedan ${segundos} segundos`}>
          <circle cx="120" cy="120" r="100" fill="none" stroke={C.card} strokeWidth="16" />
          <circle cx="120" cy="120" r="100" fill="none" stroke={C.terra} strokeWidth="16" strokeLinecap="round" strokeDasharray="628.3" strokeDashoffset={offset} transform="rotate(-90 120 120)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
          <text x="120" y="122" textAnchor="middle" dominantBaseline="middle" fontFamily="DM Sans, sans-serif" fontWeight="800" fontSize="96" fill={C.ink}>{segundos}</text>
        </svg>
        <h2 style={{ ...titulo(76), letterSpacing: -1, marginTop: 8 }}>¿Sigues ahí?</h2>
        <p style={{ margin: 0, maxWidth: 760, fontSize: 34, lineHeight: 1.4, color: C.muted }}>Si no tocas la pantalla, tu pedido se borrará y volveremos al inicio.</p>
        <div style={{ marginTop: 24, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <button onClick={onSeguir} style={btnPrimario(150, 44)}>Sí, sigo aquí</button>
          <button onClick={onReiniciar} style={btnSecundario(124, 34)}>Empezar de nuevo</button>
        </div>
      </div>
    </Capa>
  )
}

export function ConfirmarCancelar({ onNo, onSi }) {
  return (
    <Capa z={30}>
      <div style={{ width: '100%', boxSizing: 'border-box', background: C.bg, borderRadius: 52, padding: '64px 56px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h2 style={{ ...titulo(64), letterSpacing: -1 }}>¿Empezar de nuevo?</h2>
        <p style={{ margin: 0, fontSize: 32, lineHeight: 1.4, color: C.muted }}>Se borrará el pedido que llevas hecho.</p>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <button onClick={onNo} style={btnPrimario(144, 42)}>Seguir con mi pedido</button>
          <button onClick={onSi} style={btnSecundario(128, 34)}>Borrar y empezar de nuevo</button>
        </div>
      </div>
    </Capa>
  )
}

const TECLAS_PIN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancelar', '0', 'Borrar']

export function Personal({ pin, error, desbloqueado, pausado, ocupado, onTecla, onBorrar, onCancelar, onAlternarPausa, onRecargar }) {
  return (
    <Capa z={60} oscuro>
      <div style={{ width: '100%', boxSizing: 'border-box', background: C.bg, borderRadius: 56, padding: '64px 64px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, textAlign: 'center' }}>
        <span style={{ width: 128, height: 128, borderRadius: '50%', background: C.ink, color: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lock size={60} aria-hidden="true" />
        </span>
        {!desbloqueado ? (
          <>
            <h2 style={{ ...titulo(60), letterSpacing: -1 }}>Acceso del personal</h2>
            <p style={{ margin: 0, fontSize: 30, lineHeight: 1.4, color: C.muted }}>Introduce el PIN para pausar el kiosko.</p>
            <div style={{ display: 'flex', gap: 28, margin: '12px 0' }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{ width: 40, height: 40, boxSizing: 'border-box', borderRadius: '50%', border: `4px solid ${C.ink}`, background: i < pin.length ? C.ink : 'transparent' }} />
              ))}
            </div>
            {error && <span role="alert" style={{ fontSize: 28, fontWeight: 700, color: '#B3261E' }}>PIN incorrecto. Prueba otra vez.</span>}
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>
              {TECLAS_PIN.map((t) => {
                const texto = t === 'Cancelar' || t === 'Borrar'
                return (
                  <button key={t} aria-label={t}
                    onClick={t === 'Cancelar' ? onCancelar : t === 'Borrar' ? onBorrar : () => onTecla(t)}
                    style={{ height: 132, border: 0, borderRadius: 28, background: texto ? 'transparent' : '#fff', color: texto ? C.muted : C.ink, boxShadow: texto ? 'none' : '0 4px 0 rgba(26,24,21,0.1)', fontFamily: DM, fontWeight: 800, fontSize: texto ? 28 : 54, cursor: 'pointer' }}>
                    {t}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <h2 style={{ ...titulo(60), letterSpacing: -1 }}>Kiosko</h2>
            <p style={{ margin: 0, fontSize: 30, lineHeight: 1.4, color: C.muted }}>
              {pausado ? 'El kiosko está en pausa: los clientes ven «Pide en caja».' : 'El kiosko está funcionando.'}
            </p>
            <div style={{ marginTop: 16, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <button onClick={onAlternarPausa} disabled={ocupado} style={{ ...btnPrimario(144, 40), background: C.ink, color: C.bg }}>
                {pausado ? <Play size={40} aria-hidden="true" /> : <Pause size={40} aria-hidden="true" />}
                {pausado ? 'Reanudar el kiosko' : 'Pausar el kiosko'}
              </button>
              <button onClick={onRecargar} style={{ ...btnSecundario(124, 34), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <RefreshCw size={34} aria-hidden="true" />Recargar la carta
              </button>
              <button onClick={onCancelar} style={btnSecundario(124, 34)}>Volver al kiosko</button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 26, color: C.muted }}>Los pedidos que ya están en cocina no se tocan.</p>
          </>
        )}
      </div>
    </Capa>
  )
}

// Acceso del restaurante, SOLO para quien monta el kiosko. Va aquí y no en el login
// del panel a propósito: entrar por el panel registraría este navegador para los avisos
// de "pedido nuevo", y la pantalla del cliente acabaría enseñándolos.
export function Acceso({ entrando, error, onEntrar }) {
  const campo = {
    height: 120, boxSizing: 'border-box', width: '100%', borderRadius: 28, border: `3px solid ${C.line}`,
    background: '#fff', padding: '0 32px', fontSize: 40, fontFamily: 'inherit', color: C.ink, outline: 'none',
    userSelect: 'text', WebkitUserSelect: 'text',
  }
  const enviar = (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onEntrar(String(f.get('email') || '').trim(), String(f.get('clave') || ''))
  }
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
      <h1 style={{ ...titulo(80), letterSpacing: -2 }}>Activa este kiosko</h1>
      <p style={{ margin: 0, fontSize: 32, lineHeight: 1.4, color: C.muted }}>
        Entra con la cuenta del restaurante. Solo hace falta la primera vez: este aparato la recordará.
      </p>
      <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
        <label style={{ fontSize: 28, fontWeight: 700 }} htmlFor="kz-email">Correo del restaurante</label>
        <input id="kz-email" name="email" type="email" autoComplete="username" required style={campo} />
        <label style={{ fontSize: 28, fontWeight: 700 }} htmlFor="kz-clave">Contraseña</label>
        <input id="kz-clave" name="clave" type="password" autoComplete="current-password" required style={campo} />
        {error && <div role="alert" style={{ background: '#FBE3DD', color: '#8A2A12', borderRadius: 24, padding: '20px 28px', fontSize: 28, fontWeight: 700 }}>{error}</div>}
        <button type="submit" disabled={entrando} style={{ ...btnPrimario(140, 44, !entrando), marginTop: 16 }}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

// Pantalla de aviso para el que monta el kiosko (sin sesión, módulo apagado…).
export function Aviso({ tituloTxt, texto, accion, onAccion }) {
  return (
    <div style={{ ...abs, boxSizing: 'border-box', padding: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 32 }}>
      <h1 style={{ ...titulo(80), letterSpacing: -2 }}>{tituloTxt}</h1>
      {texto && <p style={{ margin: 0, fontSize: 36, lineHeight: 1.4, color: C.muted, maxWidth: 860 }}>{texto}</p>}
      {accion && <button onClick={onAccion} style={{ ...btnPrimario(140, 40), marginTop: 24 }}>{accion}</button>}
    </div>
  )
}

export { textoExtras }
