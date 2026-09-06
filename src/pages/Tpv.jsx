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
import { toast, confirmar } from '../App'
import {
  imprimirTicketTpv, imprimirComandaTpv, imprimirInformeDiaTpv,
  pulsoCajon, getPrinterConfig, savePrinterConfig, comprobarImpresoraActiva, impresoraConfigurada,
} from '../lib/printService'
import { crearDestinoDe } from '../lib/destinosImpresion'
import { resumenJornada, inicioJornada } from '../lib/jornada'
import { encolarVenta, sincronizarCola, ventasPendientes, ventasAtascadas, siguienteNumeroOff } from '../lib/colaVentas'
import {
  Search, Plus, Minus, Trash2, Printer, Banknote, CreditCard, X, AlertTriangle,
  Menu, ChefHat, FileText, Inbox, Calculator, Bike, Wallet, ArrowDownLeft, ArrowUpRight, Lock,
  Boxes, ClipboardCheck, ClipboardList, Clock, ToggleLeft, PhoneCall, ArrowLeft,
  Maximize2, Minimize2, StickyNote, Bookmark,
  ShoppingBag,
  Sandwich, Croissant, Beef, Beer, CupSoda, Coffee, Pizza, Salad, CakeSlice, IceCream,
  Fish, Drumstick, Soup, Cookie, Utensils, Wine, Ham, Popcorn, Carrot, EggFried,
} from 'lucide-react'

import { T, FONT, cents, eur, caja, btnIcono, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import TpvPedidos from '../components/TpvPedidos'
import TpvCaja from '../components/TpvCaja'
import TpvTickets from '../components/TpvTickets'
import TpvNuevoPedido from '../components/TpvNuevoPedido'
import { useEsMonitor, useEsMovil } from '../lib/tamanoPantalla'
import { prepararLogo } from '../lib/logoTicket'
import TpvStock from '../components/TpvStock'
import HistorialMovil from './HistorialMovil'
import DisponibilidadProductos from './DisponibilidadProductos'
import ConfigImpresora from './ConfigImpresora'
import CrearEnvio from './CrearEnvio'
import SociosYRepartidores from './SociosYRepartidores'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Un MONITOR no es una tablet grande. Los tamanos pensados para tocar a un brazo de
// distancia, en 1900 px se ven enormes (Marlon: "se ve muy grande"). Tercer escalon.

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
  'socios-riders': 'Repartidores',
  'crear-envio': 'Pedido telefónico',
  historial: 'Historial',
  disponibilidad: 'Carta',
  impresora: 'Impresora y cuenta',
}

