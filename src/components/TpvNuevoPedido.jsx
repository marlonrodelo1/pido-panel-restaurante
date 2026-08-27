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
// Los precios y el envío NO se calculan aquí: los pone `tpv-pedido` en el
// servidor. Lo que se pinta en pantalla es orientativo.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import AddressInput from './AddressInput'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { Search, Plus, Minus, Phone, MapPin, User, Bike, ShoppingBag, Check } from 'lucide-react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const RADIO = 12

export default function TpvNuevoPedido({ restaurante, modo, onHecho, onCancelar }) {
  const esReparto = modo === 'reparto'

  const [productos, setProductos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [carrito, setCarrito] = useState([])

  const [telefono, setTelefono] = useState('')
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [coords, setCoords] = useState(null)
  const [clienteConocido, setClienteConocido] = useState(null)

  const [metodo, setMetodo] = useState('efectivo')
  const [minutos, setMinutos] = useState(20)
  const [notas, setNotas] = useState('')
  const [creando, setCreando] = useState(false)
  const enVuelo = useRef(false)

  useEffect(() => {
    if (!restaurante?.id) return
    let vivo = true
    supabase.from('productos')
      .select('id, nombre, precio, categoria_id, disponible')
      .eq('establecimiento_id', restaurante.id).order('orden')
      .then(({ data }) => { if (vivo) setProductos((data || []).filter((p) => p.disponible !== false)) })
    return () => { vivo = false }
  }, [restaurante?.id])

  // Buscar al cliente en cuanto el teléfono está completo. Es la pieza que ahorra
  // más tiempo: quien repite no tiene que dictar la dirección otra vez.
  const buscarCliente = useCallback(async (tel) => {
    const limpio = tel.replace(/\D/g, '')
    if (limpio.length < 9) { setClienteConocido(null); return }
    const { data } = await supabase.from('clientes_telefonicos')
      .select('nombre, direccion, lat, lng, pedidos_count')
      .eq('establecimiento_id', restaurante.id)
      .or(`telefono_normalizado.eq.+34${limpio.slice(-9)},telefono_normalizado.eq.${tel}`)
      .maybeSingle()
    if (!data) { setClienteConocido(null); return }
    setClienteConocido(data)
    if (data.nombre && !nombre) setNombre(data.nombre)
    if (esReparto && data.direccion && !direccion) {
      setDireccion(data.direccion)
      if (data.lat != null && data.lng != null) setCoords({ lat: data.lat, lng: data.lng })
    }
  }, [restaurante?.id, esReparto, nombre, direccion])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos.slice(0, 24)
    return productos.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 40)
  }, [productos, busqueda])

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

  const subtotal = carrito.reduce((s, l) => s + l.precio_c * l.cantidad, 0)

  const listo = carrito.length > 0 && (esReparto
    ? (telefono.replace(/\D/g, '').length >= 9 && coords)
    : (nombre.trim() || telefono.replace(/\D/g, '').length >= 9))

  async function crear() {
    if (!listo || enVuelo.current) return
    enVuelo.current = true
    setCreando(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/tpv-pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          establecimiento_id: restaurante.id,
          modo,
          metodo_pago: metodo,
          minutos_preparacion: minutos,
          notas: notas.trim() || null,
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
        })[body?.error] || body?.detalle || body?.error || 'No se pudo crear el pedido')
      }
      const conRepartidor = body.asignacion?.ok
      toast(esReparto
        ? `${body.pedido.codigo} creado · ${conRepartidor ? 'repartidor asignado' : 'sin repartidor todavía'}`
        : `${body.pedido.codigo} creado para recoger`,
        (esReparto && !conRepartidor) ? 'error' : 'success')
      onHecho?.(body)
    } catch (err) {
      toast(err.message || 'Error al crear el pedido', 'error')
    } finally {
      enVuelo.current = false
      setCreando(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ── Cliente ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label style={etiqueta}><Phone size={13} /> Teléfono {esReparto && '· obligatorio'}</label>
          <input value={telefono} inputMode="tel" autoFocus
            onChange={(e) => { const v = e.target.value.replace(/[^\d+ ]/g, ''); setTelefono(v); buscarCliente(v) }}
            placeholder="600 12 34 56" style={inputOscuro} />
          {clienteConocido && (
            <div style={{ ...aviso, color: T.ok }}>
              <Check size={14} /> Ya ha pedido {clienteConocido.pedidos_count} vez
              {clienteConocido.pedidos_count === 1 ? '' : 'es'}: datos rellenados
            </div>
          )}
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
      </div>

      {/* ── Productos ──────────────────────────────────────────────────── */}
      <div>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 16, color: T.muted }} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto para añadir" style={{ ...inputOscuro, paddingLeft: 36 }} />
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 6, maxHeight: 190, overflowY: 'auto',
        }}>
          {visibles.map((p) => (
            <button key={p.id} onClick={() => anadir(p)} style={{
              padding: '9px 10px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface2, color: T.text,
            }}>
              <span style={{ display: 'block', fontSize: 13, lineHeight: 1.25 }}>{p.nombre}</span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: T.accent, marginTop: 3 }}>
                {eur(cents(p.precio))}
              </span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>
          Precio de domicilio, no el de barra: este pedido sale del local.
        </div>
      </div>

      {/* ── Lo que lleva ───────────────────────────────────────────────── */}
      {carrito.length > 0 && (
        <div style={{ background: T.surface2, borderRadius: RADIO, padding: 10 }}>
          {carrito.map((l) => (
            <div key={l.producto_id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{l.nombre}</span>
              <button onClick={() => cambiar(l.producto_id, -1)} style={btnMini}><Minus size={13} /></button>
              <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{l.cantidad}</span>
              <button onClick={() => cambiar(l.producto_id, +1)} style={btnMini}><Plus size={13} /></button>
              <span style={{ minWidth: 58, textAlign: 'right', fontWeight: 700, fontSize: 14 }}>
                {eur(l.precio_c * l.cantidad)}
              </span>
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 8,
          }}>
            <span style={{ fontSize: 13, color: T.muted }}>
              {esReparto ? 'Comida (el envío se suma al crear)' : 'Total'}
            </span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{eur(subtotal)}</span>
          </div>
        </div>
      )}

      {/* ── Cómo paga y cuándo ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10 }}>
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
              }}>{m}'</button>
            ))}
          </div>
        </div>
        <div>
          <label style={etiqueta}>Notas</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="Sin cebolla, portal azul…" maxLength={200} style={inputOscuro} />
        </div>
      </div>

      <button onClick={crear} disabled={!listo || creando} style={{
        ...btnAccion, height: 56, fontSize: 16, borderRadius: RADIO,
        opacity: (!listo || creando) ? 0.4 : 1, cursor: (!listo || creando) ? 'not-allowed' : 'pointer',
      }}>
        {esReparto ? <Bike size={18} style={{ marginRight: 8 }} /> : <ShoppingBag size={18} style={{ marginRight: 8 }} />}
        {creando ? 'Creando…' : (esReparto ? 'Crear reparto y buscar repartidor' : 'Crear recogida')}
      </button>
      <button onClick={onCancelar} style={{ ...btnSecundario, height: 44, borderRadius: RADIO }}>Cancelar</button>
    </div>
  )
}

const etiqueta = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
  color: T.muted, marginBottom: 6,
}
const aviso = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginTop: 5 }
const btnMini = {
  width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
  border: `1px solid ${T.border}`, background: T.surface, color: T.text,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
