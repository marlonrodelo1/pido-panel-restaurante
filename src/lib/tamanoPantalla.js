// Los tres tamaños de pantalla del TPV, en un solo sitio.
//
// Vivían dentro de `Tpv.jsx`, privados, y la pantalla de nuevo pedido no podía
// usarlos: por eso se pintaba igual en un móvil que en un monitor de 27".
//
// Los cortes NO son los de Tailwind por casualidad:
//   - 760 px separa TELÉFONO de tablet. Deja fuera al iPad en vertical (768), que
//     es el aparato con el que se cobra en la barra.
//   - 1280 px separa MONITOR de tablet. Es a partir de ahí cuando caben tres
//     columnas sin que ninguna quede inservible.
import { useState, useEffect } from 'react'

function useMedia(consulta) {
  const [valor, setValor] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const on = (e) => setValor(e.matches)
    // Se lee otra vez al montar: entre el primer render y este efecto la ventana
    // puede haber cambiado (rotar la tablet, abrir el panel ya maximizado).
    setValor(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [consulta])
  return valor
}

export const useEsMonitor = () => useMedia('(min-width: 1280px)')
export const useEsMovil = () => useMedia('(max-width: 760px)')
