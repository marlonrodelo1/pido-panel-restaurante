import { useEffect, useRef, useState } from 'react'
import { colors } from '../lib/uiStyles'
import { T } from '../lib/tpvTheme'

// Buscador de direcciones con sugerencias de Google Places (API clásica).
// Copia del de pido-app (19 sep 2026), adaptado a los colores del panel.
//
// Antes usaba el widget `google.maps.places.Autocomplete`, que pinta su lista
// (`.pac-container`) colgada de <body> y la coloca con la posición de la casilla
// sin contar el scroll interno de los contenedores: en la tablet la lista podía
// salir fuera de la pantalla o bajo el teclado. Y si no se TOCABA una sugerencia,
// la dirección se quedaba sin coordenadas y «Crear envío» seguía gris sin decir
// por qué (Broaster perdió pedidos telefónicos el 18 y 19 sep). Ahora la lista
// la pintamos nosotros justo debajo de la casilla, y si Google no sugiere nada
// hay un botón «Buscar esta dirección» que geocodifica lo escrito.
//
// Ojo: la "Places API (New)" está BLOQUEADA para esta key. Aquí solo se usan
// AutocompleteService, PlacesService.getDetails y Geocoder (clásicos).

let promesaGoogle = null

function cargarGoogle() {
  if (typeof window === 'undefined') return Promise.reject(new Error('sin window'))
  if (window.google?.maps?.places) return Promise.resolve(window.google)
  if (promesaGoogle) return promesaGoogle
  promesaGoogle = new Promise((resolve, reject) => {
    let intentos = 0
    let interval = null
    if (!document.querySelector('script[src*="maps.googleapis.com/maps/api"]')) {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&language=es&region=ES`
      script.async = true
      // Sin cobertura: quitar la etiqueta fallida para que el siguiente intento la
      // vuelva a pedir (en la tablet la app casi nunca se recarga).
      script.onerror = () => { clearInterval(interval); script.remove(); promesaGoogle = null; reject(new Error('No cargó Google Maps')) }
      document.head.appendChild(script)
    }
    interval = setInterval(() => {
      if (window.google?.maps?.places) { clearInterval(interval); resolve(window.google) }
      else if (++intentos > 100) { clearInterval(interval); promesaGoogle = null; reject(new Error('No cargó Google Maps')) }
    }, 200)
  })
  return promesaGoogle
}

// Si Google solo conoce la calle (sin portal), mete detrás de la calle el número
// que se escribió. Solo números de 1-4 cifras (un 38350 es código postal) y que
// no estén ya en la dirección ("calle 3" no es el portal 3).
function conNumeroEscrito(direccion, escrito) {
  const nums = (escrito || '').match(/\b\d{1,4}[a-zA-Z]?\b/g)
  const num = nums && nums[nums.length - 1]
  if (!num || new RegExp(`(^|\\D)${num}(\\D|$)`, 'i').test(direccion)) return direccion
  const [calle, ...resto] = direccion.split(', ')
  return [calle, num, ...resto].join(', ')
}

// Primer antepasado con scroll propio; null = la ventana.
function contenedorScroll(el) {
  let p = el?.parentElement
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
    p = p.parentElement
  }
  return null
}

// `cerca` ({lat, lng}, opcional): punto hacia el que se sesgan las sugerencias
// (el restaurante). "carretera general norte 160" existe en varios pueblos y en
// otra isla; sin sesgo Google puede poner primero el de Las Palmas.
// `oscuro`: colores del TPV (fondo negro).
export default function AddressInput({ value, onChange, onSelect, placeholder, style, cerca, oscuro = false }) {
  const inputRef = useRef(null)
  const listaRef = useRef(null)
  const serviciosRef = useRef(null)
  const tokenRef = useRef(null)
  const peticionRef = useRef(0)
  const debounceRef = useRef(null)
  const cierreRef = useRef(null)

  const [sugerencias, setSugerencias] = useState([])
  const [abierta, setAbierta] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [eligiendo, setEligiendo] = useState(false)
  const [marcada, setMarcada] = useState(-1)
  const [aviso, setAviso] = useState(null)

  const C = oscuro
    ? { fondo: T.surface, borde: T.border, texto: T.text, suave: T.muted, acento: T.accent, marcada: 'rgba(255,107,44,0.18)', error: T.danger }
    : { fondo: colors.paper, borde: colors.border, texto: colors.ink, suave: colors.stone, acento: colors.terracotta, marcada: colors.terracottaSoft, error: colors.danger }

  const cercaOk = cerca && Number.isFinite(Number(cerca.lat)) && Number.isFinite(Number(cerca.lng))
    ? { lat: Number(cerca.lat), lng: Number(cerca.lng) } : null

  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    clearTimeout(cierreRef.current)
  }, [])

  async function servicios() {
    if (serviciosRef.current) return serviciosRef.current
    const g = await cargarGoogle()
    serviciosRef.current = {
      g,
      auto: new g.maps.places.AutocompleteService(),
      places: new g.maps.places.PlacesService(document.createElement('div')),
      geocoder: new g.maps.Geocoder(),
    }
    return serviciosRef.current
  }

  // Precarga para que la primera letra ya tenga Google listo.
  useEffect(() => { servicios().catch(() => {}) }, [])

  function buscar(texto) {
    clearTimeout(debounceRef.current)
    const q = texto.trim()
    const id = ++peticionRef.current
    if (q.length < 3) { setSugerencias([]); setBuscando(false); return }
    setBuscando(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const { g, auto } = await servicios()
        if (!tokenRef.current) tokenRef.current = new g.maps.places.AutocompleteSessionToken()
        auto.getPlacePredictions({
          input: q,
          types: ['address'],
          componentRestrictions: { country: 'es' },
          sessionToken: tokenRef.current,
          ...(cercaOk ? { locationBias: { center: cercaOk, radius: 20000 } } : {}),
        }, (preds, status) => {
          if (id !== peticionRef.current) return
          setBuscando(false)
          const ok = status === g.maps.places.PlacesServiceStatus.OK
          setSugerencias(ok && preds ? preds.slice(0, 5) : [])
          setMarcada(-1)
        })
      } catch (e) {
        if (id !== peticionRef.current) return
        console.error('[AddressInput] sugerencias', e)
        setBuscando(false); setSugerencias([])
        setAviso('No se pudo buscar la dirección. Revisa la conexión.')
      }
    }, 250)
  }

  function cambiarTexto(texto) {
    onChange(texto)
    setMarcada(-1)
    setAviso(null)
    setAbierta(true)
    buscar(texto)
  }

  function confirmar(direccion, lat, lng) {
    ++peticionRef.current
    tokenRef.current = null
    setSugerencias([]); setAbierta(false); setBuscando(false); setAviso(null)
    onChange(direccion)
    if (onSelect) onSelect({ direccion, lat, lng })
  }

  async function elegir(pred) {
    if (!pred || eligiendo) return
    // Candidato del geocodificador (ya trae coordenadas).
    if (pred._loc) { confirmar(pred.description, pred._loc.lat, pred._loc.lng); return }
    setEligiendo(true); setAviso(null)
    try {
      const { g, places } = await servicios()
      const place = await new Promise((resolve) => {
        places.getDetails({
          placeId: pred.place_id,
          fields: ['formatted_address', 'geometry', 'address_components'],
          sessionToken: tokenRef.current || undefined,
        }, (p, status) => resolve(status === g.maps.places.PlacesServiceStatus.OK ? p : null))
      })
      const loc = place?.geometry?.location
      if (!loc) throw new Error('Sin coordenadas')
      // Si Google no conoce el portal devuelve la calle SIN número y el repartidor
      // no sabría a qué casa ir: se guarda el texto de la sugerencia, que sí lo lleva.
      const conNumero = (place.address_components || []).some(c => c.types?.includes('street_number'))
      const formatted = place.formatted_address || pred.description
      const texto = conNumero ? formatted
        : /\d/.test(pred.description || '') ? pred.description
        : conNumeroEscrito(formatted, value)
      confirmar(texto, loc.lat(), loc.lng())
    } catch (e) {
      console.error('[AddressInput] detalle', e)
      setAviso('No se pudo ubicar esa dirección. Prueba con otra de la lista.')
    } finally {
      setEligiendo(false)
    }
  }

  // Enter / «Buscar esta dirección». Con varias sugerencias NO se elige ninguna a
  // ciegas (la primera puede ser otro pueblo). Solo sin sugerencias se geocodifica
  // lo escrito, y los resultados se enseñan para TOCAR, nunca se guardan solos.
  async function confirmarEscrito() {
    if (buscando) { setAbierta(true); return }
    if (marcada >= 0 && sugerencias[marcada]) { elegir(sugerencias[marcada]); return }
    if (sugerencias.length === 1) { elegir(sugerencias[0]); return }
    if (sugerencias.length) { setAbierta(true); return }
    const q = (value || '').trim()
    if (q.length < 3 || eligiendo) return
    setEligiendo(true); setAviso(null)
    try {
      const { geocoder } = await servicios()
      const { results } = await geocoder.geocode({
        address: q,
        componentRestrictions: { country: 'ES' },
        ...(cercaOk ? { bounds: { north: cercaOk.lat + 0.2, south: cercaOk.lat - 0.2, east: cercaOk.lng + 0.2, west: cercaOk.lng - 0.2 } } : {}),
      })
      // Solo resultados con calle: un pueblo o un código postal entero no sirve
      // para llevar un pedido.
      const PRECISOS = ['street_address', 'premise', 'subpremise', 'route']
      const candidatos = (results || [])
        .filter(r => r.geometry?.location && (r.types || []).some(t => PRECISOS.includes(t)))
        .slice(0, 5).map(r => {
          const partes = r.formatted_address.split(', ')
          const n = partes.length > 2 && /^\d+\w?$/.test(partes[1]) ? 2 : 1
          const conNumero = (r.address_components || []).some(c => c.types?.includes('street_number'))
          return {
            place_id: r.place_id,
            description: conNumero ? r.formatted_address : conNumeroEscrito(r.formatted_address, q),
            structured_formatting: { main_text: partes.slice(0, n).join(', '), secondary_text: partes.slice(n).join(', ') },
            _loc: { lat: r.geometry.location.lat(), lng: r.geometry.location.lng() },
          }
        })
      if (!candidatos.length) throw new Error('Sin resultados')
      setSugerencias(candidatos); setMarcada(-1); setAbierta(true)
    } catch (e) {
      console.error('[AddressInput] geocode', e)
      setAviso('No se encuentra esa dirección. Escribe calle, número y municipio.')
    } finally {
      setEligiendo(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmarEscrito()
    } else if (e.key === 'ArrowDown' && sugerencias.length) {
      e.preventDefault()
      setMarcada(i => Math.min(sugerencias.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' && sugerencias.length) {
      e.preventDefault()
      setMarcada(i => Math.max(-1, i - 1))
    } else if (e.key === 'Escape') {
      setAbierta(false)
    }
  }

  const q = (value || '').trim()
  const sinResultados = !buscando && !sugerencias.length && q.length >= 3
  const mostrarLista = abierta && (sugerencias.length > 0 || buscando || eligiendo || sinResultados)

  // Que la lista quede a la vista con el teclado abierto: subir el contenedor lo
  // justo, sin esconder la casilla.
  useEffect(() => {
    if (!mostrarLista || !sugerencias.length) return
    const raf = requestAnimationFrame(() => {
      const input = inputRef.current, lista = listaRef.current
      if (!input || !lista) return
      const vv = window.visualViewport
      const visibleAbajo = vv ? vv.offsetTop + vv.height : window.innerHeight
      const exceso = lista.getBoundingClientRect().bottom - (visibleAbajo - 8)
      if (exceso <= 0) return
      const cont = contenedorScroll(input)
      const techo = cont ? Math.max(0, cont.getBoundingClientRect().top) : (vv ? vv.offsetTop : 0)
      const margen = input.getBoundingClientRect().top - techo - 8
      const delta = Math.min(exceso, Math.max(0, margen))
      if (delta <= 0) return
      if (cont) cont.scrollBy({ top: delta, behavior: 'smooth' })
      else window.scrollBy({ top: delta, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [mostrarLista, sugerencias])

  const enlace = {
    border: 'none', background: 'none', padding: 0, fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700, color: C.acento, cursor: 'pointer',
  }

  return (
    <div>
      <input
        ref={inputRef}
        value={value || ''}
        onChange={e => cambiarTexto(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { clearTimeout(cierreRef.current); setAbierta(true); if (!sugerencias.length && (value || '').trim().length >= 3) buscar(value) }}
        onBlur={() => { cierreRef.current = setTimeout(() => setAbierta(false), 250) }}
        placeholder={placeholder || 'Buscar dirección...'}
        style={style}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />

      {mostrarLista && (
        <div
          ref={listaRef}
          role="listbox"
          // Que tocar una sugerencia no quite el foco (y cierre la lista) antes del click.
          onMouseDown={e => e.preventDefault()}
          style={{
            marginTop: 6, borderRadius: 12, overflow: 'hidden',
            background: C.fondo, border: `1px solid ${C.borde}`,
            boxShadow: '0 4px 12px rgba(26,24,21,0.10)', textAlign: 'left',
          }}
        >
          {sugerencias.map((p, i) => {
            const principal = p.structured_formatting?.main_text || p.description
            const secundario = p.structured_formatting?.secondary_text || ''
            return (
              <button
                key={p.place_id}
                type="button"
                role="option"
                aria-selected={i === marcada}
                onClick={() => elegir(p)}
                disabled={eligiendo}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
                  border: 'none', borderTop: i ? `1px solid ${C.borde}` : 'none',
                  background: i === marcada ? C.marcada : 'transparent',
                  cursor: eligiendo ? 'default' : 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: C.texto, lineHeight: 1.35 }}>{principal}</div>
                {secundario && <div style={{ fontSize: 12, color: C.suave, marginTop: 1 }}>{secundario}</div>}
              </button>
            )
          })}
          {(buscando || eligiendo) && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: C.suave }}>
              {eligiendo ? 'Situando la dirección…' : 'Buscando…'}
            </div>
          )}
          {sinResultados && !eligiendo && !aviso && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: C.suave }}>
              Google no sugiere nada para lo escrito.{' '}
              <button type="button" onClick={confirmarEscrito} style={enlace}>Buscar esta dirección</button>
            </div>
          )}
          {sugerencias.length > 0 && (
            <div style={{ padding: '4px 14px 6px', fontSize: 10, color: C.suave, textAlign: 'right' }}>
              Toca la dirección correcta
            </div>
          )}
        </div>
      )}

      {aviso && (
        <div style={{ fontSize: 12, color: C.error, marginTop: 6 }}>{aviso}</div>
      )}
    </div>
  )
}
