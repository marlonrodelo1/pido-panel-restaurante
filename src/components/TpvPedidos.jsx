// Los PEDIDOS vistos desde el TPV: los que entran por Pidoo, los que se reparten,
// los de recogida y también las ventas del propio mostrador.
//
// Durante el servicio no se puede saltar entre pantallas, así que aquí está todo:
// lo que sigue en marcha arriba y lo ya cerrado de hoy debajo, como un registro
// del día.
//
// Lo que esta pantalla NO hace, a propósito: aceptar, rechazar ni cancelar. Esa
// lógica vive en `PedidosEnVivo.jsx` y no es simple — lleva control de quién acepta
// primero si hay dos tablets, reintentos del reparto, impresión y avisos.
// Duplicarla aquí sería duplicar justo la parte que mueve dinero.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario } from '../lib/tpvTheme'
import { hayQueCobrar } from '../lib/metodoPago'
import { Bike, ShoppingBag, Store, LayoutGrid, List, RefreshCw, ArrowRight, ArrowLeft, Plus, Layers, Inbox, MapPin, Phone, User, ChevronDown, ChevronUp } from 'lucide-react'

// UNA sola forma para todo lo que se pulsa aquí. Antes convivían píldoras muy
// redondeadas con botones de esquina suave y parecían dos aplicaciones distintas.
const RADIO = 12

// El ancho de la pantalla. En tablet y telefono se centra una columna de 820 px, que es
// lo que se lee comodo. En MONITOR no se limita: lo que Marlon vio el 31 ago en la app de
// Windows eran ~600 px muertos a cada lado y las cuatro secciones apiladas en bandas
// vacias. Ir centrado a 820 en una pantalla de 1440 es tirar media pantalla.
const anchoDe = (esMonitor) => (esMonitor
  ? { width: '100%' }
  : { maxWidth: 820, marginLeft: 'auto', marginRight: 'auto' })

// Alto de la zona de tres partes del escritorio. Relativo y con tope, NO un
// `calc(100vh - N)` con un numero a dedo: encima del TPV hay cosas distintas segun
// donde se pinte (en la app no hay migas; dentro del panel si, y a veces ademas el
// banner de datos fiscales). Si sobra alto, sobra; si falta, cada parte se desplaza
// por dentro y el boton de crear sigue estando abajo del todo.
const ALTO_PANEL = 'min(68vh, 760px)'
// A partir de aqui el detalle del pedido cabe AL LADO del listado: carril 92 +
// listado 380 + dos huecos de 12 + un detalle que valga para algo (>=340). Por
// debajo, el detalle ocupa el sitio del listado y se vuelve con un boton.
const ANCHO_TRES_PARTES = 860
const ANCHO_CARRIL = 92
const ANCHO_LISTADO = 380

const EN_CURSO = ['nuevo', 'aceptado', 'preparando', 'listo', 'recogido', 'en_camino']
const CERRADOS = ['entregado', 'cancelado', 'fallido', 'rechazado']

const COLUMNAS = [
  { id: 'nuevo', titulo: 'Nuevos', estados: ['nuevo'] },
  { id: 'preparando', titulo: 'En preparación', estados: ['aceptado', 'preparando'] },
  { id: 'listo', titulo: 'Listos', estados: ['listo'] },
  { id: 'camino', titulo: 'En camino', estados: ['recogido', 'en_camino'] },
]

const ETIQUETA_ESTADO = {
  nuevo: 'Nuevo', aceptado: 'Aceptado', preparando: 'Preparando', listo: 'Listo',
  recogido: 'Recogido', en_camino: 'En camino', entregado: 'Entregado',
  cancelado: 'Cancelado', fallido: 'Fallido', rechazado: 'Rechazado',
}

// De qué puerta viene cada pedido. El mostrador es `origen_pedido='tpv'`; el resto
// se distingue por si va a domicilio o lo recoge el cliente.
const tipoDe = (p) => (p.origen_pedido === 'tpv' ? 'mostrador'
  : p.modo_entrega === 'delivery' ? 'reparto' : 'recogida')

const ICONO_TIPO = { mostrador: Store, reparto: Bike, recogida: ShoppingBag }

// Solo hay que cobrar si el pedido sigue VIVO y no es una venta de mostrador: esa se
// cobra en el acto, el dinero ya esta en el cajon. Avisar de cobrar algo ya cobrado es
// peor que no avisar: el camarero deja de fiarse del aviso.
const pendienteDeCobro = (p) =>
  EN_CURSO.includes(p.estado) && p.origen_pedido !== 'tpv' && hayQueCobrar(p.metodo_pago)

// Los cuatro filtros, definidos UNA vez: arriba en escritorio, abajo en telefono.
const FILTROS = [
  { id: 'todos', texto: 'Todos', Icono: Layers },
  { id: 'reparto', texto: 'Reparto', Icono: Bike },
  { id: 'recogida', texto: 'Recogida', Icono: ShoppingBag },
  { id: 'mostrador', texto: 'Mostrador', Icono: Store },
]

