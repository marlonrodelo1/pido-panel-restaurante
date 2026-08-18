/* ──────────────────────────────────────────────────────────────────────────
 * MesasPanel — las mesas del local y sus carteles.
 *
 * Cada mesa tiene su propio QR. Eso es lo que permitirá al camarero virtual
 * saber DÓNDE está sentado quien pide, y es imprescindible para llevarle el
 * plato al sitio correcto.
 *
 * El plano visual (colocar las mesas como están en el local) va aparte y es
 * opcional: aquí se crea la mesa, se le pone número y se imprime su cartel. Una
 * mesa sin coordenadas funciona igual de bien.
 *
 * ⚠️ El `token` del QR no se toca desde aquí: lo genera la base de datos y solo
 * Pidoo puede rotarlo (PD171). Si se pudiera escribir a mano, un restaurante
 * podría poner el token de otro y quedarse con sus pedidos.
 * ────────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from 'react'
import { Armchair, Download, Plus, Trash2, Copy, Power } from 'lucide-react'
import { colors, type, ds } from '../lib/uiStyles'
import { supabase } from '../lib/supabase'
import { construirCartel, construirPdfCarteles, descargarCanvas } from '../lib/qrCarta'
import { toast, confirmar } from '../App'

const ZONAS = ['interior', 'terraza', 'barra']

export default function MesasPanel({ restaurante }) {
  const [mesas, setMesas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [progreso, setProgreso] = useState(null)   // {hechas, total} mientras se hace el PDF
  const [nuevaCodigo, setNuevaCodigo] = useState('')
  const [nuevaZona, setNuevaZona] = useState('interior')

  const estId = restaurante?.id

  const cargar = useCallback(async () => {
    if (!estId) return
    const { data, error } = await supabase
      .from('mesas')
      .select('id, codigo, token, zona, plazas, activa, orden')
      .eq('establecimiento_id', estId)
      .order('orden')
      .order('codigo')
    if (error) { toast('No se han podido cargar las mesas: ' + error.message, 'error'); setCargando(false); return }
    setMesas(data || [])
    setCargando(false)
  }, [estId])

  useEffect(() => { cargar() }, [cargar])

  async function crear(codigo, zona) {
    const c = String(codigo || '').trim()
    if (!c) return toast('Ponle un número o un nombre a la mesa')
    setOcupado(true)
    const { error } = await supabase.from('mesas').insert({
      establecimiento_id: estId,
      codigo: c,
      zona,
      orden: mesas.length,
    })
    setOcupado(false)
    // 23505 = ya existe una mesa con ese número en este restaurante.
    if (error) return toast(error.code === '23505'
      ? `Ya tienes una mesa "${c}".`
      : 'No se ha podido crear: ' + error.message, 'error')
    setNuevaCodigo('')
    cargar()
  }

  // Montar 20 mesas de una en una es donde el dueño abandona.
  async function crearVarias() {
    const cuantas = Number(window.prompt('¿Cuántas mesas quieres crear de golpe?', '10'))
    if (!Number.isFinite(cuantas) || cuantas < 1) return
    if (cuantas > 60) return toast('De golpe, como mucho 60.')

    // Sigue por donde lo dejó: si ya tiene la 1 a la 8, empieza en la 9.
    const numeros = mesas.map(m => Number(m.codigo)).filter(Number.isFinite)
    let siguiente = numeros.length ? Math.max(...numeros) + 1 : 1

    const filas = []
    for (let i = 0; i < cuantas; i++) {
      filas.push({ establecimiento_id: estId, codigo: String(siguiente + i), zona: nuevaZona, orden: mesas.length + i })
    }
    setOcupado(true)
    const { error } = await supabase.from('mesas').insert(filas)
    setOcupado(false)
    if (error) return toast('No se han podido crear: ' + error.message, 'error')
    toast(`${cuantas} mesas creadas`, 'success')
    cargar()
  }

  async function renombrar(mesa) {
    const c = window.prompt('Número o nombre de la mesa', mesa.codigo)
    if (c === null || c.trim() === mesa.codigo) return
    const { error } = await supabase.from('mesas').update({ codigo: c.trim() }).eq('id', mesa.id)
    if (error) return toast(error.code === '23505' ? 'Ya tienes una mesa con ese nombre.' : error.message, 'error')
    cargar()
  }

  async function alternarActiva(mesa) {
    const { error } = await supabase.from('mesas').update({ activa: !mesa.activa }).eq('id', mesa.id)
    if (error) return toast(error.message, 'error')
    cargar()
  }

  async function borrar(mesa) {
    if (!await confirmar(`¿Quitar la mesa "${mesa.codigo}"? El cartel que tengas impreso dejará de funcionar.`)) return
    const { error } = await supabase.from('mesas').delete().eq('id', mesa.id)
    if (error) return toast(error.message, 'error')
    cargar()
  }

  async function descargarUno(mesa) {
    setOcupado(true)
    try {
      const canvas = await construirCartel(restaurante, mesa)
      descargarCanvas(canvas, `mesa-${mesa.codigo}-${restaurante.slug}.png`)
    } catch (e) {
      toast('No se ha podido generar el cartel: ' + (e?.message || ''), 'error')
    } finally { setOcupado(false) }
  }

  // Un PDF con todas: el navegador bloquea descargas múltiples, y además así el
  // dueño lo manda a imprimir de una vez y le salen todas las mesas seguidas.
  async function descargarTodos() {
    const activas = mesas.filter(m => m.activa)
    if (!activas.length) return toast('No tienes ninguna mesa activa.')
    setOcupado(true)
    setProgreso({ hechas: 0, total: activas.length })
    try {
      const pdf = await construirPdfCarteles(restaurante, activas,
        (hechas, total) => setProgreso({ hechas, total }))
      pdf.save(`carteles-mesas-${restaurante.slug}.pdf`)
    } catch (e) {
      toast('No se ha podido generar el PDF: ' + (e?.message || ''), 'error')
    } finally {
      setOcupado(false)
      setProgreso(null)
    }
  }

  if (!restaurante?.slug) return null

  const activas = mesas.filter(m => m.activa).length

  return (
    <div style={{ ...ds.card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <Armchair size={17} strokeWidth={2.2} color={colors.terracotta} />
        <div style={{ fontSize: type.base, fontWeight: 700, color: colors.ink }}>
          Tus mesas
        </div>
        {mesas.length > 0 && (
          <span style={{ ...ds.badge, background: colors.cream2, color: colors.stone, marginLeft: 'auto' }}>
            {activas} activa{activas === 1 ? '' : 's'} de {mesas.length}
          </span>
        )}
      </div>
      <p style={{ fontSize: type.sm, color: colors.stone, margin: '0 0 14px', lineHeight: 1.45 }}>
        Cada mesa lleva su propio QR. Así, cuando un cliente pida desde la mesa 4,
        sabrás que hay que llevarle el plato a la 4.
      </p>

      {/* Alta */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={nuevaCodigo}
          onChange={e => setNuevaCodigo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') crear(nuevaCodigo, nuevaZona) }}
          placeholder="Número o nombre"
          style={{ ...ds.input, flex: '1 1 150px', minWidth: 120 }} />
        <select value={nuevaZona} onChange={e => setNuevaZona(e.target.value)} style={{ ...ds.input, flex: '0 0 auto' }}>
          {ZONAS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <button onClick={() => crear(nuevaCodigo, nuevaZona)} disabled={ocupado} style={{ ...ds.glossyBtn, opacity: ocupado ? 0.5 : 1 }}>
          <Plus size={14} strokeWidth={2.4} /> Añadir
        </button>
        <button onClick={crearVarias} disabled={ocupado} style={{ ...ds.ghostBtn, opacity: ocupado ? 0.5 : 1 }}>
          Crear varias
        </button>
      </div>

      {/* Listado */}
      {cargando ? (
        <div style={{ fontSize: type.sm, color: colors.stone, padding: '10px 0' }}>Cargando…</div>
      ) : mesas.length === 0 ? (
        <div style={{
          padding: '18px 14px', borderRadius: 10, background: colors.cream2,
          fontSize: type.sm, color: colors.stone, lineHeight: 1.5,
        }}>
          Todavía no has puesto ninguna mesa. Añade la primera arriba, o pulsa
          «Crear varias» si quieres numerarlas de golpe.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mesas.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '9px 12px', borderRadius: 10,
              background: m.activa ? colors.paper : colors.cream2,
              border: `1px solid ${colors.border}`,
              opacity: m.activa ? 1 : 0.6,
            }}>
              <button onClick={() => renombrar(m)} style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: type.base, fontWeight: 700, color: colors.ink,
              }}>{m.codigo}</button>
              {m.zona && (
                <span style={{ fontSize: type.xs, color: colors.stone }}>{m.zona}</span>
              )}
              <span style={{ fontFamily: type.mono, fontSize: type.xxs, color: colors.stone2 }}>
                {m.token}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => descargarUno(m)} disabled={ocupado} title="Descargar su cartel"
                  style={{ ...ds.miniBtn, opacity: ocupado ? 0.5 : 1 }}>
                  <Download size={11} strokeWidth={2.2} />
                </button>
                <button onClick={() => alternarActiva(m)} title={m.activa ? 'Desactivar' : 'Activar'}
                  style={ds.miniBtn}>
                  <Power size={11} strokeWidth={2.2} />
                </button>
                <button onClick={() => borrar(m)} title="Quitar" style={ds.miniBtnDanger}>
                  <Trash2 size={11} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {mesas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={descargarTodos} disabled={ocupado} style={{ ...ds.glossyBtn, opacity: ocupado ? 0.5 : 1 }}>
            <Download size={14} strokeWidth={2.2} />
            {progreso
              ? `Generando ${progreso.hechas} de ${progreso.total}…`
              : 'Descargar todos los carteles (PDF)'}
          </button>
          <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 8, lineHeight: 1.5 }}>
            Un cartel por página, tamaño A6. Mándalo a imprimir y recorta.
          </div>
        </div>
      )}
    </div>
  )
}
