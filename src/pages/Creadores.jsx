import { useState, useEffect, useCallback } from 'react'
import { Video, ExternalLink, Plus, Trash2, Pencil, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'
import { toast, confirmar } from '../App'

// Pidoo Creadores — pantalla del restaurante.
//
// Dos interruptores distintos y NO son lo mismo:
//   · `programa_activo`        lo enciende Pidoo. Congelado aquí por el trigger
//                              `creadores_config_guard` (PD130).
//   · `pausado_por_restaurante` es el suyo: pausa la entrada de vídeos nuevos.
//     Las participaciones ya en curso siguen contando (regla 5).
//
// El editor de la escalera es donde el restaurante se puede arruinar solo, así
// que las validaciones no viven aquí: el servidor las impone (PD131 coste por
// debajo del mínimo creíble, PD132 escalera desordenada, PD133 producto ajeno).
// Aquí solo se traducen a un mensaje legible.
//
// ⚠️ EL DUEÑO NUNCA VE NI TOCA EL "NIVEL". Se guarda la escalera ENTERA por
// `creadores_guardar_escalera`, que ordena por visualizaciones y renumera. Antes
// esto se hacía con INSERT/UPDATE fila a fila y el nivel salía de "el último +1":
// con eso, meter un premio de entrada MÁS BARATO por delante de los que ya
// existían era imposible (chocaba con el unique de nivel y con PD132). Que es
// justo lo que un restaurante quiere hacer el primer día.

const ESTADOS = {
  activa:               { label: 'En juego',    bg: colors.terracottaSoft, color: colors.terracotta2 },
  premiada:             { label: 'Premiada',    bg: colors.sageSoft,       color: colors.sage2 },
  en_espera_tope:       { label: 'Espera tope', bg: colors.warningSoft,    color: colors.warning },
  caducada:             { label: 'Caducada',    bg: colors.cream2,         color: colors.stone },
  rechazada:            { label: 'Rechazada',   bg: colors.dangerSoft,     color: colors.danger },
  pendiente_validacion: { label: 'Sin validar', bg: colors.cream2,         color: colors.stone },
}

const TIPOS = [
  { id: 'descuento_fijo',  label: '€ de descuento', ayuda: 'Una cantidad fija en euros' },
  { id: 'porcentaje',      label: '% del pedido',   ayuda: 'Un porcentaje sobre la comida' },
  { id: 'envio_gratis',    label: 'Envío gratis',   ayuda: 'Le cubres el envío hasta el importe que pongas' },
  { id: 'producto_gratis', label: 'Producto gratis', ayuda: 'Un descuento por el precio de ese producto' },
]

const fmtEur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
const fmtNum = (n) => Number(n || 0).toLocaleString('es-ES')

// Los errores del servidor llegan con su código; se traducen para que el dueño
// entienda qué hacer en vez de leer un PDxxx.
function traducirError(err) {
  const m = err?.message || ''
  if (m.includes('PD130') || m.includes('lo activa Pidoo')) return 'El programa lo activa Pidoo. Tú puedes pausarlo y reanudarlo.'
  if (m.includes('coste de este premio')) return m
  if (m.includes('choca con el nivel')) return m
  if (m.includes('no es de este restaurante')) return 'Ese producto no es de tu carta.'
  if (m.includes('gasto del mes')) return 'El gasto del mes lo lleva el sistema.'
  // Los del guardado completo (PD158-PD160) ya vienen en cristiano del servidor.
  return m || 'No se ha podido guardar'
}

export default function Creadores() {
  const { restaurante } = useRest()
  const [cfg, setCfg] = useState(null)
  const [escalera, setEscalera] = useState([])
  const [parts, setParts] = useState([])
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('videos')
  const [form, setForm] = useState(null)   // escalón en edición
  const [topeInput, setTopeInput] = useState('')

  const estId = restaurante?.id

  const cargar = useCallback(async () => {
    if (!estId) return
    const [c, e, p, pr] = await Promise.all([
      supabase.from('creadores_config').select('*').eq('establecimiento_id', estId).maybeSingle(),
      supabase.from('escalera_premios').select('*').eq('establecimiento_id', estId).order('nivel'),
      supabase.from('participaciones_creador')
        .select('id, estado, red, share_url, views_actual, nivel_alcanzado, created_at, motivo_rechazo, usuario_id, usuarios(nombre)')
        .eq('establecimiento_id', estId).order('created_at', { ascending: false }).limit(120),
      supabase.from('productos').select('id, nombre, precio').eq('establecimiento_id', estId).eq('disponible', true).order('nombre'),
    ])
    setCfg(c.data || null)
    setEscalera(e.data || [])
    setParts(p.data || [])
    setProductos(pr.data || [])
    setTopeInput(c.data?.tope_mensual_euros != null ? String(c.data.tope_mensual_euros) : '')
    setLoading(false)
  }, [estId])

  // Polling, no realtime: estas tablas no están en la publicación
  // `supabase_realtime`, así que suscribirse no daría ni un evento.
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 45000)
    return () => clearInterval(t)
  }, [cargar])

  async function togglePausa() {
    setBusy(true)
    const nuevo = !cfg?.pausado_por_restaurante
    const { error } = await supabase.from('creadores_config')
      .update({ pausado_por_restaurante: nuevo })
      .eq('establecimiento_id', estId)
    setBusy(false)
    if (error) return toast(traducirError(error))
    toast(nuevo ? 'Programa pausado. No entrarán vídeos nuevos.' : 'Programa reanudado', 'success')
    cargar()
  }

  async function guardarTope() {
    const v = topeInput.trim() === '' ? null : Number(topeInput.replace(',', '.'))
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return toast('El tope tiene que ser mayor que 0')
    if (v !== null && v > 5000) return toast('El tope máximo son 5.000 € al mes')
    setBusy(true)
    const { error } = await supabase.from('creadores_config')
      .update({ tope_mensual_euros: v }).eq('establecimiento_id', estId)
    setBusy(false)
    if (error) return toast(traducirError(error))
    toast(v === null ? 'Tope mensual quitado' : `Tope puesto en ${fmtEur(v)} al mes`, 'success')
    cargar()
  }

  // La escalera se guarda SIEMPRE entera. El servidor la ordena por
  // visualizaciones y pone los niveles: aquí no se calcula ninguno.
  const aPayload = (e) => ({
    views_necesarias: Number(e.views_necesarias),
    tipo_premio: e.tipo_premio,
    valor: (e.tipo_premio === 'descuento_fijo' || e.tipo_premio === 'porcentaje') ? Number(e.valor) : null,
    producto_id: e.tipo_premio === 'producto_gratis' ? (e.producto_id || null) : null,
    descripcion: (e.descripcion || '').trim(),
    coste_estimado: Number(e.coste_estimado),
    activo: e.activo !== false,
  })

  async function guardarEscalera(lista, mensajeOk) {
    setBusy(true)
    const { error } = await supabase.rpc('creadores_guardar_escalera', {
      p_establecimiento_id: estId,
      p_escalones: lista.map(aPayload),
    })
    setBusy(false)
    if (error) return toast(traducirError(error))
    toast(mensajeOk, 'success')
    setForm(null)
    cargar()
  }

  async function guardarEscalon() {
    const f = form
    if (!f.descripcion?.trim()) return toast('Ponle un nombre al premio, es lo que verá el cliente')
    // Al editar se sustituye el que ya estaba; al crear, `f.id` es undefined y
    // no se quita ninguno.
    const resto = escalera.filter(e => e.id !== f.id)
    await guardarEscalera([...resto, f], 'Premio guardado')
  }

  async function borrarEscalon(id) {
    // Un programa encendido sin ningún premio deja a los clientes grabando
    // vídeos que no pueden ganar nada. Para eso está la pausa, no el vaciado.
    if (escalera.length <= 1) {
      return toast('Tiene que quedarte al menos un premio. Si ahora no quieres dar ninguno, pausa el programa arriba.')
    }
    if (!await confirmar('¿Quitar este premio? Los que ya has entregado no se tocan.')) return
    await guardarEscalera(escalera.filter(e => e.id !== id), 'Premio eliminado')
  }

  async function rechazar(p) {
    const motivo = window.prompt('¿Por qué rechazas este vídeo? (lo verá Pidoo)')
    if (motivo === null) return
    if (motivo.trim().length < 3) return toast('Explica un poco el motivo')
    setBusy(true)
    const { error } = await supabase.rpc('rechazar_participacion_creador', {
      p_participacion_id: p.id, p_motivo: motivo.trim(),
    })
    setBusy(false)
    if (error) return toast(traducirError(error))
    toast('Vídeo rechazado', 'success')
    cargar()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: colors.stone }}>Cargando…</div>

  // ── El programa lo enciende Pidoo. Mientras esté apagado, esto es una página
  //    informativa, no un editor a medias.
  if (!cfg?.programa_activo) {
    return (
      <div style={{ maxWidth: 620 }}>
        <Cabecera />
        <div style={{ ...ds.card, marginTop: 16, padding: 22 }}>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>
            Todavía no lo tienes activado
          </div>
          <p style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.6, marginTop: 0 }}>
            Pidoo Creadores convierte a tus clientes en quienes te hacen publicidad: graban un
            vídeo de su pedido en TikTok o Instagram y, según las visualizaciones que consigan,
            se llevan un descuento para su <strong>siguiente pedido en tu restaurante</strong>.
            No es un código que tengas que canjear en el mostrador: el descuento se aplica solo
            dentro de la app, así que a ti no te da ningún trabajo.
          </p>
          <p style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.6 }}>
            Va incluido en tu alta, sin cuota. Tú decides los premios, lo que estás dispuesto a
            gastar al mes, y puedes pausarlo cuando quieras. <strong>Los premios los pagas tú</strong>,
            así que la escalera la marcas tú.
          </p>
          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 10,
            background: colors.cream2, fontSize: type.xs, color: colors.stone, lineHeight: 1.5,
          }}>
            Para activarlo, escríbenos por Soporte y lo encendemos nosotros.
          </div>
        </div>
      </div>
    )
  }

  const pausado = !!cfg.pausado_por_restaurante
  const gasto = Number(cfg.gasto_mes_actual || 0)
  const tope = cfg.tope_mensual_euros != null ? Number(cfg.tope_mensual_euros) : null
  const enJuego = parts.filter(p => p.estado === 'activa' || p.estado === 'en_espera_tope')
  const alcance = parts.reduce((s, p) => s + (p.views_actual || 0), 0)
  const premiadas = parts.filter(p => p.estado === 'premiada')

  return (
    <div>
      <Cabecera />

      {/* Pausa */}
      <div style={{
        ...ds.card, marginTop: 14, display: 'flex', alignItems: 'center', gap: 14,
        borderColor: pausado ? colors.warning : colors.border,
        background: pausado ? colors.warningSoft : colors.paper,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink }}>
            {pausado ? 'Pausado' : 'Funcionando'}
          </div>
          <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
            {pausado
              ? 'No entran vídeos nuevos. Los que ya están en juego siguen contando.'
              : 'Tus clientes pueden registrar vídeos de sus pedidos.'}
          </div>
        </div>
        <button onClick={togglePausa} disabled={busy} aria-pressed={!pausado} style={{
          width: 48, height: 28, borderRadius: 14, border: 'none', flexShrink: 0,
          background: pausado ? colors.cream2 : colors.sage,
          cursor: busy ? 'not-allowed' : 'pointer', position: 'relative', padding: 0,
        }}>
          <span style={{
            position: 'absolute', top: 3, left: pausado ? 3 : 23, width: 22, height: 22,
            borderRadius: 11, background: '#fff', transition: 'left 0.2s',
            boxShadow: '0 1px 2px rgba(26,24,21,0.2)',
          }} />
        </button>
      </div>

      {/* Resumen del mes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 14 }}>
        <Stat label="Vídeos en juego" value={fmtNum(enJuego.length)} />
        <Stat label="Alcance total" value={fmtNum(alcance)} sub="visualizaciones" />
        <Stat label="Premios dados" value={fmtNum(premiadas.length)} />
        <Stat label="Gasto este mes" value={fmtEur(gasto)} sub={tope != null ? `de ${fmtEur(tope)}` : 'sin tope'}
              alerta={tope != null && gasto >= tope} />
      </div>

      {tope != null && gasto >= tope && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10,
          background: colors.warningSoft, border: `1px solid ${colors.warning}`,
          fontSize: type.xs, color: colors.ink, lineHeight: 1.5,
        }}>
          Has llegado a tu tope de este mes. Los vídeos que crucen un escalón quedan en espera
          y cobrarán su premio el mes que viene: <strong>no se pierden</strong>. Si quieres que
          sigan cobrando ahora, sube el tope aquí abajo.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginTop: 20, borderBottom: `1px solid ${colors.border}` }}>
        {[
          { id: 'videos', label: `Vídeos (${parts.length})` },
          { id: 'premios', label: `Premios (${escalera.length})` },
          { id: 'ajustes', label: 'Límite de gasto' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 14px', border: 'none', background: 'transparent',
            color: tab === t.id ? colors.ink : colors.stone,
            fontSize: type.sm, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            borderBottom: `2px solid ${tab === t.id ? colors.terracotta : 'transparent'}`,
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── VÍDEOS ── */}
      {tab === 'videos' && (
        <div style={{ marginTop: 16 }}>
          {parts.length === 0 ? (
            <Vacio texto="Todavía no ha grabado nadie. En cuanto un cliente registre un vídeo de un pedido tuyo, aparecerá aquí." />
          ) : parts.map(p => {
            const e = ESTADOS[p.estado] || ESTADOS.activa
            return (
              <div key={p.id} style={{
                ...ds.card, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink }}>
                    {p.usuarios?.nombre || 'Cliente'}
                  </div>
                  <a href={p.share_url} target="_blank" rel="noopener noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2,
                    fontSize: type.xs, color: colors.terracotta, textDecoration: 'none', fontWeight: 600,
                  }}>
                    Ver el vídeo en {p.red === 'instagram' ? 'Instagram' : 'TikTok'} <ExternalLink size={11} />
                  </a>
                </div>
                <div style={{ textAlign: 'right', minWidth: 90 }}>
                  <div style={{ fontSize: type.base, fontWeight: 800, color: colors.ink }}>{fmtNum(p.views_actual)}</div>
                  <div style={{ fontSize: 10.5, color: colors.stone, textTransform: 'uppercase', letterSpacing: '0.04em' }}>visualizaciones</div>
                </div>
                <span style={{ ...ds.badge, background: e.bg, color: e.color, flexShrink: 0 }}>{e.label}</span>
                {(p.estado === 'activa' || p.estado === 'en_espera_tope') && (
                  <button onClick={() => rechazar(p)} disabled={busy} style={{ ...ds.miniBtnDanger, flexShrink: 0 }}>
                    No es de mi local
                  </button>
                )}
                {p.estado === 'rechazada' && p.motivo_rechazo && (
                  <span style={{ fontSize: type.xxs, color: colors.stone, flexBasis: '100%' }}>
                    Motivo: {p.motivo_rechazo}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── PREMIOS ── */}
      {tab === 'premios' && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            background: colors.cream2, fontSize: type.xs, color: colors.stone, lineHeight: 1.5,
            display: 'flex', gap: 8,
          }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>Estos premios los pagas tú.</strong> El coste que declares es el que cuenta
              para tu límite del mes, así que ponlo de verdad. La mayoría de vídeos se queda en el
              primer escalón: hazlo barato y fácil, ahí está el volumen.
              <br />
              Créalos en el orden que quieras: <strong>se ordenan solos</strong> de menos a más
              visualizaciones.
            </span>
          </div>

          {escalera.map(e => (
            <div key={e.id} style={{ ...ds.card, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, opacity: e.activo ? 1 : 0.5 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: colors.terracottaSoft, color: colors.terracotta2,
                display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
              }}>{e.nivel}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink }}>{e.descripcion}</div>
                <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
                  A partir de {fmtNum(e.views_necesarias)} visualizaciones · te cuesta {fmtEur(e.coste_estimado)}
                </div>
              </div>
              <button onClick={() => setForm({ ...e })} style={ds.miniBtn}><Pencil size={13} /></button>
              <button onClick={() => borrarEscalon(e.id)} style={ds.miniBtnDanger}><Trash2 size={13} /></button>
            </div>
          ))}

          {escalera.length < 5 && !form && (
            <button
              onClick={() => setForm({
                views_necesarias: (escalera.at(-1)?.views_necesarias || 0) * 4 || 200,
                tipo_premio: 'descuento_fijo', valor: 2, descripcion: '', coste_estimado: 2, activo: true,
              })}
              style={{ ...ds.secondaryBtn, marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Añadir premio
            </button>
          )}

          {form && (
            <div style={{ ...ds.card, marginTop: 10, borderColor: colors.terracotta }}>
              <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, marginBottom: 12 }}>
                {form.id ? 'Editar premio' : 'Nuevo premio'}
              </div>

              <label style={ds.label}>Tipo de premio</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 8, marginBottom: 12 }}>
                {TIPOS.map(t => (
                  <button key={t.id} onClick={() => setForm(f => ({ ...f, tipo_premio: t.id, valor: t.id === 'porcentaje' ? 10 : 2 }))}
                    style={{
                      padding: '9px 10px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                      border: `1.5px solid ${form.tipo_premio === t.id ? colors.terracotta : colors.border}`,
                      background: form.tipo_premio === t.id ? colors.terracottaSoft : colors.paper,
                      fontFamily: 'inherit',
                    }}>
                    <div style={{ fontSize: type.xs, fontWeight: 700, color: colors.ink }}>{t.label}</div>
                    <div style={{ fontSize: 10.5, color: colors.stone, marginTop: 1 }}>{t.ayuda}</div>
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
                <div>
                  <label style={ds.label}>Visualizaciones necesarias (mín. 100)</label>
                  <input style={ds.formInput} type="number" min={100} value={form.views_necesarias}
                         onChange={e => setForm(f => ({ ...f, views_necesarias: e.target.value }))} />
                </div>

                {(form.tipo_premio === 'descuento_fijo' || form.tipo_premio === 'porcentaje') && (
                  <div>
                    <label style={ds.label}>{form.tipo_premio === 'porcentaje' ? 'Porcentaje (máx. 50)' : 'Euros (máx. 25)'}</label>
                    <input style={ds.formInput} type="number" step="0.5" value={form.valor}
                           onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
                  </div>
                )}

                {form.tipo_premio === 'producto_gratis' && (
                  <div>
                    <label style={ds.label}>Producto</label>
                    <select style={ds.select} value={form.producto_id || ''}
                            onChange={e => {
                              const p = productos.find(x => x.id === e.target.value)
                              setForm(f => ({ ...f, producto_id: e.target.value, coste_estimado: p?.precio ?? f.coste_estimado }))
                            }}>
                      <option value="">— Elige —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre} ({fmtEur(p.precio)})</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label style={ds.label}>Lo que te cuesta</label>
                  <input style={ds.formInput} type="number" step="0.5" value={form.coste_estimado}
                         onChange={e => setForm(f => ({ ...f, coste_estimado: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label style={ds.label}>Cómo lo verá el cliente</label>
                <input style={ds.formInput} maxLength={80} placeholder="Bebida gratis en tu próximo pedido"
                       value={form.descripcion}
                       onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                <button onClick={() => setForm(null)} style={ds.secondaryBtn} disabled={busy}>Cancelar</button>
                <button onClick={guardarEscalon} style={ds.primaryBtn} disabled={busy}>
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LÍMITE DE GASTO ── */}
      {tab === 'ajustes' && (
        <div style={{ ...ds.card, marginTop: 16, maxWidth: 460 }}>
          <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
            Cuánto estás dispuesto a gastar al mes
          </div>
          <p style={{ fontSize: type.xs, color: colors.stone, lineHeight: 1.55, marginTop: 0 }}>
            Cuando el coste de los premios de un mes llega a este límite, dejan de entregarse
            hasta el mes siguiente. Los vídeos que estaban a punto de ganar <strong>no se pierden</strong>:
            quedan en espera y cobran cuando entra el mes nuevo. Déjalo vacío si no quieres límite.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={ds.label}>Límite mensual (€)</label>
              <input style={ds.formInput} type="number" step="5" min="1" placeholder="Sin límite"
                     value={topeInput} onChange={e => setTopeInput(e.target.value)} />
            </div>
            <button onClick={guardarTope} style={ds.primaryBtn} disabled={busy}>Guardar</button>
          </div>
          <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 10 }}>
            Llevas gastados <strong>{fmtEur(gasto)}</strong> este mes.
          </div>
        </div>
      )}
    </div>
  )
}

function Cabecera() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Video size={19} color={colors.terracotta} />
        <h1 style={{ ...ds.h1, margin: 0 }}>Creadores</h1>
      </div>
      <p style={{ fontSize: type.sm, color: colors.stone, marginTop: 6, marginBottom: 0, maxWidth: 640, lineHeight: 1.55 }}>
        Tus clientes graban un vídeo de su pedido y, según las visualizaciones que consigan,
        se llevan un descuento para la próxima vez que te pidan.
      </p>
    </div>
  )
}

function Stat({ label, value, sub, alerta }) {
  return (
    <div style={{
      ...ds.card,
      borderColor: alerta ? colors.warning : colors.border,
      background: alerta ? colors.warningSoft : colors.paper,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: colors.stone, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: colors.ink, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Vacio({ texto }) {
  return (
    <div style={{ ...ds.card, textAlign: 'center', padding: 34 }}>
      <Video size={26} color={colors.stone2} style={{ marginBottom: 8 }} />
      <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5, maxWidth: 380, margin: '0 auto' }}>{texto}</div>
    </div>
  )
}