export default function TpvPedidos({
  establecimientoId, esMovil = false, huecoAbajo = 0, repartoPropio = false,
  onNuevo, onAbrirPedidos, onAbrirRepartidores,
}) {
  // 🔴 Se mide EL HUECO QUE TIENE ESTA PANTALLA, no la ventana.
  //
  // Medido el 1 sep 2026: con una ventana de 1024 px, al TPV le quedan 683 px libres
  // si el panel lleva su barra lateral, y 992 si el TPV esta ampliado. La misma
  // ventana, dos sitios distintos. Cortando por la ventana, la pantalla salia de dos
  // formas segun donde estuviera pintada, y al reducir un poco saltaba a otra cosa
  // sin motivo aparente. El contenedor no miente.
  // 🔴 Callback ref, no `useRef` + efecto []: `ref` está puesto en DOS divs
  // distintos (la rama kanban y la rama listado) y el efecto de una sola pasada
  // se quedaba observando el nodo DESMONTADO al cambiar de vista — `ancho` se
  // congelaba y el corte responsive dejaba de responder. El callback re-observa
  // cada nodo que React le entrega.
  const [ancho, setAncho] = useState(0)
  const roRef = useRef(null)
  const caja = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)))
    ro.observe(el)
    roRef.current = ro
  }, [])

  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState('lista')
  const [filtro, setFiltro] = useState('todos')
  // Cual esta abierto en el detalle, y que registro se lista.
  const [sel, setSel] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [registro, setRegistro] = useState('curso')
  // Los repartidores del restaurante, para la tira del filtro Reparto.
  const [repartidores, setRepartidores] = useState([])
  const [repAbierta, setRepAbierta] = useState(false)

  // Si una carga falla, se avisa UNA vez y se conserva lo último cargado: antes
  // el error se descartaba y la pantalla pintaba "Nada en marcha" — idéntico a
  // una noche tranquila, con los pedidos vivos escondidos detrás de un fallo de
  // red.
  const avisoErrorRef = useRef(false)

  const cargar = useCallback(async () => {
    // Desde las 5 de la mañana: un bar que cierra a las 2 sigue teniendo "hoy" a
    // las 3, y partir el día a medianoche le cortaría el registro por la mitad.
    const desde = new Date()
    if (desde.getHours() < 5) desde.setDate(desde.getDate() - 1)
    desde.setHours(5, 0, 0, 0)

    const campos = 'id, codigo, estado, modo_entrega, origen_pedido, total, created_at, guest_nombre, metodo_pago'
    // 🔴 En DOS consultas: lo EN CURSO entero y lo cerrado del día con tope.
    // Antes iba todo junto con `limit(120)` aplicado DESPUÉS de ordenar por
    // fecha: en un viernes de 130 pedidos, un 'preparando' de mediodía caía
    // fuera de las 120 filas más nuevas y desaparecía de "En curso".
    const [vivos, cerrados] = await Promise.all([
      supabase.from('pedidos').select(campos)
        .eq('establecimiento_id', establecimientoId)
        .in('estado', EN_CURSO)
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('pedidos').select(campos)
        .eq('establecimiento_id', establecimientoId)
        .not('estado', 'in', `(${EN_CURSO.join(',')})`)
        .gte('created_at', desde.toISOString())
        .order('created_at', { ascending: false }).limit(150),
    ])
    if (vivos.error || cerrados.error) {
      if (!avisoErrorRef.current) {
        toast('No se pudo actualizar la lista de pedidos: se enseña lo último cargado', 'error')
        avisoErrorRef.current = true
      }
      setCargando(false)
      return
    }
    avisoErrorRef.current = false
    const vistos = new Set()
    const junta = []
    for (const p of [...(vivos.data || []), ...(cerrados.data || [])]) {
      if (!vistos.has(p.id)) { vistos.add(p.id); junta.push(p) }
    }
    junta.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setPedidos(junta)
    setCargando(false)
  }, [establecimientoId])

  // El detalle abierto también se refresca cuando su pedido cambia: antes solo
  // se pedía al elegirlo, y un reparto abierto seguía diciendo "Buscando
  // repartidor…" con el socio ya asignado hasta tocar otro pedido y volver.
  const selRef = useRef(null)
  const [refrescoDetalle, setRefrescoDetalle] = useState(0)

  useEffect(() => {
    cargar()
    const canal = supabase.channel('tpv-pedidos-' + establecimientoId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos', filter: `establecimiento_id=eq.${establecimientoId}` },
        (payload) => {
          cargar()
          const id = payload?.new?.id || payload?.old?.id
          if (id && id === selRef.current) setRefrescoDetalle((n) => n + 1)
        })
      .subscribe()
    // Red de seguridad: si el realtime se cae (pasa con la tablet suspendida), el
    // listado se quedaría congelado sin que nadie se entere.
    const t = setInterval(cargar, 30000)
    return () => { supabase.removeChannel(canal); clearInterval(t) }
  }, [establecimientoId, cargar])

  // El detalle se pide APARTE y solo del elegido: el listado trae hasta 120 pedidos y
  // cargarles las lineas a todos seria pedir cientos de filas para enseñar una.
  useEffect(() => { selRef.current = sel }, [sel])

  useEffect(() => {
    if (!sel) return
    let vivo = true
    ;(async () => {
      const [ped, its] = await Promise.all([
        supabase.from('pedidos')
          // 🔴 `socios` a secas NO vale: `pedidos` tiene DOS claves foraneas a esa tabla
          // (`socio_id` y `socio_responsable_id`) y PostgREST responde que la relacion es
          // ambigua, tumbando el detalle entero. Hay que nombrar la clave.
          .select('*, usuarios(nombre, apellido, telefono), socios!pedidos_socio_id_fkey(nombre_comercial, telefono)')
          .eq('id', sel).maybeSingle(),
        supabase.from('pedido_items').select('*').eq('pedido_id', sel),
      ])
      if (!vivo) return
      // Un fallo de red NO es "ese pedido ya no está": si hay error se conserva
      // lo que hubiera en pantalla (el refresco de los 30 s reintenta solo).
      if (ped.error || its.error) return
      // Siempre se guarda algo con el id pedido, aunque el pedido ya no exista: si no,
      // `cargandoDetalle` se quedaria en true para siempre girando en el panel.
      setDetalle(ped.data
        ? { ...ped.data, items: its.data || [] }
        : { id: sel, noExiste: true })
    })()
    return () => { vivo = false }
  }, [sel, refrescoDetalle])

  // Lo que se pinta en el detalle, DEDUCIDO: si lo cargado no es lo elegido, es que
  // todavia esta de camino. Un estado aparte para eso obligaba a escribirlo dentro del
  // efecto, y eso son renders en cascada.
  const detalleVisible = detalle && detalle.id === sel ? detalle : null
  const cargandoDetalle = !!sel && !detalleVisible

  // Los repartidores se piden SOLO al entrar en el filtro Reparto: a un restaurante
  // que nunca reparte no hay por que hacerle esta consulta en cada arranque del TPV.
  useEffect(() => {
    if (filtro !== 'reparto' || repartoPropio) return
    let vivo = true
    const traer = async () => {
      const { data, error } = await supabase.from('socio_establecimiento')
        .select('id, estado, socios(id, nombre_comercial, logo_url, rating, en_servicio, activo)')
        .eq('establecimiento_id', establecimientoId)
        .in('estado', ['activa', 'pendiente'])
      // Con error no se pisa la lista: "fallo de red" no es "no tienes repartidores".
      if (vivo && !error) setRepartidores(data || [])
    }
    ;(async () => { await traer() })()
    // Dos suscripciones: una para vincular/desvincular y otra para el interruptor de
    // en linea, que vive en `socios` y cambia mucho mas a menudo. La de `socios` no
    // se puede filtrar por restaurante (esa tabla no lo tiene), asi que se AGRUPA:
    // cada ping de GPS de cada socio disparaba una consulta entera.
    let deb = null
    const canal = supabase.channel('tpv-repartidores-' + establecimientoId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'socio_establecimiento', filter: `establecimiento_id=eq.${establecimientoId}` },
        () => { traer() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'socios' },
        () => { clearTimeout(deb); deb = setTimeout(traer, 2000) })
      .subscribe()
    return () => { vivo = false; clearTimeout(deb); supabase.removeChannel(canal) }
  }, [filtro, repartoPropio, establecimientoId])

  // Cuantos hay EN MARCHA de cada tipo. Va en el propio filtro para que se vea sin
  // tener que entrar en cada uno: lo que interesa de un vistazo es si hay algo
  // esperando en reparto, no cuantos se cerraron hoy.
  const activos = pedidos.filter((p) => EN_CURSO.includes(p.estado))
  const cuenta = {
    todos: activos.length,
    reparto: activos.filter((p) => tipoDe(p) === 'reparto').length,
    recogida: activos.filter((p) => tipoDe(p) === 'recogida').length,
    mostrador: activos.filter((p) => tipoDe(p) === 'mostrador').length,
  }
  const sinAceptar = (tipo) => activos.filter(
    (p) => p.estado === 'nuevo' && (tipo === 'todos' || tipoDe(p) === tipo)).length

  const delFiltro = pedidos.filter((p) => filtro === 'todos' || tipoDe(p) === filtro)
  const enMarcha = delFiltro.filter((p) => EN_CURSO.includes(p.estado))
  const cerrados = delFiltro.filter((p) => CERRADOS.includes(p.estado))

  // 🔴 Aviso DIRECTO al padre, no un evento global.
  //
  // Antes esto disparaba `pidoo:goto 'pedidos'` por `window`, y ese evento lo escuchan
  // DOS sitios: el TPV (que abre su capa encima, dejando el mostrador detras) y
  // `App.jsx` (que cambia de seccion). En la app de Windows se ejecutaban los dos: la
  // capa se abria y acto seguido App.jsx cambiaba `seccion` a 'pedidos', dejaba de
  // cumplirse `seccion === 'tpv'` y el <Tpv/> se DESMONTABA entero. Resultado: tocabas
  // un pedido y acababas en una pagina en blanco, con el carrito perdido.
  //
  // Un evento global no tiene destinatario: lo coge quien pilla. Con un prop, el que
  // abre la capa es exactamente quien la tiene.
  const irAPedidos = () => {
    if (onAbrirPedidos) { onAbrirPedidos(); return }
    // Sin padre que escuche (montado desde otro sitio), el evento sigue valiendo.
    window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'pedidos' }))
  }

  // En Reparto y en Recogida se ofrece crear uno nuevo; en Todos no, porque no
  // sabríamos de qué tipo.
  const nuevo = filtro === 'reparto' ? 'Nuevo reparto'
    : filtro === 'recogida' ? 'Nueva recogida' : null

  // ── Como se reparte el sitio ────────────────────────────────────────────────
  //
  // La FORMA es la misma en todas partes: filtros, listado y el boton de crear abajo
  // del todo. Lo unico que cambia es donde cabe el detalle del pedido:
  //   - con sitio  → a la derecha, siempre a la vista;
  //   - sin sitio  → ocupa el lugar del listado, con un boton para volver.
  // Asi no hay ningun tamaño en el que la pantalla "se convierta en otra cosa".
  //
  // El primer pintado aun no tiene medida (el observador la trae justo despues), asi
  // que se arranca con una estimacion por la ventana en vez de con un cero que haria
  // parpadear la pantalla.
  const anchoUtil = ancho || (esMovil ? 360 : 900)
  const alLado = !esMovil && anchoUtil >= ANCHO_TRES_PARTES
  // Búsqueda por código o nombre: con el cliente al teléfono preguntando por
  // "el PD-4837" había que barrer la lista a ojo.
  const [busca, setBusca] = useState('')
  const q = busca.trim().toLowerCase()
  const coincide = (p) => !q
    || (p.codigo || '').toLowerCase().includes(q)
    || (p.guest_nombre || '').toLowerCase().includes(q)
  const lista = (registro === 'curso' ? enMarcha : cerrados).filter(coincide)

  const tiraRepartidores = filtro === 'reparto' ? (
    <TiraRepartidores filas={repartidores} repartoPropio={repartoPropio}
      abierta={repAbierta} onAlternar={() => setRepAbierta((v) => !v)}
      onGestionar={onAbrirRepartidores} />
  ) : null

  const cabeceraListado = (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {/* Dos pastillas y no un desplegable: un <select> aqui son dos toques y una
          lista que tapa el listado, y ademas su flecha vive en un data: URI donde las
          variables de color no entran. */}
      <Pastilla activa={registro === 'curso'} onClick={() => setRegistro('curso')}
        texto="En curso" cuantos={enMarcha.length} />
      <Pastilla activa={registro === 'cerrados'} onClick={() => setRegistro('cerrados')}
        texto="Cerrados" cuantos={cerrados.length} />
      {/* El kanban solo se ofrece donde cabe: cuatro columnas en 400 px son cuatro
          tiras donde no entra ni el codigo del pedido. */}
      {alLado && (
        <button onClick={() => setVista('columnas')}
          style={{ ...btnSecundario, marginLeft: 'auto', height: 36, borderRadius: RADIO, padding: '0 10px' }}
          title="Ver en columnas" aria-label="Ver en columnas">
          <LayoutGrid size={15} />
        </button>
      )}
      <button onClick={cargar}
        style={{ ...btnSecundario, height: 36, borderRadius: RADIO, padding: '0 10px', ...(alLado ? null : { marginLeft: 'auto' }) }}
        title="Actualizar" aria-label="Actualizar">
        <RefreshCw size={14} />
      </button>
      <input value={busca} onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar código o nombre…"
        style={{
          flexBasis: '100%', height: 36, borderRadius: RADIO, padding: '0 12px',
          border: `1px solid ${busca ? T.accent : T.border}`, background: T.surface2,
          color: T.text, fontSize: 13, fontFamily: 'inherit', outline: 'none',
        }} />
    </div>
  )

  const cuerpoListado = cargando ? (
    <div style={{ padding: 24, textAlign: 'center', color: T.muted }}>Cargando pedidos…</div>
  ) : !lista.length ? (
    <div style={{ padding: '28px 10px', textAlign: 'center', color: T.muted }}>
      <ShoppingBag size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
        {registro === 'curso' ? 'Nada en marcha' : 'Nada cerrado hoy'}
      </div>
      {registro === 'curso' && (
        <div style={{ fontSize: 12, marginTop: 3 }}>Los que entren por Pidoo aparecen solos.</div>
      )}
    </div>
  ) : registro === 'curso' ? (
    // Agrupado por estado, con el titulo de cada grupo haciendo de separador. Los
    // grupos VACIOS no se pintan: cuatro cabeceras con un guion debajo se comen el
    // sitio de los pedidos, que es lo que se mira.
    COLUMNAS.map((col) => {
      const suyos = lista.filter((p) => col.estados.includes(p.estado))
      if (!suyos.length) return null
      return (
        <div key={col.id} style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 6,
          }}>
            {col.titulo} · {suyos.length}
          </div>
          {/* Con el detalle al lado, una tarjeta por fila. Sin el, el listado ocupa
              todo el ancho y las tarjetas fluyen: si no, un pedido por renglon en una
              tablet apaisada deja el 80 % del renglon vacio. */}
          <div style={{
            display: 'grid', gap: 6,
            gridTemplateColumns: alLado ? '1fr' : 'repeat(auto-fill, minmax(210px, 1fr))',
          }}>
            {suyos.map((p) => (
              <Tarjeta key={p.id} p={p} activa={p.id === sel} onClick={() => setSel(p.id)} />
            ))}
          </div>
        </div>
      )
    })
  ) : (
    <div style={{
      display: 'grid', gap: 6,
      gridTemplateColumns: alLado ? '1fr' : 'repeat(auto-fill, minmax(210px, 1fr))',
    }}>
      {lista.map((p) => (
        <Tarjeta key={p.id} p={p} activa={p.id === sel} apagado onClick={() => setSel(p.id)} />
      ))}
    </div>
  )

  // ABAJO DEL TODO y del ancho de SU columna. Antes era una barra que cruzaba la
  // pantalla entera de lado a lado, y encima del listado.
  const botonNuevo = nuevo && (
    <button onClick={() => onNuevo?.(filtro)} style={{
      ...btnAccion, width: '100%', height: 48, fontSize: 15,
      borderRadius: RADIO, marginTop: 10, flexShrink: 0,
    }}>
      <Plus size={17} style={{ marginRight: 8 }} /> {nuevo}
    </button>
  )

  // ── El kanban de cuatro columnas, la vista alternativa ──────────────────────
  if (alLado && vista === 'columnas') {
    return (
      <div ref={caja}>
        <div style={{
          display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {FILTROS.map((f) => (
            <Filtro key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}
              texto={f.texto} Icono={f.Icono}
              cuantos={cuenta[f.id]} urgentes={sinAceptar(f.id)} />
          ))}
          <button onClick={() => setVista('lista')}
            style={{ ...btnSecundario, marginLeft: 'auto', height: 40, borderRadius: RADIO, padding: '0 12px' }}
            title="Ver en listado" aria-label="Ver en listado">
            <List size={16} />
          </button>
          <button onClick={cargar}
            style={{ ...btnSecundario, height: 40, borderRadius: RADIO, padding: '0 12px' }}
            title="Actualizar" aria-label="Actualizar">
            <RefreshCw size={15} />
          </button>
        </div>

        {tiraRepartidores}
        {botonNuevo && <div style={{ marginBottom: 12 }}>{botonNuevo}</div>}

        <div style={{
          display: 'grid', gap: 10, alignItems: 'start',
          gridTemplateColumns: `repeat(4, minmax(0, 1fr))`,
        }}>
          {COLUMNAS.map((col) => {
            const suyos = enMarcha.filter((p) => col.estados.includes(p.estado))
            return (
              <div key={col.id} style={{ background: T.surface, borderRadius: RADIO, padding: 10 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
                  letterSpacing: '0.07em', marginBottom: 8,
                }}>
                  {col.titulo}{suyos.length > 0 && ` · ${suyos.length}`}
                </div>
                <div style={{ display: 'grid', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
                  {suyos.map((p) => <Tarjeta key={p.id} p={p} onClick={irAPedidos} />)}
                  {!suyos.length && <div style={{ fontSize: 12, color: T.muted, opacity: 0.5 }}>—</div>}
                </div>
              </div>
            )
          })}
        </div>

        {cerrados.length > 0 && (
          <>
            <div style={{
              fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
              letterSpacing: '0.07em', margin: '18px 0 8px',
            }}>
              Cerrados hoy · {cerrados.length}
            </div>
            <Listado pedidos={cerrados} onClick={irAPedidos} apagado esMonitor />
          </>
        )}
      </div>
    )
  }

  // ── La pantalla de siempre: filtros + listado + detalle ─────────────────────
  return (
    <div ref={caja} style={esMovil ? { paddingBottom: 78 + huecoAbajo } : undefined}>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'stretch',
        // El alto fijo es lo que deja el boton de crear SIEMPRE abajo del todo y hace
        // que cada zona se desplace por dentro. Solo cuando el detalle va al lado: si
        // no, la pantalla es una sola columna y quien scrollea es la pagina.
        ...(alLado ? { height: ALTO_PANEL, minHeight: 460 } : null),
      }}>

        {/* Carril de filtros. En TELEFONO no: alli van en la barra de abajo, que
            cuatro pastillas mas dos iconos se parten en dos filas y se comen media
            pantalla, justo la que hace falta para ver los pedidos. */}
        {!esMovil && (
          <div style={{
            width: ANCHO_CARRIL, flexShrink: 0,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {FILTROS.map((f) => (
              <FiltroCarril key={f.id} activo={filtro === f.id}
                onClick={() => { setFiltro(f.id); setSel(null) }}
                texto={f.texto} Icono={f.Icono}
                cuantos={cuenta[f.id]} urgentes={sinAceptar(f.id)} />
            ))}
          </div>
        )}

        {/* Sin sitio para el detalle al lado, el detalle OCUPA el listado y se vuelve
            con un boton. Es el mismo trato que dan el correo o los mensajes en una
            pantalla estrecha: nunca se ven las dos cosas a medias. */}
        {!alLado && sel ? (
          <div style={{
            flex: 1, minWidth: 0,
            background: T.surface, borderRadius: RADIO, padding: 12,
          }}>
            <button onClick={() => setSel(null)} style={{
              ...btnSecundario, height: 40, borderRadius: RADIO, marginBottom: 12,
            }}>
              <ArrowLeft size={15} style={{ marginRight: 6 }} /> Volver a la lista
            </button>
            <DetallePedido p={detalleVisible} cargando={cargandoDetalle}
              repartoPropio={repartoPropio} onGestionar={irAPedidos} />
          </div>
        ) : (
          <>
            <div style={{
              minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
              background: T.surface, borderRadius: RADIO, padding: 10,
              // Con el detalle al lado, el listado es una columna estrecha de ancho
              // fijo. Sin el, se queda con todo el hueco.
              ...(alLado
                ? { width: ANCHO_LISTADO, flexShrink: 0 }
                : { flex: 1 }),
            }}>
              {tiraRepartidores}
              {cabeceraListado}
              <div style={alLado
                ? { flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }
                : undefined}>
                {cuerpoListado}
              </div>
              {botonNuevo}
            </div>

            {alLado && (
              <div style={{
                flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto',
                background: T.surface, borderRadius: RADIO, padding: 16,
              }}>
                <DetallePedido p={detalleVisible} cargando={cargandoDetalle}
                  repartoPropio={repartoPropio} onGestionar={irAPedidos} />
              </div>
            )}
          </>
        )}
      </div>

      {/* La barra de abajo. zIndex 800 a proposito: por DEBAJO de la capa de pantallas
          del TPV (900), que si no se veria a traves de ella.

          🔴 `huecoAbajo` es el alto de la nav inferior del panel, que tambien va
          `fixed` en `bottom: 0`. Sin esto esta barra la tapaba ENTERA (medido a 375 px
          el 1 sep 2026: barra de 749 a 812, nav de 748 a 812) y el dueño se quedaba
          sin poder salir del TPV. En la app (`modoApp`) no hay nav: llega 0 y la barra
          se queda abajo del todo, como siempre. */}
      {esMovil && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: huecoAbajo, zIndex: 800,
          display: 'flex', background: T.surface,
          borderTop: `1px solid ${T.border}`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
          {FILTROS.map((f) => (
            <PestanaAbajo key={f.id} activo={filtro === f.id}
              onClick={() => { setFiltro(f.id); setSel(null) }}
              texto={f.texto} Icono={f.Icono}
              cuantos={cuenta[f.id]} urgentes={sinAceptar(f.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function PestanaAbajo({ activo, onClick, texto, Icono, cuantos = 0, urgentes = 0 }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, height: 62, border: 'none', background: 'none',
      cursor: 'pointer', fontFamily: 'inherit', padding: '6px 2px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
      color: activo ? T.onAccent : T.muted,
    }}>
      <span style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 46, height: 26, borderRadius: 999,
        background: activo ? T.accentFill : 'transparent',
      }}>
        {Icono ? <Icono size={17} /> : <LayoutGrid size={17} />}
        {cuantos > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: 2,
            minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            // Naranja solo si hay alguno SIN ACEPTAR: no es lo mismo tener tres en el
            // horno que tres esperando a que alguien les diga que si.
            background: urgentes > 0 ? T.accent : T.border,
            color: urgentes > 0 ? T.bg : T.text,
          }}>{cuantos}</span>
        )}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
      }}>{texto}</span>
    </button>
  )
}

