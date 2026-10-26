import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { supabase } from '../lib/supabase'
import { useRest } from './RestContext'
import { startAlarm, stopAlarm, unlockAudio, requestNotificationPermission, notificarNuevoPedido } from '../lib/alarm'
import { imprimirPedido, hayImpresoraNativa, esEscritorio } from '../lib/printService'
import { reservarImpresion, soltarImpresion, marcarComandaAvisada, comandaAvisada, nacioAceptado } from '../lib/ticketsImpresos'
import { crearDestinoDe } from '../lib/destinosImpresion'
import { redCaida } from '../lib/estadoRed'
// Ciclo de modulos App ↔ este contexto: funciona porque `toast` se llama en
// runtime, mucho despues de inicializar (PedidosEnVivo hace exactamente lo mismo).
import { toast } from '../App'

const PedidoAlertContext = createContext({
  pedidosNuevos: [],
  fetchNuevos: () => {},
  silenciada: false,
  silenciar: () => {},
})

const isNative = Capacitor.isNativePlatform()
// La ALARMA y el aviso de pedido nuevo suenan donde hay un mostrador de verdad:
// la tablet Android Y el ordenador de Windows. Antes todos los candados eran
// `isNative` (solo Capacitor) y en el PC del mostrador un pedido entraba EN
// SILENCIO — con el TPV a pantalla completa, no se enteraba nadie.
const esApp = isNative || esEscritorio

// Saca la comanda de un pedido que ha aceptado el servidor.
//
// Las lineas se piden aqui porque el payload del realtime trae la fila de
// `pedidos` y nada mas: sin `pedido_items` el ticket saldria con el total y sin
// decir que hay que cocinar.
//
// `conTpv` (a10): con el TPV, cada aviso dice el botón de SU papel en Pedidos
// («Reimprimir comanda» / «Imprimir ticket»: allí no hay ningún «Reimprimir»).
// Sin TPV (la pantalla de pedidos de la tablet) se dice lo de siempre.
async function imprimirPedidoAceptadoSolo(p, restaurante, conTpv = false) {
  if (!reservarImpresion(p.id)) return   // ya lo imprimio otro camino
  try {
    const { data: items } = await supabase
      .from('pedido_items').select('*').eq('pedido_id', p.id)
    const destinoDe = await crearDestinoDe(p.establecimiento_id)
    const r = await imprimirPedido(p, items || [], restaurante, destinoDe)
    // 🔴 Se suelta la reserva SOLO si la COMANDA no salio. Antes se soltaba con
    // cualquier fallo (`!r.ok`), y el caso real era: comanda impresa, se acaba
    // el papel, falla el ticket del cliente → reserva suelta → el reintento
    // volvia a imprimir LAS DOS y cocina hacia el pedido dos veces. El ticket
    // del cliente se saca a mano con Reimprimir; una comanda duplicada no se
    // arregla.
    if (!r?.cocina) {
      soltarImpresion(p.id)
      // Se ha pedido que la saquen a mano: la recuperación ya no la saca sola.
      marcarComandaAvisada(p.id)
      toast(`La comanda de ${p.codigo || 'un pedido'} no ha salido por la impresora${conTpv ? ': sácala con «Reimprimir comanda» en Pedidos' : ''}`, 'error')
    } else if (!r?.cliente) {
      toast(conTpv
        ? `${p.codigo || 'Pedido'}: comanda impresa, pero el ticket del cliente no salió: sácalo con «Imprimir ticket» en Pedidos.`
        : `${p.codigo || 'Pedido'}: comanda impresa, pero el ticket del cliente no salio. Usa Reimprimir.`, 'error')
    }
  } catch {
    soltarImpresion(p.id)
    // También es un aviso de «no ha salido»: la recuperación ya no la saca sola.
    // Por eso el aviso dice cuál es y con qué botón se saca.
    marcarComandaAvisada(p.id)
    toast(`No se pudo imprimir la comanda de ${p.codigo || 'un pedido aceptado automaticamente'}${conTpv ? ': sácala con «Reimprimir comanda» en Pedidos' : ''}`, 'error')
  }
}

