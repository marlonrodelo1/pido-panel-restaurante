import { useEffect, useRef, useState } from 'react'

// Editor de la ZONA DE REPARTO (30 jul 2026).
//
// Sustituye al slider de "Radio de cobertura": un círculo no se parece a la realidad
// del Norte de Tenerife (barrancos, carreteras que no cruzan, pueblos que están a
// 3 km en línea recta y a 20 minutos en coche). Aquí el restaurante dibuja su zona
// de verdad arrastrando los puntos sobre el mapa.
//
// El radio sigue existiendo como respaldo: mientras no haya zona dibujada, manda el
// radio (esa precedencia la decide la función SQL esta_en_zona_reparto, no este
// componente). Al guardar se llama a la RPC guardar_zona_reparto.
//
// Se carga la MISMA API de Google Maps que ya usa AddressInput para el autocompletado
// de direcciones, añadiendo la librería `drawing`.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const NARANJA = '#C5562C'

// NO se pide la librería `drawing`: un google.maps.Polygon con editable:true es parte
// del núcleo de la API. Pedir `drawing` obligaba a cargar el script una segunda vez
// (AddressInput ya lo carga con `places`) y Google lo rechaza con
// "You have included the Google Maps JavaScript API multiple times", dejando el mapa
// colgado en "Cargando mapa…". Se reutiliza el MISMO script que el autocompletado.
function cargarGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.Polygon) return resolve()
    if (!KEY) return reject(new Error('sin-api-key'))

    if (!document.querySelector('script[src*="maps.googleapis.com/maps/api"]')) {
      const s = document.createElement('script')
      s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places&language=es&region=ES`
      s.async = true
      s.onerror = () => reject(new Error('carga-fallida'))
      document.head.appendChild(s)
    }

    let intentos = 0
    const t = setInterval(() => {
      if (window.google?.maps?.Polygon) { clearInterval(t); resolve() }
      else if (++intentos > 60) { clearInterval(t); reject(new Error('timeout')) }
    }, 150)
  })
}

// Polígono que aproxima el círculo del radio actual: el restaurante empieza con algo
// razonable y solo tiene que arrastrar los puntos, en vez de dibujar desde cero.
function poligonoDesdeRadio(lat, lng, radioKm, vertices = 12) {
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
  const coords = []
  for (let i = 0; i < path.getLength(); i++) {
    const p = path.getAt(i)
    coords.push([Number(p.lng().toFixed(6)), Number(p.lat().toFixed(6))])
  }
  if (coords.length < 3) return null
  // GeoJSON exige el anillo cerrado (primer punto == último).
  const [x0, y0] = coords[0]
  const [xn, yn] = coords[coords.length - 1]
  if (x0 !== xn || y0 !== yn) coords.push([x0, y0])
  return { type: 'Polygon', coordinates: [coords] }
}

function geoJSONAPath(geojson) {
  const anillo = geojson?.coordinates?.[0]
  if (!Array.isArray(anillo)) return []
  const pts = anillo.map(([lng, lat]) => ({ lat, lng }))
  // Google no quiere el punto de cierre repetido.
  if (pts.length > 1) {
    const a = pts[0]; const b = pts[pts.length - 1]
    if (a.lat === b.lat && a.lng === b.lng) pts.pop()
  }
  return pts
}

export default function ZonaRepartoMap({ lat, lng, radioKm = 10, zona, onChange, alto = 340 }) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const polyRef = useRef(null)
  const circleRef = useRef(null)
  const listenersRef = useRef([])
  const historialRef = useRef([])

  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [errorMsg, setErrorMsg] = useState('')
  const [vertices, setVertices] = useState(0)

  const emitir = () => {
    const p = polyRef.current
    if (!p) { onChange?.(null); setVertices(0); return }
    const gj = pathAGeoJSON(p.getPath())
    setVertices(gj ? gj.coordinates[0].length - 1 : 0)
    onChange?.(gj)
  }

  const engancharPath = (poly) => {
    listenersRef.current.forEach(l => l.remove())
    listenersRef.current = []
    const path = poly.getPath()
    for (const ev of ['set_at', 'insert_at', 'remove_at']) {
      listenersRef.current.push(path.addListener(ev, emitir))
    }
  }

  const pintarPoligono = (puntos) => {
    if (!mapRef.current || !window.google) return
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null }
    if (circleRef.current) { circleRef.current.setMap(null); circleRef.current = null }

    const poly = new window.google.maps.Polygon({
      paths: puntos,
      editable: true,
      strokeColor: NARANJA,
      strokeOpacity: 0.95,
      strokeWeight: 2,
      fillColor: NARANJA,
      fillOpacity: 0.16,
      map: mapRef.current,
    })
    // Clic derecho / pulsación larga sobre un vértice = borrarlo.
    poly.addListener('rightclick', (e) => {
      if (e.vertex != null && poly.getPath().getLength() > 3) {
        poly.getPath().removeAt(e.vertex)
      }
    })
    polyRef.current = poly
    engancharPath(poly)

    const bounds = new window.google.maps.LatLngBounds()
    puntos.forEach(p => bounds.extend(p))
    mapRef.current.fitBounds(bounds, 24)
    emitir()
  }

  const pintarCirculoRadio = () => {
    if (!mapRef.current || !window.google) return
    if (circleRef.current) circleRef.current.setMap(null)
    circleRef.current = new window.google.maps.Circle({
      center: { lat, lng },
      radius: radioKm * 1000,
      strokeColor: '#8A8A8A', strokeOpacity: 0.8, strokeWeight: 1.5,
      fillColor: '#8A8A8A', fillOpacity: 0.10,
      map: mapRef.current,
    })
    mapRef.current.fitBounds(circleRef.current.getBounds(), 24)
  }

  useEffect(() => {
    let cancelado = false
    cargarGoogleMaps()
      .then(() => {
        if (cancelado || !divRef.current) return
        mapRef.current = new window.google.maps.Map(divRef.current, {
          center: { lat, lng },
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy', // en móvil se mueve con un dedo
        })
        new window.google.maps.Marker({
          position: { lat, lng },
          map: mapRef.current,
          title: 'Tu restaurante',
        })
        if (zona?.coordinates) pintarPoligono(geoJSONAPath(zona))
        else pintarCirculoRadio()
        setEstado('listo')
      })
      .catch((e) => {
        if (cancelado) return
        setEstado('error')
        setErrorMsg(e.message === 'sin-api-key'
          ? 'Falta la clave de Google Maps en la configuración del panel.'
          : 'No se ha podido cargar el mapa. Comprueba tu conexión.')
      })
    return () => {
      cancelado = true
      listenersRef.current.forEach(l => l.remove())
    }
    // Solo al montar: los cambios de zona/radio se manejan con los botones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const crearDesdeRadio = () => {
    historialRef.current.push(polyRef.current ? pathAGeoJSON(polyRef.current.getPath()) : null)
    pintarPoligono(poligonoDesdeRadio(lat, lng, radioKm))
  }

  const borrarZona = () => {
    historialRef.current.push(polyRef.current ? pathAGeoJSON(polyRef.current.getPath()) : null)
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null }
    setVertices(0)
    pintarCirculoRadio()
    onChange?.(null)
  }

  const deshacer = () => {
    const prev = historialRef.current.pop()
    if (prev === undefined) return
    if (prev && prev.coordinates) pintarPoligono(geoJSONAPath(prev))
    else { if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null } setVertices(0); pintarCirculoRadio(); onChange?.(null) }
  }

  const btn = (principal = false) => ({
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12.5, fontWeight: 700, minHeight: 42,
    border: principal ? 'none' : '1px solid var(--c-border)',
    background: principal ? 'var(--c-primary)' : 'var(--c-surface2)',
    color: principal ? '#fff' : 'var(--c-text)',
  })

  if (estado === 'error') {
    return (
      <div style={{ padding: 14, borderRadius: 10, background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Mapa no disponible</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{errorMsg}</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 8 }}>
          Mientras no haya zona dibujada se sigue usando tu radio de {radioKm} km, así que tus clientes no notan nada.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
        <div ref={divRef} style={{ width: '100%', height: alto, background: 'var(--c-surface2)' }} />
        {estado === 'cargando' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'var(--c-muted)', background: 'var(--c-surface2)',
          }}>Cargando mapa…</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {vertices === 0 ? (
          <button type="button" onClick={crearDesdeRadio} style={btn(true)}>
            Dibujar mi zona
          </button>
        ) : (
          <>
            <button type="button" onClick={borrarZona} style={btn()}>Volver al radio</button>
            <button type="button" onClick={deshacer} style={btn()}>Deshacer</button>
          </>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 10, lineHeight: 1.55 }}>
        {vertices === 0 ? (
          <>
            Ahora mismo reparte a todo lo que quede dentro del círculo grís: <b>{radioKm} km a la redonda</b>.
            Pulsa <b>Dibujar mi zona</b> y arrastra los puntos para ajustarla a las calles a las que llegas de verdad.
          </>
        ) : (
          <>
            <b>{vertices} puntos.</b> Arrastra un punto para moverlo, toca la mitad de un lado para añadir
            uno nuevo, y mantén pulsado un punto para borrarlo. Los clientes de fuera de esta zona no podrán
            pedirte a domicilio. No olvides <b>guardar</b>.
          </>
        )}
      </div>
    </div>
  )
}