function Listado({ pedidos, onClick, apagado, esMonitor = false }) {
  return (
    // En monitor va en DOS columnas: una fila de 1400 px de ancho para un codigo, una
    // hora y un importe deja el 80 % del renglon vacio y obliga a barrer con la vista
    // de un extremo al otro para leer un solo pedido.
    <div style={{
      background: T.surface, borderRadius: RADIO, overflow: 'hidden', ...anchoDe(esMonitor),
      ...(esMonitor ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : null),
    }}>
      {pedidos.map((p, i) => {
        const Icono = ICONO_TIPO[tipoDe(p)]
        return (
          <button key={p.id} onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
            padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', opacity: apagado ? 0.62 : 1,
            borderBottom: i === pedidos.length - 1 ? 'none' : `1px solid ${T.border}`,
          }}>
            <Icono size={16} color={T.accent} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text }}>{p.codigo}</span>
              <span style={{ display: 'block', fontSize: 12, color: T.muted }}>
                {ETIQUETA_ESTADO[p.estado] || p.estado} · {hora(p.created_at)}
                {pendienteDeCobro(p) && (
                  <span style={{ color: T.accent, fontWeight: 700 }}> · COBRAR</span>
                )}
              </span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{eur(cents(p.total))}</span>
          </button>
        )
      })}
    </div>
  )
}

