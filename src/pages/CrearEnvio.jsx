import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast, confirmar } from '../App'
import { colors, type, ds, chip, chipDot } from '../lib/uiStyles'
import AddressInput from '../components/AddressInput'
import { PhoneCall, Bike, Send, RotateCcw, ClipboardList } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

const SUPABASE_URL = 'https://rmrbxrabngdmpgpfmjbo.supabase.co'
const isNative = Capacitor.isNativePlatform()

// Pedido telefónico: el restaurante registra un pedido que le entró por teléfono
// y Pidoo se encarga del reparto con sus socios vinculados. Sin productos: solo
// teléfono + dirección + importe acordado + notas. La edge crear-pedido-telefonico
// hace todo el trabajo (valida, calcula envío, memoriza al cliente y asigna rider).

// Misma regla de normalización que la edge (E.164 España).
function normalizarTelefonoES(raw) {
  let t = String(raw || '').replace(/[\s\-().]/g, '')
  if (t.startsWith('0034')) t = '+34' + t.slice(4)
  else if (t.startsWith('34') && t.length === 11) t = '+' + t
  else if (/^[6789]\d{8}$/.test(t)) t = '+34' + t
  return /^\+34[6789]\d{8}$/.test(t) ? t : null
}

async function fetchConTimeout(url, options, ms = 20000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('La operación tardó demasiado. Inténtalo de nuevo.')
    throw err
  } finally {
    clearTimeout(t)
  }
}

const MINUTOS = [10, 15, 20, 30, 45]

