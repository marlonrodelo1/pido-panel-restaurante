import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { useRest } from './RestContext'
import { startAlarm, stopAlarm, unlockAudio, requestNotificationPermission, notificarNuevoPedido } from '../lib/alarm'

const PedidoAlertContext = createContext({
  pedidosNuevos: [],
  fetchNuevos: () => {},
  silenciada: false,
  silenciar: () => {},
})

const isNative = Capacitor.isNativePlatform()

export function PedidoAlertProvider({ children, onNuevoPedido }) {
  const { restaurante } = useRest()
  const [pedidosNuevos, setPedidosNuevos] = useState([])
  // silenciada = el usuario pulsó "Silenciar"; se resetea cuando la lista se vacía
  // o cuando llega un pedido nuevo después (queremos que un nuevo pedido vuelva a sonar).
  const [silenciada, setSilenciada] = useState(false)
  const silenciadaRef = useRef(false)
  useEffect(() => { silenciadaRef.current = silenciada }, [silenciada])

  const onNuevoPedidoRef = useRef(onNuevoPedido)
  useEffect(() => { onNuevoPedidoRef.current = onNuevoPedido }, [onNuevoPedido])

  const silenciar = useCallback(() => {
    setSilenciada(true)
    stopAlarm()
  }, [])

  const fetchNuevos = useCallback(async () => {
    if (!restaurante) return
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .eq('establecimiento_id', restaurante.id)
      .eq('estado', 'nuevo')
      .eq('canal', 'pido')
      .order('created_at', { ascending: false })
    setPedidosNuevos(data || [])
    if ((data || []).length > 0 && isNative && !silenciadaRef.current) startAlarm()
  }, [restaurante?.id])

  // Realtime global — vive en el provider, por encima del router,
  // así la alarma sigue sonando aunque cambies de sección
  useEffect(() => {
    if (!restaurante) return
    requestNotificationPermission()
    fetchNuevos()

    const channel = supabase.channel('pedidos-rest-' + restaurante.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        if (payload.new.canal !== 'pido') return
        setPedidosNuevos(prev => {
          if (prev.some(p => p.id === payload.new.id)) return prev
          return [payload.new, ...prev]
        })
        // Al llegar un pedido nuevo, resetear estado silenciado → vuelve a sonar
        setSilenciada(false)
        silenciadaRef.current = false
        if (isNative) {
          startAlarm()
          notificarNuevoPedido(payload.new.codigo)
        }
        if (onNuevoPedidoRef.current) onNuevoPedidoRef.current(payload.new)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        if (payload.new.canal !== 'pido') return
        const p = payload.new
        if (p.estado !== 'nuevo') {
          setPedidosNuevos(prev => {
            const remaining = prev.filter(x => x.id !== p.id)
            if (remaining.length === 0) stopAlarm()
            return remaining
          })
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurante?.id, fetchNuevos])

  // Guardia: si hay pedidos nuevos y no está silenciada, la alarma debe estar
  // sonando. Cubre casos extremos (recarga con pedidos ya en BD, o stopAlarm
  // llamado desde otro punto).
  useEffect(() => {
    if (!isNative) return
    if (pedidosNuevos.length > 0 && !silenciada) {
      startAlarm()
    } else if (pedidosNuevos.length === 0) {
      stopAlarm()
    }
  }, [pedidosNuevos.length, silenciada])

  // Reset del estado silenciado cuando la lista de pedidos nuevos se vacía
  useEffect(() => {
    if (pedidosNuevos.length === 0 && silenciada) {
      setSilenciada(false)
    }
  }, [pedidosNuevos.length, silenciada])

  // Desbloquear audio al primer toque
  useEffect(() => {
    const handler = () => unlockAudio()
    document.addEventListener('click', handler, { once: true })
    document.addEventListener('touchstart', handler, { once: true })
    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [])

  return (
    <PedidoAlertContext.Provider value={{ pedidosNuevos, fetchNuevos, silenciada, silenciar }}>
      {children}
    </PedidoAlertContext.Provider>
  )
}

export const usePedidoAlert = () => useContext(PedidoAlertContext)
