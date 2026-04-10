import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from './RestContext'
import { startAlarm, stopAlarm, unlockAudio, requestNotificationPermission, notificarNuevoPedido } from '../lib/alarm'

const PedidoAlertContext = createContext({ pedidosNuevos: [], fetchNuevos: () => {} })

export function PedidoAlertProvider({ children, onNuevoPedido }) {
  const { restaurante } = useRest()
  const [pedidosNuevos, setPedidosNuevos] = useState([])
  const onNuevoPedidoRef = useRef(onNuevoPedido)
  useEffect(() => { onNuevoPedidoRef.current = onNuevoPedido }, [onNuevoPedido])

  const fetchNuevos = useCallback(async () => {
    if (!restaurante) return
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .eq('establecimiento_id', restaurante.id)
      .eq('estado', 'nuevo')
      .order('created_at', { ascending: false })
    setPedidosNuevos(data || [])
    if ((data || []).length > 0) startAlarm()
  }, [restaurante?.id])

  // Realtime global — suena en CUALQUIER pantalla
  useEffect(() => {
    if (!restaurante) return
    requestNotificationPermission()
    fetchNuevos()

    const channel = supabase.channel('pedidos-rest-global')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        setPedidosNuevos(prev => [payload.new, ...prev])
        startAlarm()
        notificarNuevoPedido(payload.new.codigo)
        if (onNuevoPedidoRef.current) onNuevoPedidoRef.current(payload.new)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        const p = payload.new
        if (p.estado !== 'nuevo') {
          // Pedido ya no es nuevo (aceptado, cancelado, etc.) — quitar de la lista
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
    <PedidoAlertContext.Provider value={{ pedidosNuevos, fetchNuevos }}>
      {children}
    </PedidoAlertContext.Provider>
  )
}

export const usePedidoAlert = () => useContext(PedidoAlertContext)
