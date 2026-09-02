// El almacén EN LA TABLET, dentro del TPV.
//
// Aquí va SOLO lo del servicio: ver qué queda, apuntar una merma y hacer recuento.
// Dar de alta artículos y escribir escandallos es trabajo de escritorio y vive en el
// panel web — hacerlo con el dedo en el mostrador es inviable, y meterlo en la APK
// obligaría a compilar un AAB por cada retoque de pantalla.
//
// NADA de aquí bloquea una venta. Ni avisa siquiera al cobrar: el mostrador no se
// frena por falta de existencias, esa es la regla del módulo.
//
// Las cuentas NO se hacen en la tablet: se piden al servidor por RPC. Si se hicieran
// aquí, un recuento podría guardarse "cuadrado" sin serlo.
import { useState, useEffect } from 'react'
import { Search, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import { T, FONT, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { cantidad, apuntarMerma, recuentoLote, MOTIVOS_MERMA } from '../lib/stock'

const VISTAS = [
  { id: 'existencias', label: 'Existencias' },
  { id: 'merma', label: 'Merma' },
  { id: 'recuento', label: 'Recuento' },
]

export default function TpvStock({ establecimientoId, vistaInicial = 'existencias' }) {
  const [vista, setVista] = useState(vistaInicial)
  const [arts, setArts] = useState([])
  const [busca, setBusca] = useState('')
  const [cargando, setCargando] = useState(true)
  const [refresco, setRefresco] = useState(0)

  // merma
  const [elegido, setElegido] = useState(null)
  const [cant, setCant] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS_MERMA[0])
  // recuento
  const [conteos, setConteos] = useState({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!establecimientoId) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('stock_articulos')
        .select('id, nombre, unidad, existencia, coste_medio, minimo')
        .eq('establecimiento_id', establecimientoId).eq('activo', true).order('nombre')
      if (!vivo) return
      setArts(data || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [establecimientoId, refresco])

  const visibles = busca.trim()
    ? arts.filter(a => a.nombre.toLowerCase().includes(busca.trim().toLowerCase()))
    : arts

  const num = (v) => Number(String(v ?? '').replace(',', '.'))

  async function guardarMerma() {
    const n = num(cant)
    if (!elegido || !(n > 0)) return toast('Elige qué se ha perdido y pon cuánto', 'error')
    setGuardando(true)
    try {
      await apuntarMerma(elegido.id, n, motivo)
      toast('Merma apuntada', 'success')
      setElegido(null); setCant(''); setRefresco(x => x + 1); setVista('existencias')
    } catch (e) { toast(e.message, 'error') }
    setGuardando(false)
  }

  async function guardarRecuento() {
    const lineas = Object.entries(conteos)
      .filter(([, v]) => v !== '' && !Number.isNaN(num(v)) && num(v) >= 0)
      .map(([id, v]) => ({ articulo_id: id, contado: num(v), coste: null }))
    if (!lineas.length) return toast('No has contado nada todavía', 'error')
    setGuardando(true)
    try {
      const n = await recuentoLote(lineas)
      toast(`Recuento guardado (${n} artículo${n === 1 ? '' : 's'})`, 'success')
      setConteos({}); setRefresco(x => x + 1); setVista('existencias')
    } catch (e) { toast(e.message, 'error') }
    setGuardando(false)
  }

  return (
    <div style={{ fontFamily: FONT, color: T.text }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {VISTAS.map(v => (
          <button key={v.id} onClick={() => setVista(v.id)} style={{
            ...btnSecundario, height: 40,
            background: vista === v.id ? T.accentFill : T.surface2,
            color: vista === v.id ? T.onAccent : T.text,
            borderColor: vista === v.id ? T.accentFill : T.border,
            fontWeight: vista === v.id ? 800 : 600,
          }}>{v.label}</button>
        ))}
      </div>

      {cargando && <div style={{ color: T.muted, padding: 26, textAlign: 'center' }}>Cargando…</div>}

      {!cargando && !arts.length && (
        <div style={{ color: T.muted, padding: 26, textAlign: 'center', lineHeight: 1.6 }}>
          Todavía no hay nada en el almacén.<br />
          Lo que compras (pan, carne, queso) se da de alta desde el ordenador, en Almacén.
        </div>
      )}

      {!cargando && !!arts.length && (
        <>
          {vista !== 'merma' && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={17} color={T.muted}
                style={{ position: 'absolute', left: 13, top: 15, pointerEvents: 'none' }} />
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar…" style={{ ...inputOscuro, paddingLeft: 40 }} />
            </div>
          )}

          {/* ── EXISTENCIAS ── */}
          {vista === 'existencias' && (
            <div style={{ maxHeight: '54vh', overflowY: 'auto' }}>
              {visibles.map(a => {
                const ex = Number(a.existencia)
                const negativo = ex < 0
                const bajo = !negativo && Number(a.minimo) > 0 && ex <= Number(a.minimo)
                return (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    borderBottom: `1px solid ${T.border}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>
                      {a.nombre}
                      {bajo && (
                        <span style={{ color: T.muted, fontSize: 12, marginLeft: 8 }}>
                          bajo mínimo
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                      color: negativo ? T.danger : ex === 0 ? T.muted : T.text,
                    }}>
                      {cantidad(ex, a.unidad)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── MERMA ── */}
          {vista === 'merma' && (
            <div>
              {!elegido ? (
                <>
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <Search size={17} color={T.muted}
                      style={{ position: 'absolute', left: 13, top: 15, pointerEvents: 'none' }} />
                    <input value={busca} onChange={e => setBusca(e.target.value)}
                      placeholder="¿Qué se ha perdido?" style={{ ...inputOscuro, paddingLeft: 40 }} />
                  </div>
                  <div style={{ maxHeight: '48vh', overflowY: 'auto' }}>
                    {visibles.map(a => (
                      <button key={a.id} onClick={() => { setElegido(a); setBusca('') }} style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 12,
                        padding: '14px', border: 'none', borderBottom: `1px solid ${T.border}`,
                        background: 'transparent', color: T.text, fontFamily: 'inherit',
                        fontSize: 16, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                      }}>
                        <span style={{ flex: 1 }}>{a.nombre}</span>
                        <span style={{ color: T.muted, fontVariantNumeric: 'tabular-nums' }}>
                          {cantidad(a.existencia, a.unidad)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>{elegido.nombre}</div>
                  <div style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>
                    Quedan {cantidad(elegido.existencia, elegido.unidad)}
                  </div>

                  <div style={{ color: T.muted, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    CUÁNTO SE HA PERDIDO
                  </div>
                  <input autoFocus inputMode="decimal" value={cant}
                    onChange={e => setCant(e.target.value.replace(/[^\d.,]/g, ''))}
                    placeholder="0"
                    style={{ ...inputOscuro, height: 62, fontSize: 26, fontWeight: 800, textAlign: 'right' }} />

                  <div style={{ color: T.muted, fontSize: 12, fontWeight: 700, margin: '18px 0 6px' }}>
                    QUÉ HA PASADO
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {MOTIVOS_MERMA.map(m => (
                      <button key={m} onClick={() => setMotivo(m)} style={{
                        ...btnSecundario, height: 42,
                        background: motivo === m ? T.accentFill : T.surface2,
                        color: motivo === m ? T.onAccent : T.text,
                        borderColor: motivo === m ? T.accentFill : T.border,
                      }}>{m}</button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                    <button onClick={() => { setElegido(null); setCant('') }}
                      style={{ ...btnSecundario, flex: 1, height: 54 }}>Atrás</button>
                    <button onClick={guardarMerma} disabled={guardando}
                      style={{ ...btnAccion, flex: 2, height: 54, fontSize: 17 }}>
                      {guardando ? 'Guardando…' : 'Apuntar merma'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── RECUENTO ── */}
          {vista === 'recuento' && (
            <div>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12,
                padding: '10px 12px', borderRadius: 10, background: T.surface2,
                color: T.muted, fontSize: 13, lineHeight: 1.5,
              }}>
                <TriangleAlert size={15} color={T.accent} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  Cuenta primero y mira después lo que debería haber: si lo miras antes,
                  cuadra siempre y no sirve de nada.
                </div>
              </div>

              <div style={{ maxHeight: '44vh', overflowY: 'auto' }}>
                {visibles.map(a => {
                  const v = conteos[a.id]
                  const dif = v !== undefined && v !== '' && !Number.isNaN(num(v))
                    ? num(v) - Number(a.existencia) : null
                  return (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>
                        {a.nombre}
                        {dif !== null && dif !== 0 && (
                          <div style={{
                            fontSize: 12, marginTop: 2, fontWeight: 700,
                            color: dif > 0 ? T.ok : T.danger,
                          }}>
                            {dif > 0 ? '+' : '−'}{cantidad(Math.abs(dif), a.unidad)} respecto a lo apuntado
                          </div>
                        )}
                      </div>
                      <input inputMode="decimal" value={v ?? ''}
                        onChange={e => setConteos({ ...conteos, [a.id]: e.target.value.replace(/[^\d.,]/g, '') })}
                        placeholder={String(Number(a.existencia))}
                        style={{ ...inputOscuro, width: 96, height: 44, textAlign: 'right', fontSize: 17 }} />
                    </div>
                  )
                })}
              </div>

              <button onClick={guardarRecuento} disabled={guardando}
                style={{ ...btnAccion, width: '100%', height: 56, fontSize: 17, marginTop: 16 }}>
                {guardando ? 'Guardando…' : 'Guardar el recuento'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
