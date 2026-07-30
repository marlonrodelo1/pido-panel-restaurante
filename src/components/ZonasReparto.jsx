import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'

// ZONAS DE REPARTO (30 jul 2026).
//
// El restaurante dibuja en el mapa TODAS las zonas a las que reparte, y en cada una
// puede cobrar un envío distinto y exigir un pedido mínimo distinto: no cuesta lo
// mismo cruzar el pueblo que subir a la montaña.
//
// Un círculo no servía para esto: el Norte de Tenerife tiene barrancos y carreteras
// que no cruzan, así que la zona real no es redonda. El radio sigue existiendo por
// debajo como respaldo, y solo decide mientras no haya ninguna zona dibujada.
//
// Reglas (las aplica el servidor, no este componente):
//   - Si el cliente cae en una zona, esa zona manda: su tarifa y su mínimo.
//   - Si cae en varias, gana la de mayor prioridad (orden más bajo); a igual
//     prioridad, la más pequeña.
//   - Fuera de todas las zonas: no puede pedir a domicilio.
// La decisión vive en la función SQL esta_en_zona_reparto, que es la que consultan
// tanto el carrito como el cobro.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

const COLORES = ['#C5562C', '#2E7D6F', '#3A6EA5', '#8B5FBF', '#B5843A', '#9A3B5C']

function cargarGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.Polygon) return resolve()
    if (!KEY) return reject(new Error('sin-api-key'))
    // Se reutiliza el MISMO script que carga AddressInput. No se pide la librería
    // `drawing`: un Polygon editable es del núcleo, y pedirla obliga a cargar la API
    // por segunda vez, cosa que Google rechaza y deja el mapa colgado.
    if (!document.querySelector('script[src*="maps.googleapis.com/maps/api"]')) {
      const s = document.createElement('script')
      s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places&language=es&region=ES`
      s.async = true
      s.onerror = () => reject(new Error('carga-fallida'))
      document.head.appendChild(s)
    }
    let n = 0
    const t = setInterval(() => {
      if (window.google?.maps?.Polygon) { clearInterval(t); resolve() }
      else if (++n > 60) { clearInterval(t); reject(new Error('timeout')) }
    }, 150)
  })
}

// Punto de partida: un polígono derivado del radio, para que el dueño solo arrastre.
function poligonoInicial(lat, lng, radioKm, vertices = 10) {
  const R = 6371
  const pts = []
  for (let i = 0; i < vertices; i++) {
    const ang = (2 * Math.PI * i) / vertices
    const dLat = (radioKm / R) * (180 / Math.PI)
    const dLng = ((radioKm / R) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180)
    pts.push({ lat: lat + dLat * Math.cos(ang), lng: lng + dLng * Math.sin(ang) })
  }
  return pts
}

function pathAGeoJSON(path) {
  const c = []
  for (let i = 0; i < path.getLength(); i++) {
    const p = path.getAt(i)
    c.push([Number(p.lng().toFixed(6)), Number(p.lat().toFixed(6))])
  }
  if (c.length < 3) return null
  const [x0, y0] = c[0]; const [xn, yn] = c[c.length - 1]
  if (x0 !== xn || y0 !== yn) c.push([x0, y0])
  return { type: 'Polygon', coordinates: [c] }
}

function geoJSONAPath(gj) {
  const anillo = gj?.coordinates?.[0]
  if (!Array.isArray(anillo)) return []
  const pts = anillo.map(([lng, lat]) => ({ lat, lng }))
  if (pts.length > 1) {
    const a = pts[0]; const b = pts[pts.length - 1]
    if (a.lat === b.lat && a.lng === b.lng) pts.pop()
  }
  return pts
}

const FORM_VACIO = { id: null, nombre: '', color: COLORES[0], tarifa: '', minimo: '', minutos: '', geojson: null }

export default function ZonasReparto({ establecimientoId, lat, lng, radioKm = 10 }) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const polysRef = useRef(new Map())   // id -> google.maps.Polygon (zonas guardadas)
  const editRef = useRef(null)         // polígono en edición
  const listenersRef = useRef([])

  const [estado, setEstado] = useState('cargando')
  const [errorMapa, setErrorMapa] = useState('')
  const [zonas, setZonas] = useState([])
  const [form, setForm] = useState(null)   // null = no se está editando nada
  const [guardando, setGuardando] = useState(false)

  const cargarZonas = async () => {
    const { data, error } = await supabase
      .from('zonas_reparto')
      .select('id, nombre, color, tarifa_envio, pedido_minimo, minutos_extra, activa, orden, poligono_geojson')
      .eq('establecimiento_id', establecimientoId)
      .order('orden', { ascending: true })
    if (error) { console.warn('[zonas] no se pudieron cargar:', error.message); return [] }
    setZonas(data || [])
    return data || []
  }

  // ── Mapa ──────────────────────────────────────────────────────────────────
  const limpiarEditor = () => {
    listenersRef.current.forEach(l => l.remove()); listenersRef.current = []
    if (editRef.current) { editRef.current.setMap(null); editRef.current = null }
  }

  const pintarGuardadas = (lista, ocultarId = null) => {
    polysRef.current.forEach(p => p.setMap(null))
    polysRef.current.clear()
    if (!mapRef.current) return
    for (const z of lista) {
      if (!z.poligono_geojson || z.id === ocultarId) continue
      const poly = new window.google.maps.Polygon({
        paths: geoJSONAPath(z.poligono_geojson),
        editable: false, clickable: true,
        strokeColor: z.color, strokeOpacity: 0.9, strokeWeight: 2,
        fillColor: z.color, fillOpacity: 0.14,
        map: mapRef.current,
      })
      poly.addListener('click', () => abrirEdicion(z))
      polysRef.current.set(z.id, poly)
    }
  }

  const pintarEditor = (puntos, color) => {
    limpiarEditor()
    const poly = new window.google.maps.Polygon({
      paths: puntos, editable: true,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2.5,
      fillColor: color, fillOpacity: 0.22,
      map: mapRef.current, zIndex: 10,
    })
    poly.addListener('rightclick', (e) => {
      if (e.vertex != null && poly.getPath().getLength() > 3) poly.getPath().removeAt(e.vertex)
    })
    const path = poly.getPath()
    const sync = () => setForm(f => (f ? { ...f, geojson: pathAGeoJSON(path) } : f))
    for (const ev of ['set_at', 'insert_at', 'remove_at']) {
      listenersRef.current.push(path.addListener(ev, sync))
    }
    editRef.current = poly
    const b = new window.google.maps.LatLngBounds()
    puntos.forEach(p => b.extend(p))
    mapRef.current.fitBounds(b, 30)
    setForm(f => (f ? { ...f, geojson: pathAGeoJSON(path) } : f))
  }

  useEffect(() => {
    let cancelado = false
    cargarGoogleMaps()
      .then(async () => {
        if (cancelado || !divRef.current) return
        mapRef.current = new window.google.maps.Map(divRef.current, {
          center: { lat, lng }, zoom: 12,
          mapTypeControl: false, streetViewControl: false, clickableIcons: false,
          gestureHandling: 'greedy',
        })
        new window.google.maps.Marker({ position: { lat, lng }, map: mapRef.current, title: 'Tu restaurante' })
        const lista = await cargarZonas()
        pintarGuardadas(lista)
        if (lista.length) {
          const b = new window.google.maps.LatLngBounds()
          lista.forEach(z => geoJSONAPath(z.poligono_geojson).forEach(p => b.extend(p)))
          if (!b.isEmpty()) mapRef.current.fitBounds(b, 30)
        }
        setEstado('listo')
      })
      .catch(e => {
        if (cancelado) return
        setEstado('error')
        setErrorMapa(e.message === 'sin-api-key'
          ? 'Falta la clave de Google Maps en la configuración del panel.'
          : 'No se ha podido cargar el mapa. Comprueba tu conexión.')
      })
    return () => { cancelado = true; limpiarEditor() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Acciones ──────────────────────────────────────────────────────────────
  const abrirEdicion = (z) => {
    setForm({
      id: z.id, nombre: z.nombre, color: z.color,
      tarifa: z.tarifa_envio ?? '', minimo: z.pedido_minimo ?? '', minutos: z.minutos_extra ?? '',
      geojson: z.poligono_geojson,
    })
    pintarGuardadas(zonas, z.id)
    pintarEditor(geoJSONAPath(z.poligono_geojson), z.color)
  }

  const nuevaZona = () => {
    const color = COLORES[zonas.length % COLORES.length]
    setForm({ ...FORM_VACIO, color, nombre: '' })
    pintarGuardadas(zonas)
    // Empieza pequeña (un tercio del radio) para que se vea que hay que ajustarla.
    pintarEditor(poligonoInicial(lat, lng, Math.max(1, (Number(radioKm) || 6) / 3)), color)
  }

  const descartar = () => {
    setForm(null)
    limpiarEditor()
    pintarGuardadas(zonas)
  }

  const guardar = async () => {
    if (!form?.geojson) { toast('Dibuja la zona en el mapa antes de guardar', 'error'); return }
    if (!form.nombre.trim()) { toast('Ponle un nombre a la zona', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('guardar_zona', {
      p_establecimiento_id: establecimientoId,
      p_geojson: form.geojson,
      p_nombre: form.nombre.trim(),
      p_color: form.color,
      p_tarifa_envio: form.tarifa === '' ? null : Number(form.tarifa),
      p_pedido_minimo: form.minimo === '' ? null : Number(form.minimo),
      p_minutos_extra: form.minutos === '' ? null : Number(form.minutos),
      p_id: form.id,
      p_orden: 0,
    })
    setGuardando(false)
    if (error) { toast(error.message || 'No se ha podido guardar la zona', 'error'); return }
    toast('Zona guardada', 'success')
    const lista = await cargarZonas()
    setForm(null); limpiarEditor(); pintarGuardadas(lista)
  }

  const eliminar = async () => {
    if (!form?.id) { descartar(); return }
    setGuardando(true)
    const { error } = await supabase.rpc('eliminar_zona', { p_id: form.id })
    setGuardando(false)
    if (error) { toast(error.message || 'No se ha podido borrar', 'error'); return }
    toast('Zona eliminada', 'success')
    const lista = await cargarZonas()
    setForm(null); limpiarEditor(); pintarGuardadas(lista)
  }

  // ── Estilos ───────────────────────────────────────────────────────────────
  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontFamily: 'inherit', background: 'rgba(0,0,0,0.05)', color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box' }
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'rgba(0,0,0,0.45)', marginBottom: 4, display: 'block' }
  const btn = (tipo = 'normal') => ({
    padding: '10px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700, minHeight: 44,
    border: tipo === 'normal' ? '1px solid var(--c-border)' : 'none',
    background: tipo === 'principal' ? 'var(--c-primary)' : tipo === 'peligro' ? 'rgba(181,86,74,0.12)' : 'var(--c-surface2)',
    color: tipo === 'principal' ? '#fff' : tipo === 'peligro' ? '#B5564A' : 'var(--c-text)',
  })

  if (estado === 'error') {
    return (
      <div style={{ padding: 14, borderRadius: 10, background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Mapa no disponible</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{errorMapa}</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
        <div ref={divRef} style={{ width: '100%', height: 380, background: 'var(--c-surface2)' }} />
        {estado === 'cargando' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--c-muted)', background: 'var(--c-surface2)' }}>
            Cargando mapa…
          </div>
        )}
      </div>

      {/* Lista de zonas */}
      {!form && (
        <div style={{ marginTop: 12 }}>
          {zonas.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--c-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              Todavía no has marcado ninguna zona. Mientras no haya ninguna, repartes a todo lo que
              quede a <b>{radioKm} km</b> a la redonda y cobras tu tarifa normal.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {zonas.map(z => (
                <button key={z.id} type="button" onClick={() => abrirEdicion(z)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
                  padding: '11px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid var(--c-border)', background: 'var(--c-surface2)',
                }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: z.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--c-text)' }}>{z.nombre}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c-muted)', marginTop: 2 }}>
                      {z.tarifa_envio != null ? `Envío ${Number(z.tarifa_envio).toFixed(2)} €` : 'Envío: tu tarifa normal'}
                      {z.pedido_minimo != null ? ` · Mínimo ${Number(z.pedido_minimo).toFixed(2)} €` : ''}
                      {z.minutos_extra ? ` · +${z.minutos_extra} min` : ''}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--c-primary)' }}>Editar</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={nuevaZona} style={btn('principal')}>
            {zonas.length === 0 ? 'Marcar mi primera zona' : 'Añadir otra zona'}
          </button>
        </div>
      )}

      {/* Editor */}
      {form && (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid var(--c-border)', background: 'var(--c-surface2)' }}>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Arrastra los puntos del mapa para ajustar la zona. Toca la mitad de un lado para añadir
            un punto, y mantén pulsado un punto para quitarlo.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={lbl}>Nombre de la zona</label>
              <input style={inp} value={form.nombre} maxLength={60} placeholder="La Matanza, El Toscal…"
                onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Color</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {COLORES.map(c => (
                  <button key={c} type="button" onClick={() => {
                    setForm({ ...form, color: c })
                    if (editRef.current) editRef.current.setOptions({ strokeColor: c, fillColor: c })
                  }} style={{
                    width: 28, height: 38, borderRadius: 8, cursor: 'pointer', background: c,
                    border: form.color === c ? '3px solid var(--c-text)' : '1px solid rgba(0,0,0,0.12)',
                  }} aria-label={`Color ${c}`} />
                ))}
              </div>
            </div>
          </div>

          <div className="pidoo-grid-3" style={{ marginBottom: 12 }}>
            <div>
              <label style={lbl}>Envío en esta zona (€)</label>
              <input style={inp} type="number" min="0" max="50" step="0.5" placeholder="Tu tarifa normal"
                value={form.tarifa} onChange={e => setForm({ ...form, tarifa: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Pedido mínimo (€)</label>
              <input style={inp} type="number" min="0" max="500" step="1" placeholder="Sin mínimo"
                value={form.minimo} onChange={e => setForm({ ...form, minimo: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Minutos extra</label>
              <input style={inp} type="number" min="0" max="240" step="5" placeholder="0"
                value={form.minutos} onChange={e => setForm({ ...form, minutos: e.target.value })} />
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Si dejas el envío vacío, en esta zona se cobra tu tarifa de siempre. Si dejas el mínimo
            vacío, se aplica el mínimo general del restaurante.
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={guardar} disabled={guardando} style={{ ...btn('principal'), opacity: guardando ? 0.6 : 1 }}>
              {guardando ? 'Guardando…' : 'Guardar zona'}
            </button>
            <button type="button" onClick={descartar} disabled={guardando} style={btn()}>Descartar</button>
            {form.id && (
              <button type="button" onClick={eliminar} disabled={guardando} style={btn('peligro')}>Eliminar zona</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
