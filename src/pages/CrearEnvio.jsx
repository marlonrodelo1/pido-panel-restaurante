import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast, confirmar } from '../App'
import { colors, type, ds, chip, chipDot } from '../lib/uiStyles'
import AddressInput from '../components/AddressInput'
import { PhoneCall, Bike, Send, RotateCcw, ClipboardList, User, MapPin, Euro, StickyNote } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

const SUPABASE_URL = 'https://rmrbxrabngdmpgpfmjbo.supabase.co'
const isNative = Capacitor.isNativePlatform()

// Pedido telefónico: el restaurante registra un pedido que le entró por teléfono
// y Pidoo se encarga del reparto con sus socios vinculados. Sin productos: solo
// teléfono + dirección + importe acordado + notas. La edge crear-pedido-telefonico
// hace todo el trabajo (valida, calcula envío, memoriza al cliente y asigna rider).
// Pensada para usarse EN LA APP NATIVA mientras se atiende la llamada: mobile-first,
// clientes guardados con búsqueda por teléfono (dropdown) y relleno automático.

// Misma regla de normalización que la edge (E.164 España).
function normalizarTelefonoES(raw) {
  let t = String(raw || '').replace(/[\s\-().]/g, '')
  if (t.startsWith('0034')) t = '+34' + t.slice(4)
  else if (t.startsWith('34') && t.length === 11) t = '+' + t
  else if (/^[6789]\d{8}$/.test(t)) t = '+34' + t
  return /^\+34[6789]\d{8}$/.test(t) ? t : null
}
const soloDigitos = (raw) => String(raw || '').replace(/\D/g, '').replace(/^0034/, '').replace(/^34(?=\d{9}$)/, '')
const fmtTel = (norm) => (norm || '').replace('+34', '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')

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

// ── Piezas de UI móviles ──
const inputBase = {
  ...ds.formInput,
  height: 46,
  borderRadius: 12,
  fontSize: 15,
}

