import { useEffect, useRef } from 'react'

// Autocompletado de direcciones con Google Places. Al elegir una sugerencia
// devuelve la dirección formateada + lat/lng EXACTOS vía onSelect.
// Mismo patrón que el de pido-app. Usa VITE_GOOGLE_MAPS_API_KEY.
export default function AddressInput({ value, onChange, onSelect, placeholder, style }) {
  const inputRef = useRef(null)
  const autocompleteRef = useRef(null)

  // Sincronizar valor externo → input (solo si no se está escribiendo)
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
          onChange(addr)
          if (onSelect) {
            onSelect({
              direccion: addr,
              lat: place.geometry?.location?.lat(),
              lng: place.geometry?.location?.lng(),
            })
          }
        }
      })

      autocompleteRef.current = ac
    }

    if (window.google?.maps?.places) {
      init()
      return
    }

    if (!document.querySelector('script[src*="maps.googleapis.com/maps/api"]')) {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`
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