// ── KIOSKO (14 oct 2026): la comanda sale en cuanto el cliente confirma ─────────
//
// `kiosko-pedido` crea el pedido ya en 'preparando' (es interno del local, nadie lo
// acepta), así que no pasa por el camino de 'nuevo' de abajo. Y la pantalla de
// Pedidos, que es la que imprime los de mesa, en el TPV casi nunca está montada:
// por eso se imprime AQUÍ, que vive por encima del router y siempre escucha.
//
// 🔴 Las líneas se insertan en una segunda llamada, DESPUÉS del pedido: el INSERT
// puede llegar por realtime antes que ellas. Se reintenta unos segundos; una
// comanda sin platos no sirve para nada en la plancha.
//
// La reserva de `ticketsImpresos` es la misma que usa Pedidos para la mesa: si las
// dos pantallas ven el INSERT, solo una saca papel.
async function imprimirPedidoKiosko(p, restaurante, conTpv = false) {
  if (!reservarImpresion(p.id)) return
  try {
    let items = []
    for (let intento = 0; intento < 6 && !items.length; intento++) {
      if (intento) await new Promise((r) => setTimeout(r, 700))
      const { data } = await supabase.from('pedido_items').select('*').eq('pedido_id', p.id)
      items = data || []
    }
    if (!items.length) {
      soltarImpresion(p.id)
      toast(`El pedido ${p.codigo || ''} del kiosko llegó sin productos: revísalo en Pedidos`, 'error')
      return
    }
    const destinoDe = await crearDestinoDe(p.establecimiento_id)
    const r = await imprimirPedido(p, items, restaurante, destinoDe)
    if (!r?.cocina) {
      soltarImpresion(p.id)
      toast(`La comanda del kiosko ${p.codigo || ''} no ha salido por la impresora${conTpv ? ': sácala con «Reimprimir comanda» en Pedidos' : ''}`, 'error')
    }
  } catch {
    soltarImpresion(p.id)
    toast('No se pudo imprimir un pedido del kiosko', 'error')
  }
}