function Seccion({ Icon, titulo, children }) {
  return (
    <div style={{ ...ds.card, borderRadius: 16, padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={15} strokeWidth={2.4} color={colors.terracotta} />}
        <span style={{ fontSize: type.xs, fontWeight: 800, color: colors.stone, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {titulo}
        </span>
      </div>
      {children}
    </div>
  )
}

function Campo({ label, hint, error, children }) {
  return (
    <div>
      {label && <label style={{ ...ds.label, marginBottom: 7 }}>{label}</label>}
      {children}
      {hint && <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
      {error && <div style={{ fontSize: type.xs, color: colors.danger, fontWeight: 600, marginTop: 5 }}>{error}</div>}
    </div>
  )
}

// Segmented táctil de 2 opciones que envuelve bien en pantallas estrechas.
function Segmented({ value, onChange, opciones }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {opciones.map(op => {
        const sel = value === op.id
        return (
          <button
            key={op.id}
            onClick={() => onChange(op.id)}
            style={{
              flex: '1 1 130px', minWidth: 0, height: 44, borderRadius: 12,
              border: `1.5px solid ${sel ? colors.ink : colors.border}`,
              background: sel ? colors.ink : colors.paper,
              color: sel ? colors.cream : colors.ink2,
              fontSize: 14, fontWeight: sel ? 700 : 600,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {op.label}
          </button>
        )
      })}
    </div>
  )
}

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
  const [clienteConocido, setClienteConocido] = useState(null) // cliente seleccionado/encontrado
  const [sugerencias, setSugerencias] = useState([])           // dropdown de clientes guardados
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

  // ── Clientes guardados: sugerencias en vivo mientras teclea el número ──
  const busquedaSeq = useRef(0)
  const busquedaTimer = useRef(null)
  function onTelefonoChange(v) {
    setTelefono(v)
    setClienteConocido(null)
    const digits = soloDigitos(v)
    if (busquedaTimer.current) clearTimeout(busquedaTimer.current)
    if (digits.length < 3 || !restaurante?.id) { setSugerencias([]); return }
    busquedaTimer.current = setTimeout(async () => {
      const seq = ++busquedaSeq.current
      const { data } = await supabase
        .from('clientes_telefonicos')
        .select('telefono_normalizado, nombre, direccion, lat, lng, pedidos_count')
        .eq('establecimiento_id', restaurante.id)
        .ilike('telefono_normalizado', `%${digits}%`)
        .order('last_pedido_at', { ascending: false })
        .limit(4)
      if (seq !== busquedaSeq.current) return
      // Si ya tecleó el número completo y coincide exacto, autoseleccionar.
      const norm = normalizarTelefonoES(v)
      const exacto = norm && (data || []).find(c => c.telefono_normalizado === norm)
      if (exacto) seleccionarCliente(exacto)
      else setSugerencias(data || [])
    }, 300)
  }

  function seleccionarCliente(c) {
    setSugerencias([])
    setClienteConocido(c)
    setTelefono(fmtTel(c.telefono_normalizado))
    if (c.nombre) setNombre(c.nombre)
    if (c.direccion) {
      setDireccion(c.direccion)
      if (c.lat != null && c.lng != null) {
        setCoords({ lat: c.lat, lng: c.lng })
        calcularEnvio(c.lat, c.lng)
      }
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
    setClienteConocido(null); setSugerencias([]); setEnvio(null); setResultado(null)
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
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ ...ds.card, borderRadius: 18, textAlign: 'center', padding: '30px 20px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', margin: '0 auto 12px',
            background: colors.sageSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bike size={26} strokeWidth={2.2} color={colors.sage2} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: colors.sage2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Envío creado
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: colors.ink, margin: '8px 0 6px', letterSpacing: '-0.01em' }}>
            {resultado.pedido?.codigo}
          </div>
          <div style={{ fontSize: 14, color: colors.stone, marginBottom: 16, lineHeight: 1.5 }}>
            {fmtEur(resultado.pedido?.subtotal || 0)} comida + {fmtEur(resultado.pedido?.coste_envio || 0)} envío
            <br />
            <b style={{ color: colors.ink, fontSize: 16 }}>{fmtEur(resultado.pedido?.total || 0)}</b>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
            <button onClick={abrirWhatsApp} style={{ ...ds.primaryBtn, height: 48, borderRadius: 12, fontSize: 15, background: '#25D366', borderColor: '#25D366' }}>
              <Send size={16} strokeWidth={2.2} />
              Enviar seguimiento por WhatsApp
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: isNative ? 'pedidos' : 'historial' }))}
              style={{ ...ds.secondaryBtn, height: 46, borderRadius: 12 }}
            >
              <ClipboardList size={15} strokeWidth={2} />
              Ver mis pedidos
            </button>
            <button onClick={resetForm} style={{ ...ds.ghostBtn, height: 46, borderRadius: 12 }}>
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
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
      {/* Cabecera: título + contador de repartidores en vivo */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhoneCall size={18} strokeWidth={2.3} color={colors.terracotta} />
          <span style={{ fontSize: 18, fontWeight: 800, color: colors.ink, letterSpacing: '-0.01em' }}>Pedido telefónico</span>
        </div>
        {onlineCount === null ? (
          <span style={chip('paper')}>Comprobando…</span>
        ) : onlineCount > 0 ? (
          <span style={chip('sage', { dot: true })}>
            <span style={chipDot} />{onlineCount} repartidor{onlineCount > 1 ? 'es' : ''} en línea
          </span>
        ) : (
          <span style={chip('danger', { dot: true })}>
            <span style={chipDot} />Sin repartidores
          </span>
        )}
      </div>

      {/* ── CLIENTE ── */}
      <Seccion Icon={User} titulo="Cliente">
        <Campo
          label="Teléfono"
          error={telefono && !telValido && sugerencias.length === 0 ? 'Número español de 9 dígitos (empieza por 6, 7, 8 o 9)' : null}
        >
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...inputBase, ...(telefono && !telValido && sugerencias.length === 0 ? { borderColor: colors.danger } : {}) }}
              type="tel"
              inputMode="tel"
              placeholder="612 34 56 78"
              value={telefono}
              onChange={e => onTelefonoChange(e.target.value)}
            />
            {/* Dropdown de clientes guardados: tocar uno lo rellena TODO y calcula el envío */}
            {sugerencias.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40,
                background: colors.paper, border: `1px solid ${colors.borderStrong}`,
                borderRadius: 14, boxShadow: colors.shadowLg, overflow: 'hidden',
              }}>
                {sugerencias.map(c => (
                  <button
                    key={c.telefono_normalizado}
                    onClick={() => seleccionarCliente(c)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '12px 14px', border: 'none', borderBottom: `1px solid ${colors.border}`,
                      background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      background: colors.terracottaSoft, color: colors.terracotta2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 13,
                    }}>
                      {(c.nombre || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>
                        {c.nombre || 'Sin nombre'} <span style={{ fontWeight: 500, color: colors.stone }}>· {fmtTel(c.telefono_normalizado)}</span>
                      </div>
                      {c.direccion && (
                        <div style={{ fontSize: 12, color: colors.stone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {c.direccion}
                        </div>
                      )}
                    </div>
                    <span style={{ ...chip('terracotta'), flexShrink: 0 }}>{c.pedidos_count || 1}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Campo>
        {clienteConocido && (
          <div>
            <span style={chip('sage', { dot: true })}>
              <span style={chipDot} />
              Cliente guardado · {clienteConocido.pedidos_count || 1} pedido{(clienteConocido.pedidos_count || 1) > 1 ? 's' : ''}
            </span>
          </div>
        )}
        <Campo label="Nombre (opcional)">
          <input
            style={inputBase}
            placeholder="Juanita"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
        </Campo>
      </Seccion>

      {/* ── ENTREGA ── */}
      <Seccion Icon={MapPin} titulo="Entrega">
        <Campo
          label="Dirección"
          hint={!direccion && !clienteConocido ? 'Empieza a escribir y elige la dirección exacta de Google' : null}
          error={envio?.error || null}
        >
          <AddressInput
            value={direccion}
            onChange={(v) => { setDireccion(v); setCoords(null); setEnvio(null) }}
            onSelect={({ direccion: dir, lat, lng }) => {
              setDireccion(dir)
              if (lat != null && lng != null) { setCoords({ lat, lng }); calcularEnvio(lat, lng) }
            }}
            placeholder="Calle, número, municipio…"
            style={inputBase}
          />
          {envioLoading && <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 6 }}>Calculando envío…</div>}
          {envio?.envio != null && (
            <div style={{
              marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
              background: colors.sageSoft, color: colors.sage2, fontWeight: 800,
              fontSize: 13, padding: '7px 12px', borderRadius: 10,
            }}>
              <Bike size={14} strokeWidth={2.4} />
              Envío {fmtEur(envio.envio)}{envio.distancia_km != null ? ` · ${envio.distancia_km} km` : ''}
            </div>
          )}
          {direccion && !coords && !envioLoading && !envio && (
            <div style={{ fontSize: type.xxs, color: '#8B6126', marginTop: 6 }}>
              Elige la dirección en el desplegable de Google para fijar el punto exacto
            </div>
          )}
        </Campo>
      </Seccion>

      {/* ── PEDIDO ── */}
      <Seccion Icon={Euro} titulo="Pedido">
        <Campo label="Importe de la comida">
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...inputBase, paddingRight: 34, fontSize: 17, fontWeight: 700 }}
              type="text"
              inputMode="decimal"
              placeholder="21,50"
              value={importe}
              onChange={e => setImporte(e.target.value)}
            />
            <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: colors.stone, fontSize: 15, fontWeight: 700 }}>€</span>
          </div>
        </Campo>
        <Campo
          label="Cobro"
          hint={metodoCobro === 'efectivo'
            ? 'El repartidor cobra el total (comida + envío) al entregar.'
            : 'El cliente ya te pagó (bizum, en el local…). El repartidor solo entrega.'}
        >
          <Segmented
            value={metodoCobro}
            onChange={setMetodoCobro}
            opciones={[
              { id: 'efectivo', label: 'Efectivo' },
              { id: 'pagado_local', label: 'Ya pagado' },
            ]}
          />
        </Campo>
        <Campo label="Pedido / notas">
          <textarea
            style={{ ...inputBase, height: 76, padding: '11px 12px', resize: 'vertical', lineHeight: 1.45 }}
            placeholder="2 pizzas familiares + coca-cola · 2ºB, timbre roto"
            value={notas}
            onChange={e => setNotas(e.target.value)}
          />
        </Campo>
        <Campo label="Listo en">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MINUTOS.map(m => {
              const sel = minutos === m
              return (
                <button
                  key={m}
                  onClick={() => setMinutos(m)}
                  style={{
                    flex: '1 1 56px', height: 42, borderRadius: 11,
                    border: `1.5px solid ${sel ? colors.terracotta : colors.border}`,
                    background: sel ? colors.terracotta : colors.paper,
                    color: sel ? '#fff' : colors.ink2,
                    fontSize: 13, fontWeight: sel ? 800 : 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {m}′
                </button>
              )
            })}
          </div>
        </Campo>
      </Seccion>

      {/* ── REPARTIDOR ── */}
      <Seccion Icon={Bike} titulo="Repartidor">
        <Segmented
          value={asigModo}
          onChange={setAsigModo}
          opciones={[
            { id: 'auto', label: 'Automático' },
            { id: 'socio', label: 'Elegir socio' },
          ]}
        />
        {asigModo === 'auto' && (
          <div style={{ fontSize: type.xxs, color: colors.stone, lineHeight: 1.45 }}>
            Se asigna al repartidor en línea más cercano, como los pedidos de la app.
          </div>
        )}
        {asigModo === 'socio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    padding: '12px 14px', borderRadius: 12, cursor: off ? 'not-allowed' : 'pointer',
                    border: `1.5px solid ${sel ? colors.terracotta : colors.border}`,
                    background: sel ? colors.terracottaSoft : colors.paper,
                    opacity: off ? 0.5 : 1, fontFamily: 'inherit',
                  }}
                >
                  <Bike size={16} strokeWidth={2} color={sel ? colors.terracotta : colors.stone} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nombre}</span>
                  <span style={{ ...chip(s.en_servicio ? 'sage' : 'paper', { dot: true }), flexShrink: 0 }}>
                    <span style={chipDot} />{s.en_servicio ? 'En línea' : 'Off'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </Seccion>

      {/* ── RESUMEN ── */}
      {totalPedido != null && (
        <div style={{
          background: colors.cream2, borderRadius: 16, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: colors.ink2 }}>
            <span>Comida</span><span style={{ fontWeight: 600 }}>{fmtEur(importeNum)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: colors.ink2 }}>
            <span>Envío</span><span style={{ fontWeight: 600 }}>{fmtEur(envio.envio)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 800, color: colors.ink, borderTop: `1px solid ${colors.borderStrong}`, paddingTop: 8, marginTop: 2 }}>
            <span>Total</span><span>{fmtEur(totalPedido)}</span>
          </div>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2, lineHeight: 1.5 }}>
            {metodoCobro === 'efectivo'
              ? `El repartidor cobrará ${fmtEur(totalPedido)} al cliente.`
              : 'El repartidor no cobra nada al cliente.'}
            {' '}Coste Pidoo: 1,00 € por envío telefónico.
          </div>
        </div>
      )}

      {/* ── CTA ── */}
      <button
        onClick={crearEnvio}
        disabled={!formValido || creando || sinRiders}
        style={{
          ...ds.glossyBtn, height: 52, borderRadius: 14, fontSize: 16,
          opacity: (!formValido || creando || sinRiders) ? 0.5 : 1,
          cursor: (!formValido || creando || sinRiders) ? 'not-allowed' : 'pointer',
        }}
      >
        <Bike size={18} strokeWidth={2.2} />
        {creando ? 'Creando envío…' : sinRiders ? 'Sin repartidores en línea' : 'Crear envío'}
      </button>
    </div>
  )
}