export default function CrearEnvio() {
  const { restaurante } = useRest()

  // ── Formulario ──
  const [telefono, setTelefono] = useState('')
  const [nombre, setNombre] = useState('')
  const [direccion, setDireccion] = useState('')
  const [coords, setCoords] = useState(null)           // { lat, lng }
  const [importe, setImporte] = useState('')
  const [metodoCobro, setMetodoCobro] = useState('efectivo')
  const [notas, setNotas] = useState('')
  const [minutos, setMinutos] = useState(20)
  const [asigModo, setAsigModo] = useState('auto')      // 'auto' | 'socio'
  const [socioSel, setSocioSel] = useState(null)
  const [socios, setSocios] = useState(null)            // null = sin cargar

  // ── Estado derivado / red ──
  const [clienteConocido, setClienteConocido] = useState(null)
  const [envio, setEnvio] = useState(null)              // { envio, distancia_km } | { error }
  const [envioLoading, setEnvioLoading] = useState(false)
  const [onlineCount, setOnlineCount] = useState(null)  // null = cargando
  const [creando, setCreando] = useState(false)
  const [resultado, setResultado] = useState(null)      // respuesta 200 de la edge

  // ── Repartidores online (contador en vivo, visible mientras atiende la llamada) ──
  const refreshOnline = useCallback(async () => {
    if (!restaurante?.id) return
    try {
      const { data } = await supabase.functions.invoke('check-socio-availability-now', {
        body: { establecimiento_id: restaurante.id },
      })
      if (typeof data?.online_count === 'number') setOnlineCount(data.online_count)
    } catch { /* mantiene el último valor */ }
  }, [restaurante?.id])

  useEffect(() => { refreshOnline() }, [refreshOnline])

  useEffect(() => {
    if (!restaurante?.id) return
    let t = null
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(refreshOnline, 800) }
    const channel = supabase.channel(`crear-envio-${restaurante.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'socios' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'socio_establecimiento', filter: `establecimiento_id=eq.${restaurante.id}` }, debounced)
      .subscribe()
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel) }
  }, [restaurante?.id, refreshOnline])

  // ── Memoria de clientes: lookup por teléfono ──
  const lookupSeq = useRef(0)
  async function buscarCliente(raw) {
    const tel = normalizarTelefonoES(raw)
    if (!tel || !restaurante?.id) { setClienteConocido(null); return }
    const seq = ++lookupSeq.current
    const { data } = await supabase
      .from('clientes_telefonicos')
      .select('nombre, direccion, lat, lng, pedidos_count')
      .eq('establecimiento_id', restaurante.id)
      .eq('telefono_normalizado', tel)
      .maybeSingle()
    if (seq !== lookupSeq.current) return // respuesta obsoleta
    if (data) {
      setClienteConocido(data)
      if (data.nombre && !nombre) setNombre(data.nombre)
      if (data.direccion && !direccion) {
        setDireccion(data.direccion)
        if (data.lat != null && data.lng != null) {
          setCoords({ lat: data.lat, lng: data.lng })
          calcularEnvio(data.lat, data.lng)
        }
      }
    } else {
      setClienteConocido(null)
    }
  }

  // ── Coste de envío en vivo (fetch crudo: necesitamos leer el body de los 400) ──
  async function calcularEnvio(lat, lng) {
    if (!restaurante?.id) return
    setEnvioLoading(true)
    setEnvio(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetchConTimeout(`${SUPABASE_URL}/functions/v1/calcular_envio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ canal: 'pido', establecimiento_id: restaurante.id, lat_cliente: lat, lng_cliente: lng }),
      }, 12000)
      const d = await resp.json().catch(() => ({}))
      if (d?.fuera_de_radio) {
        setEnvio({ error: `Fuera del área de reparto (${d.distancia_km ?? '?'} km)` })
      } else if (d?.delivery_disabled) {
        setEnvio({ error: 'El reparto está desactivado ahora mismo (sin repartidores vinculados online)' })
      } else if (resp.ok && typeof d?.envio === 'number') {
        setEnvio({ envio: d.envio, distancia_km: d.distancia_km })
      } else {
        setEnvio({ error: 'No se pudo calcular el envío' })
      }
    } catch {
      setEnvio({ error: 'No se pudo calcular el envío' })
    } finally {
      setEnvioLoading(false)
    }
  }

  // ── Selector de socio (lazy) ──
  async function cargarSocios() {
    try {
      const { data } = await supabase.functions.invoke('list-socios-restaurante', {
        body: { establecimiento_id: restaurante.id },
      })
      setSocios(data?.socios || [])
    } catch {
      setSocios([])
    }
  }
  useEffect(() => {
    if (asigModo === 'socio' && socios === null && restaurante?.id) cargarSocios()
  }, [asigModo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validación ──
  const telValido = !!normalizarTelefonoES(telefono)
  const importeNum = Number(String(importe).replace(',', '.'))
  const importeValido = Number.isFinite(importeNum) && importeNum >= 0.5 && importeNum <= 500
  const formValido = telValido && direccion.trim() && coords && importeValido
    && envio?.envio != null && (asigModo === 'auto' || socioSel)
  const sinRiders = onlineCount === 0

  // ── Crear el envío ──
  async function crearEnvio() {
    if (!formValido || creando) return
    if (importeNum > 100) {
      const seguro = await confirmar(`El importe es de ${importeNum.toFixed(2).replace('.', ',')} €. ¿Es correcto?`)
      if (!seguro) return
    }
    setCreando(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetchConTimeout(`${SUPABASE_URL}/functions/v1/crear-pedido-telefonico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          establecimiento_id: restaurante.id,
          telefono,
          nombre: nombre.trim() || null,
          direccion: direccion.trim(),
          lat: coords.lat,
          lng: coords.lng,
          importe_comida: importeNum,
          metodo_cobro: metodoCobro,
          notas: notas.trim() || null,
          minutos_preparacion: minutos,
          asignacion: asigModo === 'socio' ? { modo: 'socio', socio_id: socioSel } : { modo: 'auto' },
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (resp.status === 409 && body?.error === 'sin_riders_online') {
        setOnlineCount(0)
        throw new Error('No tienes repartidores en línea ahora mismo. Ofrece recogida al cliente.')
      }
      if (resp.status === 409 && body?.error === 'socio_offline') {
        throw new Error('Ese repartidor ya no está en línea. Elige otro o usa asignación automática.')
      }
      if (body?.error === 'fuera_de_radio') throw new Error('La dirección está fuera de tu área de reparto.')
      if (!resp.ok || !body?.ok) throw new Error(body?.detalle || body?.error || 'No se pudo crear el envío')
      setResultado(body)
      toast(`Envío ${body.pedido?.codigo} creado`, 'success')
    } catch (err) {
      toast(err.message || 'Error al crear el envío', 'error')
    } finally {
      setCreando(false)
    }
  }

  function resetForm() {
    setTelefono(''); setNombre(''); setDireccion(''); setCoords(null)
    setImporte(''); setMetodoCobro('efectivo'); setNotas(''); setMinutos(20)
    setAsigModo('auto'); setSocioSel(null)
    setClienteConocido(null); setEnvio(null); setResultado(null)
    refreshOnline()
  }

  function abrirWhatsApp() {
    const tel = normalizarTelefonoES(telefono)
    if (!tel || !resultado?.tracking_url) return
    const msg = `¡Tu pedido ${resultado.pedido?.codigo} de ${restaurante?.nombre || 'nuestro restaurante'} está en marcha! Síguelo en tiempo real aquí: ${resultado.tracking_url}`
    window.open(`https://wa.me/${tel.replace('+', '')}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const totalPedido = envio?.envio != null && importeValido ? importeNum + envio.envio : null
  const fmtEur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`

  // ═══════════════ Vista de éxito ═══════════════
  if (resultado) {
    const asig = resultado.asignacion
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ ...ds.card, textAlign: 'center', padding: '28px 22px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.sage2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Envío creado
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: colors.ink, margin: '10px 0 4px', letterSpacing: '-0.01em' }}>
            {resultado.pedido?.codigo}
          </div>
          <div style={{ fontSize: type.sm, color: colors.stone, marginBottom: 14 }}>
            {fmtEur(resultado.pedido?.subtotal || 0)} comida + {fmtEur(resultado.pedido?.coste_envio || 0)} envío
            {' = '}<b style={{ color: colors.ink }}>{fmtEur(resultado.pedido?.total || 0)}</b>
            {metodoCobro === 'efectivo' ? ' · cobra el repartidor' : ' · ya pagado'}
          </div>

          {asig?.ok ? (
            <span style={chip('sage', { dot: true })}>
              <span style={chipDot} />Repartidor asignado{asig.distancia_metros != null ? ` · ${(asig.distancia_metros / 1000).toFixed(1)} km` : ''}
            </span>
          ) : (
            <span style={chip('warning')}>
              Buscando repartidor… {asig?.reason === 'socio_sin_rider_online' ? '(ese socio no tiene rider online)' : ''}
            </span>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
            <button onClick={abrirWhatsApp} style={{ ...ds.primaryBtn, height: 44, background: '#25D366', borderColor: '#25D366' }}>
              <Send size={15} strokeWidth={2.2} />
              Enviar seguimiento por WhatsApp
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: isNative ? 'pedidos' : 'historial' }))}
              style={{ ...ds.secondaryBtn, height: 42 }}
            >
              <ClipboardList size={15} strokeWidth={2} />
              Ver mis pedidos
            </button>
            <button onClick={resetForm} style={{ ...ds.ghostBtn, height: 42 }}>
              <RotateCcw size={15} strokeWidth={2} />
              Crear otro envío
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════ Formulario ═══════════════
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Cabecera: título + contador de repartidores en vivo */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhoneCall size={19} strokeWidth={2.2} color={colors.terracotta} />
          <h1 style={{ ...ds.h1, fontSize: 19 }}>Pedido telefónico</h1>
        </div>
        {onlineCount === null ? (
          <span style={chip('paper')}>Comprobando repartidores…</span>
        ) : onlineCount > 0 ? (
          <span style={chip('sage', { dot: true })}>
            <span style={chipDot} />{onlineCount} repartidor{onlineCount > 1 ? 'es' : ''} en línea
          </span>
        ) : (
          <span style={chip('danger', { dot: true })}>
            <span style={chipDot} />Sin repartidores — solo recogida
          </span>
        )}
      </div>

      <div style={{ ...ds.card, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Teléfono */}
        <div>
          <label style={ds.label}>Teléfono del cliente</label>
          <input
            style={{ ...ds.formInput, ...(telefono && !telValido ? { borderColor: colors.danger } : {}) }}
            type="tel"
            inputMode="tel"
            placeholder="612 34 56 78"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            onBlur={e => buscarCliente(e.target.value)}
          />
          {telefono && !telValido && (
            <div style={{ fontSize: type.xxs, color: colors.danger, marginTop: 4 }}>
              Móvil o fijo español de 9 dígitos (empieza por 6, 7, 8 o 9)
            </div>
          )}
          {clienteConocido && (
            <div style={{ marginTop: 6 }}>
              <span style={chip('terracotta')}>
                Cliente habitual · {clienteConocido.pedidos_count} pedido{clienteConocido.pedidos_count > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Nombre */}
        <div>
          <label style={ds.label}>Nombre (opcional)</label>
          <input
            style={ds.formInput}
            placeholder="Juanita"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
        </div>

        {/* Dirección */}
        <div>
          <label style={ds.label}>Dirección de entrega</label>
          <AddressInput
            value={direccion}
            onChange={(v) => { setDireccion(v); setCoords(null); setEnvio(null) }}
            onSelect={({ direccion: dir, lat, lng }) => {
              setDireccion(dir)
              if (lat != null && lng != null) { setCoords({ lat, lng }); calcularEnvio(lat, lng) }
            }}
            placeholder="Calle, número, municipio…"
            style={ds.formInput}
          />
          {envioLoading && <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 4 }}>Calculando envío…</div>}
          {envio?.envio != null && (
            <div style={{ fontSize: type.xs, color: colors.sage2, fontWeight: 700, marginTop: 4 }}>
              Envío: {fmtEur(envio.envio)}{envio.distancia_km != null ? ` · ${envio.distancia_km} km` : ''}
            </div>
          )}
          {envio?.error && (
            <div style={{ fontSize: type.xs, color: colors.danger, fontWeight: 600, marginTop: 4 }}>{envio.error}</div>
          )}
          {direccion && !coords && !envioLoading && !envio && (
            <div style={{ fontSize: type.xxs, color: colors.warning, marginTop: 4 }}>
              Elige la dirección en el desplegable para fijar el punto exacto
            </div>
          )}
        </div>

        {/* Importe + cobro */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={ds.label}>Importe de la comida</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...ds.formInput, paddingRight: 28 }}
                type="text"
                inputMode="decimal"
                placeholder="21,50"
                value={importe}
                onChange={e => setImporte(e.target.value)}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: colors.stone, fontSize: type.sm }}>€</span>
            </div>
          </div>
          <div style={{ flex: '2 1 220px' }}>
            <label style={ds.label}>Cobro</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'efectivo', label: 'Efectivo a la entrega' },
                { id: 'pagado_local', label: 'Ya pagado' },
              ].map(op => (
                <button
                  key={op.id}
                  onClick={() => setMetodoCobro(op.id)}
                  style={{
                    ...ds.filterBtn, flex: 1, height: 38, justifyContent: 'center',
                    ...(metodoCobro === op.id
                      ? { background: colors.ink, color: colors.cream, borderColor: colors.ink, fontWeight: 700 }
                      : {}),
                  }}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 4 }}>
              {metodoCobro === 'efectivo'
                ? 'El repartidor cobra el total (comida + envío) al entregar.'
                : 'El cliente ya te pagó (bizum, en el local…). El repartidor solo entrega.'}
            </div>
          </div>
        </div>

        {/* Notas */}
        <div>
          <label style={ds.label}>Pedido / notas</label>
          <textarea
            style={{ ...ds.formInput, height: 66, padding: '9px 12px', resize: 'vertical' }}
            placeholder="2 pizzas familiares + coca-cola · 2ºB, timbre roto"
            value={notas}
            onChange={e => setNotas(e.target.value)}
          />
        </div>

        {/* Tiempo de preparación */}
        <div>
          <label style={ds.label}>Listo en</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MINUTOS.map(m => (
              <button
                key={m}
                onClick={() => setMinutos(m)}
                style={{
                  ...ds.filterBtn, height: 34, padding: '0 14px',
                  ...(minutos === m
                    ? { background: colors.terracotta, color: '#fff', borderColor: colors.terracotta, fontWeight: 700 }
                    : {}),
                }}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>

        {/* Asignación */}
        <div>
          <label style={ds.label}>Repartidor</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: asigModo === 'socio' ? 8 : 0 }}>
            {[
              { id: 'auto', label: 'Automático (el más cercano)' },
              { id: 'socio', label: 'Elegir socio' },
            ].map(op => (
              <button
                key={op.id}
                onClick={() => setAsigModo(op.id)}
                style={{
                  ...ds.filterBtn, flex: 1, height: 34, justifyContent: 'center',
                  ...(asigModo === op.id
                    ? { background: colors.ink, color: colors.cream, borderColor: colors.ink, fontWeight: 700 }
                    : {}),
                }}
              >
                {op.label}
              </button>
            ))}
          </div>
          {asigModo === 'socio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {socios === null && <div style={{ fontSize: type.xs, color: colors.stone }}>Cargando socios…</div>}
              {socios?.length === 0 && <div style={{ fontSize: type.xs, color: colors.danger }}>No tienes socios vinculados</div>}
              {(socios || []).map(s => {
                const off = !s.en_servicio
                const sel = socioSel === s.socio_id
                return (
                  <button
                    key={s.socio_id}
                    disabled={off}
                    onClick={() => setSocioSel(s.socio_id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '9px 12px', borderRadius: 10, cursor: off ? 'not-allowed' : 'pointer',
                      border: `1px solid ${sel ? colors.terracotta : colors.border}`,
                      background: sel ? colors.terracottaSoft : colors.paper,
                      opacity: off ? 0.5 : 1, fontFamily: 'inherit',
                    }}
                  >
                    <Bike size={16} strokeWidth={2} color={sel ? colors.terracotta : colors.stone} />
                    <span style={{ flex: 1, fontSize: type.sm, fontWeight: 600, color: colors.ink }}>{s.nombre}</span>
                    <span style={chip(s.en_servicio ? 'sage' : 'paper', { dot: true })}>
                      <span style={chipDot} />{s.en_servicio ? 'En línea' : 'Desconectado'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Resumen */}
        {totalPedido != null && (
          <div style={{
            background: colors.cream2, borderRadius: 10, padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: type.sm, color: colors.ink2 }}>
              <span>Comida</span><span>{fmtEur(importeNum)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: type.sm, color: colors.ink2 }}>
              <span>Envío</span><span>{fmtEur(envio.envio)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: type.base, fontWeight: 800, color: colors.ink, borderTop: `1px solid ${colors.border}`, paddingTop: 6, marginTop: 2 }}>
              <span>Total</span><span>{fmtEur(totalPedido)}</span>
            </div>
            <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>
              {metodoCobro === 'efectivo'
                ? `El repartidor cobrará ${fmtEur(totalPedido)} al cliente.`
                : 'El repartidor no cobra nada al cliente.'}
              {' '}Coste Pidoo: 1,00 € por envío telefónico.
            </div>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={crearEnvio}
          disabled={!formValido || creando || sinRiders}
          style={{
            ...ds.glossyBtn, height: 46,
            opacity: (!formValido || creando || sinRiders) ? 0.5 : 1,
            cursor: (!formValido || creando || sinRiders) ? 'not-allowed' : 'pointer',
          }}
        >
          <Bike size={16} strokeWidth={2.2} />
          {creando ? 'Creando envío…' : sinRiders ? 'Sin repartidores en línea' : 'Crear envío'}
        </button>
      </div>
    </div>
  )
}
