import { useEffect, useRef } from 'react'

// Autocompletado de direcciones con Google Places (widget LEGACY
// `google.maps.places.Autocomplete`). Es el mismo enfoque que usa pido-app y
// que SÍ funciona con la key del proyecto (la "Places API (New)" está bloqueada
// para esta key: 403 API_KEY_SERVICE_BLOCKED — verificado 22 jun 2026). El
// widget legacy usa el producto "Places API" clásico, que sí está habilitado.
// Muestra el dropdown nativo de Google (.pac-container) y al elegir una
// dirección devuelve dirección formateada + lat/lng vía onSelect.
export default function AddressInput({ value, onChange, onSelect, placeholder, style }) {
  const inputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  // Sincronizar valor externo → input (solo si cambia desde fuera, no al teclear).
  useEffect(() => {
    if (inputRef.current && inputRef.current !== document.activeElement) {
      inputRef.current.value = value || ''
    }
  }, [value])

  useEffect(() => {
    function init() {
      if (!window.google?.maps?.places || !inputRef.current || autocompleteRef.current) return

      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'es' },
        fields: ['formatted_address', 'geometry'],
      })

      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (place.formatted_address) {
          const addr = place.formatted_address
          if (inputRef.current) inputRef.current.value = addr
          onChangeRef.current?.(addr)
          onSelectRef.current?.({
            direccion: addr,
            lat: place.geometry?.location?.lat(),
            lng: place.geometry?.location?.lng(),
          })
        }
      })

      autocompleteRef.current = ac
    }

    if (window.google?.maps?.places) {
      init()
      return
    }

    const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!document.querySelector('script[src*="maps.googleapis.com/maps/api"]')) {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places&language=es&region=ES`
      script.async = true
      script.onload = () => init()
      document.head.appendChild(script)
    } else {
      const interval = setInterval(() => {
        if (window.google?.maps?.places) { clearInterval(interval); init() }
      }, 200)
      return () => clearInterval(interval)
    }
  }, [])

  return (
    <input
      ref={inputRef}
      defaultValue={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Buscar dirección...'}
      style={style}
      autoComplete="off"
    />
  )
}
