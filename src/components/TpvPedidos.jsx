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
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { T, cents, eur, btnAccion, btnSecundario } from '../lib/tpvTheme'
import { Bike, ShoppingBag, Store, LayoutGrid, List, RefreshCw, ArrowRight, Plus } from 'lucide-react'

// UNA sola forma para todo lo que se pulsa aquí. Antes convivían píldoras muy
// redondeadas con botones de esquina suave y parecían dos aplicaciones distintas.
const RADIO = 12

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
  recogido: 'Recogido', en_camino: 'En camino', entregado: 'Cobrado',
  cancelado: 'Cancelado', fallido: 'Fallido', rechazado: 'Rechazado',
}

// De qué puerta viene cada pedido. El mostrador es `origen_pedido='tpv'`; el resto
// se distingue por si va a domicilio o lo recoge el cliente.
const tipoDe = (p) => (p.origen_pedido === 'tpv' ? 'mostrador'
  : p.modo_entrega === 'delivery' ? 'reparto' : 'recogida')

const ICONO_TIPO = { mostrador: Store, reparto: Bike, recogida: ShoppingBag }

export default function TpvPedidos({ establecimientoId, onNuevo }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState('columnas')
  const [filtro, setFiltro] = useState('todos')

  const cargar = useCallback(async () => {
    // Desde las 5 de la mañana: un bar que cierra a las 2 sigue teniendo "hoy" a
    // las 3, y partir el día a medianoche le cortaría el registro por la mitad.
    const desde = new Date()
    if (desde.getHours() < 5) desde.setDate(desde.getDate() - 1)
    desde.setHours(5, 0, 0, 0)

    const { data } = await supabase.from('pedidos')
      .select('id, codigo, estado, modo_entrega, origen_pedido, total, created_at, guest_nombre')
      .eq('establecimiento_id', establecimientoId)
      .or(`estado.in.(${EN_CURSO.join(',')}),created_at.gte.${desde.toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(120)
    setPedidos(data || [])
    setCargando(false)
  }, [establecimientoId])

  useEffect(() => {
    cargar()
    const canal = supabase.channel('tpv-pedidos-' + establecimientoId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos', filter: `establecimiento_id=eq.${establecimientoId}` },
        cargar)
      .subscribe()
    // Red de seguridad: si el realtime se cae (pasa con la tablet suspendida), el
    // listado se quedaría congelado sin que nadie se entere.
    const t = setInterval(cargar, 30000)
    return () => { supabase.removeChannel(canal); clearInterval(t) }
  }, [establecimientoId, cargar])

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

  const irAPedidos = () => window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'pedidos' }))

  // En Reparto y en Recogida se ofrece crear uno nuevo; en Todos no, porque no
  // sabríamos de qué tipo.
  const nuevo = filtro === 'reparto' ? 'Nuevo reparto'
    : filtro === 'recogida' ? 'Nueva recogida' : null

  return (
    <div>
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {[
          { id: 'todos', texto: 'Todos' },
          { id: 'reparto', texto: 'Reparto', Icono: Bike },
          { id: 'recogida', texto: 'Recogida', Icono: ShoppingBag },
          { id: 'mostrador', texto: 'Mostrador', Icono: Store },
        ].map((f) => (
          <Filtro key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}
            texto={f.texto} Icono={f.Icono}
            cuantos={cuenta[f.id]} urgentes={sinAceptar(f.id)} />
        ))}
        <button onClick={() => setVista(vista === 'columnas' ? 'lista' : 'columnas')}
          style={{ ...btnSecundario, height: 40, borderRadius: RADIO, padding: '0 12px' }}
          aria-label={vista === 'columnas' ? 'Ver en listado' : 'Ver en columnas'}>
          {vista === 'columnas' ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>
        <button onClick={cargar} style={{ ...btnSecundario, height: 40, borderRadius: RADIO, padding: '0 12px' }}
          aria-label="Actualizar">
          <RefreshCw size={15} />
        </button>
      </div>

      {nuevo && (
        <button onClick={() => onNuevo?.(filtro)} style={{
          ...btnAccion, width: '100%', height: 50, fontSize: 15, borderRadius: RADIO, marginBottom: 12,
        }}>
          <Plus size={18} style={{ marginRight: 8 }} /> {nuevo}
        </button>
      )}

      {cargando ? (
        <div style={{ padding: 36, textAlign: 'center', color: T.muted }}>Cargando pedidos…</div>
      ) : (
        <>
          {enMarcha.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: T.muted }}>
              <ShoppingBag size={26} style={{ marginBottom: 8, opacity: 0.6 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Nada en marcha</div>
              <div style={{ fontSize: 13, marginTop: 3 }}>Los que entren por Pidoo aparecen aquí solos.</div>
            </div>
          ) : vista === 'columnas' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
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
                    <div style={{ display: 'grid', gap: 6 }}>
                      {suyos.map((p) => <Tarjeta key={p.id} p={p} onClick={irAPedidos} />)}
                      {!suyos.length && <div style={{ fontSize: 12, color: T.muted, opacity: 0.5 }}>—</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Listado pedidos={enMarcha} onClick={irAPedidos} />
          )}

          {/* El registro del día: aquí caen solas las ventas del mostrador en cuanto
              se cobran, y los pedidos que ya se cerraron. */}
          {cerrados.length > 0 && (
            <>
              <div style={{
                fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase',
                letterSpacing: '0.07em', margin: '18px 0 8px',
              }}>
                Cerrados hoy · {cerrados.length}
              </div>
              <Listado pedidos={cerrados} onClick={irAPedidos} apagado />
            </>
          )}

          {enMarcha.length > 0 && (
            <button onClick={irAPedidos} style={{
              ...btnSecundario, width: '100%', height: 44, borderRadius: RADIO, marginTop: 12,
            }}>
              Gestionar en Pedidos <ArrowRight size={15} style={{ marginLeft: 6 }} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Listado({ pedidos, onClick, apagado }) {
  return (
    <div style={{ background: T.surface, borderRadius: RADIO, overflow: 'hidden' }}>
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
              </span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{eur(cents(p.total))}</span>
          </button>
        )
      })}
    </div>
  )
}

function Tarjeta({ p, onClick }) {
  const nuevo = p.estado === 'nuevo'
  const Icono = ICONO_TIPO[tipoDe(p)]
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', width: '100%', padding: 9, cursor: 'pointer', fontFamily: 'inherit',
      borderRadius: 10, background: T.surface2, color: T.text,
      border: `1px solid ${nuevo ? T.accent : T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icono size={14} color={T.accent} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{p.codigo}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700 }}>{eur(cents(p.total))}</span>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{hora(p.created_at)}</div>
    </button>
  )
}

const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

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
