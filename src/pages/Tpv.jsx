// TPV — la pantalla con la que se cobra en el MOSTRADOR del local.
//
// Se usa cien veces al día con alguien esperando delante, así que la regla que
// manda sobre todas las demás es: pocos toques por venta y ninguna espera evitable.
//
// Cosas que NO se hacen aquí, a propósito:
//   - No se calculan precios para cobrar. Se mandan los IDS de producto y de extras,
//     y el servidor pone el precio de barra y suma los extras leyéndolos de la base
//     de datos. Lo que se pinta en pantalla es orientativo; lo que se cobra es lo que
//     devuelve `tpv-venta`.
//   - No se espera a la impresora para dar la venta por buena. Primero se graba,
//     luego se imprime. Una impresora apagada no puede costar una venta.
//   - El dinero se cuenta en CÉNTIMOS enteros. Nunca en decimales: 0.1 + 0.2 no
//     es 0.3 y el cambio de un cliente no es sitio para descubrirlo.
//
// TEMA OSCURO, y sus dos reglas de contraste (medidas, no supuestas):
//   - El acento es `#FF6B2C` (el naranja de la app cliente), NO el terracota del
//     panel: sobre negro el terracota se queda en 3,7:1 y no llega a AA.
//   - Sobre el naranja el texto va OSCURO. Blanco sobre #FF6B2C da 2,84:1 y no pasa;
//     #1A1815 encima da 6,24:1.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { usePedidoAlert } from '../context/PedidoAlertContext'
import { toast } from '../App'
import {
  imprimirTicketTpv, imprimirComandaTpv, imprimirInformeDiaTpv,
  pulsoCajon, getPrinterConfig, checkPrinterConnection,
} from '../lib/printService'
import {
  Search, Plus, Minus, Trash2, Printer, Banknote, CreditCard, X, AlertTriangle,
  Menu, ChefHat, FileText, Inbox, Calculator, Bike, Wallet, ArrowDownLeft, ArrowUpRight, Lock,
  Boxes, ClipboardCheck, ClipboardList, Clock, ToggleLeft, PhoneCall, ArrowLeft,
  ShoppingBag,
  Sandwich, Croissant, Beef, Beer, CupSoda, Coffee, Pizza, Salad, CakeSlice, IceCream,
  Fish, Drumstick, Soup, Cookie, Utensils, Wine, Ham, Popcorn, Carrot, EggFried,
} from 'lucide-react'

