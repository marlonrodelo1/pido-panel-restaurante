import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { getPrinterConfig, savePrinterConfig, testPrint, scanPrinters, connectAndTestPrinter, disconnectPrinter, checkPrinterConnection } from '../lib/printService'
import { Capacitor } from '@capacitor/core'
import { DIAS_ORDEN, DIAS_LABEL, DIAS_CORTO, horarioVacio, horarioEstandar, estaAbierto, horarioHoyTexto } from '../lib/horario'
import { toast } from '../App'

export default function Ajustes() {
  const { restaurante, updateRestaurante, logout } = useRest()
  // --- F2: URL propia tienda pública ---
  const [slugDraft, setSlugDraft] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)
  const [slugError, setSlugError] = useState(null)
  const [slugCopied, setSlugCopied] = useState(false)
  function slugify(txt) {
    return (txt || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40)
  }
  useEffect(() => {
    if (!restaurante?.slug && restaurante?.nombre && !slugDraft) {
      setSlugDraft(slugify(restaurante.nombre))
    }
  }, [restaurante?.nombre, restaurante?.slug])
  async function guardarSlug() {
    setSlugError(null)
    const s = slugify(slugDraft)
    if (!s || s.length < 3) { setSlugError('Mínimo 3 caracteres'); return }
    const RESERVED = ['terminos','privacidad','reset-password','landing-repartidores','perfil','home','carrito','mis-pedidos','favoritos','mapa','notificaciones','admin','panel','api','login','registro','tracking','tienda','pedido']
    if (RESERVED.includes(s)) { setSlugError('Ese nombre está reservado'); return }
    setSlugSaving(true)
    const { error } = await supabase.from('establecimientos').update({ slug: s }).eq('id', restaurante.id)
    setSlugSaving(false)
    if (error) {
      if (String(error.message || '').toLowerCase().includes('duplicate') || error.code === '23505') {
        setSlugError('Ese nombre ya está en uso. Prueba otro.')
      } else {
        setSlugError(error.message || 'No se pudo guardar')
      }
      return
    }
    await updateRestaurante?.({ slug: s })
  }
  async function copiarUrl() {
    try {
      await navigator.clipboard.writeText(`https://pidoo.es/${restaurante?.slug}`)
      setSlugCopied(true)
      setTimeout(() => setSlugCopied(false), 2000)
    } catch (_) {}
  }
  // --- fin F2 ---
  const [activo, setActivo] = useState(restaurante?.activo ?? true)
  const [nombre, setNombre] = useState(restaurante?.nombre || '')
  const [tipo, setTipo] = useState(restaurante?.tipo || 'restaurante')
  const [descripcion, setDescripcion] = useState(restaurante?.descripcion || '')
  const [direccion, setDireccion] = useState(restaurante?.direccion || '')
  const [email, setEmail] = useState(restaurante?.email || '')
  const [telefono, setTelefono] = useState(restaurante?.telefono || '')
  const [radioCobertura, setRadioCobertura] = useState(restaurante?.radio_cobertura_km || 10)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [catsGenerales, setCatsGenerales] = useState([]) // todas las categorias disponibles
  const [catsSeleccionadas, setCatsSeleccionadas] = useState([]) // IDs de categorias del restaurante
  const [catsOriginales, setCatsOriginales] = useState([])
  const [horario, setHorario] = useState(null) // JSONB schedule
  const [horarioOriginal, setHorarioOriginal] = useState(null)
  const logoRef = useRef()
  const bannerRef = useRef()
  const [subiendoImg, setSubiendoImg] = useState(null) // 'logo' | 'banner' | null
  const [obteniendoUbi, setObteniendoUbi] = useState(false)
  const [ubiOk, setUbiOk] = useState(!!restaurante?.latitud)

  // Delivery config (algoritmo + tarifa)
  const [deliveryCfg, setDeliveryCfg] = useState({
    algoritmo_asignacion: 'nearest',
    timing_envio_rider: 'on_accept',
    tarifa_base: '',
    tarifa_radio_base_km: '',
    tarifa_precio_km: '',
    tarifa_maxima: '',
    override_activo: false,
  })
  const [overrideAlgoPermitido, setOverrideAlgoPermitido] = useState(true)
  const [overrideTarifaPermitido, setOverrideTarifaPermitido] = useState(true)
  const [globalDefaults, setGlobalDefaults] = useState({
    envio_tarifa_base: '',
    envio_radio_base_km: '',
    envio_precio_km_adicional: '',
    envio_tarifa_maxima: '',
    default_algoritmo_asignacion: 'nearest',
    default_timing_envio_rider: 'on_accept',
  })
  const [guardandoDelivery, setGuardandoDelivery] = useState(false)

  // Printer config
  const [printerIp, setPrinterIp] = useState('')
  const [printerPort, setPrinterPort] = useState(9100)
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [foundPrinters, setFoundPrinters] = useState([])
  const [scanDone, setScanDone] = useState(false)
  const [connecting, setConnecting] = useState(null) // ip being connected
  const [connectResult, setConnectResult] = useState(null) // { ip, ok }
  const [manualIp, setManualIp] = useState('')
  const [ticketCount, setTicketCount] = useState(2) // 1 = solo comanda, 2 = comanda + cliente

  useEffect(() => {
    if (restaurante) {
      loadCategorias()
      loadDeliveryConfig()
      const h = restaurante.horario || null
      setHorario(h)
      setHorarioOriginal(h ? JSON.stringify(h) : null)
    }
  }, [restaurante?.id])

  async function loadDeliveryConfig() {
    // Cargar config global + override flags
    const { data: platform } = await supabase
      .from('configuracion_plataforma')
      .select('clave, valor')
      .in('clave', [
        'override_algoritmo_permitido',
        'override_tarifa_permitido',
        'default_algoritmo_asignacion',
        'default_timing_envio_rider',
        'envio_tarifa_base',
        'envio_radio_base_km',
        'envio_precio_km_adicional',
        'envio_tarifa_maxima',
      ])
    const map = {}
    ;(platform || []).forEach(r => { map[r.clave] = r.valor })
    setOverrideAlgoPermitido(map.override_algoritmo_permitido !== 'false')
    setOverrideTarifaPermitido(map.override_tarifa_permitido !== 'false')
    setGlobalDefaults({
      envio_tarifa_base: map.envio_tarifa_base ?? '',
      envio_radio_base_km: map.envio_radio_base_km ?? '',
      envio_precio_km_adicional: map.envio_precio_km_adicional ?? '',
      envio_tarifa_maxima: map.envio_tarifa_maxima ?? '',
      default_algoritmo_asignacion: map.default_algoritmo_asignacion || 'nearest',
      default_timing_envio_rider: map.default_timing_envio_rider || 'on_accept',
    })

    // Cargar config del restaurante
    const { data: cfg } = await supabase
      .from('restaurante_config_delivery')
      .select('*')
      .eq('establecimiento_id', restaurante.id)
      .maybeSingle()
    if (cfg) {
      setDeliveryCfg({
        algoritmo_asignacion: cfg.algoritmo_asignacion || map.default_algoritmo_asignacion || 'nearest',
        timing_envio_rider: cfg.timing_envio_rider || map.default_timing_envio_rider || 'on_accept',
        tarifa_base: cfg.tarifa_base ?? '',
        tarifa_radio_base_km: cfg.tarifa_radio_base_km ?? '',
        tarifa_precio_km: cfg.tarifa_precio_km ?? '',
        tarifa_maxima: cfg.tarifa_maxima ?? '',
        override_activo: !!cfg.override_activo,
      })
    } else {
      setDeliveryCfg(prev => ({
        ...prev,
        algoritmo_asignacion: map.default_algoritmo_asignacion || 'nearest',
        timing_envio_rider: map.default_timing_envio_rider || 'on_accept',
      }))
    }
  }

  async function guardarDelivery() {
    setGuardandoDelivery(true)
    const payload = {
      establecimiento_id: restaurante.id,
      algoritmo_asignacion: deliveryCfg.algoritmo_asignacion,
      timing_envio_rider: deliveryCfg.timing_envio_rider,
      tarifa_base: deliveryCfg.tarifa_base === '' ? null : Number(deliveryCfg.tarifa_base),
      tarifa_radio_base_km: deliveryCfg.tarifa_radio_base_km === '' ? null : Number(deliveryCfg.tarifa_radio_base_km),
      tarifa_precio_km: deliveryCfg.tarifa_precio_km === '' ? null : Number(deliveryCfg.tarifa_precio_km),
      tarifa_maxima: deliveryCfg.tarifa_maxima === '' ? null : Number(deliveryCfg.tarifa_maxima),
      override_activo: !!deliveryCfg.override_activo,
    }
    const { error } = await supabase
      .from('restaurante_config_delivery')
      .upsert(payload, { onConflict: 'establecimiento_id' })
    setGuardandoDelivery(false)
    if (error) return toast('Error guardando: ' + error.message, 'error')
    toast('Configuración de delivery guardada', 'success')
  }

  function updateDelivery(field, value) {
    setDeliveryCfg(prev => ({ ...prev, [field]: value }))
  }

  // Load printer config from localStorage
  useEffect(() => {
    const cfg = getPrinterConfig()
    setPrinterIp(cfg.ip || '')
    setPrinterPort(cfg.port || 9100)
    setPrinterEnabled(cfg.enabled || false)
    setTicketCount(cfg.tickets ?? 2)
  }, [])

  async function loadCategorias() {
    const [allRes, asignRes] = await Promise.all([
      supabase.from('categorias_generales').select('*').eq('activa', true).order('orden'),
      supabase.from('establecimiento_categorias').select('categoria_id').eq('establecimiento_id', restaurante.id),
    ])
    setCatsGenerales(allRes.data || [])
    const ids = (asignRes.data || []).map(r => r.categoria_id)
    setCatsSeleccionadas(ids)
    setCatsOriginales(ids)
  }

  function toggleCat(catId) {
    setCatsSeleccionadas(prev => {
      if (prev.includes(catId)) return prev.filter(id => id !== catId)
      if (prev.length >= 3) return prev // máximo 3
      return [...prev, catId]
    })
  }

  const hayCambios =
    nombre !== (restaurante?.nombre || '') ||
    tipo !== (restaurante?.tipo || 'restaurante') ||
    descripcion !== (restaurante?.descripcion || '') ||
    direccion !== (restaurante?.direccion || '') ||
    email !== (restaurante?.email || '') ||
    telefono !== (restaurante?.telefono || '') ||
    radioCobertura !== (restaurante?.radio_cobertura_km || 10) ||
    JSON.stringify(catsSeleccionadas.sort()) !== JSON.stringify(catsOriginales.sort()) ||
    JSON.stringify(horario) !== horarioOriginal

  async function guardarTodo() {
    setGuardando(true)

    // Si la direccion cambio, re-geocodificar
    const updates = {
      nombre: nombre.trim(),
      tipo,
      descripcion: descripcion.trim() || null,
      direccion: direccion.trim() || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      radio_cobertura_km: radioCobertura,
      horario: horario,
    }
    if (direccion.trim() && direccion.trim() !== (restaurante?.direccion || '')) {
      try {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
        if (apiKey) {
          const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccion.trim())}&key=${apiKey}`)
          const geoData = await geoRes.json()
          if (geoData.results?.length > 0) {
            updates.latitud = geoData.results[0].geometry.location.lat
            updates.longitud = geoData.results[0].geometry.location.lng
            setUbiOk(true)
          }
        }
      } catch (e) { console.warn('Geocoding failed:', e) }
    }

    await updateRestaurante(updates)
    setHorarioOriginal(horario ? JSON.stringify(horario) : null)
    // Guardar categorías del establecimiento (nivel 2)
    await supabase.from('establecimiento_categorias').delete().eq('establecimiento_id', restaurante.id)
    if (catsSeleccionadas.length > 0) {
      await supabase.from('establecimiento_categorias').insert(
        catsSeleccionadas.map(catId => ({ establecimiento_id: restaurante.id, categoria_id: catId }))
      )
    }
    setCatsOriginales([...catsSeleccionadas])
    setGuardando(false)
    setGuardado(true)
    setTimeout(() => setGuardado(false), 2500)
  }

  async function toggleActivo() {
    const nuevo = !activo
    setActivo(nuevo)
    await updateRestaurante({ activo: nuevo })
  }

  async function subirImagen(file, bucket, field) {
    const tipo = field === 'logo_url' ? 'logo' : 'banner'
    setSubiendoImg(tipo)
    try {
      const ext = file.name.split('.').pop()
      const path = `establecimientos/${restaurante.id}_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from(bucket).upload(path, file)
      if (error) { toast('Error al subir: ' + error.message); return }
      const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path)
      await updateRestaurante({ [field]: publicUrl })
    } catch (err) {
      toast('Error al subir imagen: ' + err.message)
    } finally {
      setSubiendoImg(null)
    }
  }

  // ---- Horario helpers ----
  function initHorario(tipo) {
    const h = tipo === 'estandar' ? horarioEstandar() : horarioVacio()
    setHorario(h)
  }

  function toggleDia(dia) {
    setHorario(prev => {
      const h = { ...prev }
      if (h[dia] && h[dia].length > 0) {
        h[dia] = [] // cerrar este día
      } else {
        h[dia] = [{ abre: '10:00', cierra: '23:00' }] // abrir con turno default
      }
      return h
    })
  }

  const [horarioError, setHorarioError] = useState(null)

  function updateTurno(dia, idx, field, value) {
    setHorario(prev => {
      const h = { ...prev }
      h[dia] = [...h[dia]]
      h[dia][idx] = { ...h[dia][idx], [field]: value }
      // Validar que cierra != abre (cierra < abre es valido: turno nocturno que cruza medianoche)
      const turno = h[dia][idx]
      if (turno.abre && turno.cierra && turno.cierra === turno.abre) {
        setHorarioError(`${DIAS_LABEL[dia]}: la hora de apertura y cierre no pueden ser iguales`)
      } else {
        setHorarioError(null)
      }
      return h
    })
  }

  function addTurno(dia) {
    setHorario(prev => {
      const h = { ...prev }
      h[dia] = [...(h[dia] || []), { abre: '18:00', cierra: '23:00' }]
      return h
    })
  }

  function removeTurno(dia, idx) {
    setHorario(prev => {
      const h = { ...prev }
      h[dia] = h[dia].filter((_, i) => i !== idx)
      return h
    })
  }

  function copiarHorarioATodos(diaOrigen) {
    setHorario(prev => {
      const h = { ...prev }
      const turnos = h[diaOrigen] || []
      for (const d of DIAS_ORDEN) {
        if (d !== diaOrigen) h[d] = turnos.map(t => ({ ...t }))
      }
      return h
    })
  }

  async function handleScan() {
    setScanning(true)
    setScanDone(false)
    setFoundPrinters([])
    setConnectResult(null)
    const result = await scanPrinters()
    setFoundPrinters(result.printers || [])
    setScanning(false)
    setScanDone(true)
  }

  async function handleConnect(ip, port = 9100) {
    setConnecting(ip)
    setConnectResult(null)
    const result = await connectAndTestPrinter(ip, port)
    setConnecting(null)
    if (result.ok) {
      setPrinterIp(ip)
      setPrinterPort(port)
      setPrinterEnabled(true)
      setConnectResult({ ip, ok: true })
    } else {
      setConnectResult({ ip, ok: false })
    }
    setTimeout(() => setConnectResult(null), 5000)
  }

  function handleDisconnect() {
    disconnectPrinter()
    setPrinterIp('')
    setPrinterEnabled(false)
    setScanDone(false)
    setFoundPrinters([])
  }

  async function handleManualConnect() {
    const ip = manualIp.trim()
    if (!ip) return
    await handleConnect(ip, printerPort)
    setManualIp('')
  }

  async function handleRetest() {
    if (!printerIp) return
    setConnecting(printerIp)
    setConnectResult(null)
    const result = await connectAndTestPrinter(printerIp, printerPort)
    setConnecting(null)
    setConnectResult({ ip: printerIp, ok: result.ok })
    setTimeout(() => setConnectResult(null), 5000)
  }

  const inp = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', fontSize: 13, fontFamily: 'inherit', background: 'rgba(255,255,255,0.06)', color: '#F5F5F5', outline: 'none', boxSizing: 'border-box' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 4, display: 'block' }

  return (
    <div style={{ paddingBottom: hayCambios ? 90 : 0 }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 20px' }}>Ajustes</h2>

      {/* ── F2: URL propia tienda pública ── */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Mi URL propia</h3>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          Tu restaurante sigue apareciendo en pidoo.es. Esta URL es adicional.
        </div>
        {restaurante?.slug ? (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 14px', borderRadius: 10,
              background: 'var(--c-surface2)', border: '1px solid var(--c-border)',
              marginBottom: 10,
            }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--c-text)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                https://pidoo.es/{restaurante.slug}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copiarUrl} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10,
                border: '1px solid var(--c-border)', background: 'var(--c-surface2)',
                color: 'var(--c-text)', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {slugCopied ? '✓ Copiado' : 'Copiar'}
              </button>
              <button onClick={() => window.open(`https://pidoo.es/${restaurante.slug}`, '_blank', 'noopener,noreferrer')} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10,
                border: 'none', background: 'var(--c-primary, #B91C1C)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Abrir tienda
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 8 }}>
              Crea tu URL personalizada (solo minúsculas, números y guiones).
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginBottom: 8 }}>
              <span style={{
                display: 'flex', alignItems: 'center', padding: '0 10px',
                borderRadius: 10, background: 'var(--c-surface2)',
                border: '1px solid var(--c-border)', fontSize: 12, color: 'var(--c-muted)', fontFamily: 'monospace',
              }}>
                pidoo.es/
              </span>
              <input
                value={slugDraft}
                onChange={e => { setSlugDraft(slugify(e.target.value)); setSlugError(null) }}
                placeholder="mi-restaurante"
                maxLength={40}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10,
                  background: 'var(--c-surface2)', border: '1px solid var(--c-border)',
                  color: 'var(--c-text)', fontSize: 14, fontFamily: 'monospace',
                  outline: 'none', minHeight: 40,
                }}
              />
            </div>
            {slugError && (
              <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 8, fontWeight: 600 }}>
                {slugError}
              </div>
            )}
            <button
              onClick={guardarSlug}
              disabled={slugSaving || !slugDraft || slugDraft.length < 3}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                border: 'none',
                background: slugSaving || !slugDraft || slugDraft.length < 3 ? 'rgba(255,255,255,0.1)' : 'var(--c-primary, #B91C1C)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: slugSaving || !slugDraft || slugDraft.length < 3 ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}>
              {slugSaving ? 'Guardando...' : 'Crear URL'}
            </button>
          </>
        )}
      </div>

      {/* Estado abierto/cerrado — inmediato */}
      <div style={{ background: activo ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', borderRadius: 14, padding: '16px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: activo ? '#4ADE80' : '#EF4444' }}>{activo ? 'Abierto' : 'Cerrado'}</div>
          <div style={{ fontSize: 12, color: activo ? '#22C55E' : '#EF4444', marginTop: 2 }}>{activo ? 'Recibiendo pedidos' : 'No se reciben pedidos'}</div>
        </div>
        <button onClick={toggleActivo} style={{ width: 52, height: 28, borderRadius: 14, border: 'none', background: activo ? '#16A34A' : 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', minHeight: 44, minWidth: 52, display: 'flex', alignItems: 'center', padding: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: activo ? 27 : 3, width: 22, height: 22, borderRadius: 11, background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
        </button>
      </div>

      {/* Logo */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Logo</h3>
        <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && subirImagen(e.target.files[0], 'logos', 'logo_url')} />
        <div onClick={() => !subiendoImg && logoRef.current?.click()} style={{ width: 100, height: 100, borderRadius: 20, background: 'var(--c-surface2)', border: '2px dashed var(--c-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: subiendoImg ? 'default' : 'pointer', margin: '0 auto 12px', overflow: 'hidden', opacity: subiendoImg === 'logo' ? 0.5 : 1 }}>
          {subiendoImg === 'logo' ? <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 600 }}>Subiendo...</span> : restaurante?.logo_url ? <img src={restaurante.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><span style={{ fontSize: 28, marginBottom: 4 }}>📷</span><span style={{ fontSize: 10, color: 'var(--c-muted)', fontWeight: 600 }}>Subir logo</span></>}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)' }}>200 × 200 px recomendado · PNG o JPG</div>
      </div>

      {/* Banner */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Banner</h3>
        <input ref={bannerRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && subirImagen(e.target.files[0], 'banners', 'banner_url')} />
        <div onClick={() => !subiendoImg && bannerRef.current?.click()} style={{ width: '100%', aspectRatio: '8/3', minHeight: 80, borderRadius: 14, background: 'var(--c-surface2)', border: '2px dashed var(--c-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: subiendoImg ? 'default' : 'pointer', marginBottom: 12, overflow: 'hidden', opacity: subiendoImg === 'banner' ? 0.5 : 1 }}>
          {subiendoImg === 'banner' ? <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 600 }}>Subiendo...</span> : restaurante?.banner_url ? <img src={restaurante.banner_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <><span style={{ fontSize: 28, marginBottom: 4 }}>🖼️</span><span style={{ fontSize: 10, color: 'var(--c-muted)', fontWeight: 600 }}>Subir banner</span></>}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)' }}>800 × 300 px recomendado · PNG o JPG</div>
      </div>

      {/* Información editable */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Información</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Nombre</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Tipo de negocio</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp}>
            <option value="restaurante">Restaurante</option>
            <option value="cafeteria">Cafetería</option>
            <option value="pizzeria">Pizzería</option>
            <option value="hamburgueseria">Hamburguesería</option>
            <option value="sushi">Sushi</option>
            <option value="minimarket">Minimarket</option>
            <option value="fruteria">Frutería</option>
            <option value="farmacia">Farmacia</option>
            <option value="panaderia">Panadería</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Descripción</label>
          <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Breve descripción del negocio..." rows={2} style={{ ...inp, resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Dirección</label>
          <input value={direccion} onChange={e => setDireccion(e.target.value)} style={inp} />
        </div>

        {/* Ubicación GPS */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Ubicación GPS</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={async () => {
              setObteniendoUbi(true)
              try {
                const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 10000 }))
                await updateRestaurante({ latitud: pos.coords.latitude, longitud: pos.coords.longitude })
                setUbiOk(true)
              } catch { toast('No se pudo obtener la ubicación. Activa el GPS.') }
              setObteniendoUbi(false)
            }} disabled={obteniendoUbi} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-border)',
              background: ubiOk ? 'rgba(34,197,94,0.12)' : 'var(--c-surface2)',
              color: ubiOk ? '#4ADE80' : 'var(--c-text)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {obteniendoUbi ? 'Obteniendo...' : ubiOk ? '✅ Ubicación guardada' : '📍 Obtener ubicación actual'}
            </button>
          </div>
          {!ubiOk && <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 6, fontWeight: 600 }}>⚠️ Sin ubicación GPS — los clientes no podrán calcular envío ni verte en el mapa.</div>}
          {ubiOk && restaurante?.latitud && <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4 }}>📍 {restaurante.latitud.toFixed(5)}, {restaurante.longitud.toFixed(5)}</div>}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Teléfono</label>
          <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} style={inp} />
        </div>
      </div>

      {/* Radio de cobertura */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Radio de cobertura</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <input type="range" min="1" max="30" value={radioCobertura} onChange={e => setRadioCobertura(Number(e.target.value))} style={{ flex: 1, accentColor: '#B91C1C' }} />
          <span style={{ minWidth: 50, textAlign: 'center', fontWeight: 800, fontSize: 16, color: 'var(--c-primary)' }}>{radioCobertura} km</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 8 }}>Solo los clientes dentro de este radio verán tu restaurante.</div>
      </div>

      {/* Horario semanal */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Horario de apertura</h3>
          {horario && (() => {
            const estado = estaAbierto({ activo, horario })
            return (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 50,
                background: estado.abierto ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: estado.abierto ? '#4ADE80' : '#EF4444',
              }}>
                {estado.abierto ? 'Abierto ahora' : 'Cerrado'}
              </span>
            )
          })()}
        </div>
        <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 14 }}>
          Configura tus horarios por dia. Puedes tener varios turnos por dia (ej: mañana y noche). Los clientes veran si estas abierto o cerrado.
        </p>

        {/* Sin horario configurado */}
        {!horario ? (
          <div>
            <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: 12 }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>🕐</span>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Sin horario configurado</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>Los clientes veran tu restaurante solo segun el toggle abierto/cerrado</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => initHorario('estandar')} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--c-primary)', color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Horario estandar
              </button>
              <button onClick={() => initHorario('personalizado')} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-border)',
                background: 'transparent', color: 'var(--c-text)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Personalizado
              </button>
            </div>
          </div>
        ) : (
          /* Editor de horarios */
          <div>
            {DIAS_ORDEN.map(dia => {
              const turnos = horario[dia] || []
              const abierto = turnos.length > 0

              return (
                <div key={dia} style={{
                  marginBottom: 10, borderRadius: 10, overflow: 'hidden',
                  border: '1px solid ' + (abierto ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'),
                  background: abierto ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
                }}>
                  {/* Header del día */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => toggleDia(dia)} style={{
                        width: 48, height: 28, borderRadius: 14, border: 'none',
                        background: abierto ? '#16A34A' : 'rgba(255,255,255,0.15)',
                        cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                        minHeight: 44, minWidth: 48, display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
                      }}>
                        <span style={{
                          position: 'absolute', top: 3, left: abierto ? 23 : 3,
                          width: 22, height: 22, borderRadius: 11, background: '#fff',
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </button>
                      <span style={{ fontWeight: 700, fontSize: 13, color: abierto ? 'var(--c-text)' : 'var(--c-muted)', minWidth: 75 }}>
                        {DIAS_LABEL[dia]}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: abierto ? 'rgba(74,222,128,0.8)' : 'rgba(239,68,68,0.6)',
                    }}>
                      {abierto ? turnos.map(t => `${t.abre}-${t.cierra}`).join(' · ') : 'Cerrado'}
                    </span>
                  </div>

                  {/* Turnos */}
                  {abierto && (
                    <div style={{ padding: '0 14px 10px' }}>
                      {turnos.map((turno, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, color: 'var(--c-muted)', fontWeight: 600, minWidth: 38 }}>
                            T{idx + 1}
                          </span>
                          <input
                            type="time"
                            value={turno.abre}
                            onChange={e => updateTurno(dia, idx, 'abre', e.target.value)}
                            style={{
                              padding: '10px 8px', borderRadius: 8,
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'rgba(255,255,255,0.06)', color: '#F5F5F5',
                              fontSize: 13, fontFamily: 'inherit', outline: 'none', minHeight: 44,
                            }}
                          />
                          <span style={{ color: 'var(--c-muted)', fontSize: 12 }}>—</span>
                          <input
                            type="time"
                            value={turno.cierra}
                            onChange={e => updateTurno(dia, idx, 'cierra', e.target.value)}
                            style={{
                              padding: '10px 8px', borderRadius: 8,
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'rgba(255,255,255,0.06)', color: '#F5F5F5',
                              fontSize: 13, fontFamily: 'inherit', outline: 'none', minHeight: 44,
                            }}
                          />
                          {turnos.length > 1 && (
                            <button onClick={() => removeTurno(dia, idx)} style={{
                              background: 'rgba(239,68,68,0.1)', border: 'none', color: '#EF4444',
                              fontSize: 16, cursor: 'pointer', padding: 0,
                              width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>×</button>
                          )}
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button onClick={() => addTurno(dia)} style={{
                          background: 'none', border: 'none', color: 'var(--c-primary)',
                          fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          padding: 0,
                        }}>+ Añadir turno</button>
                        <button onClick={() => copiarHorarioATodos(dia)} style={{
                          background: 'none', border: 'none', color: 'var(--c-muted)',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          padding: 0,
                        }}>Copiar a todos</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Error horario */}
            {horarioError && <div style={{ color: '#EF4444', fontSize: 11, fontWeight: 600, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, marginTop: 8 }}>{horarioError}</div>}

            {/* Quitar horario */}
            <button onClick={() => { setHorario(null); setHorarioError(null) }} style={{
              width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10,
              border: '1px solid rgba(239,68,68,0.2)', background: 'transparent',
              color: '#EF4444', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Quitar horario (usar solo toggle abierto/cerrado)
            </button>
          </div>
        )}
      </div>

      {/* Delivery — Algoritmo de asignación */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Algoritmo de asignación</h3>
        <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 14 }}>
          Cómo se elige el rider que recibirá tus pedidos
        </p>

        {!overrideAlgoPermitido && (
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 11, color: '#FBBF24', marginBottom: 12 }}>
            Tu Pidoo no permite personalizar esto todavía. Se están usando las reglas globales.
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Algoritmo</label>
          <select
            value={overrideAlgoPermitido ? deliveryCfg.algoritmo_asignacion : globalDefaults.default_algoritmo_asignacion}
            onChange={e => updateDelivery('algoritmo_asignacion', e.target.value)}
            disabled={!overrideAlgoPermitido}
            style={{ ...inp, opacity: overrideAlgoPermitido ? 1 : 0.6 }}
          >
            <option value="nearest">Más cercano</option>
            <option value="fewest_orders">Menos pedidos activos</option>
            <option value="same_area">Misma zona</option>
            <option value="broadcast_all">Difundir a todos los riders</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Cuándo se envía el pedido al rider</label>
          <select
            value={overrideAlgoPermitido ? deliveryCfg.timing_envio_rider : globalDefaults.default_timing_envio_rider}
            onChange={e => updateDelivery('timing_envio_rider', e.target.value)}
            disabled={!overrideAlgoPermitido}
            style={{ ...inp, opacity: overrideAlgoPermitido ? 1 : 0.6 }}
          >
            <option value="on_accept">Al aceptar el pedido</option>
            <option value="on_ready">Cuando esté listo para recoger</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: overrideAlgoPermitido ? 'pointer' : 'default', opacity: overrideAlgoPermitido ? 1 : 0.6 }}>
          <input
            type="checkbox"
            checked={!!deliveryCfg.override_activo}
            onChange={e => updateDelivery('override_activo', e.target.checked)}
            disabled={!overrideAlgoPermitido}
            style={{ width: 18, height: 18, accentColor: 'var(--c-primary)' }}
          />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Usar mi configuración</span>
        </label>
      </div>

      {/* Delivery — Tarifa de envío al cliente */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Tarifa de envío que cobras al cliente</h3>

        {!overrideTarifaPermitido && (
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 11, color: '#FBBF24', marginBottom: 12 }}>
            Tu Pidoo no permite personalizar esto todavía. Se están usando las reglas globales.
          </div>
        )}

        {(() => {
          const readOnly = !overrideTarifaPermitido
          const base = readOnly ? globalDefaults.envio_tarifa_base : deliveryCfg.tarifa_base
          const radio = readOnly ? globalDefaults.envio_radio_base_km : deliveryCfg.tarifa_radio_base_km
          const precio = readOnly ? globalDefaults.envio_precio_km_adicional : deliveryCfg.tarifa_precio_km
          const maxima = readOnly ? globalDefaults.envio_tarifa_maxima : deliveryCfg.tarifa_maxima
          const fmt = v => (v === '' || v === null || v === undefined) ? '—' : Number(v).toFixed(2)
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Tarifa base (€)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={base}
                    onChange={e => updateDelivery('tarifa_base', e.target.value)}
                    disabled={readOnly}
                    style={{ ...inp, opacity: readOnly ? 0.6 : 1 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4 }}>Asignada a todos los pedidos</div>
                </div>
                <div>
                  <label style={lbl}>Distancia base (km)</label>
                  <input
                    type="number" step="0.1" min="0"
                    value={radio}
                    onChange={e => updateDelivery('tarifa_radio_base_km', e.target.value)}
                    disabled={readOnly}
                    style={{ ...inp, opacity: readOnly ? 0.6 : 1 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4 }}>Si se excede, se añade cargo adicional</div>
                </div>
                <div>
                  <label style={lbl}>Tarifa adicional por km (€)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={precio}
                    onChange={e => updateDelivery('tarifa_precio_km', e.target.value)}
                    disabled={readOnly}
                    style={{ ...inp, opacity: readOnly ? 0.6 : 1 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4 }}>Esto se cobra por cada km sobre la distancia base</div>
                </div>
                <div>
                  <label style={lbl}>Tarifa máxima (€)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={maxima}
                    onChange={e => updateDelivery('tarifa_maxima', e.target.value)}
                    disabled={readOnly}
                    style={{ ...inp, opacity: readOnly ? 0.6 : 1 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4 }}>Tope del envío</div>
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 10, background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.2)', fontSize: 12, color: 'var(--c-text)', lineHeight: 1.6, marginBottom: 12 }}>
                A tus clientes se les cobrará <strong>{fmt(base)}€</strong> por los primeros <strong>{fmt(radio)} km</strong>. Después, <strong>{fmt(precio)}€</strong> por cada km adicional, con un máximo de <strong>{fmt(maxima)}€</strong>.
              </div>
            </>
          )
        })()}

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: overrideTarifaPermitido ? 'pointer' : 'default', opacity: overrideTarifaPermitido ? 1 : 0.6 }}>
          <input
            type="checkbox"
            checked={!!deliveryCfg.override_activo}
            onChange={e => updateDelivery('override_activo', e.target.checked)}
            disabled={!overrideTarifaPermitido}
            style={{ width: 18, height: 18, accentColor: 'var(--c-primary)' }}
          />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Usar mi configuración</span>
        </label>

        <button
          onClick={guardarDelivery}
          disabled={guardandoDelivery || (!overrideAlgoPermitido && !overrideTarifaPermitido)}
          style={{
            width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 12, border: 'none',
            background: guardandoDelivery ? 'var(--c-muted)' : 'var(--c-primary)',
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: guardandoDelivery ? 'default' : 'pointer', fontFamily: 'inherit',
            opacity: (!overrideAlgoPermitido && !overrideTarifaPermitido) ? 0.5 : 1,
          }}
        >
          {guardandoDelivery ? 'Guardando...' : 'Guardar configuración delivery'}
        </button>
      </div>

      {/* Categorías del establecimiento (nivel 2) */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Categorías de tu negocio</h3>
        <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 14 }}>Elige hasta 3 categorías para que los clientes te encuentren (ej: Pizzas, Burgers)</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {catsGenerales.map(c => {
            const sel = catsSeleccionadas.includes(c.id)
            const disabled = !sel && catsSeleccionadas.length >= 3
            return (
              <button key={c.id} onClick={() => !disabled && toggleCat(c.id)} style={{
                padding: '8px 14px', borderRadius: 50, cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                border: sel ? '2px solid var(--c-primary)' : '1px solid var(--c-border)',
                background: sel ? 'rgba(185,28,28,0.12)' : 'var(--c-surface)',
                color: sel ? 'var(--c-primary)' : disabled ? 'rgba(255,255,255,0.2)' : 'var(--c-text)',
                opacity: disabled ? 0.5 : 1,
              }}>
                {c.emoji} {c.nombre}
              </button>
            )
          })}
        </div>
        {catsSeleccionadas.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--c-primary)', marginTop: 10, fontWeight: 600 }}>
            {catsSeleccionadas.length}/3 seleccionadas
          </div>
        )}
      </div>

      {/* Impresora térmica */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🖨️</span>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Impresora de tickets</h3>
        </div>
        <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 16 }}>
          Conecta tu impresora termica 80mm por red LAN. Al aceptar un pedido se imprimen automaticamente 2 copias: comanda para cocina + ticket para el cliente.
        </p>

        {/* ESTADO CONECTADO */}
        {printerEnabled && printerIp ? (
          <div>
            {/* Impresora conectada */}
            <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 12, padding: 16, marginBottom: 14, border: '1px solid rgba(34,197,94,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, background: '#4ADE80', boxShadow: '0 0 8px rgba(74,222,128,0.6)' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#4ADE80' }}>Conectada</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>🖨️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Impresora termica</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{printerIp}:{printerPort}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.7)', marginTop: 8 }}>
                Se imprimira automaticamente al aceptar cada pedido
              </div>
            </div>

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleRetest}
                disabled={connecting === printerIp}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-border)',
                  background: 'var(--c-surface)', color: 'var(--c-text)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {connecting === printerIp ? 'Probando...' : 'Probar impresion'}
              </button>
              <button
                onClick={handleDisconnect}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.08)', color: '#EF4444',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Desconectar
              </button>
            </div>

            {/* Resultado del test */}
            {connectResult && (
              <div style={{
                marginTop: 10, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: connectResult.ok ? '#4ADE80' : '#EF4444',
                fontSize: 12, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok ? 'Ticket de prueba enviado!' : 'Error al imprimir. Verifica que la impresora este encendida.'}
              </div>
            )}

            {/* Opción: cuántos tickets imprimir */}
            <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--c-surface2)', borderRadius: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Tickets al aceptar pedido</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ v: 2, label: 'Comanda + Cliente' }, { v: 1, label: 'Solo comanda' }].map(opt => (
                  <button key={opt.v} onClick={() => {
                    setTicketCount(opt.v)
                    const cfg = getPrinterConfig()
                    savePrinterConfig({ ...cfg, tickets: opt.v })
                  }} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 10, border: 'none',
                    background: ticketCount === opt.v ? 'var(--c-primary)' : 'rgba(255,255,255,0.08)',
                    color: ticketCount === opt.v ? '#fff' : 'var(--c-muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    minHeight: 44,
                  }}>{opt.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 6 }}>
                {ticketCount === 2 ? 'Se imprimiran 2 tickets: comanda para cocina y ticket para el cliente' : 'Se imprimira solo la comanda para cocina'}
              </div>
            </div>
          </div>
        ) : (
          /* ESTADO DESCONECTADO - Buscar impresoras */
          <div>
            {/* Botón buscar */}
            <button
              onClick={handleScan}
              disabled={scanning}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: scanning ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, var(--c-primary), #D94420)',
                color: '#fff', fontSize: 14, fontWeight: 800, cursor: scanning ? 'default' : 'pointer',
                fontFamily: 'inherit', marginBottom: 14,
                opacity: scanning ? 0.7 : 1,
              }}
            >
              {scanning ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Buscando impresoras...
                </span>
              ) : (
                'Buscar impresoras en la red'
              )}
            </button>

            {/* Resultados del escaneo */}
            {scanning && (
              <div style={{ textAlign: 'center', padding: 16, color: 'var(--c-muted)', fontSize: 12 }}>
                Escaneando todos los dispositivos de tu red local...
                <br />Esto puede tardar unos segundos.
              </div>
            )}

            {scanDone && !scanning && foundPrinters.length === 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 16,
                textAlign: 'center', marginBottom: 14,
              }}>
                <span style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>🔍</span>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>No se encontraron impresoras</div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>
                  Asegurate de que la impresora este encendida y conectada a la misma red por cable LAN.
                </div>
              </div>
            )}

            {foundPrinters.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--c-muted)' }}>
                  {foundPrinters.length} impresora{foundPrinters.length > 1 ? 's' : ''} encontrada{foundPrinters.length > 1 ? 's' : ''}:
                </div>
                {foundPrinters.map(p => (
                  <div key={p.ip} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '12px 14px',
                    marginBottom: 8, border: '1px solid var(--c-border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 24 }}>🖨️</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {p.hostname && p.hostname !== p.ip ? p.hostname : 'Impresora termica'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>{p.ip}:{p.port || 9100}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnect(p.ip, p.port || 9100)}
                      disabled={connecting === p.ip}
                      style={{
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: connecting === p.ip ? 'rgba(255,255,255,0.1)' : '#16A34A',
                        color: '#fff', fontSize: 12, fontWeight: 700,
                        cursor: connecting === p.ip ? 'default' : 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {connecting === p.ip ? 'Conectando...' : 'Conectar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Resultado de conexión */}
            {connectResult && !printerEnabled && (
              <div style={{
                marginBottom: 14, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: connectResult.ok ? '#4ADE80' : '#EF4444',
                fontSize: 12, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok
                  ? `Conectada a ${connectResult.ip} - Ticket de prueba enviado!`
                  : `No se pudo conectar a ${connectResult.ip}. Verifica que este encendida.`
                }
              </div>
            )}

            {/* Separador + manual */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
              <span style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600 }}>o conectar manualmente</span>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
            </div>

            {/* IP manual */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={manualIp}
                onChange={e => setManualIp(e.target.value)}
                placeholder="IP: 192.168.1.100"
                onKeyDown={e => e.key === 'Enter' && handleManualConnect()}
                style={{ ...inp, flex: 1 }}
              />
              <button
                onClick={handleManualConnect}
                disabled={!manualIp.trim() || connecting}
                style={{
                  padding: '12px 18px', borderRadius: 10, border: 'none',
                  background: !manualIp.trim() ? 'rgba(255,255,255,0.06)' : 'var(--c-primary)',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: !manualIp.trim() ? 'default' : 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {connecting ? '...' : 'Conectar'}
              </button>
            </div>

            {!Capacitor.isNativePlatform() && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.1)', fontSize: 11, color: '#FBBF24' }}>
                La busqueda automatica y la impresion directa solo funcionan en la app Android. En el navegador puedes reimprimir tickets desde los pedidos activos.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spinner animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Cerrar sesión */}
      <button onClick={logout} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: 'rgba(239,68,68,0.12)', color: '#EF4444', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20 }}>Cerrar sesión</button>

      {/* Botón guardar cambios flotante */}
      {hayCambios && (
        <div style={{
          position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)',
          width: '100%', padding: '0 20px', zIndex: 40,
          animation: 'fadeIn 0.3s ease',
        }}>
          <button onClick={guardarTodo} disabled={guardando} style={{
            width: '100%', padding: '16px 0', borderRadius: 14, border: 'none',
            background: guardando ? 'var(--c-muted)' : 'var(--c-primary)', color: '#fff',
            fontSize: 15, fontWeight: 800, cursor: guardando ? 'default' : 'pointer',
            fontFamily: 'inherit',
            boxShadow: '0 8px 32px rgba(185,28,28,0.3), 0 4px 12px rgba(0,0,0,0.2)',
          }}>
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {/* Toast confirmación */}
      {guardado && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#16A34A', color: '#fff', padding: '12px 24px', borderRadius: 12,
          fontSize: 13, fontWeight: 700, zIndex: 200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.3s ease',
        }}>
          Cambios guardados correctamente
        </div>
      )}

    </div>
  )
}