export default function Tpv({ modoApp = false, pantallaCompleta = false, huecoAbajo = 0, onAlternarPantalla }) {
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
  // El pedido telefonico que se esta EDITANDO (con sus items). Reusa el mismo
  // formulario y el mismo modal que uno nuevo: es la misma conversacion por
  // telefono, solo que el pedido ya existe.
  const [pedidoEditar, setPedidoEditar] = useState(null)
  // Sube uno cada vez que se guarda una edición: es la señal para que la
  // pestaña Pedidos recargue lista y detalle sin esperar al realtime.
  const [recargasPedidos, setRecargasPedidos] = useState(0)
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [impresora, setImpresora] = useState({ configurada: false, viva: null })
  const [modalTickets, setModalTickets] = useState(false)
  // Nota de una línea del carrito: { clave, texto } mientras se edita.
  const [editandoNota, setEditandoNota] = useState(null)
  const [modalLibre, setModalLibre] = useState(false)
  // Ventas APARCADAS: varias cuentas a medias a la vez ("el rubio de la barra",
  // "mesa 3"). Cada una conserva su clave de idempotencia y su nº de ronda.
  const [aparcadas, setAparcadas] = useState([])
  const [modalAparcadas, setModalAparcadas] = useState(false)
  const [aparcandoNombre, setAparcandoNombre] = useState(null)   // null | texto del input

  // Un pedido nuevo NO se lleva la pantalla por delante: si estas cobrando a alguien
  // en la barra, saltar a Pedidos solo es quitarle el mostrador de las manos al
  // camarero. Sale un aviso encima de todo, imposible de no ver, y se entra cuando
  // se puede. `avisoFuera` guarda el ultimo pedido que se aparto: si entra OTRO
  // despues, el aviso vuelve a salir.
  const esMovil = useEsMovil()
  const esMonitor = useEsMonitor()
  // Elige entre los tres escalones: telefono, tablet, monitor.
  const tam = (movil, tablet, monitor) => (esMovil ? movil : esMonitor ? monitor : tablet)

  // Las dos columnas a lo alto SOLO cuando el TPV es dueno de la pantalla. Dentro del
  // panel es una seccion de una pagina que scrollea, y ahi forzar el alto completo
  // saca el contenido por debajo del borde.
  const altoCompleto = esMonitor && (modoApp || pantallaCompleta)
  // En el telefono la venta se ve en una hoja a pantalla completa. Empieza cerrada:
  // lo que se toca cien veces al dia es la carta, no el ticket.
  const [hojaVenta, setHojaVenta] = useState(false)

  // ── MODO SIN INTERNET (fase 1) ─────────────────────────────────────────────
  // `online` pinta el banner; `colaN` es cuántas ventas cobradas sin conexión
  // esperan a sincronizarse. La cola se intenta enviar al entrar, al volver la
  // conexión y cada 60 s — y avisa de lo que sube y de lo que se atasca.
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [colaN, setColaN] = useState(0)
  const atascadasAvisadasRef = useRef(0)
  useEffect(() => {
    if (!restaurante?.id) return
    const est = restaurante.id
    setColaN(ventasPendientes(est))
    const alta = () => setOnline(true)
    const baja = () => setOnline(false)
    const cambioCola = (e) => { if (e?.detail?.est === est) setColaN(e.detail.n) }
    const intentar = async () => {
      if (!navigator.onLine || !ventasPendientes(est)) return
      const r = await sincronizarCola(est)
      if (r?.enviadas) toast(`Sincronizada${r.enviadas > 1 ? 's' : ''} ${r.enviadas} venta${r.enviadas > 1 ? 's' : ''} cobrada${r.enviadas > 1 ? 's' : ''} sin conexión`, 'success')
      const atasc = ventasAtascadas(est)
      if (atasc && atasc !== atascadasAvisadasRef.current) {
        toast(`${atasc} venta${atasc > 1 ? 's' : ''} cobrada${atasc > 1 ? 's' : ''} sin conexión no se pudo apuntar: avisa a Pidoo (el dinero está en el cajón)`, 'error')
      }
      atascadasAvisadasRef.current = atasc
      setColaN(ventasPendientes(est))
    }
    window.addEventListener('online', alta)
    window.addEventListener('offline', baja)
    window.addEventListener('online', intentar)
    window.addEventListener('pidoo:cola-ventas', cambioCola)
    intentar()
    const t = setInterval(intentar, 60000)
    return () => {
      window.removeEventListener('online', alta)
      window.removeEventListener('offline', baja)
      window.removeEventListener('online', intentar)
      window.removeEventListener('pidoo:cola-ventas', cambioCola)
      clearInterval(t)
    }
  }, [restaurante?.id])

  const [avisoFuera, setAvisoFuera] = useState(null)
  const pedidoAvisado = pedidosNuevos?.[0] || null
  // 🔴 Sin `modoApp`. Ese candado dejaba a la app de WINDOWS sin aviso de pedido nuevo:
  // el TPV ocupa la pantalla entera, el pedido entraba y no se enteraba nadie.
  // Y SIN esconderlo en la pestaña Pedidos (pedido de Marlon, 3 sep): ahí se
  // puede estar mirando el detalle de un pedido viejo, y el nuevo entraría a la
  // lista sin que nadie levante la vista. El aviso se va solo al aceptarlo o
  // con "Luego".
  const hayAviso = pedidoAvisado && avisoFuera !== pedidoAvisado.id
  // "Ver pedido" del aviso abre ESE pedido en la pestaña Pedidos, con su botón
  // de aceptar delante, en vez de dejar al usuario buscándolo en la lista.
  const [pedidoParaAbrir, setPedidoParaAbrir] = useState(null)

  // Ir a una pantalla desde donde sea; `CrearEnvio` pide 'pedidos' con este
  // evento al terminar. Los pedidos YA NO son una capa: la capa "Pedidos en
  // vivo" duplicaba la pestaña Pedidos del propio TPV (que ahora también
  // acepta, avanza estados, reimprime y factura), así que 'pedidos' lleva a la
  // pestaña. El mostrador se queda detrás: el carrito a medias no se pierde.
  useEffect(() => {
    const ir = (e) => {
      const d = e?.detail
      if (d === 'pedidos') { setPantalla(null); setPestana('pedidos'); return }
      if (PANTALLAS[d]) setPantalla(d)
    }
    window.addEventListener('pidoo:goto', ir)
    return () => window.removeEventListener('pidoo:goto', ir)
  }, [])

  // El logo del ticket, listo ANTES de que haga falta. Convertirlo es una descarga mas
  // un rato de canvas, y el momento de hacerlo no es con el ticket ya saliendo y el
  // cliente esperando el cambio. Si falla no pasa nada: se reintenta sola la proxima
  // vez (desde el 31 ago los fallos ya NO se guardan).
  useEffect(() => { prepararLogo(restaurante?.logo_url) }, [restaurante?.logo_url])

  // ── La venta a medias SOBREVIVE ───────────────────────────────────────────
  // El carrito y su clave de idempotencia se guardan en localStorage por
  // restaurante. Cubre tres muertes reales: recargar la tablet, un crash del
  // WebView, y el remonte del componente al cambiar de shell en escritorio.
  //
  // 🔴 La clave de idempotencia va ATADA A LA FIRMA del carrito (líneas y
  // cantidades), no a cada pulsación de cobrar: un reintento tras un fallo de
  // red lleva LA MISMA clave y el servidor devuelve la venta ya grabada en vez
  // de cobrar dos veces. Antes se regeneraba en cada pulsación y la idempotencia
  // solo protegía el doble-tap dentro del mismo intento — con tarjeta, reintentar
  // tras un corte de red eran dos tickets. Si el carrito CAMBIA, la clave cambia
  // con él: cobrar un carrito distinto es otra venta.
  const idemRef = useRef(null)
  const firmaRef = useRef(null)
  const enVueloRef = useRef(false)
  const comandandoRef = useRef(false)   // candado de "Comandar" (doble toque)
  // …y su cara visible: sin esto, mientras la impresora tardaba el botón se
  // quedaba mudo y parecía que el clic no había hecho nada.
  const [comandando, setComandando] = useState(false)
  const rondaRef = useRef(0)            // nº de comanda dentro de la venta en curso

  // uuid v4 de verdad también sin crypto.randomUUID (WebView viejas): el
  // fallback anterior (Date.now()+random) no pasaba el regex del servidor y en
  // esos aparatos NINGUNA venta se podía cobrar.
  const uuidv4 = () => crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })

  const claveVenta = restaurante?.id ? `pidoo_tpv_venta_${restaurante.id}` : null

  useEffect(() => {
    if (!claveVenta) return
    try {
      const v = JSON.parse(localStorage.getItem(claveVenta) || 'null')
      if (Array.isArray(v?.lineas) && v.lineas.length) {
        idemRef.current = v.clave || null
        firmaRef.current = v.firma || null
        setCarrito(v.lineas)
      }
    } catch { /* respaldo roto: se empieza de cero */ }
  }, [claveVenta])

  useEffect(() => {
    if (!claveVenta) return
    if (!carrito.length) {
      // Venta cerrada o vaciada. El pase inicial (sin firma todavía) no toca
      // nada: si borrase aquí, pisaría lo que la hidratación acaba de leer.
      if (firmaRef.current != null) {
        idemRef.current = null
        firmaRef.current = null
        rondaRef.current = 0   // la numeración de comandas empieza con cada venta
        try { localStorage.removeItem(claveVenta) } catch { /* nada */ }
      }
      return
    }
    // La nota entra en la firma: cambiarla convierte la venta en OTRA venta a
    // efectos de idempotencia (las líneas libres llevan su importe en la clave).
    const firma = JSON.stringify(carrito.map((l) => [l.clave, l.cantidad, l.notas || '']))
    if (!idemRef.current || firmaRef.current !== firma) {
      idemRef.current = uuidv4()
      firmaRef.current = firma
    }
    try {
      localStorage.setItem(claveVenta, JSON.stringify({ clave: idemRef.current, firma, lineas: carrito }))
    } catch { /* storage lleno: la venta sigue, solo pierde el respaldo */ }
  }, [carrito, claveVenta])

  // La carta, en una función REUTILIZABLE: se llama al entrar, desde el menú
  // ("Recargar la carta") y al volver de la capa de Carta. Una tablet de
  // mostrador vive semanas sin recargarse: la carta se quedaba con los precios
  // del día que se abrió la app (la pantalla enseñaba uno y el servidor cobraba
  // otro) y un producto borrado dejaba la venta imposible de cerrar sin matar
  // la app — y con ella, antes, el carrito.
  // La carta que se pinta, venga de donde venga. `desdeEspejo` avisa de que se
  // está sirviendo la copia local (modo sin internet).
  function aplicarCarta({ cats, prods, gru, tam, vin }, desdeEspejo = false) {
    setCategorias(cats || [])
    setProductos(prods || [])
    setCatSel((actual) => actual || cats?.[0]?.id || null)
    setGrupos(gru || [])
    setTamanos(tam || [])
    setVinculos(vin || [])
    setCargando(false)
    if (desdeEspejo) toast('Sin conexión: usando la carta guardada en este aparato', 'error')
  }

  async function cargarCarta(avisar = false) {
    const claveEspejo = `pidoo_tpv_carta_${restaurante.id}`
    const [cats, prods, gru] = await Promise.all([
      supabase.from('categorias').select('id, nombre, orden, impresora_destino')
        .eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden'),
      supabase.from('productos').select('id, nombre, precio, precio_local, categoria_id, disponible, orden, imagen_url')
        .eq('establecimiento_id', restaurante.id).order('orden'),
      supabase.from('grupos_extras').select('id, nombre, tipo, max_selecciones, extras_opciones(id, nombre, precio, orden)')
        .eq('establecimiento_id', restaurante.id),
    ])
    if (cats.error || prods.error || gru.error) {
      // Sin red, la carta guardada de la última vez: un router caído no puede
      // dejar el mostrador sin carta.
      try {
        const espejo = JSON.parse(localStorage.getItem(claveEspejo) || 'null')
        if (espejo?.cats?.length) { aplicarCarta(espejo, true); return }
      } catch { /* espejo roto: se sigue al aviso de siempre */ }
      if (avisar) toast('No se pudo recargar la carta: ' + (cats.error || prods.error || gru.error).message, 'error')
      setCargando(false)
      return
    }
    const listaProd = (prods.data || []).filter((p) => p.disponible !== false)
    let tam = [], vin = []
    if (listaProd.length) {
      const ids = listaProd.map((p) => p.id)
      const [t, v] = await Promise.all([
        supabase.from('producto_tamanos').select('id, producto_id, nombre, precio, precio_local, orden')
          .in('producto_id', ids).order('orden'),
        supabase.from('producto_extras').select('producto_id, grupo_id').in('producto_id', ids),
      ])
      tam = t.data || []
      vin = v.data || []
    }
    const datos = { cats: cats.data || [], prods: listaProd, gru: gru.data || [], tam, vin }
    aplicarCarta(datos)
    // El espejo se refresca con cada carga buena: lo que habrá sin internet es
    // la carta del último día que sí lo hubo.
    try { localStorage.setItem(claveEspejo, JSON.stringify(datos)) } catch { /* lleno */ }
    if (avisar) toast('Carta recargada', 'success')
  }
  useEffect(() => { if (restaurante?.id) cargarCarta() }, [restaurante?.id])

  // ── Ventas aparcadas: persistidas por restaurante, como el carrito ─────────
  const claveAparcadas = restaurante?.id ? `pidoo_tpv_aparcadas_${restaurante.id}` : null
  useEffect(() => {
    if (!claveAparcadas) return
    try {
      const v = JSON.parse(localStorage.getItem(claveAparcadas) || '[]')
      if (Array.isArray(v)) setAparcadas(v)
    } catch { /* respaldo roto: se empieza sin aparcadas */ }
  }, [claveAparcadas])
  const guardarAparcadas = (lista) => {
    setAparcadas(lista)
    try { if (claveAparcadas) localStorage.setItem(claveAparcadas, JSON.stringify(lista)) } catch { /* nada */ }
  }

  function aparcarVenta(nombre) {
    if (!carrito.length) return
    if (aparcadas.length >= 12) { toast('Ya hay 12 ventas aparcadas: recupera o borra alguna', 'error'); return }
    const etiqueta = (nombre || '').trim()
      || `Sin nombre ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    guardarAparcadas([...aparcadas, {
      id: uuidv4(), nombre: etiqueta, lineas: carrito,
      clave: idemRef.current, firma: firmaRef.current, ronda: rondaRef.current,
      creada: Date.now(),
    }])
    setCarrito([])   // el efecto del carrito limpia refs y el respaldo activo
    setAparcandoNombre(null)
    toast(`Venta aparcada: ${etiqueta}`, 'success')
  }

  function recuperarVenta(id) {
    const ficha = aparcadas.find((a) => a.id === id)
    if (!ficha) return
    let lista = aparcadas.filter((a) => a.id !== id)
    if (carrito.length) {
      // La venta que había en el mostrador se aparca sola: nada se pierde.
      if (lista.length >= 12) { toast('No cabe: cobra o borra alguna aparcada primero', 'error'); return }
      lista = [...lista, {
        id: uuidv4(),
        nombre: `Sin nombre ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
        lineas: carrito, clave: idemRef.current, firma: firmaRef.current, ronda: rondaRef.current,
        creada: Date.now(),
      }]
    }
    guardarAparcadas(lista)
    // Las refs ANTES que el carrito: el efecto de guardado las lee en el mismo
    // ciclo y así conserva la clave de idempotencia y la ronda de la ficha.
    idemRef.current = ficha.clave || null
    firmaRef.current = ficha.firma || null
    rondaRef.current = ficha.ronda || 0
    setCarrito(Array.isArray(ficha.lineas) ? ficha.lineas : [])
    setModalAparcadas(false)
    toast(`Recuperada: ${ficha.nombre}`, 'success')
  }

  async function borrarAparcada(id) {
    const ficha = aparcadas.find((a) => a.id === id)
    if (!ficha) return
    const seguro = await confirmar(`¿Borrar la venta aparcada "${ficha.nombre}"? No se puede recuperar.`)
    if (!seguro) return
    guardarAparcadas(aparcadas.filter((a) => a.id !== id))
  }

  // La impresora se sondea AL ENTRAR, no al cobrar: enterarse de que está apagada
  // con el cliente delante y el cajón cerrado es demasiado tarde.
  //
  // Y se VUELVE a sondear al cerrar la pantalla de configuración, que se abre
  // como capa ENCIMA sin desmontar esto: antes el estado se calculaba una sola
  // vez y configurar la impresora desde dentro del TPV dejaba el aviso rojo — y
  // el toast de fallo al imprimir tras cobrar — congelados para siempre.
  const sondearImpresora = () => {
    setImpresora((p) => ({ ...p, viva: null }))
    // La impresora QUE TOCA: la de CAJA de la nube si hay impresoras dadas de
    // alta ahí, o la clásica de este aparato si no.
    // 🔴 `r.ok`, no `r`: esto devuelve un OBJETO {ok, error} y un objeto siempre es
    // verdadero, asi que el aviso de "impresora no conectada" NUNCA podia saltar.
    // Venia asi de antes, con checkPrinterConnection.
    comprobarImpresoraActiva()
      .then((r) => setImpresora(r?.sin_configurar
        ? { configurada: false, viva: null }
        : { configurada: true, viva: !!r?.ok }))
      .catch(() => setImpresora({ configurada: true, viva: false }))
  }
  useEffect(() => { sondearImpresora() }, [])
  const pantallaPrevia = useRef(null)
  useEffect(() => {
    if (pantallaPrevia.current === 'impresora' && pantalla === null) sondearImpresora()
    // Al volver de la capa de Carta (donde se apagan productos o cambian
    // precios), la carta del mostrador se pone al día sola.
    if (pantallaPrevia.current === 'disponibilidad' && pantalla === null && restaurante?.id) cargarCarta()
    pantallaPrevia.current = pantalla
  }, [pantalla])

  // En teléfono, la hoja de la venta (z 1000) tapaba las capas de pantallas
  // (z 900): se pulsaba "Ver y aceptar" con la hoja abierta y parecía que el
  // botón no hacía nada. Al abrir cualquier capa, la hoja se recoge.
  useEffect(() => { if (pantalla) setHojaVenta(false) }, [pantalla])

  // Respaldo de la impresora de RED guardado en `tpv_config` (lo escribe el
  // dueño desde el panel web, TpvConfigCard, que prometía exactamente esto):
  // una tablet recién instalada, sin nada en localStorage, arranca imprimiendo
  // sin tener que volver a configurar la IP a mano. Solo siembra si aquí no hay
  // NADA configurado: lo local (incluido el modo USB) siempre manda.
  useEffect(() => {
    if (!tpvConfig?.impresora_ip) return
    if (impresoraConfigurada()) return
    savePrinterConfig({
      ...getPrinterConfig(),
      modo: 'red',
      ip: tpvConfig.impresora_ip,
      port: tpvConfig.impresora_puerto || 9100,
      enabled: true,
    })
    sondearImpresora()
  }, [tpvConfig?.impresora_ip, tpvConfig?.impresora_puerto])

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
        // El id del tamaño ADEMÁS del nombre: el servidor casaba solo por
        // nombre y renombrar un tamaño con el TPV abierto cobraba el precio
        // base sin avisar. Con el id, el precio es el de ESE tamaño siempre.
        tamano_id: tam?.id || null,
        tamano: tam?.nombre || null,
        extras: extrasElegidos.map((o) => o.id),
        extrasTexto: extrasElegidos.map((o) => o.nombre).join(', '),
        precio_c: precioBarra(producto, tam) + extrasC,
        cantidad: 1,
        notas: null,
      }]
    })
  }

  // Nota de UNA línea ("sin hielo", "muy hecha"): el servidor la guarda y la
  // comanda la imprime desde el primer día — lo que no existía era el sitio
  // donde escribirla. Cambiar la nota devuelve la línea a "sin comandar":
  // cocina tiene que enterarse.
  function guardarNotaLinea(clave, texto) {
    const t = (texto || '').trim().slice(0, 200) || null
    setCarrito((prev) => prev.map((l) => (l.clave === clave
      ? { ...l, notas: t, comandada: t === l.notas ? l.comandada : false }
      : l)))
    setEditandoNota(null)
  }

  // Línea LIBRE: lo que un cliente pide y no está en la carta ("un mechero",
  // "suplemento terraza"). El servidor la aceptaba desde la v1 de tpv-venta y
  // el mostrador nunca la ofreció. Aquí SÍ manda el importe tecleado (0-500 €),
  // que es exactamente lo que la edge valida.
  function anadirLibre(nombre, importeTexto) {
    const limpio = String(importeTexto || '').replace(/[^\d.,]/g, '')
    const num = parseFloat(limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio)
    if (!Number.isFinite(num) || num <= 0 || num > 500) {
      toast('El importe tiene que estar entre 0 y 500 €', 'error')
      return
    }
    const etiqueta = (nombre || '').trim().slice(0, 80) || 'Varios'
    setCarrito((prev) => [...prev, {
      clave: `libre|${uuidv4()}`,   // cada línea libre es única: el uuid fija su importe en la firma
      producto_id: null,
      nombre: etiqueta,
      tamano: null,
      extras: [],
      extrasTexto: '',
      precio_c: Math.round(num * 100),
      cantidad: 1,
      notas: null,
      libre: true,
    }])
    setModalLibre(false)
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

  // La RONDA numera los papeles de una misma venta ("MOSTRADOR #1", "#2"...):
  // tres rondas en hora punta eran tres papeles idénticos y cocina no sabía
  // cuál iba primero. Se reinicia con cada venta (el efecto del carrito la pone
  // a 0 al vaciarse).
  async function comandar() {
    if (!sinComandar.length) { toast('No hay nada nuevo que mandar a cocina'); return }
    // Doble toque = dos comandas iguales = comida duplicada. Candado síncrono.
    if (comandandoRef.current) return
    comandandoRef.current = true
    setComandando(true)
    // 🔴 Se capturan AHORA las claves de lo que va a salir por la impresora: el
    // envío tarda segundos y lo que se pique en ese hueco NO ha salido en este
    // papel — antes se marcaba TODO el carrito como comandado y esas líneas se
    // quedaban sin cocinar sin que nadie se enterase.
    const claves = new Set(sinComandar.map((l) => l.clave))
    try {
      // Con varias impresoras, cada línea va a la suya según su CATEGORÍA
      // (configurado en la nube; las líneas libres, a la de caja). El helper
      // resuelve también el camino clásico cocina/barra de este aparato.
      const destinoDe = await crearDestinoDe(restaurante.id)
      const ok = await imprimirComandaTpv(sinComandar, restaurante, { numero: rondaRef.current + 1 }, destinoDe)
      if (!ok) { toast('La impresora no responde: la comanda no ha salido', 'error'); return }
      rondaRef.current += 1
      setCarrito((prev) => prev.map((l) => (claves.has(l.clave) ? { ...l, comandada: true } : l)))
      toast('Comanda enviada a cocina', 'success')
    } finally {
      comandandoRef.current = false
      setComandando(false)
    }
  }

  const informandoRef = useRef(false)
  async function informeDelDia() {
    // Candado: dos toques eran dos informes por la impresora.
    if (informandoRef.current) return
    informandoRef.current = true
    try {
    // 🔴 ANTES ESTE INFORME MENTÍA, y por eso Marlon vio 73 € un día que vendió
    // 193: leía solo `tpv_tickets`, y esa tabla POR DISEÑO solo puede tener
    // ventas de mostrador (`tpv_emitir_ticket` lanza PD195 con cualquier otro
    // origen). Los 83,10 € del teléfono y los 37 de la app no llegan a existir
    // como ticket, así que no había forma de que salieran.
    //
    // Ahora la venta sale de `lib/jornada.js`, que mira TODAS las vías, y los
    // tickets se siguen leyendo pero solo para la parte fiscal (base, IGIC y el
    // rango de numeración), que es lo único para lo que sirven.
    const desde = inicioJornada()
    const [dia, { data: dataTk, error: errTk }] = await Promise.all([
      resumenJornada(restaurante.id, desde),
      supabase.from('tpv_tickets')
        .select('serie, numero, total, base_imponible, cuota_igic, metodo_pago')
        .eq('establecimiento_id', restaurante.id)
        .gte('emitido_at', desde.toISOString())
        .order('emitido_at')
        .limit(2000),
    ])
    if (!dia) { toast('No se pudo leer la venta del día. Revisa la conexión.', 'error'); return }
    if (errTk) { toast('No se pudieron leer los tickets: ' + errTk.message, 'error'); return }
    const t = dataTk || []
    if (!dia.pedidos && !t.length) { toast('Hoy todavía no se ha cobrado nada'); return }

    const suma = (f) => t.reduce((s, x) => s + Number(f(x) || 0), 0)
    const resumen = {
      // La venta, por todas las puertas.
      total: dia.total,
      pedidos: dia.pedidos,
      comida: dia.comida,
      envios: dia.envios,
      propinas: dia.propinas,
      porVia: dia.porVia,
      // Dónde está ese dinero. `efectivo` es lo que tiene que haber en el cajón.
      efectivo: dia.efectivo,
      datafono: dia.datafono,
      online: dia.online,
      // La parte fiscal, que solo existe para el mostrador.
      tickets: t.length,
      base: suma((x) => x.base_imponible),
      igic: suma((x) => x.cuota_igic),
      primero: t.length ? `${t[0].serie}-${t[0].numero}` : null,
      ultimo: t.length ? `${t[t.length - 1].serie}-${t[t.length - 1].numero}` : null,
    }
    if (dia.truncado || t.length >= 2000) toast('Hoy hay más de 2000 apuntes: el informe puede quedarse corto', 'error')
    const ok = await imprimirInformeDiaTpv(resumen, restaurante)
    toast(ok
      ? `Informe impreso · ${dia.pedidos} pedidos · ${eur(cents(dia.total))}`
      : `Hoy: ${dia.pedidos} pedidos, ${eur(cents(dia.total))} (la impresora no responde)`,
      ok ? 'success' : 'error')
    } finally {
      informandoRef.current = false
    }
  }

  async function vaciar() {
    // Si parte ya se mandó a cocina, vaciar deja platos hechos que nadie va a
    // cobrar: se pregunta ANTES de borrar. El aviso de antes salía DESPUÉS de
    // haber borrado, cuando ya no servía para nada.
    if (carrito.some((l) => l.comandada)) {
      const seguro = await confirmar('Parte de esta venta ya está en cocina. ¿Vaciarla igualmente?')
      if (!seguro) return
    }
    setCarrito([])
  }

  // La clave de idempotencia YA vive en `idemRef`, atada a la firma del carrito
  // (ver arriba): aquí no se genera nada. Reintentar un cobro fallido reusa la
  // misma clave y el servidor devuelve la venta ya grabada en vez de repetirla.
  function cobrarEnEfectivo() {
    if (!carrito.length) return
    setModalPago(true)      // hace falta preguntar con cuánto paga, para el cambio
  }

  function cobrarConTarjeta() {
    if (!carrito.length) return
    // Con tarjeta no hay cambio que calcular: el importe se teclea en el datáfono
    // y aquí solo se deja constancia. Un paso menos en cada venta con tarjeta.
    cobrar('datafono', null)
  }

  // La venta cobrada SIN INTERNET: a la cola local (misma clave de
  // idempotencia) + ticket PROVISIONAL serie OFF + cajón si es efectivo. El
  // dinero ya está en el cajón: el servicio no se para por el router.
  function cobrarSinInternet(cuerpo, metodo_pago, entregado_c, totalPantalla, lineasPantalla) {
    const numeroOff = siguienteNumeroOff(restaurante.id)
    encolarVenta(restaurante.id, { payload: cuerpo, numeroOff, total_c: totalPantalla, metodo: metodo_pago })

    const igic = Number(tpvConfig?.igic_pct) || 0
    const total = totalPantalla / 100
    const base = igic ? total / (1 + igic / 100) : total
    const ticket = {
      serie: 'OFF', numero: numeroOff, total,
      base_imponible: base, igic_pct: igic, cuota_igic: total - base,
      metodo_pago, emitido_at: new Date().toISOString(),
      entregado_efectivo: entregado_c != null ? entregado_c / 100 : null,
      cambio: entregado_c != null ? Math.max(0, entregado_c - totalPantalla) / 100 : null,
    }
    const items = lineasPantalla.map((l) => ({
      nombre_producto: l.nombre, tamano: l.tamano || null,
      extras: l.extrasTexto ? String(l.extrasTexto).split(', ').filter(Boolean) : [],
      precio_unitario: l.precio_c / 100, cantidad: l.cantidad, notas: l.notas || null,
    }))
    imprimirTicketTpv(ticket, { codigo: null }, items, restaurante, {
      pieTicket: tpvConfig?.pie_ticket, provisional: true,
      abrirCajonTambien: metodo_pago === 'efectivo' && (tpvConfig?.abrir_cajon ?? true),
    }).catch(() => {})

    setCarrito([])          // el efecto del carrito limpia la clave y el respaldo
    setModalPago(false)
    toast(`Sin conexión: venta OFF-${numeroOff} guardada en este aparato. Se apuntará sola al volver internet.`, 'success')
  }

  async function cobrar(metodo_pago, entregado_c = null) {
    if (enVueloRef.current) return
    enVueloRef.current = true
    setCobrando(true)
    // Sin límite de tiempo, una red a medias (TCP abierto, sin respuesta) dejaba
    // los dos botones deshabilitados SIN SALIDA durante minutos, y la única
    // escapatoria era recargar. 30 s y se corta: reintentar es seguro porque la
    // clave de idempotencia no cambia.
    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), 30000)
    // El total que VE el camarero en este momento, para poder comparar después
    // con el que cobró de verdad el servidor. Y las líneas tal cual están: si
    // hay que guardar la venta sin conexión, esto es lo que se guarda.
    const totalPantalla = totalCarrito
    const lineasPantalla = carrito
    let cuerpo = null
    try {
      if (!idemRef.current) idemRef.current = uuidv4()  // red de seguridad; la pone el efecto del carrito
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      cuerpo = {
        establecimiento_id: restaurante.id,
        metodo_pago,
        entregado_efectivo: entregado_c != null ? entregado_c / 100 : null,
        idempotency_key: idemRef.current,
        // Dos formas de línea, las dos del contrato de tpv-venta: producto de
        // la carta (ids, el precio lo pone el servidor) o línea LIBRE (aquí
        // sí viaja el importe, validado 0-500 en los dos lados).
        lineas: carrito.map((l) => (l.producto_id
          ? { producto_id: l.producto_id, tamano: l.tamano, tamano_id: l.tamano_id || null, cantidad: l.cantidad, extras: l.extras, notas: l.notas || null }
          : { nombre: l.nombre, precio_unitario: l.precio_c / 100, cantidad: l.cantidad, notas: l.notas || null })),
      }
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-venta`, {
        method: 'POST',
        signal: corte.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(cuerpo),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body?.ok) {
        throw new Error(({
          tpv_no_contratado: 'Este restaurante no tiene el TPV activado.',
          tpv_no_activo: 'El TPV está desactivado. Habla con Pidoo.',
          tpv_pausado: 'Tienes el TPV pausado desde Ajustes.',
          forbidden: 'Esta cuenta no puede cobrar en este restaurante.',
          producto_no_encontrado: 'Un producto de la venta ya no está en la carta. Recárgala desde el menú y vuelve a picarlo.',
          extra_no_encontrado: 'Un extra de la venta ya no existe. Recarga la carta desde el menú y vuelve a elegirlo.',
          generar_codigo_failed: 'El servidor no respondió. Vuelve a intentarlo: no se ha cobrado nada.',
        })[body?.error] || body?.detalle || body?.error || 'No se pudo completar la venta')
      }

      // A partir de aquí LA VENTA YA ESTÁ COBRADA Y GRABADA.
      setUltimaVenta(body)
      setCarrito([])          // el efecto del carrito limpia la clave y el respaldo
      setModalPago(false)
      if (body.sin_ticket) toast('Venta guardada, pero sin número de ticket. Avisa a Pidoo.', 'error')
      else toast(`Cobrado ${eur(cents(body.pedido?.total))}${body.repetida ? ' (ya estaba cobrado)' : ''}`, 'success')

      // El CAMBIO se enseñó en el modal con el total de la PANTALLA. Si el del
      // servidor difiere (carta desactualizada), el camarero ya contó mal el
      // cambio en la cabeza: se le canta el bueno, bien alto.
      if (metodo_pago === 'efectivo' && entregado_c != null && body.pedido?.total != null) {
        const totalServidor = cents(body.pedido.total)
        if (totalServidor !== totalPantalla && entregado_c >= totalServidor) {
          toast(`OJO: el total real es ${eur(totalServidor)} — el cambio correcto son ${eur(entregado_c - totalServidor)}`, 'error')
        }
      }

      if (body.ticket) {
        imprimirTicketTpv(body.ticket, body.pedido, body.items, conLogo(body.establecimiento), {
          pieTicket: body.config?.pie_ticket,
          // Si la respuesta viene SIN `config` (venta repetida servida por una
          // edge anterior a la v6), en efectivo el cajón se abre igual: el
          // reintento es justo el momento en que hay que dar el cambio.
          abrirCajonTambien: body.config ? !!body.config.abrir_cajon : metodo_pago === 'efectivo',
        }).then((r) => {
          // `impresoraConfigurada()` EN VIVO, no el estado congelado al montar:
          // si se configuró la impresora desde la capa, el aviso tiene que salir.
          if (!r.ticket && impresoraConfigurada()) toast('No se pudo imprimir el ticket', 'error')
        }).catch(() => {})
      }
    } catch (err) {
      // FALLO DE RED (sin internet, o el fetch ni salió): la venta NO se
      // pierde ni se bloquea — va a la COLA LOCAL con su misma clave de
      // idempotencia y sale un ticket PROVISIONAL. Al volver la conexión se
      // envía sola; si por lo que fuera ya había entrado, el servidor contesta
      // `repetida` y no se cobra dos veces.
      const esRed = !navigator.onLine || /failed to fetch|networkerror|load failed/i.test(err?.message || '')
      if (esRed && cuerpo) {
        cobrarSinInternet(cuerpo, metodo_pago, entregado_c, totalPantalla, lineasPantalla)
      } else if (err?.name === 'AbortError') {
        // El servidor no contestó a tiempo con la red viva: reintentar tal
        // cual es seguro por la clave de idempotencia.
        toast('Sin respuesta del servidor. Vuelve a pulsar cobrar TAL CUAL está la venta: si ya había entrado, no se cobra dos veces.', 'error')
      } else {
        toast(err.message || 'Error al cobrar', 'error')
      }
    } finally {
      clearTimeout(reloj)
      enVueloRef.current = false
      setCobrando(false)
    }
  }

  // 🔴 El establecimiento que devuelve `tpv-venta` NO trae `logo_url`: su consulta pide
  // lo FISCAL (razon social, NIF, direccion, telefono) y nada mas. Por eso el ticket
  // salia sin logo aunque el restaurante tenga uno puesto — `bytesDelLogo(undefined)`
  // devuelve null y el ticket se imprime igual, sin el, que es el comportamiento
  // correcto cuando algo falla pero aqui no fallaba nada: es que nunca llegaba la URL.
  //
  // Se completa AQUI y no ampliando la consulta del edge a proposito: los datos
  // fiscales tienen que venir del servidor porque son los que se imprimen en una
  // factura, pero el logo es cosmetico y el panel ya lo tiene cargado en el contexto.
  // Asi no hay que desplegar una edge que cobra dinero para arreglar una imagen.
  const conLogo = (est) => ({ ...est, logo_url: est?.logo_url || restaurante?.logo_url || null })

  async function reimprimir() {
    if (!ultimaVenta?.ticket) return
    const r = await imprimirTicketTpv(ultimaVenta.ticket, ultimaVenta.pedido, ultimaVenta.items,
      conLogo(ultimaVenta.establecimiento), { pieTicket: ultimaVenta.config?.pie_ticket })
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
    <div className="tpv-raiz" style={modoApp || pantallaCompleta
      // Ocupando la pantalla, la caja ES la pantalla: columna flex de alto completo,
      // para que la fila de abajo pueda quedarse con lo que sobre SIN numeros magicos.
      ? {
          ...caja, padding: esMovil ? 10 : 16, borderRadius: 0,
          // 🔴 El alto FIJO solo donde la fila de abajo es `flex: 1`. En telefono y
          // tablet las dos columnas se apilan y crecen: una caja de 100dvh ahi dejaria
          // el contenido colgando por fuera. Esos siguen con minHeight, que crece.
          ...(altoCompleto
            ? { height: '100dvh', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }
            : { minHeight: '100vh' }),
        }
      : esMovil ? { ...caja, padding: 10, borderRadius: 12 } : caja}>
      {/* SENSACIÓN DE PULSACIÓN en todo el TPV (pedido de Marlon, 4 sep): en un
          mostrador se toca deprisa y sin mirar dos veces — cada botón se hunde
          un pelín al pulsarlo para que se SIENTA el toque, y el que está
          deshabilitado no se inmuta (ni miente). */}
      <style>{`
        .tpv-raiz button { transition: transform 0.06s ease, filter 0.06s ease; }
        .tpv-raiz button:active:not(:disabled) { transform: scale(0.96); filter: brightness(1.25); }
      `}</style>
      {/* Mostrador y Pedidos en la misma pantalla: durante el servicio no se puede
          estar saltando de una sección a otra. No hay pestaña de Reservas porque
          Pidoo no tiene reservas: no existe ninguna tabla detrás. */}
      {/* En modo app no hay cabecera de panel detrás, así que el nombre y el estado
          van aquí. El estado importa: si la app se queda sin conexión, el sistema
          cierra el restaurante solo a los 5 minutos y conviene verlo de un vistazo. */}
      {/* Tambien a pantalla completa en escritorio: sin la cabecera del panel detras,
          el nombre del local y si esta abierto no se ven en ningun sitio. */}
      {(modoApp || pantallaCompleta) && <CabeceraApp restaurante={restaurante} esMovil={esMovil}
        onAbrir={() => {
          // En la app, el interruptor de abrir/cerrar vive en la pantalla de
          // Impresora. En escritorio vive en Ajustes, que esta FUERA del TPV: hay que
          // salir de pantalla completa y navegar. Antes esto no hacia absolutamente
          // nada en escritorio — un boton muerto en la cabecera.
          if (modoApp) { setPantalla('impresora'); return }
          onAlternarPantalla?.()
          window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'ajustes' }))
        }} />}

      {/* Fila flex de verdad, no un centrado con el menu en absolute encima: asi el
          menu ocupa su sitio y las pestanas no pueden crecer por debajo de el. Antes,
          con el contador puesto, "Pedidos" se metia 18 px DEBAJO del boton del menu
          (medido a 375 px: 8 px de holgura y 26 que ocupa el contador). */}
      {/* FIJA arriba: al bajar por la carta, el cambio de Mostrador/Pedidos y el menu
          tienen que seguir ahi. Son los dos sitios a los que se salta a mitad de
          servicio, y perseguirlos con el scroll es tiempo con el cliente delante.
          Lleva el fondo del TPV porque los productos pasan por DEBAJO. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        position: 'sticky', top: 0, zIndex: 20,
        background: T.bg,
        paddingTop: modoApp || pantallaCompleta ? 6 : 0,
        paddingBottom: 10, marginBottom: 6,
      }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Pestana activa={pestana === 'mostrador'} onClick={() => setPestana('mostrador')}
            esMovil={esMovil} esMonitor={esMonitor}
            icono={<Calculator size={tam(16, 17, 16)} />} texto="Mostrador" />
          <Pestana activa={pestana === 'pedidos'} onClick={() => setPestana('pedidos')}
            esMovil={esMovil} esMonitor={esMonitor}
            icono={<Bike size={tam(16, 17, 16)} />} texto="Pedidos"
            contador={pedidosNuevos?.length || 0} />
        </div>
        {/* El menú va en la esquina y no encima del ticket: es de la pantalla
            entera, no de la venta que estés cobrando. La etiqueta dice "del TPV"
            porque el header de la app ya tiene su propio botón de menú. */}
        {/* Ampliar a toda la pantalla. Solo en escritorio: en la app el TPV YA la
            ocupa entera, y el boton no tendria nada que hacer. */}
        {onAlternarPantalla && (
          <button onClick={onAlternarPantalla} style={{
            ...btnIcono, flexShrink: 0,
            width: tam(40, 44, 40), height: tam(40, 44, 40), borderRadius: 11,
          }}
            aria-label={pantallaCompleta ? 'Salir de pantalla completa' : 'TPV a pantalla completa'}
            title={pantallaCompleta ? 'Salir de pantalla completa (Esc)' : 'TPV a pantalla completa'}>
            {pantallaCompleta ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
          </button>
        )}
        <button onClick={() => setMenu(true)} aria-label="Menú del TPV" style={{
          ...btnIcono, flexShrink: 0,
          width: tam(40, 44, 40), height: tam(40, 44, 40), borderRadius: 11,
        }}>
          <Menu size={20} />
        </button>
      </div>

      {/* MODO SIN INTERNET: el mostrador sigue (carta local, comandas por la
          red del local, ventas a la cola con ticket provisional). El banner
          dice en qué situación se está, y desaparece cuando todo está al día. */}
      {(!online || colaN > 0) && (
        <div style={{
          padding: '9px 14px', borderRadius: 10, marginBottom: 10,
          fontSize: 13, fontWeight: 700, lineHeight: 1.4,
          background: !online ? 'rgba(245,158,11,0.14)' : 'rgba(96,165,250,0.12)',
          border: `1px solid ${!online ? 'rgba(245,158,11,0.5)' : 'rgba(96,165,250,0.45)'}`,
          color: !online ? '#F5A623' : '#7EB5F7',
        }}>
          {!online
            ? `Sin conexión · modo local — el mostrador sigue: comandas, efectivo y datáfono. Las ventas se guardan en este aparato${colaN ? ` (${colaN} pendiente${colaN > 1 ? 's' : ''})` : ''} y se apuntarán solas al volver internet.`
            : `Sincronizando ${colaN} venta${colaN > 1 ? 's' : ''} cobrada${colaN > 1 ? 's' : ''} sin conexión…`}
        </div>
      )}

      {pestana === 'pedidos' ? (
        <TpvPedidos establecimientoId={restaurante.id} esMovil={esMovil} huecoAbajo={huecoAbajo}
          repartoPropio={restaurante?.delivery_sin_socio === true}
          abrirPedidoId={pedidoParaAbrir}
          onNuevo={(tipo) => setNuevoPedido(tipo)}
          onEditar={(p) => setPedidoEditar(p)}
          recargarToken={recargasPedidos}
          onAbrirRepartidores={() => setPantalla('socios-riders')} />
      ) : (
      // En MONITOR las dos columnas ocupan el alto de la pantalla y cada una se
      // desplaza por su cuenta: la carta puede tener 160 productos y la venta cuatro
      // lineas, y hacerlas scrollear juntas aleja el total del sitio donde se cobra.
      //
      // 🔴 `flex: 1` y NO `calc(100vh - Xpx)`: ese numero habria que ajustarlo a mano
      // segun lo que haya encima, y encima hay cosas distintas en cada sitio (en el
      // panel, migas y a veces el banner de datos fiscales). Con flex, la fila se
      // queda con lo que sobre, valga lo que valga la cabecera.
      //
      // Y solo cuando el TPV es DUENO de la pantalla. Dentro del panel el TPV es una
      // seccion de una pagina que scrollea: forzar ahi el alto completo saca el
      // contenido por abajo.
      // (Comentario JS y no {/* */}: en la rama de un ternario solo cabe UNA expresion.)
      //
      // 🔴 `nowrap` SIEMPRE. Con `wrap`, el ticket se caia DEBAJO de toda la rejilla
      // de productos —o sea, fuera de la pantalla— en cuanto la suma de las dos bases
      // (420 + 14 + 360 = 794) no cabia en el contenedor. Medido el 1 sep 2026: pasaba
      // en iPad vertical (contenedor 708) Y en una ventana de 1024 con la barra lateral
      // del panel (contenedor 683), que no es ningun caso raro. Las bases de abajo
      // estan puestas para que quepan hasta en el contenedor mas estrecho que existe
      // sin ser telefono (~689 px); ahi encoge, que es recuperable, y envolver no lo
      // era. En telefono el ticket es una hoja `fixed`: no esta en esta fila.
      <div style={{
        display: 'flex', gap: esMonitor ? 16 : 14, alignItems: 'flex-start', flexWrap: 'nowrap',
        ...(altoCompleto ? { flex: 1, minHeight: 0 } : null),
      }}>
      {/* ── Izquierda: la carta ─────────────────────────────────────────── */}
      {/* En telefono la carta es TODA la pantalla, y se le deja hueco abajo para que
          la barra de la venta no tape la ultima fila de productos. */}
      <div style={{
        flex: '1 1 420px', minWidth: 0, paddingBottom: esMovil ? 84 + huecoAbajo : 0,
        ...(altoCompleto ? { height: '100%', overflowY: 'auto', paddingRight: 4 } : null),
      }}>
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

        {/* En MONITOR el buscador va estrecho y a la izquierda de las categorias:
            a todo lo ancho se comia una franja entera para un campo que casi nunca se
            usa (la carta se toca, no se escribe). En telefono y tablet sigue ancho,
            que es donde escribir sale mas a cuenta que buscar con el dedo. */}
        <div style={{
          position: 'relative', marginBottom: esMonitor ? 10 : 14,
          width: esMonitor ? 260 : '100%', flexShrink: 0,
        }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: esMonitor ? 14 : 15, color: T.muted }} />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto"
            style={{
              width: '100%', height: esMonitor ? 44 : 46, paddingLeft: 36, paddingRight: 12,
              borderRadius: 11, border: `1px solid ${T.border}`,
              background: T.surface2, color: T.text,
              fontSize: esMonitor ? 14 : 15, fontFamily: 'inherit',
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
            <div style={{ ...etiquetaBloque, marginBottom: 7 }}>Categorías</div>
            <div style={{
              position: 'relative', marginBottom: esMonitor ? 12 : 14,
              display: 'flex', justifyContent: esMonitor ? 'flex-start' : 'center',
            }}>
              {/* En TELEFONO las categorias van en una sola fila que se desliza: no
                  caben y apilarlas se comeria media pantalla de carta. En tablet
                  grande y en escritorio se REPARTEN EN FILAS y se ven TODAS, que es
                  lo que ahorra toques: la categoria que buscas ya esta a la vista. */}
              <div style={{
                maxWidth: '100%',
                ...(esMovil
                  // TELEFONO: una sola fila que se desliza. Apilarlas se comeria media
                  // pantalla de carta.
                  ? { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2,
                      scrollSnapType: 'x proximity' }
                  // ESCRITORIO: fila de ancho NATURAL alineada a la IZQUIERDA.
                  // La rejilla de celdas iguales cuadraba pero dejaba huecos raros con
                  // los nombres cortos. Y lo que se veia "apilado" era el wrap
                  // CENTRADO: bordes irregulares por los dos lados. Alineado a la
                  // izquierda solo queda corta la ultima fila, que es como se lee.
                  : { display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%',
                      justifyContent: 'flex-start' }),
              }}>
                {categorias.map((c) => {
                  const Icono = iconoDe(c.nombre)
                  const activa = c.id === catSel && !busqueda
                  return (
                    <button key={c.id} onClick={() => { setCatSel(c.id); setBusqueda('') }} style={{
                      // No encoge en ninguno de los dos: cada categoria ocupa lo que
                      // mide su nombre. Un tope evita que "Bebidas Alcoholicas" se lleve
                      // media fila.
                      flex: '0 0 auto', minWidth: 0, maxWidth: esMonitor ? 230 : '100%',
                      height: tam(46, 56, 44), padding: esMovil ? '0 12px' : '0 12px', cursor: 'pointer',
                      scrollSnapAlign: 'start', fontFamily: 'inherit',
                      border: `1px solid ${activa ? T.accent : T.border}`,
                      borderRadius: 12,
                      background: activa ? T.accentFill : T.surface2,
                      color: activa ? T.onAccent : T.text,
                      display: 'flex', alignItems: 'center', gap: 9,
                      fontSize: tam(13, 14, 13), fontWeight: activa ? 700 : 500,
                    }}>
                      <Icono size={tam(16, 18, 15)} color={activa ? T.onAccent : T.accent} style={{ flexShrink: 0 }} />
                      <span style={{
                        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', textAlign: 'left', flex: 1,
                      }}>{c.nombre}</span>
                      <span style={{
                        fontSize: 12, opacity: 0.65, fontWeight: 500, flexShrink: 0,
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

            {/* Una etiqueta por bloque y una raya entre los dos. Sin esto, la tira de
                categorias y la rejilla de productos son dos filas de botones oscuros
                pegadas y no se ve que una filtra a la otra. Lo pidio Marlon el 1 sep
                mirando la pantalla: "esta todo pegado". */}
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              borderTop: `1px solid ${T.border}`,
              paddingTop: esMovil ? 9 : 11, marginBottom: esMovil ? 8 : 10,
            }}>
              <span style={etiquetaBloque}>{busqueda ? 'Resultados' : 'Productos'}</span>
              <span style={{
                fontSize: 12, color: T.muted, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {busqueda ? `"${busqueda}"` : (categorias.find((c) => c.id === catSel)?.nombre || '')}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: T.muted, flexShrink: 0 }}>
                {visibles.length}
              </span>
            </div>
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
                  <TarjetaProducto
                    key={p.id}
                    p={p}
                    tams={tams}
                    tieneExtras={tieneExtras}
                    yaLleva={yaLleva}
                    esMovil={esMovil}
                    tam={tam}
                    precioBarra={precioBarra}
                    onClick={() => tocarProducto(p)}
                  />
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
      } : altoCompleto ? {
        // Ancho FIJO en monitor: la venta no debe encogerse porque la carta tenga
        // muchos productos, y a mas de 400 px se queda vacia mirando al techo.
        flex: '0 0 380px', width: 380, height: '100%',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      } : {
        // Encoge hasta 300 y no mas. Con `nowrap`, cuando las dos columnas no caben
        // encogen a la vez en vez de envolver: en el contenedor mas estrecho medido
        // (683 px) quedan carta 360 / ticket 309, o sea 2 columnas de producto y el
        // ticket entero a la vista.
        flex: '0 1 360px', minWidth: 300, position: 'sticky', top: 12,
      }}>
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
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 14,
          // En monitor la tarjeta ocupa TODO el alto de su columna, con las lineas
          // desplazandose en medio y el total anclado abajo. Asi el importe y los
          // botones de cobro estan SIEMPRE en el mismo sitio, lleve la venta dos
          // lineas o veinte: el camarero no tiene que buscarlos.
          ...(altoCompleto ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : null),
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15, color: T.text }}>Venta en curso</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {aparcadas.length > 0 && (
                <button onClick={() => setModalAparcadas(true)} style={{
                  border: 'none', background: 'none', cursor: 'pointer', color: T.accent,
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
                }}>
                  <Bookmark size={14} /> Aparcadas ({aparcadas.length})
                </button>
              )}
              {carrito.length > 0 && (
                <button onClick={() => setAparcandoNombre('')} style={{
                  border: 'none', background: 'none', cursor: 'pointer', color: T.muted,
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit',
                }}>
                  <Bookmark size={14} /> Aparcar
                </button>
              )}
              <button onClick={() => setModalLibre(true)} style={{
                border: 'none', background: 'none', cursor: 'pointer', color: T.muted,
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit',
              }}>
                <Plus size={14} /> Libre
              </button>
              {carrito.length > 0 && (
                <button onClick={vaciar} style={{
                  border: 'none', background: 'none', cursor: 'pointer', color: T.muted,
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit',
                }}>
                  <Trash2 size={14} /> Vaciar
                </button>
              )}
            </div>
          </div>

          {carrito.length === 0 ? (
            <div style={{
              padding: '28px 10px', textAlign: 'center', color: T.muted, fontSize: 14,
              ...(altoCompleto ? { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } : null),
            }}>
              Toca un producto para empezar.
            </div>
          ) : (
            <div style={altoCompleto
              ? { flex: 1, minHeight: 0, overflowY: 'auto', marginBottom: 12 }
              : { maxHeight: '44vh', overflowY: 'auto', marginBottom: 12 }}>
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
                    {l.notas && (
                      <div style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>! {l.notas}</div>
                    )}
                    <div style={{ fontSize: 12, color: T.muted }}>{eur(l.precio_c)} / ud.</div>
                  </div>
                  <button onClick={() => setEditandoNota({ clave: l.clave, texto: l.notas || '' })}
                    title="Nota para cocina"
                    style={{ ...btnIcono, ...(l.notas ? { color: T.accent, borderColor: T.accent } : null) }}>
                    <StickyNote size={14} />
                  </button>
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
              fontSize: tam(26, 30, 26), fontWeight: 800, color: T.text,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {eur(totalCarrito)}
            </span>
          </div>

          {/* Comandar va ANTES de cobrar y no cobra: en un mostrador con cocina lo
              primero es que empiecen a hacerlo. Solo aparece si hay algo pendiente. */}
          {sinComandar.length > 0 && (
            <button onClick={comandar} disabled={comandando} style={{
              ...btnSecundario, width: '100%', height: 48, fontSize: 15, marginBottom: 8,
              borderColor: T.accent, color: T.accent,
              opacity: comandando ? 0.6 : 1, cursor: comandando ? 'default' : 'pointer',
            }}>
              <ChefHat size={17} style={{ marginRight: 8 }} />
              {comandando
                ? 'Enviando a cocina…'
                : 'Comandar a cocina' + (carrito.length !== sinComandar.length ? ` (${sinComandar.length} nuevo${sinComandar.length > 1 ? 's' : ''})` : '')}
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
          abreCajon={tpvConfig?.abrir_cajon_efectivo !== false}
          onCerrar={() => setModalPago(false)}
          onCobrar={(entregado) => cobrar('efectivo', entregado)} />
      )}

      {nuevoPedido && (
        <Modal titulo={nuevoPedido === 'reparto' ? 'Nuevo reparto' : 'Nueva recogida'}
          onCerrar={() => setNuevoPedido(null)}
          ancho={esMonitor ? 1240 : 440} altoFijo={esMonitor} cerrarAlFondo={false}>
          <TpvNuevoPedido restaurante={restaurante} modo={nuevoPedido}
            onCancelar={() => setNuevoPedido(null)}
            onHecho={() => setNuevoPedido(null)} />
        </Modal>
      )}

      {pedidoEditar && (
        <Modal titulo={'Editar ' + (pedidoEditar.codigo || 'pedido')}
          onCerrar={() => setPedidoEditar(null)}
          ancho={esMonitor ? 1240 : 440} altoFijo={esMonitor} cerrarAlFondo={false}>
          <TpvNuevoPedido restaurante={restaurante}
            modo={pedidoEditar.modo_entrega === 'delivery' ? 'reparto' : 'recogida'}
            pedidoEditar={pedidoEditar}
            onCancelar={() => setPedidoEditar(null)}
            onHecho={() => { setPedidoEditar(null); setRecargasPedidos((n) => n + 1) }} />
        </Modal>
      )}

      {modalCaja && (
        <Modal titulo="Caja del mostrador" onCerrar={() => setModalCaja(false)}>
          <TpvCaja establecimientoId={restaurante.id} restaurante={restaurante}
            vistaInicial={cajaVista} onCerrarModal={() => setModalCaja(false)} />
        </Modal>
      )}

      {modalTickets && (
        <Modal titulo="Tickets del día" onCerrar={() => setModalTickets(false)} ancho={560}>
          <TpvTickets establecimientoId={restaurante.id} restaurante={restaurante}
            tpvConfig={tpvConfig} onCerrarModal={() => setModalTickets(false)} />
        </Modal>
      )}

      {editandoNota && (
        <ModalTexto titulo="Nota para cocina" etiqueta="Se imprime en la comanda y en el ticket"
          placeholder="Sin cebolla, muy hecha, para llevar…" inicial={editandoNota.texto}
          boton="Guardar la nota" onCerrar={() => setEditandoNota(null)}
          onAceptar={(v) => guardarNotaLinea(editandoNota.clave, v)} />
      )}

      {modalLibre && <ModalLibre onCerrar={() => setModalLibre(false)} onAceptar={anadirLibre} />}

      {aparcandoNombre != null && (
        <ModalTexto titulo="Aparcar esta venta" etiqueta="Ponle un nombre para reconocerla"
          placeholder="Mesa 3, el rubio de la barra…" inicial="" maxLength={40}
          boton="Aparcar" onCerrar={() => setAparcandoNombre(null)}
          onAceptar={(v) => aparcarVenta(v)} />
      )}

      {modalAparcadas && (
        <Modal titulo="Ventas aparcadas" onCerrar={() => setModalAparcadas(false)}>
          <div style={{ display: 'grid', gap: 8 }}>
            {aparcadas.map((a) => {
              const unidades = (a.lineas || []).reduce((s, l) => s + (l.cantidad || 0), 0)
              const total = (a.lineas || []).reduce((s, l) => s + (l.precio_c || 0) * (l.cantidad || 0), 0)
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 12, background: T.surface2,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{a.nombre}</div>
                    <div style={{ fontSize: 12, color: T.muted }}>
                      {unidades} art. · {eur(total)} · {new Date(a.creada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button onClick={() => recuperarVenta(a.id)} style={{ ...btnSecundario, height: 40, flexShrink: 0 }}>
                    Recuperar
                  </button>
                  <button onClick={() => borrarAparcada(a.id)} title="Borrar"
                    style={{ ...btnIcono, color: T.danger, flexShrink: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {/* La barra de la venta, fija abajo en telefono. Es lo unico que hace falta ver
          de la venta mientras se marca: cuanto llevas y como llegar al cobro. */}
      {esMovil && pestana === 'mostrador' && !hojaVenta && !pantalla && (
        <div style={{
          // 🔴 `huecoAbajo` es el alto de la nav inferior del panel, que tambien va
          // `fixed` en `bottom: 0`. Sin esto la barra se pintaba JUSTO ENCIMA de
          // TPV / Historial / Carta / Promos / Ajustes. En la app (`modoApp`) no hay
          // nav: llega 0 y la barra se queda abajo del todo, como siempre.
          position: 'fixed', left: 10, right: 10, bottom: 10 + huecoAbajo, zIndex: 950,
        }}>
          <button onClick={() => setHojaVenta(true)} disabled={!carrito.length} style={{
            ...btnAccion, width: '100%', height: 54, borderRadius: 14,
            justifyContent: 'space-between', padding: '0 14px', fontSize: 15,
            // Apagada NO con `opacity`: translucida se leia a traves lo que hubiera
            // debajo. Se apaga con colores propios, opacos.
            ...(carrito.length ? null : {
              background: T.surface2, color: T.muted, border: `1px solid ${T.border}`,
            }),
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
          onVer={() => {
            setAvisoFuera(pedidoAvisado.id)
            setPedidoParaAbrir(pedidoAvisado.id)
            setPantalla(null)
            setPestana('pedidos')
          }}
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
            {pantalla === 'socios-riders' && <SociosYRepartidores />}
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
              {/* "Pedidos" ya no está aquí: es la pestaña de arriba, donde ahora
                  también se acepta, se avanza, se reimprime y se factura. */}
              <OpcionMenu icono={<Bike size={19} color={T.accent} />} texto="Repartidores"
                nota="Quién reparte contigo y quién está en línea"
                onClick={() => { setMenu(false); setPantalla('socios-riders') }} />
              <OpcionMenu icono={<PhoneCall size={19} color={T.accent} />} texto="Pedido telefónico"
                nota="Crear un reparto o una recogida por teléfono"
                onClick={() => { setMenu(false); setPantalla('crear-envio') }} />
              <OpcionMenu icono={<Clock size={19} color={T.accent} />} texto="Historial"
                nota="Todo lo de días anteriores"
                onClick={() => { setMenu(false); setPantalla('historial') }} />
              <OpcionMenu icono={<ToggleLeft size={19} color={T.accent} />} texto="Carta"
                nota="Qué está disponible y qué se ha agotado"
                onClick={() => { setMenu(false); setPantalla('disponibilidad') }} />
              <OpcionMenu icono={<Search size={19} color={T.accent} />} texto="Recargar la carta"
                nota="Trae los precios y productos de ahora mismo"
                onClick={() => { setMenu(false); cargarCarta(true) }} />
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
          <OpcionMenu icono={<ClipboardList size={19} color={T.accent} />} texto="Tickets del día"
            nota="Reimprimir o anular cualquier venta"
            onClick={() => { setMenu(false); setModalTickets(true) }} />
          <OpcionMenu icono={<FileText size={19} color={T.accent} />} texto="Informe X"
            nota="Lo vendido en este turno, sin cerrar nada"
            onClick={() => { setMenu(false); setCajaVista('resumen'); setModalCaja(true) }} />
          <OpcionMenu icono={<Lock size={19} color={T.accent} />} texto="Cierre Z"
            nota="Cierra la caja e imprime el cierre del día"
            onClick={() => { setMenu(false); setCajaVista('cierre'); setModalCaja(true) }} />
          <OpcionMenu icono={<Printer size={19} color={T.accent} />} texto="Informe del día"
            nota="Mostrador, teléfono, app y web, todo junto"
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
function ModalEfectivo({ total_c, cobrando, abreCajon = true, onCerrar, onCobrar }) {
  const [entregado_c, setEntregado] = useState(null)
  const [otro, setOtro] = useState('')
  // Los billetes que de verdad se dan, y el importe justo el primero.
  const sugerencias = useMemo(() => {
    const opciones = [total_c, 500, 1000, 2000, 5000].filter((c) => c >= total_c)
    return [...new Set(opciones)].slice(0, 5)
  }, [total_c])
  const cambio = entregado_c != null ? entregado_c - total_c : null
  // Con 70 € en la mano y una venta de 62, las sugerencias no valían: en cuanto
  // el total pasaba de 50, la única opción era "Justo" y el cambio no se podía
  // ni registrar ni ver. El campo acepta lo que el cliente entregue.
  const escribirOtro = (texto) => {
    const limpio = texto.replace(/[^\d.,]/g, '')
    setOtro(limpio)
    if (!limpio) { setEntregado(null); return }
    const num = parseFloat(
      limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio
    )
    setEntregado(Number.isFinite(num) && num >= 0 ? Math.round(num * 100) : null)
  }
  const noLlega = entregado_c != null && entregado_c < total_c

  return (
    <Modal titulo={`Cobrar ${eur(total_c)} en efectivo`} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: T.muted, fontWeight: 600 }}>¿Con cuánto paga?</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sugerencias.map((c) => (
            <button key={c} onClick={() => { setEntregado(c); setOtro('') }} style={{
              ...btnSecundario, height: 48, minWidth: 86, fontSize: 15,
              borderColor: entregado_c === c && !otro ? T.accent : T.border,
              color: entregado_c === c && !otro ? T.accent : T.text,
              fontWeight: entregado_c === c && !otro ? 700 : 600,
            }}>
              {c === total_c ? 'Justo' : eur(c)}
            </button>
          ))}
          <input value={otro} onChange={(e) => escribirOtro(e.target.value)}
            placeholder="Otro…" inputMode="decimal"
            style={{
              ...btnSecundario, height: 48, width: 96, fontSize: 15, textAlign: 'center',
              borderColor: otro ? T.accent : T.border, outline: 'none',
            }} />
        </div>

        {cambio != null && (
          <div style={{
            padding: 14, borderRadius: 12, textAlign: 'center',
            background: noLlega ? 'rgba(255,122,107,0.12)' : T.surface2,
          }}>
            <div style={{ fontSize: 13, color: T.muted }}>{noLlega ? 'No llega' : 'Cambio a devolver'}</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: noLlega ? T.danger : T.text }}>
              {noLlega ? `faltan ${eur(total_c - entregado_c)}` : eur(cambio)}
            </div>
          </div>
        )}

        <button onClick={() => onCobrar(entregado_c)} disabled={cobrando || noLlega}
          style={{ ...btnAccion, height: 58, fontSize: 17, opacity: (cobrando || noLlega) ? 0.5 : 1 }}>
          <Banknote size={19} style={{ marginRight: 8 }} />
          {cobrando ? 'Cobrando…' : abreCajon ? 'Cobrar y abrir cajón' : 'Cobrar'}
        </button>
      </div>
    </Modal>
  )
}

// Un modal con UN campo de texto y un botón: sirve para la nota de una línea y
// para ponerle nombre a una venta aparcada. Enter también acepta.
function ModalTexto({ titulo, etiqueta, placeholder, inicial = '', boton, maxLength = 200, onCerrar, onAceptar }) {
  const [v, setV] = useState(inicial)
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 }}>{etiqueta}</label>
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder}
            maxLength={maxLength} autoFocus style={inputOscuro}
            onKeyDown={(e) => { if (e.key === 'Enter') onAceptar(v) }} />
        </div>
        <button onClick={() => onAceptar(v)} style={{ ...btnAccion, height: 50, fontSize: 15 }}>{boton}</button>
      </div>
    </Modal>
  )
}

// Línea de importe LIBRE: concepto + importe. El único sitio del mostrador
// donde el importe lo teclea una persona, y va validado igual que en la edge.
function ModalLibre({ onCerrar, onAceptar }) {
  const [nombre, setNombre] = useState('')
  const [importe, setImporte] = useState('')
  return (
    <Modal titulo="Añadir un importe libre" onCerrar={onCerrar}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          Para lo que no está en la carta. Sale en la comanda y en el ticket con
          el nombre que le pongas.
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 }}>Concepto</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Varios"
            maxLength={80} autoFocus style={inputOscuro} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 }}>Importe</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="2,50" inputMode="decimal" style={inputOscuro}
            onKeyDown={(e) => { if (e.key === 'Enter') onAceptar(nombre, importe) }} />
        </div>
        <button onClick={() => onAceptar(nombre, importe)} style={{ ...btnAccion, height: 50, fontSize: 15 }}>
          Añadir a la venta
        </button>
      </div>
    </Modal>
  )
}

// ── Piezas sueltas ──────────────────────────────────────────────────────────
// `ancho` sube el tope de 440 px para el contenido que necesita mas sitio (la
// pantalla de nuevo pedido en un monitor son tres columnas). `altoFijo` le pasa el
// scroll a los hijos: sin el, el modal entero scrollea como un bloque y las tres
// columnas se mueven juntas, que es justo lo que no queremos.
// `cerrarAlFondo: false` para el contenido que duele perder (el pedido nuevo,
// con teléfono, dirección y doce líneas picadas): un toque fuera del modal lo
// desmontaba entero sin preguntar.
function Modal({ titulo, children, onCerrar, ancho = 440, altoFijo = false, cerrarAlFondo = true }) {
  return (
    <div onClick={cerrarAlFondo ? onCerrar : undefined} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 18,
        width: '100%', maxWidth: ancho, maxHeight: '88vh',
        fontFamily: FONT,
        ...(altoFijo
          ? { height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { overflowY: 'auto' }),
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 14, flexShrink: 0,
        }}>
          <strong style={{ fontSize: 17, color: T.text }}>{titulo}</strong>
          <button onClick={onCerrar} style={{ border: 'none', background: 'none', cursor: 'pointer', color: T.muted }}>
            <X size={20} />
          </button>
        </div>
        {altoFijo ? <div style={{ flex: 1, minHeight: 0 }}>{children}</div> : children}
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

function Pestana({ activa, onClick, icono, texto, contador, esMovil, esMonitor }) {
  const compacto = esMovil || esMonitor
  return (
    <button onClick={onClick} style={{
      height: compacto ? 40 : 44, padding: compacto ? '0 14px' : '0 18px',
      borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
      fontSize: compacto ? 14 : 15, fontWeight: activa ? 800 : 600,
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
      {/* Minimizar la app de WINDOWS desde dentro del TPV: la app va a pantalla
          completa sin menú del panel, y esta es la salida hacia el escritorio.
          Solo existe donde existe el puente (en la tablet no aparece). */}
      {typeof window !== 'undefined' && window.pidooDesktop?.minimize && (
        <button onClick={() => window.pidooDesktop.minimize()} title="Minimizar"
          aria-label="Minimizar" style={{
            ...btnIcono, width: esMovil ? 34 : 38, height: esMovil ? 34 : 38, flexShrink: 0,
          }}>
          <Minimize2 size={16} />
        </button>
      )}
    </div>
  )
}

// El aviso de pedido nuevo. Va encima de TODO (tambien de la capa de pantallas) y no
// se quita solo: un pedido sin aceptar es dinero esperando, y la alarma se puede
// silenciar. Ensena lo justo para decidir -de donde viene, de quien es y cuanto- y el
// boton lleva a la pestana Pedidos del TPV, donde se acepta con su tiempo de
// preparacion, se rechaza y se imprime.
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

// Etiqueta de bloque del mostrador ("Categorías", "Productos"). Pequeña y apagada:
// tiene que separar sin robarle sitio a la carta, que es lo que se toca.
const etiquetaBloque = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
  color: T.muted, flexShrink: 0,
}

// La tarjeta de un producto en el mostrador.
//
// CON FOTO: la foto ocupa la tarjeta entera y el nombre va ENCIMA, abajo, sobre un
// degradado. Se busca el plato mirando la foto, no leyendo: la foto tiene que mandar.
// Antes la imagen era una franja y debajo habia otra franja de texto casi igual de
// alta, y en un monitor eso deja la foto diminuta.
//
// SIN FOTO: hoy 122 de 160 productos no tienen. Una tarjeta alta y negra con el nombre
// perdido en medio se lee peor que una fila compacta, asi que esas mantienen el
// formato de texto de siempre. Dos formas para dos casos, a proposito.
function TarjetaProducto({ p, tams, tieneExtras, yaLleva, esMovil, tam, precioBarra, onClick }) {
  // 🔴 En TELEFONO no: ahi la rejilla es de 2-3 columnas y una tarjeta de 126 px de
  // alto deja ver media carta, asi que se queda la fila compacta de texto.
  // En TABLET SI. Es el aparato con el que se cobra en la barra, y era justo donde
  // no se veia ni una foto: esto pedia `esMonitor` (>=1280 px) y una tablet de 800
  // o de 1024 se quedaba fuera. Hay fotos de sobra para ello — en BD (1 sep 2026):
  // Duende Burger 77 de 77 productos, Burger House 38 de 38 a la venta.
  const conFoto = !!p.imagen_url && !esMovil
  const precio = (
    <>
      {tams.length ? 'desde ' : ''}
      {eur(tams.length ? Math.min(...tams.map((t) => precioBarra(p, t))) : precioBarra(p))}
    </>
  )

  const contador = yaLleva > 0 && (
    <span style={{
      position: 'absolute', top: 6, right: 6,
      minWidth: esMovil ? 20 : 24, height: esMovil ? 20 : 24,
      padding: '0 5px', borderRadius: 7, background: T.accentFill, color: T.onAccent,
      fontSize: esMovil ? 11 : 13, fontWeight: 800,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Sobre una foto clara, el naranja solo no separa: hace falta la sombra.
      boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
    }}>{yaLleva}</span>
  )

  const marco = {
    position: 'relative', overflow: 'hidden', padding: 0, textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit', color: T.text,
    border: `1px solid ${yaLleva ? T.accent : T.border}`,
    borderRadius: esMovil ? 10 : 12,
    background: T.surface2,
    display: 'flex', flexDirection: 'column',
  }

  if (!conFoto) {
    return (
      <button onClick={onClick} style={{ ...marco, minHeight: tam(64, 78, 68) }}>
        {contador}
        <span style={{
          padding: esMovil ? '8px 9px' : '10px 11px',
          display: 'flex', flexDirection: 'column', gap: esMovil ? 3 : 5,
          flex: 1, justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: tam(12, 14, 12.5), fontWeight: 500, lineHeight: 1.25 }}>{p.nombre}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: tam(13, 15, 13.5), fontWeight: 700, color: T.accent }}>{precio}</span>
            {tieneExtras && <span style={{ fontSize: esMovil ? 10 : 11, color: T.muted }}>+ extras</span>}
          </span>
        </span>
      </button>
    )
  }

  return (
    <button onClick={onClick} title={p.nombre} style={{ ...marco, height: tam(126, 150, 132) }}>
      <img src={p.imagen_url} alt="" loading="lazy" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', display: 'block',
      }} />
      {/* El degradado NO es adorno: sin el, un nombre blanco sobre una foto clara
          (unas papas, un plato con luz) no se lee. Sube casi hasta media tarjeta
          porque el texto puede ocupar dos lineas. */}
      <span style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, top: '38%',
        background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.88) 100%)',
        pointerEvents: 'none',
      }} />
      {contador}
      <span style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: esMovil ? '0 8px 8px' : '0 10px 10px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <span style={{
          fontSize: tam(12, 14, 12.5), fontWeight: 600, lineHeight: 1.25, color: '#FFFFFF',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          // Por si el degradado se queda corto con una foto muy blanca.
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>{p.nombre}</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: tam(13, 15, 13.5), fontWeight: 800, color: T.accent,
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          }}>{precio}</span>
          {tieneExtras && (
            <span style={{ fontSize: esMovil ? 10 : 11, color: 'rgba(255,255,255,0.75)' }}>+ extras</span>
          )}
        </span>
      </span>
    </button>
  )
}