export function PedidoAlertProvider({ children, onNuevoPedido }) {
  const { restaurante, tpvActivo } = useRest()
  // ¿Este local cobra con el TPV? Solo cambia el texto de los avisos de impresión
  // (a10). En una ref porque el realtime de abajo se monta una vez por local.
  // `tpvActivo` y no `tpvConfig.activo`: con el TPV pausado desde Ajustes no se
  // llega a su Pedidos, y el aviso no puede mandar a un botón que no se ve.
  const conTpvRef = useRef(false)
  useEffect(() => { conTpvRef.current = !!tpvActivo }, [tpvActivo])
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
    if ((data || []).length > 0 && esApp && !silenciadaRef.current) startAlarm()
  }, [restaurante?.id])

  // Realtime global — vive en el provider, por encima del router,
  // así la alarma sigue sonando aunque cambies de sección
  useEffect(() => {
    if (!restaurante) return
    requestNotificationPermission()
    // Pequeño retry: si la sesión Supabase aún no está completamente lista al
    // arrancar la app (caso típico al abrir desde un push o recién logueado),
    // el primer fetch puede devolver vacío. Reintentamos a los 1500ms si la
    // suscripción realtime aún no había confirmado SUBSCRIBED.
    let subscribed = false
    let retryT = null
    fetchNuevos()
    retryT = setTimeout(() => { if (!subscribed) fetchNuevos() }, 1500)

    // 🔴 LO QUE EL SERVIDOR ACEPTÓ SOLO MIENTRAS ESTE APARATO NO ESCUCHABA
    // (revisión del 24 oct 2026, punto 12 del informe 05). Con la aceptación
    // automática, la comanda sale con el UPDATE a 'preparando' del realtime (más
    // abajo). Durante un corte ese aviso no llega y al reconectar no se reenvía:
    // los pedidos de la web y de Lucía aceptados en el corte no salían NUNCA por
    // la impresora, y el repartidor llegaba a por un pedido que la cocina no
    // había visto. Ahora se apunta desde cuándo no se escucha (el canal se cae o
    // la red se da por caída) y, al volver, se buscan los aceptados desde
    // entonces (con 2 min de margen) que sigan en 'preparando', y se sacan como
    // si hubiera llegado su aviso. La reserva de `ticketsImpresos` evita sacar dos
    // veces el que ya salió en este aparato; los que nacieron aceptados y los que
    // este aparato ya avisó como fallidos se saltan (ver el bucle).
    let sordoDesde = null
    let recuperando = false
    // ¿El canal de realtime está escuchando? Si la red vuelve antes de que el
    // canal se reconecte, lo aceptado en ese hueco tampoco llegaría: entonces se
    // busca, pero NO se da por recuperado hasta que el canal vuelva (y se mira
    // otra vez entonces; la reserva evita sacar dos veces el mismo).
    let canalVivo = false
    const marcarSordo = () => { if (sordoDesde == null) sordoDesde = Date.now() }
    const recuperarAceptados = async () => {
      if (sordoDesde == null || recuperando) return
      if (!restaurante?.auto_aceptar || !hayImpresoraNativa) { sordoDesde = null; return }
      recuperando = true
      // Como mucho 3 h atrás: un pedido aceptado hace más y aún «en preparación»
      // ya no espera su comanda (un PC que ha estado dormido no saca la noche).
      const desde = new Date(Math.max(sordoDesde - 2 * 60000, Date.now() - 3 * 3600000)).toISOString()
      try {
        const { data, error } = await supabase.from('pedidos').select('*')
          .eq('establecimiento_id', restaurante.id)
          .eq('canal', 'pido')
          .eq('estado', 'preparando')
          .gte('aceptado_at', desde)
          .order('aceptado_at', { ascending: true })
          .limit(50)
        if (error) return               // se vuelve a intentar con el siguiente aviso
        if (canalVivo) sordoDesde = null
        for (const p of data || []) {
          // El kiosko sale con su INSERT (no con un UPDATE) y el mostrador no se acepta.
          if (p.kiosko || p.origen_pedido === 'tpv') continue
          // Revisión del 25 oct: solo lo que se perdió de verdad, lo mismo que el
          // camino en vivo saca al recibir el aviso de «aceptado».
          //   - Nació aceptado (el telefónico del TPV: se inserta ya en
          //     'preparando'). Nadie lo aceptó, su comanda la saca el aparato que
          //     lo crea; sacarla aquí era una segunda en cocina.
          //   - ESTE aparato ya la intentó, no salió y pidió sacarla a mano con
          //     «Reimprimir comanda». Sacarla ahora sola, sin avisar, daría dos.
          if (nacioAceptado(p) || comandaAvisada(p.id)) continue
          imprimirPedidoAceptadoSolo(p, restaurante, conTpvRef.current)
        }
      } catch { /* sin red: se vuelve a intentar con el siguiente aviso */ } finally {
        recuperando = false
      }
    }
    const alCambiarRed = () => { if (redCaida()) marcarSordo(); else recuperarAceptados() }
    window.addEventListener('pidoo:red', alCambiarRed)

    const channel = supabase.channel('pedidos-rest-' + restaurante.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'pedidos',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        if (payload.new.canal !== 'pido') return
        // Kiosko: nace en cocina. Suena el aviso corto (no la alarma, que no se calla
        // hasta que alguien acepta y aquí no hay nada que aceptar) y sale la comanda.
        if (payload.new.kiosko && payload.new.origen_pedido === 'mesa') {
          if (esApp) notificarNuevoPedido(payload.new.codigo)
          if (hayImpresoraNativa) imprimirPedidoKiosko(payload.new, restaurante, conTpvRef.current)
          return
        }
        // Solo pedidos PAGADOS (estado 'nuevo'). Un pedido con tarjeta se inserta
        // primero como 'pendiente_pago' y NO debe avisar al restaurante ni sonar
        // la alarma hasta que el pago se confirme (pasa a 'nuevo' vía UPDATE).
        if (payload.new.estado !== 'nuevo') return
        setPedidosNuevos(prev => {
          if (prev.some(p => p.id === payload.new.id)) return prev
          return [payload.new, ...prev]
        })
        // Al llegar un pedido nuevo, resetear estado silenciado → vuelve a sonar
        setSilenciada(false)
        silenciadaRef.current = false
        if (esApp) {
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
        if (p.estado === 'nuevo') {
          // Transición a 'nuevo' (p.ej. 'pendiente_pago' → 'nuevo' al confirmarse
          // el pago con tarjeta): AHORA sí entra como pedido nuevo y suena.
          setPedidosNuevos(prev => {
            if (prev.some(x => x.id === p.id)) return prev
            return [p, ...prev]
          })
          setSilenciada(false)
          silenciadaRef.current = false
          if (esApp) {
            startAlarm()
            notificarNuevoPedido(p.codigo)
          }
          if (onNuevoPedidoRef.current) onNuevoPedidoRef.current(p)
        } else {
          // 🔴 ACEPTADO POR EL SERVIDOR: hay que sacar la comanda AQUI.
          //
          // Con la aceptacion automatica no hay nadie pulsando "Aceptar", asi que
          // no pasa por `PedidosEnVivo`. Y esa pantalla solo imprime si esta
          // montada: en el TPV vive detras de una capa que casi siempre esta
          // cerrada, con el mostrador delante. Este provider vive por encima del
          // router, asi que se entera pase lo que pase.
          //
          // `hayImpresoraNativa` y no Capacitor: la app de WINDOWS tambien tiene
          // socket a la impresora, y preguntando por Capacitor el ordenador del
          // mostrador se quedaria sin papel.
          if (p.estado === 'preparando' && restaurante?.auto_aceptar && hayImpresoraNativa) {
            imprimirPedidoAceptadoSolo(p, restaurante, conTpvRef.current)
          }
          setPedidosNuevos(prev => {
            const remaining = prev.filter(x => x.id !== p.id)
            if (remaining.length === 0) stopAlarm()
            return remaining
          })
        }
      })
      .subscribe(status => {
        // Cuando la suscripción se confirma (SUBSCRIBED), refrescamos la lista
        // por si llegó un INSERT entre el fetchNuevos inicial y la suscripción
        // (race condition al abrir la app desde push).
        if (status === 'SUBSCRIBED') {
          subscribed = true
          canalVivo = true
          fetchNuevos()
          // Vuelve a escuchar tras haberse caído: lo aceptado mientras tanto.
          recuperarAceptados()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          canalVivo = false
          marcarSordo()
        }
      })

    return () => {
      if (retryT) clearTimeout(retryT)
      window.removeEventListener('pidoo:red', alCambiarRed)
      supabase.removeChannel(channel)
    }
  }, [restaurante?.id, fetchNuevos])

  // Refetch al volver al foreground (Capacitor) o al recuperar visibilidad
  // de la pestaña (web). Esto evita el bug clásico de "abro la app desde
  // un push y los pedidos no aparecen": realtime puede haberse desconectado
  // mientras la app estaba en background, y solo se reconecta cuando vuelve.
  useEffect(() => {
    if (!restaurante) return

    const refresh = () => { fetchNuevos() }

    let appListenerHandle = null
    if (Capacitor.isNativePlatform()) {
      // Capacitor App: dispara cada vez que la app vuelve al primer plano
      try {
        const p = CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) refresh()
        })
        // Algunas versiones de @capacitor/app retornan Promise<PluginListenerHandle>
        if (p && typeof p.then === 'function') {
          p.then(h => { appListenerHandle = h }).catch(() => {})
        } else {
          appListenerHandle = p
        }
      } catch (_) {}
    }

    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      try {
        if (appListenerHandle) {
          if (typeof appListenerHandle.remove === 'function') appListenerHandle.remove()
          else if (typeof appListenerHandle.then === 'function') {
            appListenerHandle.then(h => h && h.remove && h.remove()).catch(() => {})
          }
        }
      } catch (_) {}
    }
  }, [restaurante?.id, fetchNuevos])

  // Polling de respaldo (SOLO nativo): red de seguridad por si el canal realtime
  // muere en silencio (blip de red con la app en primer plano, sin evento
  // focus/online que dispare el refetch). En un tablet de restaurante abierto
  // todo el día eso = pedidos que no aparecen → ventas perdidas. Un poll cada
  // 25s garantiza que un pedido pagado se vea y suene la alarma aunque el
  // realtime esté caído. Coste mínimo: 1 query de pocas filas.
  useEffect(() => {
    if (!restaurante || !esApp) return
    const id = setInterval(() => { fetchNuevos() }, 25000)
    return () => clearInterval(id)
  }, [restaurante?.id, fetchNuevos])

  // Guardia: si hay pedidos nuevos y no está silenciada, la alarma debe estar
  // sonando. Cubre casos extremos (recarga con pedidos ya en BD, o stopAlarm
  // llamado desde otro punto).
  useEffect(() => {
    if (!esApp) return
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