function Tarjeta({ p, onClick, activa = false, apagado = false }) {
  const nuevo = p.estado === 'nuevo'
  const Icono = ICONO_TIPO[tipoDe(p)]
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', width: '100%', padding: 9, cursor: 'pointer', fontFamily: 'inherit',
      borderRadius: 10, color: T.text, opacity: apagado && !activa ? 0.62 : 1,
      // La elegida se RELLENA, no solo cambia de borde: con quince tarjetas iguales,
      // un borde de 1 px no dice cual es la que estas viendo en el detalle.
      background: activa ? T.accentFill : T.surface2,
      border: `1px solid ${activa || nuevo ? T.accent : T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icono size={14} color={T.accent} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{p.codigo}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700 }}>{eur(cents(p.total))}</span>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
        {hora(p.created_at)}
        {/* Un pedido que hay que cobrar y uno ya pagado se pintaban IGUAL. */}
        {pendienteDeCobro(p) && (
          <span style={{ color: T.accent, fontWeight: 700 }}> · COBRAR</span>
        )}
      </div>
    </button>
  )
}

const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

// ── Piezas de la pantalla de escritorio ─────────────────────────────────────

// Un filtro del carril de la izquierda: icono arriba, etiqueta debajo y el numero en
// una chapa en la esquina. Vertical y estrecho, para que el sitio se lo lleven el
// listado y el detalle.
function FiltroCarril({ activo, onClick, texto, Icono, cuantos = 0, urgentes = 0 }) {
  return (
    <button onClick={onClick} title={texto} style={{
      position: 'relative', height: 66, borderRadius: RADIO, cursor: 'pointer',
      fontFamily: 'inherit', padding: '0 4px',
      border: `1px solid ${activo ? T.accent : T.border}`,
      background: activo ? T.accentFill : T.surface2,
      color: activo ? T.onAccent : T.text,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
    }}>
      {Icono ? <Icono size={19} /> : <LayoutGrid size={19} />}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{texto}</span>
      {cuantos > 0 && (
        <span style={{
          position: 'absolute', top: 5, right: 5,
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          // Naranja solo si hay alguno SIN ACEPTAR: no es lo mismo tener tres en el
          // horno que tres esperando a que alguien les diga que si.
          background: urgentes > 0 ? T.accent : activo ? 'rgba(0,0,0,0.24)' : T.border,
          color: urgentes > 0 ? T.bg : activo ? T.onAccent : T.muted,
        }}>{cuantos}</span>
      )}
    </button>
  )
}

// La pastilla de "En curso" / "Cerrados" de la cabecera del listado.
function Pastilla({ activa, onClick, texto, cuantos = 0 }) {
  return (
    <button onClick={onClick} style={{
      height: 36, padding: '0 11px', borderRadius: RADIO, cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 13, fontWeight: activa ? 700 : 500,
      border: `1px solid ${activa ? T.accent : T.border}`,
      background: activa ? T.accentFill : T.surface2,
      color: activa ? T.onAccent : T.text,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {texto}
      <span style={{
        fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums', opacity: 0.75,
      }}>{cuantos}</span>
    </button>
  )
}

// La tira de repartidores del filtro Reparto.
//
// 🔴 El vinculo real es `socio_establecimiento`, NO `restaurante_riders`. Medido el
// 1 sep 2026: `restaurante_riders` esta VACIA en 8 de los 11 restaurantes activos,
// mientras que en `socio_establecimiento` hay 6 socios en Mamma Mia, 8 en Dar Kebab,
// 7 en Octava Isla... Mirar la tabla equivocada ya costo una sesion el 14 de agosto,
// cuando la asignacion manual del super-admin no encontraba a nadie.
//
// 🔴 Y la verdad de "esta en linea" es `socios.en_servicio` con `socios.activo`, la
// misma regla que usa la pantalla de Socios y repartidores. `rider_status` quedo
// legacy: si se lee de dos sitios distintos, tarde o temprano dicen cosas distintas.
//
// ⚠️ Aviso para el futuro: la RLS de `socios` deja al restaurante ver solo a los que
// tienen `activo`, `marketplace_activo` y `slug`. Hoy se cumple en los 8 restaurantes
// con socios (comprobado: visibles == vinculados), pero si un socio apaga su tienda
// publica desaparece de esta lista aunque siga repartiendo. Por eso las filas sin
// `socios` embebido no se pintan en blanco: se cuentan aparte.
function TiraRepartidores({ filas, repartoPropio, abierta, onAlternar, onGestionar }) {
  const conDatos = filas.filter((f) => f.socios)
  const activos = conDatos.filter((f) => f.estado === 'activa')
  const pendientes = conDatos.filter((f) => f.estado === 'pendiente')
  const enLinea = activos.filter((f) => f.socios.en_servicio === true && f.socios.activo !== false)
  const ocultos = filas.length - conDatos.length

  const marco = {
    background: T.surface2, border: `1px solid ${T.border}`,
    borderRadius: RADIO, marginBottom: 10, overflow: 'hidden',
  }

  // Quien reparte por su cuenta no tiene socios de Pidoo, y una lista vacia ahi
  // parece una averia. Max's Pizza y Drink2Home estan en este caso.
  if (repartoPropio) {
    return (
      <div style={{ ...marco, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <Bike size={17} color={T.accent} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>Reparto propio</span>
        <span style={{ fontSize: 12, color: T.muted }}>Repartes tú, sin socios de Pidoo</span>
      </div>
    )
  }

  return (
    <div style={marco}>
      <button onClick={onAlternar} style={{
        width: '100%', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
        background: 'none', border: 'none', color: T.text,
        display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
      }}>
        <Bike size={17} color={T.accent} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>
            {activos.length} {activos.length === 1 ? 'repartidor' : 'repartidores'}
            {pendientes.length > 0 && ` · ${pendientes.length} por aprobar`}
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
            color: enLinea.length ? T.ok : T.muted, marginTop: 2,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: enLinea.length ? T.ok : T.muted,
            }} />
            {enLinea.length ? `${enLinea.length} en línea ahora` : 'Ninguno en línea ahora'}
          </span>
        </span>
        {abierta ? <ChevronUp size={16} color={T.muted} /> : <ChevronDown size={16} color={T.muted} />}
      </button>

      {abierta && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          {!conDatos.length ? (
            <div style={{ padding: '14px 12px', fontSize: 13, color: T.muted }}>
              Todavía no tienes ningún repartidor vinculado.
            </div>
          ) : [...activos, ...pendientes].map((f) => {
            const s = f.socios
            const desactivado = s.activo === false
            const online = s.en_servicio === true && !desactivado
            const pendiente = f.estado === 'pendiente'
            return (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px',
                borderTop: `1px solid ${T.border}`,
              }}>
                <span style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                  background: T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: T.accent,
                }}>
                  {s.logo_url
                    ? <img src={s.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (s.nombre_comercial || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 13, fontWeight: 600, color: T.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.nombre_comercial || 'Sin nombre'}</span>
                  <span style={{ display: 'block', fontSize: 11, color: T.muted }}>
                    {pendiente ? 'Pendiente de aprobar'
                      : desactivado ? 'Cuenta desactivada'
                        : online ? 'En línea' : 'Desconectado'}
                    {s.rating > 0 && ` · ${Number(s.rating).toFixed(1)} ★`}
                  </span>
                </span>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: pendiente ? T.accent : online ? T.ok : T.border,
                }} />
              </div>
            )
          })}

          {ocultos > 0 && (
            <div style={{
              padding: '9px 12px', borderTop: `1px solid ${T.border}`,
              fontSize: 12, color: T.muted,
            }}>
              Hay {ocultos} más que ahora mismo no se pueden mostrar.
            </div>
          )}

          {onGestionar && (
            <button onClick={onGestionar} style={{
              width: '100%', padding: '11px 12px', cursor: 'pointer', fontFamily: 'inherit',
              background: 'none', border: 'none', borderTop: `1px solid ${T.border}`,
              color: T.accent, fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              Ver todos y gestionar <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// El pedido elegido, a la derecha. SOLO LECTURA a proposito: aceptar, rechazar,
// cancelar e imprimir siguen viviendo en `PedidosEnVivo.jsx`, que lleva el control de
// quien acepta primero cuando hay dos tablets, los reintentos del reparto y la
// impresion. Duplicar eso aqui seria duplicar justo la parte que mueve dinero.
function DetallePedido({ p, cargando, repartoPropio = false, onGestionar }) {
  if (cargando) {
    return <div style={{ padding: 30, textAlign: 'center', color: T.muted }}>Cargando el pedido…</div>
  }
  if (p?.noExiste) {
    return <div style={{ padding: 30, textAlign: 'center', color: T.muted }}>Ese pedido ya no está.</div>
  }
  if (!p) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 9,
        color: T.muted, textAlign: 'center', padding: 20,
      }}>
        <Inbox size={30} style={{ opacity: 0.6 }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Ningún pedido abierto</div>
        <div style={{ fontSize: 13, maxWidth: 300 }}>
          Toca uno de la lista y aquí ves quién lo pide, qué lleva y cuánto es.
        </div>
        {/* Tambien aqui, y no solo con un pedido abierto: aceptar uno nuevo se hace en
            Pedidos, y sin este boton habria que elegir algo antes para poder llegar. */}
        <button onClick={onGestionar} style={{
          ...btnSecundario, height: 42, borderRadius: RADIO, marginTop: 6,
        }}>
          Gestionar en Pedidos <ArrowRight size={15} style={{ marginLeft: 6 }} />
        </button>
      </div>
    )
  }

  const Icono = ICONO_TIPO[tipoDe(p)]
  const cliente = p.usuarios
    ? [p.usuarios.nombre, p.usuarios.apellido].filter(Boolean).join(' ')
    : p.guest_nombre
  const tel = p.usuarios?.telefono || p.guest_telefono
  const lineas = p.items || []
  const cobrar = pendienteDeCobro(p)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icono size={18} color={T.accent} />
            <span style={{ fontSize: 19, fontWeight: 800, color: T.text }}>{p.codigo}</span>
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
            {ETIQUETA_ESTADO[p.estado] || p.estado} · {hora(p.created_at)}
            {p.minutos_preparacion ? ' · ' + p.minutos_preparacion + ' min' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 26, fontWeight: 800, color: T.text, fontVariantNumeric: 'tabular-nums',
          }}>{eur(cents(p.total))}</div>
          <div style={{ fontSize: 12, color: cobrar ? T.accent : T.muted, fontWeight: cobrar ? 800 : 500 }}>
            {cobrar ? 'COBRAR · ' : ''}{p.metodo_pago || '—'}
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        alignItems: 'start',
      }}>
        {/* Quien lo pide */}
        <div style={{ background: T.surface2, borderRadius: RADIO, padding: 12 }}>
          <Titulo>Quién lo pide</Titulo>
          <Dato Icono={User} texto={cliente || 'Sin nombre'} />
          {tel && <Dato Icono={Phone} texto={tel} />}
          {p.modo_entrega === 'delivery' && p.direccion_entrega && (
            <Dato Icono={MapPin} texto={p.direccion_entrega} />
          )}
          {p.notas && (
            <div style={{
              marginTop: 8, padding: 9, borderRadius: 10, background: T.surface,
              fontSize: 13, color: T.text, fontStyle: 'italic',
            }}>“{p.notas}”</div>
          )}
        </div>

        {/* Quien lo lleva. Solo en reparto: en una recogida o en una venta de
            mostrador no hay repartidor al que buscar. */}
        {p.modo_entrega === 'delivery' && (
          <div style={{ background: T.surface2, borderRadius: RADIO, padding: 12 }}>
            <Titulo>Quién lo lleva</Titulo>
            {p.socios ? (
              <>
                <Dato Icono={Bike} texto={p.socios.nombre_comercial || 'Repartidor'} />
                {p.socios.telefono && <Dato Icono={Phone} texto={p.socios.telefono} />}
              </>
            ) : repartoPropio ? (
              <Dato Icono={Bike} texto="Lo repartes tú" />
            ) : EN_CURSO.includes(p.estado) ? (
              <Dato Icono={Bike} texto="Buscando repartidor…" />
            ) : (
              <Dato Icono={Bike} texto="Nadie lo recogió" />
            )}
            {/* Cambiar de repartidor se hace en Pedidos, que es donde vive el boton
                de Reasignar con su motivo: cancela el reparto actual y busca al
                siguiente mejor. Aqui no se reparte a dedo a proposito. */}
          </div>
        )}

        {/* Las cuentas */}
        <div style={{ background: T.surface2, borderRadius: RADIO, padding: 12 }}>
          <Titulo>Las cuentas</Titulo>
          <Importe texto="Subtotal" valor={p.subtotal} />
          {p.coste_envio > 0 && <Importe texto="Envío" valor={p.coste_envio} />}
          {p.descuento > 0 && <Importe texto="Descuento" valor={-p.descuento} />}
          {p.propina > 0 && <Importe texto="Propina" valor={p.propina} />}
          <div style={{ borderTop: `2px solid ${T.accent}`, marginTop: 8, paddingTop: 8 }}>
            <Importe texto="Total" valor={p.total} fuerte />
          </div>
        </div>
      </div>

      {/* Que lleva */}
      <div style={{ background: T.surface2, borderRadius: RADIO, padding: 12, marginTop: 12 }}>
        <Titulo>Qué lleva{lineas.length ? ' · ' + lineas.length : ''}</Titulo>
        {!lineas.length ? (
          <div style={{ fontSize: 13, color: T.muted }}>Sin líneas.</div>
        ) : lineas.map((l) => (
          <div key={l.id} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0',
            borderTop: `1px solid ${T.border}`,
          }}>
            <span style={{
              minWidth: 26, height: 24, borderRadius: 7, flexShrink: 0,
              background: T.surface, color: T.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800,
            }}>{l.cantidad}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, color: T.text }}>
                {l.nombre_producto}{l.tamano ? ' · ' + l.tamano : ''}
              </span>
              {/* La columna es `extras text[]`, NO `extras_texto`: mientras se leyo la
                  que no era, los extras no se vieron nunca en pantalla. */}
              {l.extras?.length > 0 && (
                <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {l.extras.join(', ')}
                </span>
              )}
              {l.notas && (
                <span style={{ display: 'block', fontSize: 12, color: T.muted, fontStyle: 'italic', marginTop: 2 }}>
                  {l.notas}
                </span>
              )}
            </span>
            <span style={{
              fontSize: 14, fontWeight: 700, color: T.text, flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>{eur(cents(l.precio_unitario) * l.cantidad)}</span>
          </div>
        ))}
      </div>

      <button onClick={onGestionar} style={{
        ...btnSecundario, width: '100%', height: 46, borderRadius: RADIO, marginTop: 12,
      }}>
        Gestionar en Pedidos <ArrowRight size={15} style={{ marginLeft: 6 }} />
      </button>
    </div>
  )
}

function Titulo({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
      letterSpacing: '0.07em', marginBottom: 8,
    }}>{children}</div>
  )
}

function Dato({ Icono, texto }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
      {Icono && <Icono size={14} color={T.muted} style={{ flexShrink: 0, marginTop: 2 }} />}
      <span style={{ fontSize: 14, color: T.text, minWidth: 0, wordBreak: 'break-word' }}>{texto}</span>
    </div>
  )
}

function Importe({ texto, valor, fuerte = false }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0',
    }}>
      <span style={{
        fontSize: fuerte ? 14 : 13, color: fuerte ? T.text : T.muted, fontWeight: fuerte ? 700 : 500,
      }}>{texto}</span>
      <span style={{
        fontSize: fuerte ? 17 : 14, fontWeight: fuerte ? 800 : 600, color: T.text,
        fontVariantNumeric: 'tabular-nums',
      }}>{eur(cents(valor))}</span>
    </div>
  )
}

function Filtro({ activo, onClick, texto, Icono, cuantos = 0, urgentes = 0 }) {
  return (
    <button onClick={onClick} style={{
      height: 40, padding: '0 14px', borderRadius: RADIO, cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 14, fontWeight: activo ? 700 : 500,
      border: `1px solid ${activo ? T.accent : T.border}`,
      background: activo ? T.accentFill : T.surface2,
      color: activo ? T.onAccent : T.text,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {Icono && <Icono size={15} />}{texto}
      {cuantos > 0 && (
        // El que tiene pedidos SIN ACEPTAR se pinta en naranja: no es lo mismo tener
        // tres en el horno que tres esperando a que alguien les diga que si. Sobre el
        // naranja el numero va OSCURO, que es la regla de contraste del tema.
        <span style={{
          minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          background: urgentes > 0 ? T.accent : activo ? 'rgba(0,0,0,0.22)' : T.border,
          color: urgentes > 0 ? T.bg : activo ? T.onAccent : T.muted,
        }}>{cuantos}</span>
      )}
    </button>
  )
}