import { T, FONT, cents, eur, caja, btnIcono, btnAccion, btnSecundario } from '../lib/tpvTheme'
import TpvPedidos from '../components/TpvPedidos'
import TpvCaja from '../components/TpvCaja'
import TpvNuevoPedido from '../components/TpvNuevoPedido'
import TpvStock from '../components/TpvStock'
import PedidosEnVivo from './PedidosEnVivo'
import HistorialMovil from './HistorialMovil'
import DisponibilidadProductos from './DisponibilidadProductos'
import ConfigImpresora from './ConfigImpresora'
import CrearEnvio from './CrearEnvio'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Un TELEFONO no es una tablet estrecha. En 375 px las dos columnas del mostrador se
// apilan y el ticket queda debajo de toda la carta: para cobrar habria que bajar 77
// productos. El corte esta en 760 px, que deja fuera al iPad en vertical (768).
function useEsMovil() {
  const [movil, setMovil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const on = (e) => setMovil(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return movil
}



// Icono por categoría. Se mira el nombre porque `categorias` no guarda ningún icono
// ni imagen. Con la carta de un bar (bocadillos, croissants, papas, perritos…) el
// mapa de ilustraciones que hay en `lib/food.jsx` mandaría casi todo al icono de
// pizza, así que aquí se usa lucide, que ya está en el proyecto.
const ICONOS = [
  [/bocadill|sandwi|sándwi|montad/i, Sandwich],
  [/croissa|bolleri|bollería|dulce/i, Croissant],
  [/hamburg|burger/i, Beef],
  [/perrit|salchich|hot ?dog/i, Drumstick],
  [/cervez|alcoh|copa|cubata/i, Beer],
  [/vino|tinto|blanco|rioja/i, Wine],
  [/refresc|bebid|zumo|agua/i, CupSoda],
  [/caf[eé]|infusi|t[eé]\b|desayun/i, Coffee],
  [/pizza/i, Pizza],
  [/ensalad|verdur|vegetal/i, Salad],
  [/postre|tarta|pastel/i, CakeSlice],
  [/helad|granizad/i, IceCream],
  [/pescad|marisc|at[uú]n/i, Fish],
  [/sopa|crema|caldo|guiso/i, Soup],
  [/galle|snack|aperitiv/i, Cookie],
  [/jam[oó]n|ib[eé]ric|embutid/i, Ham],
  [/papa|patata|frit/i, Popcorn],
  [/tortill|huevo/i, EggFried],
  [/extra|complement|salsa/i, Carrot],
]
const iconoDe = (nombre) => (ICONOS.find(([re]) => re.test(nombre || ''))?.[1]) || Utensils

const PANTALLAS = {
  pedidos: 'Pedidos',
  'crear-envio': 'Pedido telefónico',
  historial: 'Historial',
  disponibilidad: 'Carta',
  impresora: 'Impresora y cuenta',
}

export default function Tpv({ modoApp = false }) {
  const { restaurante, tpvConfig, stockActivo } = useRest()
  const { pedidosNuevos } = usePedidoAlert()

  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [tamanos, setTamanos] = useState([])
  const [grupos, setGrupos] = useState([])
  const [vinculos, setVinculos] = useState([])
  const [cargando, setCargando] = useState(true)

  // La categoría elegida no se vacía nunca: la tira de arriba está siempre a la
  // vista y debajo se ven sus productos. Al entrar se selecciona la primera, para
  // que nadie se encuentre la pantalla vacía.
  const [catSel, setCatSel] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [carrito, setCarrito] = useState([])
  const [configurando, setConfigurando] = useState(null)

  const [cobrando, setCobrando] = useState(false)
  const [modalPago, setModalPago] = useState(false)
  const [menu, setMenu] = useState(false)
  const [pestana, setPestana] = useState('mostrador')
  const [modalCaja, setModalCaja] = useState(false)
  const [cajaVista, setCajaVista] = useState('resumen')
  // Con `modoApp`, el TPV es la aplicacion entera y las demas pantallas se abren
  // ENCIMA en esta capa. No se sustituye el TPV: si se desmontara, el carrito a
  // medias se perderia con el cliente delante.
  const [pantalla, setPantalla] = useState(null)
  const [modalStock, setModalStock] = useState(false)
  const [stockVista, setStockVista] = useState('existencias')
  const [nuevoPedido, setNuevoPedido] = useState(null)   // 'reparto' | 'recogida'
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [impresora, setImpresora] = useState({ configurada: false, viva: null })

  // Un pedido nuevo NO se lleva la pantalla por delante: si estas cobrando a alguien
  // en la barra, saltar a Pedidos solo es quitarle el mostrador de las manos al
  // camarero. Sale un aviso encima de todo, imposible de no ver, y se entra cuando
  // se puede. `avisoFuera` guarda el ultimo pedido que se aparto: si entra OTRO
  // despues, el aviso vuelve a salir.
  const esMovil = useEsMovil()
  // En el telefono la venta se ve en una hoja a pantalla completa. Empieza cerrada:
  // lo que se toca cien veces al dia es la carta, no el ticket.
  const [hojaVenta, setHojaVenta] = useState(false)

  const [avisoFuera, setAvisoFuera] = useState(null)
  const pedidoAvisado = pedidosNuevos?.[0] || null
  const hayAviso = modoApp && pedidoAvisado && avisoFuera !== pedidoAvisado.id && pantalla !== 'pedidos'

  // Volver a Pedidos desde donde sea. `TpvPedidos` y `CrearEnvio` piden ir alli con
  // este evento; en la shell normal lo recoge `App.jsx`, pero aqui NO hay secciones
  // y sin esto tocar una tarjeta de pedido no haria absolutamente nada.
  useEffect(() => {
    if (!modoApp) return
    const ir = (e) => {
      const d = e?.detail
      if (PANTALLAS[d]) setPantalla(d)
    }
    window.addEventListener('pidoo:goto', ir)
    return () => window.removeEventListener('pidoo:goto', ir)
  }, [modoApp])

  const idemRef = useRef(null)
  const enVueloRef = useRef(false)

  useEffect(() => {
    if (!restaurante?.id) return
    let vivo = true
    ;(async () => {
      const [cats, prods, gru] = await Promise.all([
        supabase.from('categorias').select('id, nombre, orden')
          .eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden'),
        supabase.from('productos').select('id, nombre, precio, precio_local, categoria_id, disponible, orden, imagen_url')
          .eq('establecimiento_id', restaurante.id).order('orden'),
        supabase.from('grupos_extras').select('id, nombre, tipo, max_selecciones, extras_opciones(id, nombre, precio, orden)')
          .eq('establecimiento_id', restaurante.id),
      ])
      if (!vivo) return
      const listaProd = (prods.data || []).filter((p) => p.disponible !== false)
      setCategorias(cats.data || [])
      setProductos(listaProd)
      setCatSel((actual) => actual || cats.data?.[0]?.id || null)
      // Los grupos llegan con sus opciones anidadas; no hace falta aplanarlas.
      setGrupos(gru.data || [])
      if (listaProd.length) {
        const ids = listaProd.map((p) => p.id)
        const [tam, vin] = await Promise.all([
          supabase.from('producto_tamanos').select('id, producto_id, nombre, precio, precio_local, orden')
            .in('producto_id', ids).order('orden'),
          supabase.from('producto_extras').select('producto_id, grupo_id').in('producto_id', ids),
        ])
        if (vivo) { setTamanos(tam.data || []); setVinculos(vin.data || []) }
      }
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [restaurante?.id])

  // La impresora se sondea AL ENTRAR, no al cobrar: enterarse de que está apagada
  // con el cliente delante y el cajón cerrado es demasiado tarde.
  useEffect(() => {
    const cfg = getPrinterConfig()
    if (!cfg.ip || !cfg.enabled) { setImpresora({ configurada: false, viva: null }); return }
    setImpresora({ configurada: true, viva: null })
    checkPrinterConnection(cfg.ip, cfg.port)
      .then((ok) => setImpresora({ configurada: true, viva: !!ok }))
      .catch(() => setImpresora({ configurada: true, viva: false }))
  }, [])

  const tamanosDe = useMemo(() => {
    const m = {}
    for (const t of tamanos) (m[t.producto_id] ||= []).push(t)
    return m
  }, [tamanos])

  const gruposDe = useMemo(() => {
    const m = {}
    for (const v of vinculos) {
      const g = grupos.find((x) => x.id === v.grupo_id)
      if (g) (m[v.producto_id] ||= []).push(g)
    }
    return m
  }, [vinculos, grupos])

  const contarPorCategoria = useMemo(() => {
    const m = {}
    for (const p of productos) m[p.categoria_id] = (m[p.categoria_id] || 0) + 1
    return m
  }, [productos])

  // Cuántas unidades de cada producto llevas ya, para el contador de la esquina:
  // se ve lo que va picado sin tener que leer el ticket de al lado.
  const enCarritoPorProducto = useMemo(() => {
    const m = {}
    for (const l of carrito) m[l.producto_id] = (m[l.producto_id] || 0) + l.cantidad
    return m
  }, [carrito])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (q) return productos.filter((p) => p.nombre.toLowerCase().includes(q))
    if (!catSel) return []
    return productos.filter((p) => p.categoria_id === catSel)
  }, [productos, catSel, busqueda])

  const precioBarra = (p, tam) => cents(tam ? (tam.precio_local ?? tam.precio) : (p.precio_local ?? p.precio))

  const totalCarrito = carrito.reduce((s, l) => s + l.precio_c * l.cantidad, 0)
  const totalUnidades = carrito.reduce((s, l) => s + l.cantidad, 0)

  function anadir(producto, tam = null, extrasElegidos = []) {
    // La clave lleva la firma de tamaño y extras: dos cafés iguales se agrupan, pero
    // uno con bacon y otro sin él son dos líneas distintas.
    const firma = [producto.id, tam?.nombre || '', ...extrasElegidos.map((o) => o.id).sort()].join('|')
    const extrasC = extrasElegidos.reduce((s, o) => s + Math.max(0, cents(o.precio)), 0)
    setCarrito((prev) => {
      const i = prev.findIndex((l) => l.clave === firma)
      if (i >= 0) {
        const copia = [...prev]
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + 1 }
        return copia
      }
      return [...prev, {
        clave: firma,
        producto_id: producto.id,
        nombre: producto.nombre,
        tamano: tam?.nombre || null,
        extras: extrasElegidos.map((o) => o.id),
        extrasTexto: extrasElegidos.map((o) => o.nombre).join(', '),
        precio_c: precioBarra(producto, tam) + extrasC,
        cantidad: 1,
      }]
    })
  }

  function tocarProducto(p) {
    const tams = tamanosDe[p.id] || []
    const grs = gruposDe[p.id] || []
    if (tams.length || grs.length) { setConfigurando({ producto: p, tamanos: tams, grupos: grs }); return }
    anadir(p)
  }

  // Al añadir unidades a algo que ya se mandó a cocina, la línea vuelve a contar
  // como pendiente: si no, el segundo café de la ronda no llegaría nunca.
  const cambiarCantidad = (clave, delta) => setCarrito((prev) => prev
    .map((l) => (l.clave === clave
      ? { ...l, cantidad: l.cantidad + delta, comandada: delta > 0 ? false : l.comandada }
      : l))
    .filter((l) => l.cantidad > 0))

  const sinComandar = carrito.filter((l) => !l.comandada)

  async function comandar() {
    if (!sinComandar.length) { toast('No hay nada nuevo que mandar a cocina'); return }
    const ok = await imprimirComandaTpv(sinComandar, restaurante)
    if (!ok) { toast('La impresora no responde: la comanda no ha salido', 'error'); return }
    setCarrito((prev) => prev.map((l) => ({ ...l, comandada: true })))
    toast('Comanda enviada a cocina', 'success')
  }

  async function informeDelDia() {
    const desde = new Date(); desde.setHours(0, 0, 0, 0)
    const { data, error } = await supabase.from('tpv_tickets')
      .select('serie, numero, total, base_imponible, cuota_igic, metodo_pago')
      .eq('establecimiento_id', restaurante.id)
      .gte('emitido_at', desde.toISOString())
      .order('numero')
    if (error) { toast('No se pudo leer el día: ' + error.message, 'error'); return }
    const t = data || []
    if (!t.length) { toast('Hoy todavía no se ha cobrado nada'); return }
    const suma = (f) => t.reduce((s, x) => s + Number(f(x) || 0), 0)
    const resumen = {
      tickets: t.length,
      articulos: t.length,
      efectivo: t.filter((x) => x.metodo_pago === 'efectivo').reduce((s, x) => s + Number(x.total || 0), 0),
      datafono: t.filter((x) => x.metodo_pago === 'datafono').reduce((s, x) => s + Number(x.total || 0), 0),
      total: suma((x) => x.total),
      base: suma((x) => x.base_imponible),
      igic: suma((x) => x.cuota_igic),
      primero: `${t[0].serie}-${t[0].numero}`,
      ultimo: `${t[t.length - 1].serie}-${t[t.length - 1].numero}`,
    }
    const ok = await imprimirInformeDiaTpv(resumen, restaurante)
    toast(ok
      ? `Informe impreso · ${t.length} tickets · ${eur(cents(resumen.total))}`
      : `Hoy: ${t.length} tickets, ${eur(cents(resumen.total))} (la impresora no responde)`,
      ok ? 'success' : 'error')
  }

  function vaciar() {
    if (sinComandar.length && carrito.length !== sinComandar.length) {
      // Si parte ya se mandó a cocina, vaciar sin avisar deja platos hechos que
      // nadie va a cobrar.
      toast('Ojo: parte de esta venta ya está en cocina', 'error')
    }
    setCarrito([])
  }

  // Una venta = una clave, y se genera aquí, antes de elegir cómo se paga: si el
  // dedo se va dos veces, las dos llamadas llevan la misma y el servidor devuelve
  // el mismo ticket en vez de cobrar dos veces.
  function nuevaVenta() {
    idemRef.current = (crypto?.randomUUID?.() || String(Date.now()) + Math.random())
  }

  function cobrarEnEfectivo() {
    if (!carrito.length) return
    nuevaVenta()
    setModalPago(true)      // hace falta preguntar con cuánto paga, para el cambio
  }

  function cobrarConTarjeta() {
    if (!carrito.length) return
    nuevaVenta()
    // Con tarjeta no hay cambio que calcular: el importe se teclea en el datáfono
    // y aquí solo se deja constancia. Un paso menos en cada venta con tarjeta.
    cobrar('datafono', null)
  }

  async function cobrar(metodo_pago, entregado_c = null) {
    if (enVueloRef.current) return
    enVueloRef.current = true
    setCobrando(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-venta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          establecimiento_id: restaurante.id,
          metodo_pago,
          entregado_efectivo: entregado_c != null ? entregado_c / 100 : null,
          idempotency_key: idemRef.current,
          lineas: carrito.map((l) => ({
            producto_id: l.producto_id, tamano: l.tamano, cantidad: l.cantidad, extras: l.extras,
          })),
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body?.ok) {
        throw new Error(({
          tpv_no_contratado: 'Este restaurante no tiene el TPV activado.',
          tpv_no_activo: 'El TPV está desactivado. Habla con Pidoo.',
          tpv_pausado: 'Tienes el TPV pausado desde Ajustes.',
          forbidden: 'Esta cuenta no puede cobrar en este restaurante.',
        })[body?.error] || body?.detalle || body?.error || 'No se pudo completar la venta')
      }

      // A partir de aquí LA VENTA YA ESTÁ COBRADA Y GRABADA.
      setUltimaVenta(body)
      setCarrito([])
      setModalPago(false)
      if (body.sin_ticket) toast('Venta guardada, pero sin número de ticket. Avisa a Pidoo.', 'error')
      else toast(`Cobrado ${eur(cents(body.pedido?.total))}${body.repetida ? ' (ya estaba cobrado)' : ''}`, 'success')

      if (body.ticket) {
        imprimirTicketTpv(body.ticket, body.pedido, body.items, body.establecimiento, {
          pieTicket: body.config?.pie_ticket,
          abrirCajonTambien: !!body.config?.abrir_cajon,
        }).then((r) => {
          if (!r.ticket && impresora.configurada) toast('No se pudo imprimir el ticket', 'error')
        }).catch(() => {})
      }
    } catch (err) {
      toast(err.message || 'Error al cobrar', 'error')
    } finally {
      enVueloRef.current = false
      setCobrando(false)
    }
  }

  async function reimprimir() {
    if (!ultimaVenta?.ticket) return
    const r = await imprimirTicketTpv(ultimaVenta.ticket, ultimaVenta.pedido, ultimaVenta.items,
      ultimaVenta.establecimiento, { pieTicket: ultimaVenta.config?.pie_ticket })
    toast(r.ticket ? 'Ticket reimpreso' : 'La impresora no responde', r.ticket ? 'success' : 'error')
  }

  if (!tpvConfig?.activo) {
    return (
      <div style={{ ...caja, padding: 40, textAlign: 'center' }}>
        <Utensils size={32} color={T.muted} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>El TPV no está activado</div>
        <div style={{ fontSize: 14, marginTop: 6, color: T.muted }}>Lo activa Pidoo para tu restaurante.</div>
      </div>
    )
  }


  return (
    <div style={modoApp
      // Como app, la caja ES la pantalla: sin esquinas redondeadas ni tope de alto.
      ? { ...caja, padding: esMovil ? 10 : 16, borderRadius: 0, minHeight: '100vh' }
      : esMovil ? { ...caja, padding: 10, borderRadius: 12 } : caja}>
      {/* Mostrador y Pedidos en la misma pantalla: durante el servicio no se puede
          estar saltando de una sección a otra. No hay pestaña de Reservas porque
          Pidoo no tiene reservas: no existe ninguna tabla detrás. */}
      {/* En modo app no hay cabecera de panel detrás, así que el nombre y el estado
          van aquí. El estado importa: si la app se queda sin conexión, el sistema
          cierra el restaurante solo a los 5 minutos y conviene verlo de un vistazo. */}
      {modoApp && <CabeceraApp restaurante={restaurante} esMovil={esMovil}
        onAbrir={() => setPantalla('impresora')} />}

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Pestana activa={pestana === 'mostrador'} onClick={() => setPestana('mostrador')}
            esMovil={esMovil} icono={<Calculator size={esMovil ? 16 : 17} />} texto="Mostrador" />
          <Pestana activa={pestana === 'pedidos'} onClick={() => setPestana('pedidos')}
            esMovil={esMovil} icono={<Bike size={esMovil ? 16 : 17} />} texto="Pedidos"
            contador={pedidosNuevos?.length || 0} />
        </div>
        {/* El menú va en la esquina y no encima del ticket: es de la pantalla
            entera, no de la venta que estés cobrando. La etiqueta dice "del TPV"
            porque el header de la app ya tiene su propio botón de menú. */}
        <button onClick={() => setMenu(true)} aria-label="Menú del TPV" style={{
          ...btnIcono, position: 'absolute', right: 0, top: esMovil ? 4 : 6,
          width: esMovil ? 40 : 44, height: esMovil ? 40 : 44, borderRadius: 12,
        }}>
          <Menu size={20} />
        </button>
      </div>

      {pestana === 'pedidos' ? (
        <TpvPedidos establecimientoId={restaurante.id} onNuevo={(tipo) => setNuevoPedido(tipo)} />
      ) : (
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* ── Izquierda: la carta ─────────────────────────────────────────── */}
      {/* En telefono la carta es TODA la pantalla, y se le deja hueco abajo para que
          la barra de la venta no tape la ultima fila de productos. */}
      <div style={{ flex: '1 1 420px', minWidth: 0, paddingBottom: esMovil ? 84 : 0 }}>
        {impresora.configurada && impresora.viva === false && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 12,
            borderRadius: 12, background: 'rgba(255,122,107,0.12)', color: T.danger,
            fontSize: 13, fontWeight: 600,
          }}>
            <AlertTriangle size={16} />
            Impresora no conectada: no saldrá el ticket y el cajón no se abrirá.
          </div>
        )}

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 15, color: T.muted }} />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto"
            style={{
              width: '100%', height: 46, paddingLeft: 36, paddingRight: 12,
              borderRadius: 12, border: `1px solid ${T.border}`,
              background: T.surface2, color: T.text, fontSize: 15, fontFamily: 'inherit',
            }}
          />
        </div>

        {cargando ? (
          <div style={{ padding: 30, textAlign: 'center', color: T.muted }}>Cargando la carta…</div>
        ) : (
          <>
            {/* La tira de categorías NO desaparece al elegir una: se queda arriba y
                los productos salen debajo. Va en una sola fila con scroll lateral
                porque una rejilla de 16 categorías se comería media tablet. */}
            {/* Fila de categorías al estilo del TPV de Last: botones rectangulares
                bajos, no tarjetas altas — así caben más y sobra sitio para los
                productos, que es lo que de verdad se toca. Se centra cuando cabe y
                se desliza cuando no. */}
            <div style={{ position: 'relative', marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
              {/* En TELEFONO las categorias van en una sola fila que se desliza: no
                  caben y apilarlas se comeria media pantalla de carta. En tablet
                  grande y en escritorio se REPARTEN EN FILAS y se ven TODAS, que es
                  lo que ahorra toques: la categoria que buscas ya esta a la vista. */}
              <div style={{
                display: 'flex', gap: 8, maxWidth: '100%',
                justifyContent: 'center',
                ...(esMovil
                  ? { overflowX: 'auto', paddingBottom: 2, scrollSnapType: 'x proximity' }
                  : { flexWrap: 'wrap' }),
              }}>
                {categorias.map((c) => {
                  const Icono = iconoDe(c.nombre)
                  const activa = c.id === catSel && !busqueda
                  return (
                    <button key={c.id} onClick={() => { setCatSel(c.id); setBusqueda('') }} style={{
                      flex: '0 0 auto', height: esMovil ? 46 : 56, padding: esMovil ? '0 12px' : '0 16px', cursor: 'pointer',
                      scrollSnapAlign: 'start', fontFamily: 'inherit',
                      border: `1px solid ${activa ? T.accent : T.border}`,
                      borderRadius: 12,
                      background: activa ? T.accentFill : T.surface2,
                      color: activa ? T.onAccent : T.text,
                      display: 'flex', alignItems: 'center', gap: 9,
                      fontSize: esMovil ? 13 : 14, fontWeight: activa ? 700 : 500,
                    }}>
                      <Icono size={esMovil ? 16 : 18} color={activa ? T.onAccent : T.accent} />
                      {c.nombre}
                      <span style={{
                        fontSize: 12, opacity: 0.65, fontWeight: 500,
                      }}>{contarPorCategoria[c.id] || 0}</span>
                    </button>
                  )
                })}
              </div>
              {/* El CSS global esconde las barras de scroll, así que sin esta pista
                  visual no hay forma de saber que quedan categorías a la derecha.
                  Cuando van en filas no hay nada a la derecha que insinuar. */}
              {esMovil && (
                <div style={{
                  position: 'absolute', right: 0, top: 0, bottom: 2, width: 24, pointerEvents: 'none',
                  background: `linear-gradient(90deg, rgba(18,16,14,0), ${T.bg})`,
                }} />
              )}
            </div>

            {busqueda && (
              <div style={{ fontSize: 13, color: T.muted, marginBottom: 10, fontWeight: 500 }}>
                Resultados de &quot;{busqueda}&quot;
              </div>
            )}
            <div style={{
              display: 'grid', gap: esMovil ? 8 : 10,
              // 3 columnas en telefono. Con 150 px salen 2 y se ve media carta por
              // pantalla; con 104 entran tres y se llega antes al producto.
              gridTemplateColumns: `repeat(auto-fill, minmax(${esMovil ? 104 : 150}px, 1fr))`,
            }}>
              {visibles.map((p) => {
                const tams = tamanosDe[p.id] || []
                const tieneExtras = (gruposDe[p.id] || []).length > 0
                const yaLleva = enCarritoPorProducto[p.id] || 0
                return (
                  <button key={p.id} onClick={() => tocarProducto(p)} style={{
                    position: 'relative', overflow: 'hidden',
                    minHeight: esMovil ? 78 : 92, padding: 0, textAlign: 'left', cursor: 'pointer',
                    border: `1px solid ${yaLleva ? T.accent : T.border}`, borderRadius: esMovil ? 10 : 12,
                    background: T.surface2,
                    display: 'flex', flexDirection: 'column',
                    fontFamily: 'inherit', color: T.text,
                  }}>
                    {/* La foto solo si existe: hoy la tienen 38 de 160 productos, y
                        una caja gris con un icono de "sin imagen" es peor que nada. */}
                    {p.imagen_url && (
                      <img src={p.imagen_url} alt="" loading="lazy" style={{
                        width: '100%', height: esMovil ? 58 : 74, objectFit: 'cover', display: 'block',
                      }} />
                    )}
                    {yaLleva > 0 && (
                      <span style={{
                        position: 'absolute', top: 5, right: 5,
                        minWidth: esMovil ? 20 : 24, height: esMovil ? 20 : 24,
                        padding: '0 5px', borderRadius: 7, background: T.accentFill, color: T.onAccent,
                        fontSize: esMovil ? 11 : 13, fontWeight: 700, display: 'flex', alignItems: 'center',
                        justifyContent: 'center',
                      }}>{yaLleva}</span>
                    )}
                    <span style={{
                      padding: esMovil ? '7px 8px 8px' : '10px 10px 11px',
                      display: 'flex', flexDirection: 'column',
                      gap: esMovil ? 3 : 5, flex: 1, justifyContent: 'space-between',
                    }}>
                      <span style={{
                        fontSize: esMovil ? 12 : 14, fontWeight: 500,
                        lineHeight: esMovil ? 1.2 : 1.25,
                      }}>{p.nombre}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: esMovil ? 13 : 15, fontWeight: 700, color: T.accent }}>
                          {tams.length ? 'desde ' : ''}
                          {eur(tams.length ? Math.min(...tams.map((t) => precioBarra(p, t))) : precioBarra(p))}
                        </span>
                        {tieneExtras && <span style={{ fontSize: esMovil ? 10 : 11, color: T.muted }}>+ extras</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
              {!visibles.length && (
                <div style={{ gridColumn: '1/-1', padding: 24, textAlign: 'center', color: T.muted }}>
                  Ningún producto coincide.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Derecha: el ticket en curso ─────────────────────────────────── */}
      {/* MISMO bloque en los dos sitios. En tablet es la columna de siempre; en
          telefono es una hoja a pantalla completa que abre la barra de abajo. Se
          monta siempre (`display:none` cuando esta cerrada) y NO se desmonta: el
          carrito vive en este componente y desmontarlo seria perder la venta. */}
      <div style={esMovil ? {
        position: 'fixed', inset: 0, zIndex: 1000, background: T.bg,
        padding: 10, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: hojaVenta ? 'block' : 'none',
      } : { flex: '0 1 360px', minWidth: 300, position: 'sticky', top: 12 }}>
        {esMovil && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
          }}>
            <button onClick={() => setHojaVenta(false)} style={{
              ...btnSecundario, height: 42, borderRadius: 12, flexShrink: 0,
            }}>
              <ArrowLeft size={16} style={{ marginRight: 6 }} /> Seguir marcando
            </button>
          </div>
        )}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 15, color: T.text }}>Venta en curso</strong>
            {carrito.length > 0 && (
              <button onClick={vaciar} style={{
                border: 'none', background: 'none', cursor: 'pointer', color: T.muted,
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit',
              }}>
                <Trash2 size={14} /> Vaciar
              </button>
            )}
          </div>

          {carrito.length === 0 ? (
            <div style={{ padding: '28px 10px', textAlign: 'center', color: T.muted, fontSize: 14 }}>
              Toca un producto para empezar.
            </div>
          ) : (
            <div style={{ maxHeight: '44vh', overflowY: 'auto', marginBottom: 12 }}>
              {carrito.map((l) => (
                <div key={l.clave} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                      {l.nombre}{l.tamano ? ` · ${l.tamano}` : ''}
                    </div>
                    {l.extrasTexto && (
                      <div style={{ fontSize: 12, color: T.accent }}>{l.extrasTexto}</div>
                    )}
                    <div style={{ fontSize: 12, color: T.muted }}>{eur(l.precio_c)} / ud.</div>
                  </div>
                  <button onClick={() => cambiarCantidad(l.clave, -1)} style={btnIcono}><Minus size={14} /></button>
                  <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700, fontSize: 15, color: T.text }}>{l.cantidad}</span>
                  <button onClick={() => cambiarCantidad(l.clave, +1)} style={btnIcono}><Plus size={14} /></button>
                  <span style={{ minWidth: 62, textAlign: 'right', fontWeight: 700, fontSize: 14, color: T.text }}>
                    {eur(l.precio_c * l.cantidad)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '10px 0', borderTop: `2px solid ${T.accent}`, marginTop: 4,
          }}>
            <span style={{ fontSize: 13, color: T.muted }}>{totalUnidades} art.</span>
            <span style={{
              fontSize: esMovil ? 26 : 30, fontWeight: 800, color: T.text,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {eur(totalCarrito)}
            </span>
          </div>

          {/* Comandar va ANTES de cobrar y no cobra: en un mostrador con cocina lo
              primero es que empiecen a hacerlo. Solo aparece si hay algo pendiente. */}
          {sinComandar.length > 0 && (
            <button onClick={comandar} style={{
              ...btnSecundario, width: '100%', height: 48, fontSize: 15, marginBottom: 8,
              borderColor: T.accent, color: T.accent,
            }}>
              <ChefHat size={17} style={{ marginRight: 8 }} />
              Comandar a cocina{carrito.length !== sinComandar.length ? ` (${sinComandar.length} nuevo${sinComandar.length > 1 ? 's' : ''})` : ''}
            </button>
          )}

          {/* Cobrar en dos botones y no en uno: la forma de pago es lo primero que
              dice el cliente, y así se ahorra un paso en cada venta. */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cobrarEnEfectivo} disabled={!carrito.length || cobrando} style={{
              ...btnAccion, flex: 1, height: 58, fontSize: 16, flexDirection: 'column', gap: 2,
              opacity: (!carrito.length || cobrando) ? 0.4 : 1,
              cursor: (!carrito.length || cobrando) ? 'not-allowed' : 'pointer',
            }}>
              <Banknote size={19} />
              {cobrando ? 'Cobrando…' : 'Efectivo'}
            </button>
            <button onClick={cobrarConTarjeta} disabled={!carrito.length || cobrando} style={{
              ...btnSecundario, flex: 1, height: 58, fontSize: 16, flexDirection: 'column', gap: 2,
              borderColor: T.accent, color: T.accent,
              opacity: (!carrito.length || cobrando) ? 0.4 : 1,
              cursor: (!carrito.length || cobrando) ? 'not-allowed' : 'pointer',
            }}>
              <CreditCard size={19} />
              {cobrando ? 'Cobrando…' : 'Tarjeta'}
            </button>
          </div>

          {ultimaVenta?.ticket && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 12,
              background: 'rgba(143,196,107,0.12)', color: T.text, fontSize: 13,
            }}>
              <div style={{ fontWeight: 700 }}>
                Cobrado {eur(cents(ultimaVenta.pedido?.total ?? ultimaVenta.ticket?.total))}
                {ultimaVenta.ticket.cambio != null && ` · cambio ${eur(cents(ultimaVenta.ticket.cambio))}`}
              </div>
              <div style={{ color: T.muted }}>
                Ticket {ultimaVenta.ticket.serie}-{String(ultimaVenta.ticket.numero).padStart(6, '0')}{ultimaVenta.pedido?.codigo ? ` · ${ultimaVenta.pedido.codigo}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={reimprimir} style={{ ...btnSecundario, height: 36, fontSize: 13 }}>
                  <Printer size={14} style={{ marginRight: 4 }} /> Reimprimir
                </button>
                <button onClick={() => pulsoCajon()} style={{ ...btnSecundario, height: 36, fontSize: 13 }}>
                  Abrir cajón
                </button>
              </div>
            </div>
          )}
        </div>

        {pedidosNuevos?.length > 0 && (
          <div style={{
            background: T.surface, border: `1px solid ${T.accent}`, borderRadius: 16,
            padding: 14, marginTop: 12,
          }}>
            <strong style={{ fontSize: 14, color: T.accent }}>
              {pedidosNuevos.length} pedido{pedidosNuevos.length > 1 ? 's' : ''} por Pidoo
            </strong>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>Ve a Pedidos para aceptarlos.</div>
          </div>
        )}
      </div>

      </div>
      )}

      {configurando && (
        <ModalProducto
          {...configurando}
          precioBarra={precioBarra}
          onCerrar={() => setConfigurando(null)}
          onAceptar={(tam, extras) => { anadir(configurando.producto, tam, extras); setConfigurando(null) }}
        />
      )}

      {modalPago && (
        <ModalEfectivo total_c={totalCarrito} cobrando={cobrando}
          onCerrar={() => setModalPago(false)}
          onCobrar={(entregado) => cobrar('efectivo', entregado)} />
      )}

      {nuevoPedido && (
        <Modal titulo={nuevoPedido === 'reparto' ? 'Nuevo reparto' : 'Nueva recogida'}
          onCerrar={() => setNuevoPedido(null)}>
          <TpvNuevoPedido restaurante={restaurante} modo={nuevoPedido}
            onCancelar={() => setNuevoPedido(null)}
            onHecho={() => setNuevoPedido(null)} />
        </Modal>
      )}

      {modalCaja && (
        <Modal titulo="Caja del mostrador" onCerrar={() => setModalCaja(false)}>
          <TpvCaja establecimientoId={restaurante.id} restaurante={restaurante}
            vistaInicial={cajaVista} onCerrarModal={() => setModalCaja(false)} />
        </Modal>
      )}

      {/* La barra de la venta, fija abajo en telefono. Es lo unico que hace falta ver
          de la venta mientras se marca: cuanto llevas y como llegar al cobro. */}
      {esMovil && pestana === 'mostrador' && !hojaVenta && !pantalla && (
        <div style={{
          position: 'fixed', left: 10, right: 10, bottom: 10, zIndex: 950,
        }}>
          <button onClick={() => setHojaVenta(true)} disabled={!carrito.length} style={{
            ...btnAccion, width: '100%', height: 54, borderRadius: 14,
            justifyContent: 'space-between', padding: '0 14px', fontSize: 15,
            opacity: carrito.length ? 1 : 0.45,
            cursor: carrito.length ? 'pointer' : 'not-allowed',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{
                minWidth: 24, height: 24, padding: '0 6px', borderRadius: 999,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.26)', fontSize: 13, fontWeight: 800,
              }}>{totalUnidades}</span>
              Ver la venta
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {eur(totalCarrito)}
            </span>
          </button>
        </div>
      )}

      {hayAviso && (
        <AvisoPedido
          pedido={pedidoAvisado}
          cuantos={pedidosNuevos.length}
          onVer={() => { setAvisoFuera(pedidoAvisado.id); setPantalla('pedidos') }}
          onLuego={() => setAvisoFuera(pedidoAvisado.id)}
        />
      )}

      {/* Las pantallas de la app, ENCIMA del mostrador. Van con el tema claro del
          panel porque son las mismas de siempre: no se tocan, solo se enmarcan. */}
      {pantalla && (
        <div className="tpv-capa" style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'var(--c-bg)', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)',
            flexShrink: 0,
          }}>
            <button onClick={() => setPantalla(null)} style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px',
              borderRadius: 10, border: '1px solid var(--c-border)',
              background: 'var(--c-surface)', color: 'var(--c-text)',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              <ArrowLeft size={16} /> Volver al mostrador
            </button>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--c-text)' }}>
              {PANTALLAS[pantalla]}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {pantalla === 'pedidos' && <PedidosEnVivo />}
            {pantalla === 'crear-envio' && <CrearEnvio />}
            {pantalla === 'historial' && <HistorialMovil />}
            {pantalla === 'disponibilidad' && <DisponibilidadProductos />}
            {pantalla === 'impresora' && <ConfigImpresora />}
          </div>
        </div>
      )}

      {modalStock && (
        <Modal titulo="Almacén" onCerrar={() => setModalStock(false)}>
          <TpvStock establecimientoId={restaurante.id} vistaInicial={stockVista} />
        </Modal>
      )}

      {menu && (
        <Drawer titulo={modoApp ? (restaurante?.nombre || 'TPV') : 'TPV'} onCerrar={() => setMenu(false)}>
          {modoApp && (
            <>
              <GrupoMenu titulo="El negocio" />
              <OpcionMenu icono={<ClipboardList size={19} color={T.accent} />} texto="Pedidos"
                nota="Aceptar, marcar listos y entregados"
                onClick={() => { setMenu(false); setPantalla('pedidos') }} />
              <OpcionMenu icono={<PhoneCall size={19} color={T.accent} />} texto="Pedido telefónico"
                nota="Crear un reparto o una recogida por teléfono"
                onClick={() => { setMenu(false); setPantalla('crear-envio') }} />
              <OpcionMenu icono={<Clock size={19} color={T.accent} />} texto="Historial"
                nota="Todo lo de días anteriores"
                onClick={() => { setMenu(false); setPantalla('historial') }} />
              <OpcionMenu icono={<ToggleLeft size={19} color={T.accent} />} texto="Carta"
                nota="Qué está disponible y qué se ha agotado"
                onClick={() => { setMenu(false); setPantalla('disponibilidad') }} />
              <OpcionMenu icono={<Printer size={19} color={T.accent} />} texto="Impresora y cuenta"
                nota="Abrir o cerrar el local, impresora y salir"
                onClick={() => { setMenu(false); setPantalla('impresora') }} />
            </>
          )}
          <GrupoMenu titulo="Caja" />
          <OpcionMenu icono={<Inbox size={19} color={T.accent} />} texto="Abrir cajón"
            nota="Sin cobrar nada"
            onClick={async () => {
              setMenu(false)
              const ok = await pulsoCajon()
              toast(ok ? 'Cajón abierto' : 'La impresora no responde: el cajón no se abre sin ella',
                ok ? 'success' : 'error')
            }} />
          <OpcionMenu icono={<ArrowDownLeft size={19} color={T.accent} />} texto="Meter dinero"
            nota="Entrada de efectivo"
            onClick={() => { setMenu(false); setCajaVista('entrada'); setModalCaja(true) }} />
          <OpcionMenu icono={<ArrowUpRight size={19} color={T.accent} />} texto="Sacar dinero"
            nota="Salida de efectivo"
            onClick={() => { setMenu(false); setCajaVista('salida'); setModalCaja(true) }} />
          <OpcionMenu icono={<Wallet size={19} color={T.accent} />} texto="Estado de la caja"
            nota="Cuánto debería haber ahora mismo"
            onClick={() => { setMenu(false); setCajaVista('resumen'); setModalCaja(true) }} />

          <GrupoMenu titulo="Informes" />
          <OpcionMenu icono={<FileText size={19} color={T.accent} />} texto="Informe X"
            nota="Lo vendido en este turno, sin cerrar nada"
            onClick={() => { setMenu(false); setCajaVista('resumen'); setModalCaja(true) }} />
          <OpcionMenu icono={<Lock size={19} color={T.accent} />} texto="Cierre Z"
            nota="Cierra la caja e imprime el cierre del día"
            onClick={() => { setMenu(false); setCajaVista('cierre'); setModalCaja(true) }} />
          <OpcionMenu icono={<Printer size={19} color={T.accent} />} texto="Informe del día"
            nota="Todo lo vendido hoy, haya habido caja o no"
            onClick={async () => { setMenu(false); await informeDelDia() }} />

          {/* El almacen SOLO si Pidoo le ha dado de alta el modulo. Aqui va lo del
              servicio; dar de alta articulos y escandallos es del panel web. */}
          {stockActivo && (
            <>
              <GrupoMenu titulo="Almacén" />
              <OpcionMenu icono={<Boxes size={19} color={T.accent} />} texto="Existencias"
                nota="Lo que queda de cada cosa"
                onClick={() => { setMenu(false); setStockVista('existencias'); setModalStock(true) }} />
              <OpcionMenu icono={<Trash2 size={19} color={T.accent} />} texto="Apuntar merma"
                nota="Lo que se ha roto, caducado o se ha ido a la basura"
                onClick={() => { setMenu(false); setStockVista('merma'); setModalStock(true) }} />
              <OpcionMenu icono={<ClipboardCheck size={19} color={T.accent} />} texto="Recuento"
                nota="Contar y cuadrar lo que hay de verdad"
                onClick={() => { setMenu(false); setStockVista('recuento'); setModalStock(true) }} />
            </>
          )}

          <div style={{
            marginTop: 14, padding: 12, borderRadius: 10, background: T.surface2,
            fontSize: 12, color: T.muted, lineHeight: 1.5,
          }}>
            El <strong style={{ color: T.text }}>informe</strong> dice lo que se ha
            vendido. La <strong style={{ color: T.text }}>caja</strong> dice lo que hay
            en el cajón: entre las dos están el fondo, lo que sacas para pagar al
            proveedor y lo que metes de la caja fuerte.
          </div>
        </Drawer>
      )}
    </div>
  )
}

// ── Modal de tamaño + extras ────────────────────────────────────────────────
function ModalProducto({ producto, tamanos, grupos, precioBarra, onCerrar, onAceptar }) {
  const [tam, setTam] = useState(tamanos.length === 1 ? tamanos[0] : null)
  const [sel, setSel] = useState({})   // { grupo_id: [opcion, ...] }

  // `tipo` no tiene CHECK en la base: conviven 'unico' (grupos viejos) y 'single'
  // (lo que guarda Carta.jsx hoy). Por eso la pregunta se hace al reves — multiple
  // es lo unico que admite varias — y asi coincide con lo que valida el servidor.
  const esMultiple = (g) => g.tipo === 'multiple'
  const topeDe = (g) => {
    if (!esMultiple(g)) return 1
    const m = Number(g.max_selecciones)
    return Number.isFinite(m) && m > 0 ? m : Infinity   // 0 guardado = sin limite
  }

  // Los grupos de elección única se tratan como obligatorios: no hay columna que lo
  // diga, pero "el punto de la carne" es una pregunta que hay que responder.
  const faltan = grupos.filter((g) => !esMultiple(g) && !(sel[g.id] || []).length)
  const listo = (!tamanos.length || tam) && !faltan.length

  function alternar(grupo, opcion) {
    setSel((prev) => {
      const actuales = prev[grupo.id] || []
      if (!esMultiple(grupo)) return { ...prev, [grupo.id]: [opcion] }
      const ya = actuales.some((o) => o.id === opcion.id)
      if (ya) return { ...prev, [grupo.id]: actuales.filter((o) => o.id !== opcion.id) }
      if (actuales.length >= topeDe(grupo)) return prev   // el servidor también lo frena
      return { ...prev, [grupo.id]: [...actuales, opcion] }
    })
  }

  const extras = Object.values(sel).flat()
  // Mismo clamp a 0 que hace el servidor: si alguien guardara un extra en negativo,
  // la pantalla y el ticket dirian cosas distintas delante del cliente.
  const totalC = (tam || !tamanos.length ? precioBarra(producto, tam) : 0) +
    extras.reduce((s, o) => s + Math.max(0, cents(o.precio)), 0)

  return (
    <Modal titulo={producto.nombre} onCerrar={onCerrar}>
      {tamanos.length > 0 && (
        <Bloque titulo="Tamaño" obligatorio>
          {tamanos.map((t) => (
            <Opcion key={t.id} activa={tam?.id === t.id} onClick={() => setTam(t)}
              nombre={t.nombre} precio={eur(precioBarra(producto, t))} />
          ))}
        </Bloque>
      )}

      {grupos.map((g) => (
        <Bloque key={g.id} titulo={g.nombre} obligatorio={g.tipo !== 'multiple'}
          nota={g.tipo === 'multiple' && Number(g.max_selecciones) > 0 ? `hasta ${g.max_selecciones}` : null}>
          {(g.extras_opciones || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0)).map((o) => (
            <Opcion key={o.id}
              activa={(sel[g.id] || []).some((x) => x.id === o.id)}
              onClick={() => alternar(g, { ...o, grupo_id: g.id })}
              nombre={o.nombre}
              precio={Number(o.precio) > 0 ? '+' + eur(cents(o.precio)) : ''} />
          ))}
        </Bloque>
      ))}

      <button onClick={() => onAceptar(tam, extras)} disabled={!listo} style={{
        ...btnAccion, width: '100%', height: 54, fontSize: 16, marginTop: 6,
        opacity: listo ? 1 : 0.4, cursor: listo ? 'pointer' : 'not-allowed',
      }}>
        {listo ? `Añadir · ${eur(totalC)}` : `Elige ${faltan[0]?.nombre || 'el tamaño'}`}
      </button>
    </Modal>
  )
}

// ── Modal de cobro ──────────────────────────────────────────────────────────
// Solo efectivo: la tarjeta no pasa por aquí porque no hay cambio que calcular.
function ModalEfectivo({ total_c, cobrando, onCerrar, onCobrar }) {
  const [entregado_c, setEntregado] = useState(null)
  // Los billetes que de verdad se dan, y el importe justo el primero.
  const sugerencias = useMemo(() => {
    const opciones = [total_c, 500, 1000, 2000, 5000].filter((c) => c >= total_c)
    return [...new Set(opciones)].slice(0, 5)
  }, [total_c])
  const cambio = entregado_c != null ? entregado_c - total_c : null

  return (
    <Modal titulo={`Cobrar ${eur(total_c)} en efectivo`} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: T.muted, fontWeight: 600 }}>¿Con cuánto paga?</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sugerencias.map((c) => (
            <button key={c} onClick={() => setEntregado(c)} style={{
              ...btnSecundario, height: 48, minWidth: 86, fontSize: 15,
              borderColor: entregado_c === c ? T.accent : T.border,
              color: entregado_c === c ? T.accent : T.text,
              fontWeight: entregado_c === c ? 700 : 600,
            }}>
              {c === total_c ? 'Justo' : eur(c)}
            </button>
          ))}
        </div>

        {cambio != null && (
          <div style={{ padding: 14, borderRadius: 12, background: T.surface2, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: T.muted }}>Cambio a devolver</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: T.text }}>{eur(cambio)}</div>
          </div>
        )}

        <button onClick={() => onCobrar(entregado_c)} disabled={cobrando}
          style={{ ...btnAccion, height: 58, fontSize: 17, opacity: cobrando ? 0.5 : 1 }}>
          <Banknote size={19} style={{ marginRight: 8 }} />
          {cobrando ? 'Cobrando…' : 'Cobrar y abrir cajón'}
        </button>
      </div>
    </Modal>
  )
}

// ── Piezas sueltas ──────────────────────────────────────────────────────────
function Modal({ titulo, children, onCerrar }) {
  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 18,
        width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto',
        fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 17, color: T.text }}>{titulo}</strong>
          <button onClick={onCerrar} style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.muted }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Bloque({ titulo, obligatorio, nota, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{titulo}</span>
        {obligatorio && <span style={{ fontSize: 11, color: T.accent, fontWeight: 700 }}>obligatorio</span>}
        {nota && <span style={{ fontSize: 11, color: T.muted }}>{nota}</span>}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </div>
  )
}

function Pestana({ activa, onClick, icono, texto, contador, esMovil }) {
  return (
    <button onClick={onClick} style={{
      height: esMovil ? 40 : 44, padding: esMovil ? '0 14px' : '0 18px',
      borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
      fontSize: esMovil ? 14 : 15, fontWeight: activa ? 800 : 600,
      border: `1px solid ${activa ? T.accent : T.border}`,
      background: activa ? T.accentFill : T.surface2,
      color: activa ? T.onAccent : T.text,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {icono}
      {texto}
      {contador > 0 && (
        <span style={{
          minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999,
          background: activa ? T.onAccent : T.accentFill,
          color: activa ? T.accentFill : T.onAccent,
          fontSize: 12, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{contador}</span>
      )}
    </button>
  )
}

// Panel lateral, como el menú del TPV de Last: se abre desde la esquina y ocupa
// el lado derecho, sin tapar del todo lo que estabas haciendo.
function Drawer({ titulo, children, onCerrar }) {
  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 900,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        width: '100%', maxWidth: 340, height: '100%', overflowY: 'auto', padding: 18,
        fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <strong style={{ fontSize: 17, color: T.text }}>{titulo}</strong>
          <button onClick={onCerrar} style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.muted }}
            aria-label="Cerrar menú">
            <X size={20} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>{children}</div>
      </div>
    </div>
  )
}

function GrupoMenu({ titulo }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
      letterSpacing: '0.08em', marginTop: 8, marginBottom: 2,
    }}>{titulo}</div>
  )
}

function OpcionMenu({ icono, texto, nota, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit',
      borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
    }}>
      {icono}
      <span>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{texto}</span>
        {nota && <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 2 }}>{nota}</span>}
      </span>
    </button>
  )
}

function Opcion({ activa, onClick, nombre, precio }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      height: 48, padding: '0 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15,
      borderRadius: 12, border: `1px solid ${activa ? T.accent : T.border}`,
      background: activa ? 'rgba(255,107,44,0.14)' : T.surface2,
      color: activa ? T.accent : T.text, fontWeight: activa ? 700 : 500,
    }}>
      <span>{nombre}</span>
      <span style={{ fontSize: 13, color: activa ? T.accent : T.muted }}>{precio}</span>
    </button>
  )
}

// La cabecera de la app. Antes eran dos contornos naranjas seguidos, con radios
// distintos (999 y 12) y los dos huecos: parecian dos aplicaciones pegadas. Ahora es
// UNA barra con fondo propio, el estado como pastilla de relleno suave (sin borde y
// sin mayusculas gritadas) y una sola accion, esa si, rellena. Cerrado no es un
// detalle de adorno: con el local cerrado no entra ni un pedido.
function CabeceraApp({ restaurante, esMovil, onAbrir }) {
  const abierto = !!restaurante?.activo
  const tono = abierto ? T.ok : T.danger
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: esMovil ? 10 : 14,
      padding: esMovil ? '8px 10px' : '10px 12px', borderRadius: 14, background: T.surface,
    }}>
      <div style={{
        fontSize: esMovil ? 14 : 16, fontWeight: 800, color: T.text, letterSpacing: '-0.01em',
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {restaurante?.nombre}
      </div>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
        marginLeft: 'auto', padding: esMovil ? '5px 10px' : '6px 12px', borderRadius: 999,
        fontSize: esMovil ? 12 : 13, fontWeight: 700, color: tono,
        background: abierto ? 'rgba(143,196,107,0.14)' : 'rgba(255,122,107,0.14)',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tono }} />
        {abierto ? 'Abierto' : 'Cerrado'}
      </span>
      {!abierto && (
        <button onClick={onAbrir} style={{
          ...btnAccion, height: esMovil ? 34 : 38, padding: esMovil ? '0 14px' : '0 18px',
          fontSize: esMovil ? 13 : 14, borderRadius: 11, flexShrink: 0,
        }}>Abrir</button>
      )}
    </div>
  )
}

// El aviso de pedido nuevo. Va encima de TODO (tambien de la capa de pantallas) y no
// se quita solo: un pedido sin aceptar es dinero esperando, y la alarma se puede
// silenciar. Ensena lo justo para decidir -de donde viene, de quien es y cuanto- y el
// boton lleva a `PedidosEnVivo`, que es donde se acepta con su tiempo de preparacion,
// se rechaza y se imprime.
function AvisoPedido({ pedido, cuantos, onVer, onLuego }) {
  const reparto = pedido.modo_entrega === 'delivery'
  const Icono = reparto ? Bike : ShoppingBag
  const quien = pedido.guest_nombre || pedido.nombre_cliente || null
  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 1200,
      display: 'flex', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        pointerEvents: 'auto', width: '100%', maxWidth: 560,
        background: T.surface, borderRadius: 18, padding: 14,
        border: `2px solid ${T.accent}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 12, flexShrink: 0,
            background: T.accentFill, color: T.onAccent,
          }}>
            <Icono size={22} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
              {cuantos > 1 ? `${cuantos} pedidos sin aceptar` : 'Pedido nuevo'}
            </div>
            <div style={{
              fontSize: 13, color: T.muted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {pedido.codigo} · {reparto ? 'Reparto' : 'Recogida'}
              {quien ? ` · ${quien}` : ''}
            </div>
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: T.text, flexShrink: 0 }}>
            {eur(cents(pedido.total))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onLuego} style={{
            ...btnSecundario, height: 46, padding: '0 16px', borderRadius: 12, flexShrink: 0,
          }}>Ahora no</button>
          <button onClick={onVer} style={{
            ...btnAccion, flex: 1, height: 46, fontSize: 15, borderRadius: 12,
          }}>Ver y aceptar</button>
        </div>
      </div>
    </div>
  )
}
