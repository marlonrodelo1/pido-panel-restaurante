// NUEVO REPARTO o NUEVA RECOGIDA desde el TPV, picando productos de la carta.
//
// Es el relevo de la pantalla de Pedido telefónico: aquella pide un importe a
// mano, esta pica productos, así que el ticket sale con el detalle y cocina sabe
// qué hacer. Aquella se queda como está hasta que esta se haya probado en el local.
//
// Lo que hace y en qué orden, que es como se hace de verdad al teléfono:
//   1. Se teclea el teléfono. Si el cliente ya ha pedido antes, se rellena solo
//      con su nombre y su dirección — que es el 80 % de las veces.
//   2. Se pican los productos.
//   3. Si es reparto, la dirección se elige en el mapa y el servidor calcula el
//      envío con la tarifa que tenga configurada el restaurante.
//
// EN MONITOR van TRES COLUMNAS: quién pide · qué pide · la comanda. Es el orden
// real de la conversación por teléfono, y así ninguna de las tres partes obliga a
// bajar para ver las otras. Antes todo iba apilado en 440 px de ancho: en una
// pantalla de escritorio había que scrollear tres veces para un pedido que se
// dicta en veinte segundos. En teléfono y tablet se sigue apilando, que es lo
// único que cabe.
//
// Los precios y el envío NO se calculan aquí: los pone `tpv-pedido` en el
// servidor. Lo que se pinta en pantalla es orientativo.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import AddressInput from './AddressInput'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { useEsMonitor } from '../lib/tamanoPantalla'
import { imprimirPedido, impresoraConfigurada } from '../lib/printService'
import { reservarImpresion, soltarImpresion } from '../lib/ticketsImpresos'
import {
  Search, Plus, Minus, Phone, MapPin, User, Bike, ShoppingBag, Check,
  UserPlus, Trash2, StickyNote,
} from 'lucide-react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const RADIO = 12

// Un fijo canario tiene 9 dígitos igual que un móvil. Menos de 9 no es un teléfono,
// así que no se va a la base de datos a preguntar por medio número.
const DIGITOS_TELEFONO = 9

