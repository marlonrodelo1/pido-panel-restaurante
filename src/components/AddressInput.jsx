import { useEffect, useRef, useState } from 'react'

// Autocompletado de direcciones con la API NUEVA de Google Places
// (AutocompleteSuggestion). La antigua google.maps.places.Autocomplete está
// bloqueada para clientes nuevos desde marzo 2025, por eso no funcionaba.
// Mantiene el input estilado del formulario + dropdown propio. Al elegir una
// sugerencia devuelve dirección formateada + lat/lng exactos vía onSelect.
export default function AddressInput({ value, onChange, onSelect, placeholder, style }) {
  const [text, setText] = useState(value || '')
  const [preds, setPreds] = useState([])
  const [open, setOpen] = useState(false)
  const libRef = useRef(null)        // { AutocompleteSuggestion, AutocompleteSessionToken }
  const tokenRef = useRef(null)
  const debounceRef = useRef(null)
  const boxRef = useRef(null)

  // Sincronizar valor externo → input (si no se está escribiendo)
  useEffect(() => {
    if (document.activeElement !== boxRef.current) setText(value || '')
  }, [value])

  // Cargar la librería Places (API nueva). El script JS ya puede estar cargado.
  useEffect(() => {
    let cancelled = false
    const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

    function ensureMaps() {
      if (window.google?.maps?.importLibrary) return Promise.resolve()
      if (!KEY) return Promise.reject(new Error('no_key'))
      if (!document.querySelector('script[data-pidoo-gmaps]')) {
        const s = document.createElement('script')
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&libraries=places&loading=async&language=es&region=ES`
        s.async = true
        s.dataset.pidooGmaps = '1'
        document.head.appendChild(s)
      }
      return new Promise((res, rej) => {
        const t = setInterval(() => {
          if (window.google?.maps?.importLibrary) { clearInterval(t); res() }
        }, 150)
        setTimeout(() => { clearInterval(t); rej(new Error('gmaps_timeout')) }, 12000)
      })
    }

    ensureMaps()
      .then(() => window.google.maps.importLibrary('places'))
      .then((lib) => { if (!cancelled) libRef.current = lib })
      .catch((e) => console.warn('[AddressInput] Places no disponible:', e?.message))

    return () => { cancelled = true }
  }, [])

  function predLabel(pp) {
    if (!pp) return ''
    const t = pp.text
    if (!t) return ''
    if (typeof t === 'string') return t
    return t.text ?? (typeof t.toString === 'function' ? t.toString() : '')
  }

  function onType(v) {
    setText(v)
    onChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const lib = libRef.current
    if (!v || v.trim().length < 3 || !lib?.AutocompleteSuggestion) { setPreds([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        if (!tokenRef.current) tokenRef.current = new lib.AutocompleteSessionToken()
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: v,
          sessionToken: tokenRef.current,
          includedRegionCodes: ['es'],
          language: 'es',
        })
        const list = (suggestions || []).filter(s => s.placePrediction).slice(0, 5)
        setPreds(list)
        setOpen(list.length > 0)
      } catch (e) {
        console.warn('[AddressInput] fetchAutocompleteSuggestions falló:', e?.message)
        setPreds([]); setOpen(false)
      }
    }, 280)
  }

  async function pick(sug) {
    const pp = sug.placePrediction
    const fallback = predLabel(pp)
    try {
      const place = pp.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      const addr = place.formattedAddress || fallback
      setText(addr); onChange(addr)
      setPreds([]); setOpen(false)
      tokenRef.current = null // cerrar sesión de facturación
      const loc = place.location
      if (onSelect && loc) {
        onSelect({ direccion: addr, lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat, lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng })
      }
    } catch (e) {
      console.warn('[AddressInput] fetchFields falló:', e?.message)
      if (fallback) { setText(fallback); onChange(fallback) }
      setPreds([]); setOpen(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={boxRef}
        value={text}
        onChange={e => onType(e.target.value)}
        onFocus={() => { if (preds.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder || 'Buscar dirección...'}
        style={style}
        autoComplete="off"
      />
      {open && preds.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10,
          overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        }}>
          {preds.map((sug, i) => (
            <div
              key={i}
              onMouseDown={(e) => { e.preventDefault(); pick(sug) }}
              style={{
                padding: '11px 13px', cursor: 'pointer', fontSize: 13, color: 'var(--c-text)',
                borderTop: i > 0 ? '1px solid var(--c-border)' : 'none', lineHeight: 1.35,
              }}
            >
              {predLabel(sug.placePrediction)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