export default function TpvNuevoPedido({ restaurante, modo, onHecho, onCancelar }) {
  const esReparto = modo === 'reparto'
  const esMonitor = useEsMonitor()

  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [catActiva, setCatActiva] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [carrito, setCarrito] = useState([])

  const [telefono, setTelefono] = useState('')
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [coords, setCoords] = useState(null)
  const [clienteConocido, setClienteConocido] = useState(null)
  const [buscandoCliente, setBuscandoCliente] = useState(false)

  const [metodo, setMetodo] = useState('efectivo')
  const [minutos, setMinutos] = useState(20)
  const [notas, setNotas] = useState('')
  const [creando, setCreando] = useState(false)
  const enVuelo = useRef(false)
  // Una clave de idempotencia POR PEDIDO, no por pulsación: el reintento tras un
  // corte de red lleva la misma y el servidor devuelve el pedido ya creado en vez
  // de crear dos (dos repartos = dos socios asignados y dos tarifas en el corte).
  // Se limpia solo tras un éxito. El mostrador hace lo mismo desde hoy.
  const idemRef = useRef(null)
  const uuidv4 = () => crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })

  // ── La carta ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!restaurante?.id) return
    let vivo = true
    Promise.all([
      supabase.from('productos')
        .select('id, nombre, precio, categoria_id, disponible')
        .eq('establecimiento_id', restaurante.id).order('orden'),
      supabase.from('categorias')
        .select('id, nombre, orden')
        .eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden'),
    ]).then(([prods, cats]) => {
      if (!vivo) return
      setProductos((prods.data || []).filter((p) => p.disponible !== false))
      setCategorias(cats.data || [])
    })
    return () => { vivo = false }
  }, [restaurante?.id])

  // ── Reconocimiento del cliente por teléfono ───────────────────────────────
  //
  // Es la pieza que más tiempo ahorra: quien repite no vuelve a dictar la
  // dirección. Tres cosas que hay que hacer bien y antes no se hacían:
  //
  //  1. ESPERAR a que deje de teclear. Antes se consultaba en CADA pulsación a
  //     partir del noveno dígito: teclear un móvil lanzaba una consulta, y
  //     corregirlo, otra por tecla.
  //  2. RECTIFICAR si el teléfono cambia. Antes solo rellenaba «si el campo está
  //     vacío», así que al corregir un dígito mal tecleado se quedaba en pantalla
  //     el nombre del cliente ANTERIOR y el pedido salía a nombre de otra persona.
  //     Ahora se recuerda lo que rellenamos nosotros: si el operador no lo ha
  //     tocado, se sustituye; si lo escribió a mano, no se le pisa jamás.
  //  3. DECIR que es cliente nuevo. Antes, no encontrarlo se veía igual que no
  //     haber terminado de teclear: en los dos casos, nada.
  const autoRelleno = useRef({ nombre: '', direccion: '' })
  const valores = useRef({ nombre: '', direccion: '' })
  useEffect(() => { valores.current = { nombre, direccion } }, [nombre, direccion])

  const digitos = telefono.replace(/\D/g, '')
  const telefonoCompleto = digitos.length >= DIGITOS_TELEFONO

  useEffect(() => {
    if (!restaurante?.id) return

    // Lo que rellenamos nosotros se retira; lo que escribió una persona se queda.
    const soltarAutoRelleno = () => {
      if (valores.current.nombre && valores.current.nombre === autoRelleno.current.nombre) setNombre('')
      if (valores.current.direccion && valores.current.direccion === autoRelleno.current.direccion) {
        setDireccion('')
        setCoords(null)
      }
      autoRelleno.current = { nombre: '', direccion: '' }
    }

    if (!telefonoCompleto) {
      setClienteConocido(null)
      setBuscandoCliente(false)
      soltarAutoRelleno()
      return
    }

    let vivo = true
    setBuscandoCliente(true)
    const t = setTimeout(async () => {
      const nueve = digitos.slice(-9)
      const { data, error } = await supabase.from('clientes_telefonicos')
        .select('nombre, direccion, lat, lng, pedidos_count, last_pedido_at, notas')
        .eq('establecimiento_id', restaurante.id)
        .or(`telefono_normalizado.eq.+34${nueve},telefono_normalizado.eq.${nueve}`)
        .maybeSingle()
      if (!vivo) return
      setBuscandoCliente(false)
      // 🔴 Un fallo de red NO es "cliente nuevo": antes se trataban igual y un
      // parpadeo de wifi al corregir un dígito BORRABA el nombre y la dirección
      // que el operador acababa de confirmar en voz alta. Con error, la pantalla
      // se queda exactamente como está.
      if (error) return
      setClienteConocido(data || null)

      if (!data) { soltarAutoRelleno(); return }

      const nomActual = valores.current.nombre
      if (!nomActual || nomActual === autoRelleno.current.nombre) {
        const v = data.nombre || ''
        setNombre(v)
        autoRelleno.current.nombre = v
      }

      // La dirección solo en reparto: en recogida no va nadie a su casa.
      if (esReparto) {
        const dirActual = valores.current.direccion
        if (!dirActual || dirActual === autoRelleno.current.direccion) {
          const v = data.direccion || ''
          setDireccion(v)
          autoRelleno.current.direccion = v
          setCoords(data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null)
        }
      }
    }, 350)

    return () => { vivo = false; clearTimeout(t) }
  }, [digitos, telefonoCompleto, restaurante?.id, esReparto])

  // ── La comanda ────────────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    // La búsqueda manda sobre la categoría: si escribes «coca» quieres la Coca-Cola
    // esté donde esté, no un «no hay resultados» porque estabas en Hamburguesas.
    if (q) return productos.filter((p) => p.nombre.toLowerCase().includes(q))
    if (catActiva) return productos.filter((p) => p.categoria_id === catActiva)
    return productos
  }, [productos, busqueda, catActiva])

  const anadir = (p) => setCarrito((prev) => {
    const i = prev.findIndex((l) => l.producto_id === p.id)
    if (i >= 0) {
      const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + 1 }; return c
    }
    return [...prev, { producto_id: p.id, nombre: p.nombre, precio_c: cents(p.precio), cantidad: 1 }]
  })

  const cambiar = (id, d) => setCarrito((prev) => prev
    .map((l) => (l.producto_id === id ? { ...l, cantidad: l.cantidad + d } : l))
    .filter((l) => l.cantidad > 0))

  const quitar = (id) => setCarrito((prev) => prev.filter((l) => l.producto_id !== id))

  const subtotal = carrito.reduce((s, l) => s + l.precio_c * l.cantidad, 0)
  const unidades = carrito.reduce((s, l) => s + l.cantidad, 0)

  // Qué falta para poder crear. Se calcula como LISTA y no como un booleano para
  // poder decirlo: un botón apagado sin explicación, con el cliente esperando al
  // teléfono, es media llamada buscando qué falta.
  // El MISMO criterio que la edge (`normalizarTelefonoES`): antes aquí bastaban
  // 9 dígitos cualesquiera, "123456789" habilitaba el botón y el pedido moría
  // en el servidor después de picarlo entero, con el cliente al teléfono.
  const telefonoValido = (() => {
    let t = telefono.replace(/[\s\-().]/g, '')
    if (t.startsWith('0034')) t = t.slice(4)
    else if (t.startsWith('+34')) t = t.slice(3)
    else if (t.startsWith('34') && t.length === 11) t = t.slice(2)
    return /^[6789]\d{8}$/.test(t)
  })()

  const falta = []
  if (carrito.length === 0) falta.push('añadir algo a la comanda')
  if (esReparto) {
    if (!telefonoValido) falta.push('un teléfono español válido')
    // La dirección escrita Y las coordenadas: se podía llegar aquí con las
    // coordenadas del cliente guardado y el campo de dirección en blanco.
    if (!direccion.trim()) falta.push('la dirección')
    if (!coords) falta.push('elegir la dirección del desplegable')
  } else if (!telefonoCompleto && !nombre.trim()) {
    falta.push('el teléfono o el nombre')
  }
  const listo = falta.length === 0

  async function crear() {
    if (!listo || enVuelo.current) return
    enVuelo.current = true
    setCreando(true)
    // Sin límite de tiempo, una red a medias dejaba el botón "creando…" sin
    // salida. La edge encadena envío + código + insert + dispatcher, así que se
    // le dan 45 s antes de cortar; reintentar es seguro por la clave de arriba.
    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), 45000)
    try {
      if (!idemRef.current) idemRef.current = uuidv4()
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-pedido`, {
        method: 'POST',
        signal: corte.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          establecimiento_id: restaurante.id,
          modo,
          metodo_pago: metodo,
          minutos_preparacion: minutos,
          notas: notas.trim() || null,
          idempotency_key: idemRef.current,
          cliente: {
            telefono: telefono || null, nombre: nombre.trim() || null,
            direccion: esReparto ? direccion : null,
            lat: esReparto ? coords?.lat : null, lng: esReparto ? coords?.lng : null,
          },
          lineas: carrito.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body?.ok) {
        throw new Error(({
          sin_riders_online: 'No tienes repartidores en línea. Ofrécele recogida al cliente.',
          fuera_de_radio: 'Esa dirección está fuera de tu zona de reparto.',
          socio_offline: 'Ese repartidor ya no está en línea.',
          calcular_envio_failed: 'No se pudo calcular el envío. Vuelve a intentarlo.',
          calcular_envio_timeout: 'No se pudo calcular el envío. Vuelve a intentarlo.',
          generar_codigo_failed: 'El servidor no respondió. Vuelve a intentarlo.',
          producto_no_encontrado: 'Un producto de la comanda ya no existe en la carta. Quítalo y vuelve a añadirlo.',
          forbidden: 'Esta cuenta no puede crear pedidos en este restaurante.',
        })[body?.error] || body?.detalle || body?.error || 'No se pudo crear el pedido')
      }
      const conRepartidor = body.asignacion?.ok
      const propio = body.asignacion?.reparto_propio
      toast(esReparto
        ? `${body.pedido.codigo} ${body.repetido ? 'ya estaba creado' : 'creado'} · ${propio ? 'reparto propio: lo llevas tú' : conRepartidor ? 'repartidor asignado' : 'sin repartidor todavía'}`
        : `${body.pedido.codigo} ${body.repetido ? 'ya estaba creado' : 'creado para recoger'}`,
        (esReparto && !conRepartidor) ? 'error' : 'success')
      idemRef.current = null   // pedido cerrado: el siguiente es otra venta

      // La comanda sale SOLA al crear. Este pedido nace en 'preparando', así que
      // no pasa por "aceptar" (el único sitio que imprimía) y el enganche
      // automático de realtime solo cubre mesa y la aceptación del motor: sin
      // esto, cocina no veía papel salvo que alguien fuera a Pedidos a imprimir.
      // Se RESERVA en el registro anti-duplicados por si algún otro camino
      // llegara a imprimirlo también, y se suelta si la impresora falla.
      if (impresoraConfigurada() && body.pedido?.id && reservarImpresion(body.pedido.id)) {
        const pedidoTicket = {
          ...body.pedido,
          origen_pedido: 'telefonico',
          modo_entrega: esReparto ? 'delivery' : 'recogida',
          guest_nombre: body.cliente?.nombre || nombre.trim() || null,
          guest_telefono: body.cliente?.telefono || null,
          cliente_telefono: body.cliente?.telefono || null,
          direccion_entrega: esReparto ? (body.cliente?.direccion || direccion || null) : null,
          lat_entrega: esReparto ? (coords?.lat ?? null) : null,
          lng_entrega: esReparto ? (coords?.lng ?? null) : null,
          notas: notas.trim() || null,
        }
        imprimirPedido(pedidoTicket, body.items || [], restaurante)
          .then((r) => {
            // Soltar SOLO si la comanda falló: con la comanda ya en cocina,
            // reimprimir el paquete entero duplicaría el pedido en la plancha.
            if (!r?.cocina) {
              soltarImpresion(body.pedido.id)
              toast('El pedido está creado, pero la comanda no ha salido: imprímela desde Pedidos', 'error')
            } else if (!r?.cliente) {
              toast('Comanda impresa; el ticket del cliente no salió. Reimprímelo desde Pedidos.', 'error')
            }
          })
          .catch(() => soltarImpresion(body.pedido.id))
      }

      onHecho?.(body)
    } catch (err) {
      // Un corte o un fallo de red dejan el pedido EN DUDA (puede haber entrado).
      // Reintentar tal cual es seguro: la misma clave hace que el servidor
      // devuelva el pedido ya creado en vez de crear otro.
      const enDuda = err?.name === 'AbortError' || /failed to fetch|networkerror|load failed/i.test(err?.message || '')
      toast(enDuda
        ? 'Sin respuesta del servidor. Vuelve a pulsar crear TAL CUAL: si ya había entrado, no se duplica.'
        : (err.message || 'Error al crear el pedido'), 'error')
    } finally {
      clearTimeout(reloj)
      enVuelo.current = false
      setCreando(false)
    }
  }

  // ── Las tres piezas ───────────────────────────────────────────────────────

  const bloqueCliente = (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div>
        <label style={etiqueta}><Phone size={13} /> Teléfono {esReparto && '· obligatorio'}</label>
        {/* Grande a propósito: es el primer campo, se teclea mientras se escucha
            y es el que dispara todo lo demás. */}
        <input value={telefono} inputMode="tel" autoFocus
          onChange={(e) => setTelefono(e.target.value.replace(/[^\d+ ]/g, ''))}
          placeholder="600 12 34 56"
          style={{ ...inputOscuro, height: 54, fontSize: 20, letterSpacing: 1, fontWeight: 600 }} />
        <EstadoCliente
          completo={telefonoCompleto} buscando={buscandoCliente}
          cliente={clienteConocido} esReparto={esReparto} />
      </div>

      <div>
        <label style={etiqueta}><User size={13} /> Nombre</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del cliente" maxLength={60} style={inputOscuro} />
      </div>

      {esReparto && (
        <div>
          <label style={etiqueta}><MapPin size={13} /> Dirección</label>
          <AddressInput
            value={direccion}
            onChange={(v) => { setDireccion(v); setCoords(null) }}
            onSelect={({ direccion: dir, lat, lng }) => {
              setDireccion(dir)
              if (lat != null && lng != null) setCoords({ lat, lng })
            }}
            placeholder="Calle, número, municipio…"
            style={inputOscuro}
          />
          <div style={{ ...aviso, color: coords ? T.ok : T.muted }}>
            {coords
              ? <><Check size={14} /> Situada en el mapa · el envío lo calcula Pidoo al crear</>
              : 'Elige una de las sugerencias de Google para situarla en el mapa'}
          </div>
        </div>
      )}

      <div>
        <label style={etiqueta}><StickyNote size={13} /> Notas</label>
        <input value={notas} onChange={(e) => setNotas(e.target.value)}
          placeholder="Sin cebolla, portal azul…" maxLength={200} style={inputOscuro} />
      </div>
    </div>
  )

  const bloqueCarta = (
    <div style={{
      // 🔴 `minWidth: 0` NO sobra. Este bloque es hijo de una rejilla, y un hijo de
      // rejilla vale `min-width: auto`: se niega a encoger por debajo de su
      // contenido. Con 38 productos dentro, la rejilla de la carta se estiraba a
      // 947 px dentro de un modal de 315 y la mitad se salia por la derecha.
      display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
      ...(esMonitor ? { height: '100%' } : null),
    }}>
      <div style={{ position: 'relative', marginBottom: 8, flexShrink: 0 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: 16, color: T.muted }} />
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto para añadir" style={{ ...inputOscuro, paddingLeft: 36 }} />
      </div>

      {categorias.length > 0 && !busqueda.trim() && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0,
          // En monitor caben todas a la vista; en tablet y teléfono se deslizan.
          ...(esMonitor ? { flexWrap: 'wrap' } : { overflowX: 'auto', paddingBottom: 4 }),
        }}>
          <ChipCat activa={!catActiva} onClick={() => setCatActiva(null)}>Todo</ChipCat>
          {categorias.map((c) => (
            <ChipCat key={c.id} activa={catActiva === c.id} onClick={() => setCatActiva(c.id)}>
              {c.nombre}
            </ChipCat>
          ))}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 6, overflowY: 'auto', alignContent: 'start', minWidth: 0,
        // En monitor `flex: 1` (se queda con lo que sobre) y NO un alto en píxeles:
        // el bloque de arriba mide distinto según haya categorías o búsqueda activa.
        ...(esMonitor ? { flex: 1, minHeight: 0 } : { maxHeight: 190 }),
      }}>
        {visibles.map((p) => (
          <button key={p.id} onClick={() => anadir(p)} title={p.nombre} style={{
            padding: '9px 10px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
            borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
          }}>
            <span style={{ display: 'block', fontSize: 13, lineHeight: 1.25 }}>{p.nombre}</span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: T.accent, marginTop: 3 }}>
              {eur(cents(p.precio))}
            </span>
          </button>
        ))}
        {visibles.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: 16, textAlign: 'center', color: T.muted, fontSize: 13 }}>
            Nada con ese nombre en la carta.
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: T.muted, marginTop: 6, flexShrink: 0 }}>
        Precio de domicilio, no el de barra: este pedido sale del local.
      </div>
    </div>
  )

  const bloqueComanda = (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, gap: 10,
      ...(esMonitor ? { height: '100%' } : null),
    }}>
      <div style={{
        background: T.surface2, borderRadius: RADIO, padding: 10,
        ...(esMonitor ? { flex: 1, minHeight: 0, overflowY: 'auto' } : null),
      }}>
        {carrito.length === 0 ? (
          <div style={{ padding: '18px 8px', textAlign: 'center', color: T.muted, fontSize: 13 }}>
            Pica productos de la carta y aparecerán aquí.
          </div>
        ) : carrito.map((l) => (
          <div key={l.producto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14 }} title={l.nombre}>{l.nombre}</span>
            <button onClick={() => cambiar(l.producto_id, -1)} style={btnMini}
              aria-label={`Quitar uno de ${l.nombre}`}><Minus size={13} /></button>
            <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{l.cantidad}</span>
            <button onClick={() => cambiar(l.producto_id, +1)} style={btnMini}
              aria-label={`Añadir uno de ${l.nombre}`}><Plus size={13} /></button>
            <span style={{ minWidth: 58, textAlign: 'right', fontWeight: 700, fontSize: 14 }}>
              {eur(l.precio_c * l.cantidad)}
            </span>
            {/* Con doce líneas, bajar una a cero a base de toques es absurdo. */}
            <button onClick={() => quitar(l.producto_id)} style={{ ...btnMini, borderColor: 'transparent' }}
              aria-label={`Quitar ${l.nombre} de la comanda`}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10, flexShrink: 0 }}>
        <div>
          <label style={etiqueta}>Cómo paga</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              ['efectivo', 'Efectivo al entregar'],
              ['datafono', 'Datáfono al entregar'],
              ['pagado_local', 'Ya pagado'],
            ].map(([id, txt]) => (
              <button key={id} onClick={() => setMetodo(id)} style={{
                ...btnSecundario, height: 42, fontSize: 13, borderRadius: RADIO,
                borderColor: metodo === id ? T.accent : T.border,
                color: metodo === id ? T.accent : T.text,
              }}>{txt}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={etiqueta}>Estará listo en</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[10, 15, 20, 30, 45].map((m) => (
              <button key={m} onClick={() => setMinutos(m)} style={{
                ...btnSecundario, height: 42, flex: 1, fontSize: 14, borderRadius: RADIO,
                borderColor: minutos === m ? T.accent : T.border,
                color: minutos === m ? T.accent : T.text,
              }}>{m} min</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        {/* El importe NUNCA se parte. En una columna de 340 px, con la etiqueta
            larga del reparto al lado, «30,90 €» se rompia en dos lineas y el
            simbolo del euro caia solo debajo del numero. La etiqueta es la que
            cede: se envuelve en dos lineas y el numero se queda entero. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 10, gap: 10,
        }}>
          <span style={{ fontSize: 13, color: T.muted, minWidth: 0, lineHeight: 1.35 }}>
            {esReparto ? 'Comida' : 'Total'}
            {unidades > 0 ? ` · ${unidades} ud.` : ''}
            {esReparto && <><br />el envío se suma al crear</>}
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {eur(subtotal)}
          </span>
        </div>

        {!listo && (
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
            Falta {falta.join(' y ')}.
          </div>
        )}

        <button onClick={crear} disabled={!listo || creando} style={{
          ...btnAccion, height: 56, fontSize: 16, borderRadius: RADIO, width: '100%',
          opacity: (!listo || creando) ? 0.4 : 1, cursor: (!listo || creando) ? 'not-allowed' : 'pointer',
        }}>
          {esReparto
            ? <Bike size={18} style={{ marginRight: 8 }} />
            : <ShoppingBag size={18} style={{ marginRight: 8 }} />}
          {creando ? 'Creando…' : (esReparto ? 'Crear reparto y buscar repartidor' : 'Crear recogida')}
        </button>
        <button onClick={onCancelar}
          style={{ ...btnSecundario, height: 44, borderRadius: RADIO, width: '100%', marginTop: 8 }}>
          Cancelar
        </button>
      </div>
    </div>
  )

  // ── Montaje ───────────────────────────────────────────────────────────────

  // Teléfono y tablet: apilado, exactamente el mismo orden de siempre.
  if (!esMonitor) {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        {bloqueCliente}
        {bloqueCarta}
        {bloqueComanda}
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 340px',
      gap: 16, height: '100%', minHeight: 0,
    }}>
      <Columna titulo="Quién pide">{bloqueCliente}</Columna>
      <Columna titulo="Qué pide">{bloqueCarta}</Columna>
      <Columna titulo="La comanda" sinBorde>{bloqueComanda}</Columna>
    </div>
  )
}

// ── Piezas sueltas ──────────────────────────────────────────────────────────

// Cada columna se desplaza por su cuenta. Si scrollearan juntas, buscar un
// producto al final de la carta escondería el total y el botón de crear.
function Columna({ titulo, sinBorde, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
      ...(sinBorde ? null : { borderRight: `1px solid ${T.border}`, paddingRight: 16 }),
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        color: T.muted, marginBottom: 10, flexShrink: 0,
      }}>{titulo}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
    </div>
  )
}

// Lo que se sabe de quien llama. Tres estados distintos y visibles, porque para
// quien coge el teléfono no es lo mismo «espera» que «no lo conozco».
function EstadoCliente({ completo, buscando, cliente, esReparto }) {
  if (!completo) return null
  if (buscando) return <div style={{ ...aviso, color: T.muted }}>Buscando…</div>

  if (!cliente) {
    return (
      <div style={{ ...aviso, color: T.muted }}>
        <UserPlus size={14} /> Cliente nuevo · pon el nombre{esReparto ? ' y la dirección' : ''}
      </div>
    )
  }

  const veces = cliente.pedidos_count
  return (
    <div style={{ marginTop: 5 }}>
      <div style={{ ...aviso, color: T.ok, marginTop: 0 }}>
        <Check size={14} /> Ya ha pedido {veces} vez{veces === 1 ? '' : 'es'}
        {cliente.last_pedido_at ? ` · última, ${fechaCorta(cliente.last_pedido_at)}` : ''}
      </div>
      {cliente.notas && (
        <div style={{ ...aviso, color: T.muted }} title={cliente.notas}>
          <StickyNote size={13} /> {cliente.notas}
        </div>
      )}
    </div>
  )
}

function ChipCat({ activa, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: '0 0 auto', maxWidth: 190, padding: '0 12px', height: 34, borderRadius: 9,
      cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      border: `1px solid ${activa ? T.accent : T.border}`,
      background: T.surface2,
      color: activa ? T.accent : T.text,
      fontWeight: activa ? 700 : 500,
    }}>{children}</button>
  )
}

// «12 ago» basta: quien atiende no necesita el año de la última vez que pidió.
function fechaCorta(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  } catch { return '' }
}

const etiqueta = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
  color: T.muted, marginBottom: 6,
}
const aviso = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginTop: 5 }
const btnMini = {
  width: 28, height: 28, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
  border: `1px solid ${T.border}`, background: T.surface, color: T.text,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
