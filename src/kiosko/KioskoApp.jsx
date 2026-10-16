// KIOSKO de autopedido (14 oct 2026) — panel.pidoo.es/kiosko
//
// La pantalla táctil vertical que el cliente usa en el local para pedir PARA LLEVAR.
// Vive con la sesión del restaurante (la misma que el TPV del ordenador), pero es una
// app aparte A PROPÓSITO: NO monta `RestProvider` ni `PedidoAlertProvider`.
//   - Sin `PedidoAlertProvider`: esta pantalla no escucha pedidos ni imprime. Si lo
//     hiciera, al estar en el mismo ordenador que el TPV la comanda saldría dos veces
//     (la deduplicación por localStorage no es atómica entre dos ventanas).
//   - Sin `RestProvider`: ese registra el push del aparato, y la pantalla del cliente
//     no puede ponerse a enseñar avisos de "pedido nuevo" del restaurante.
//
// El pedido lo crea la edge `kiosko-pedido` (precios del servidor, nace en cocina) y
// la comanda la imprime el TPV al ver el INSERT. Ver `docs` en memoria:
// kiosko_modulo_decisiones_14oct2026.

import { useEffect, useMemo, useRef, useState } from 'react'
import './kiosko.css'
import { supabase } from '../lib/supabase'
import { estaAbierto, horarioHoyTexto } from '../lib/horario'
import {
  cargarCarta, precioUnidad, firmaLinea, textoExtras, uuidv4,
  limpiarNota, atajosNota, teclearNota, alternarAtajo,
} from './carta'
import {
  Inicio, Nombre, Carta, Ficha, Resumen, Sugerencia, Pago, Listo, Cerrado, Nota,
  AvisoInactividad, ConfirmarCancelar, Personal, Aviso, Acceso, fotoGrande,
} from './pantallas'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// SOLO EN DESARROLLO: `/kiosko?demo=<id del restaurante>` enseña su carta real sin
// sesión y SIMULA el envío (no llama a la edge, no crea pedidos ni saca comandas).
// Sirve para revisar la pantalla en la vista previa. En el build de producción
// `import.meta.env.DEV` es false y todo este camino desaparece.
const DEMO = import.meta.env.DEV && typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('demo')
  : null
const ANCHO = 1080
const ALTO = 1920

// Decisiones del 14 oct: aviso a los 75 s sin tocar, se borra a los 90 s; la pantalla
// del pedido enviado vuelve sola al inicio a los 15 s.
const AVISO_SEG = 75
const RESET_SEG = 90
const LISTO_SEG = 15
const SLIDE_SEG = 6
const PANTALLAS_CON_PEDIDO = ['nombre', 'carta', 'resumen', 'sugerencia', 'pago']

const ERRORES = {
  kiosko_pausado: 'El kiosko está en pausa ahora mismo. Pide en caja, por favor.',
  kiosko_no_activo: 'El kiosko está en pausa ahora mismo. Pide en caja, por favor.',
  kiosko_no_contratado: 'El kiosko está en pausa ahora mismo. Pide en caja, por favor.',
  cerrado: 'Ahora mismo no aceptamos pedidos aquí. Pregunta en caja.',
  fuera_de_horario: 'Ahora mismo no aceptamos pedidos aquí. Pregunta en caja.',
  restaurante_no_activo: 'Ahora mismo no aceptamos pedidos aquí. Pregunta en caja.',
  no_autorizado: 'El kiosko ha perdido la sesión. Avisa al personal, por favor.',
  forbidden: 'El kiosko ha perdido la sesión. Avisa al personal, por favor.',
}

async function buscarRestaurante(user) {
  // Igual que RestContext: dueño, por correo (cuentas antiguas) o del equipo.
  let { data } = await supabase.from('establecimientos').select('*').eq('user_id', user.id).maybeSingle()
  if (!data && user.email) {
    const res = await supabase.from('establecimientos').select('*').eq('email', user.email).maybeSingle()
    data = res.data
  }
  if (!data) {
    const { data: equipo } = await supabase.from('establecimiento_usuarios')
      .select('establecimiento_id').eq('user_id', user.id).limit(1).maybeSingle()
    if (equipo?.establecimiento_id) {
      const res = await supabase.from('establecimientos').select('*').eq('id', equipo.establecimiento_id).maybeSingle()
      data = res.data
    }
  }
  return data || null
}

export default function KioskoApp() {
  // ── Montaje: sesión, restaurante, módulo, carta ──
  const [fase, setFase] = useState('cargando')
  const [acceso, setAcceso] = useState({ entrando: false, error: null })
  const [est, setEst] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [carta, setCarta] = useState({ categorias: [], productos: [] })
  const cartaAt = useRef(0)

  // ── El pedido en curso ──
  const [pantalla, setPantalla] = useState('inicio')
  const [nombre, setNombre] = useState('')
  const [carrito, setCarrito] = useState([])
  const [catSel, setCatSel] = useState(null)
  const [ficha, setFicha] = useState(null)              // { p, sel }
  const [nota, setNota] = useState(null)                // { destino: 'ficha' | key de la línea, p, texto }
  const [sugeridos, setSugeridos] = useState([])
  const [pago, setPago] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [errorPago, setErrorPago] = useState(null)
  const [hecho, setHecho] = useState(null)              // { codigo, totalC, pago, nombre }
  const idemRef = useRef(null)

  // ── Capas y reloj ──
  const [cancelar, setCancelar] = useState(false)
  const [inactivo, setInactivo] = useState(false)
  const [avisoSeg, setAvisoSeg] = useState(RESET_SEG - AVISO_SEG)
  const [personal, setPersonal] = useState(null)        // { pin, error, desbloqueado, ocupado }
  const [slide, setSlide] = useState(0)
  const [cuenta, setCuenta] = useState(LISTO_SEG)
  const [, setTic] = useState(0)                        // repinta el "¿abierto?" cada minuto
  const ultimoToque = useRef(Date.now())
  const listoHasta = useRef(0)
  const toquesEsquina = useRef([])

  // ── Escala del lienzo de 1080x1920 a la pantalla ──
  const [escala, setEscala] = useState({ s: 1, x: 0, y: 0 })
  useEffect(() => {
    const medir = () => {
      const s = Math.min(window.innerWidth / ANCHO, window.innerHeight / ALTO)
      setEscala({ s, x: (window.innerWidth - ANCHO * s) / 2, y: (window.innerHeight - ALTO * s) / 2 })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])

  // DM Sans solo hace falta aquí: se pide al montar en vez de cargarla en todo el panel.
  useEffect(() => {
    const id = 'kz-fuente-dm'
    if (document.getElementById(id)) return
    const l = document.createElement('link')
    l.id = id
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,500;9..40,700;9..40,800&display=swap'
    document.head.appendChild(l)
    document.title = 'Kiosko · Pidoo'
  }, [])

  async function recargarCarta(estId = est?.id) {
    if (!estId) return
    try {
      const c = await cargarCarta(estId)
      setCarta(c)
      cartaAt.current = Date.now()
    } catch (e) {
      console.warn('[kiosko] carta', e)
    }
  }

  async function arrancar() {
    if (DEMO) {
      const { data: e } = await supabase.from('establecimientos')
        .select('id, nombre, logo_url, horario, estado, abierto_manual').eq('id', DEMO).maybeSingle()
      if (!e) { setFase('sin_restaurante'); return }
      setEst(e)
      setCfg({ activo: true, pausado_por_restaurante: false, pin_personal: '1234' })
      await recargarCarta(e.id)
      setFase('listo')
      return
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setFase('sin_sesion'); return }
    const r = await buscarRestaurante(session.user)
    if (!r) { setFase('sin_restaurante'); return }
    setEst(r)
    const { data: k, error } = await supabase.from('kiosko_config')
      .select('*').eq('establecimiento_id', r.id).maybeSingle()
    if (error) { setFase('error'); return }
    setCfg(k || null)
    if (!k) { setFase('sin_modulo'); return }
    await recargarCarta(r.id)
    setFase('listo')
  }

  async function entrar(email, clave) {
    if (!email || !clave) return
    setAcceso({ entrando: true, error: null })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: clave })
    if (error || !data?.user) {
      setAcceso({ entrando: false, error: 'Correo o contraseña incorrectos.' })
      return
    }
    // Mismo candado que el panel: solo cuentas de restaurante.
    const { data: perfil } = await supabase.from('usuarios').select('rol').eq('id', data.user.id).maybeSingle()
    if (perfil && perfil.rol !== 'restaurante') {
      await supabase.auth.signOut()
      setAcceso({ entrando: false, error: 'Esta cuenta no es de un restaurante.' })
      return
    }
    setAcceso({ entrando: false, error: null })
    setFase('cargando')
    arrancar()
  }

  useEffect(() => {
    arrancar()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') setFase('sin_sesion')
    })
    return () => subscription.unsubscribe()
  }, [])

  // El restaurante y el módulo se releen cada 30 s: el horario, el interruptor del
  // dueño y la pausa se notan solos, sin tocar la pantalla.
  useEffect(() => {
    if (!est?.id || DEMO) return
    const t = setInterval(async () => {
      const [{ data: e }, { data: k }] = await Promise.all([
        supabase.from('establecimientos').select('*').eq('id', est.id).maybeSingle(),
        supabase.from('kiosko_config').select('*').eq('establecimiento_id', est.id).maybeSingle(),
      ])
      if (e) setEst(e)
      if (k !== undefined) setCfg(k || null)
      setTic((n) => n + 1)
    }, 30000)
    return () => clearInterval(t)
  }, [est?.id])

  // ── Lo que se deriva ──
  const productosPorId = useMemo(() => {
    const m = {}
    for (const p of carta.productos) m[p.id] = p
    return m
  }, [carta])

  const lineas = carrito
    .filter((l) => productosPorId[l.productoId])
    .map((l) => {
      const p = productosPorId[l.productoId]
      const unidad = precioUnidad(p, l.sel)
      return { ...l, p, totalC: unidad * l.cant, extras: textoExtras(p, l.sel) }
    })
  const totalC = lineas.reduce((s, l) => s + l.totalC, 0)
  const nItems = lineas.reduce((s, l) => s + l.cant, 0)
  const cantPorProd = {}
  for (const l of lineas) cantPorProd[l.productoId] = (cantPorProd[l.productoId] || 0) + l.cant

  // Fondo: una foto de cada categoría, por turnos, hasta 8, empezando por las
  // hamburguesas. Solo fotos que aguantan la pantalla entera en vertical: las de
  // Unsplash se piden ya recortadas a 1080x1920; las cuadradas pequeñas (combos con
  // círculos de papas y lata, latas sobre fondo blanco) ampliadas así se ven mal, y
  // solo entran si no hay suficientes de las otras. Las bebidas no salen.
  const slides = useMemo(() => {
    const vertical = (p) => /images\.unsplash\.com/.test(p.img)
    const cats = [...carta.categorias]
      .filter((c) => !/bebida|refresco/i.test(c.nombre))
      .sort((a, b) => Number(/hamburg|burger/i.test(b.nombre)) - Number(/hamburg|burger/i.test(a.nombre)))
    const usables = carta.productos.filter((p) => p.ok && p.img)
    const soloVerticales = usables.filter(vertical).length >= 4
    const porCat = cats.map((c) => usables
      .filter((p) => p.categoria_id === c.id && (!soloVerticales || vertical(p)))
      .sort((a, b) => Number(vertical(b)) - Number(vertical(a))))
    const out = []
    for (let i = 0; out.length < 8 && porCat.some((l) => l[i]); i++) {
      for (const l of porCat) {
        if (l[i] && out.length < 8) {
          const c = carta.categorias.find((x) => x.id === l[i].categoria_id)
          out.push({ id: l[i].id, img: fotoGrande(l[i].img), nombre: l[i].nombre, categoria: c?.nombre || '', precioC: l[i].precioC })
        }
      }
    }
    return out
  }, [carta])

  const pausado = !!cfg?.pausado_por_restaurante
  const estadoAbierto = est
    ? (est.horario && typeof est.horario === 'object' && Object.keys(est.horario).length
      ? estaAbierto({ activo: est.abierto_manual !== false, horario: est.horario })
      : { abierto: est.abierto_manual !== false })
    : { abierto: false }
  const abierto = !!est && est.estado === 'activo' && estadoAbierto.abierto
  const turno = estadoAbierto.turnoActual
  const horarioTexto = turno ? `${turno.abre}–${turno.cierra}` : null

  // ── Reloj: fotos, cuenta atrás y aviso de inactividad ──
  const estadoReloj = useRef({})
  estadoReloj.current = { pantalla, enviando, personal, slides, cancelar }
  useEffect(() => {
    let pasos = 0
    const t = setInterval(() => {
      pasos += 1
      const s = estadoReloj.current
      if (pasos % SLIDE_SEG === 0 && s.slides.length > 1) setSlide((x) => (x + 1) % s.slides.length)
      if (s.pantalla === 'listo') {
        const quedan = Math.ceil((listoHasta.current - Date.now()) / 1000)
        if (quedan <= 0) reiniciar()
        else setCuenta(quedan)
        return
      }
      if (PANTALLAS_CON_PEDIDO.includes(s.pantalla) && !s.enviando && !s.personal) {
        const quieto = (Date.now() - ultimoToque.current) / 1000
        if (quieto >= RESET_SEG) { reiniciar(); return }
        if (quieto >= AVISO_SEG) {
          setInactivo(true)
          setAvisoSeg(Math.max(1, Math.ceil(RESET_SEG - quieto)))
        }
      }
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Al volver al inicio, la carta se refresca si tiene más de 3 minutos: lo que se
  // agota o vuelve durante el servicio se ve en el siguiente cliente.
  useEffect(() => {
    if (pantalla === 'inicio' && est?.id && Date.now() - cartaAt.current > 180000) recargarCarta()
  }, [pantalla, est?.id])

  function toque() {
    ultimoToque.current = Date.now()
    if (inactivo) setInactivo(false)
  }

  function reiniciar() {
    ultimoToque.current = Date.now()
    setPantalla('inicio')
    setNombre('')
    setCarrito([])
    setCatSel(null)          // cada cliente empieza por la categoría de siempre
    setFicha(null)
    setNota(null)
    setSugeridos([])
    setPago(null)
    setEnviando(false)
    setErrorPago(null)
    setHecho(null)
    setCancelar(false)
    setInactivo(false)
    setCuenta(LISTO_SEG)
    idemRef.current = null
  }

  // ── Acciones del pedido ──
  function empezar() {
    reiniciar()
    setPantalla('nombre')
  }

  function irACarta() {
    if (nombre.trim().length < 2) return
    if (!catSel || !carta.categorias.some((c) => c.id === catSel)) {
      // Se abre por las hamburguesas si las hay: es lo que viene a pedir casi todo el mundo.
      const conVenta = carta.categorias.filter((c) => carta.productos.some((p) => p.categoria_id === c.id && p.ok))
      const preferida = conVenta.find((c) => /hamburg|burger/i.test(c.nombre)) || conVenta[0] || carta.categorias[0]
      setCatSel(preferida?.id || null)
    }
    setNombre(nombre.trim())
    setPantalla('carta')
  }

  function meter(productoId, sel, cant) {
    const f = firmaLinea(productoId, sel)
    setCarrito((prev) => {
      const i = prev.findIndex((l) => firmaLinea(l.productoId, l.sel) === f)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, cant: Math.min(20, l.cant + cant) } : l))
      return [...prev, { key: uuidv4(), productoId, sel, cant }]
    })
  }

  function tocarProducto(p) {
    if (!p.ok) return
    if (!p.grupos.length && !p.tamanos.length) {
      meter(p.id, { tamanoId: null, ops: {} }, 1)
      return
    }
    setFicha({ p, sel: { tamanoId: null, ops: {}, nota: '', cant: 1 } })
  }

  function pulsarOpcion(g, opcionId) {
    setFicha((f) => {
      const actual = f.sel.ops[g.id] || []
      let nuevo
      if (g.unico) nuevo = [opcionId]
      else if (actual.includes(opcionId)) nuevo = actual.filter((x) => x !== opcionId)
      else if (actual.length >= g.max) return f
      else nuevo = [...actual, opcionId]
      return { ...f, sel: { ...f.sel, ops: { ...f.sel.ops, [g.id]: nuevo } } }
    })
  }

  // ── Nota de una línea para la cocina ──
  const nombreCategoria = (p) => carta.categorias.find((c) => c.id === p.categoria_id)?.nombre || ''

  function abrirNotaLinea(key) {
    const l = lineas.find((x) => x.key === key)
    if (l) setNota({ destino: key, p: l.p, texto: l.sel.nota || '' })
  }

  function guardarNota(texto) {
    const t = limpiarNota(texto)
    if (nota?.destino === 'ficha') setFicha((f) => (f ? { ...f, sel: { ...f.sel, nota: t } } : f))
    else if (nota) setCarrito((prev) => prev.map((l) => (l.key === nota.destino ? { ...l, sel: { ...l.sel, nota: t } } : l)))
    setNota(null)
  }

  function anadirFicha() {
    const { p, sel } = ficha
    meter(p.id, { tamanoId: sel.tamanoId, ops: sel.ops, nota: limpiarNota(sel.nota) }, sel.cant)
    setFicha(null)
  }

  function cambiarLinea(key, d) {
    const nuevo = carrito
      .map((l) => (l.key === key ? { ...l, cant: Math.min(20, l.cant + d) } : l))
      .filter((l) => l.cant > 0)
    setCarrito(nuevo)
    // Sin nada que revisar, de vuelta a la carta.
    if (!nuevo.length && pantalla === 'resumen') setPantalla('carta')
  }

  // Antes de pagar: papas, bebidas o postres que se puedan añadir de un toque
  // (sin elección obligatoria) y que no estén ya en el pedido. Hasta 4.
  function continuarResumen() {
    const dentro = new Set(carrito.map((l) => l.productoId))
    const rango = (catNombre) => (/papa|patata|frita/i.test(catNombre) ? 0
      : /bebida|refresco/i.test(catNombre) ? 1 : /postre|dulce/i.test(catNombre) ? 2 : -1)
    const candidatos = carta.productos
      .map((p) => ({ p, r: rango(carta.categorias.find((c) => c.id === p.categoria_id)?.nombre || '') }))
      .filter(({ p, r }) => r >= 0 && p.ok && !dentro.has(p.id) && !p.tamanos.length && !p.grupos.some((g) => g.unico))
    const elegidos = [
      ...candidatos.filter((x) => x.r === 0).slice(0, 2),
      ...candidatos.filter((x) => x.r > 0),
    ].slice(0, 4).map((x) => x.p)
    if (elegidos.length) {
      setSugeridos(elegidos)
      setPantalla('sugerencia')
    } else {
      irAPago()
    }
  }

  const deUnToque = (l) => !l.sel.tamanoId && !Object.keys(l.sel.ops).length && !l.sel.nota
  const anadidos = new Set(carrito.filter(deUnToque).map((l) => l.productoId))

  function alternarSugerido(p) {
    if (anadidos.has(p.id)) {
      setCarrito((prev) => prev.filter((l) => !(l.productoId === p.id && deUnToque(l))))
    } else {
      meter(p.id, { tamanoId: null, ops: {} }, 1)
    }
  }

  function irAPago() {
    // Una clave por visita a la pantalla de pago: los reintentos de "Confirmar"
    // mandan la MISMA y el servidor devuelve el pedido ya hecho en vez de otro.
    idemRef.current = uuidv4()
    setErrorPago(null)
    setPantalla('pago')
  }

  async function confirmar() {
    if (!pago || enviando || !lineas.length) return
    setEnviando(true)
    setErrorPago(null)
    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), 25000)
    try {
      if (DEMO) {
        await new Promise((r) => setTimeout(r, 700))
        setHecho({ codigo: 'PD-DEMO01', totalC, pago, nombre: nombre.trim() })
        listoHasta.current = Date.now() + LISTO_SEG * 1000
        setCuenta(LISTO_SEG)
        setPantalla('listo')
        return
      }
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/kiosko-pedido`, {
        method: 'POST',
        signal: corte.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          establecimiento_id: est.id,
          nombre: nombre.trim(),
          metodo_pago: pago,
          idempotency_key: idemRef.current,
          lineas: lineas.map((l) => ({
            producto_id: l.productoId,
            tamano_id: l.sel.tamanoId || null,
            cantidad: l.cant,
            extras: Object.values(l.sel.ops).flat(),
            notas: limpiarNota(l.sel.nota) || null,
          })),
        }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || !body?.ok) {
        if (body?.error === 'producto_no_disponible') {
          recargarCarta()
          setErrorPago(`Se acaba de agotar «${body.producto || 'un producto'}». Vuelve a tu pedido y cámbialo.`)
        } else if (body?.error === 'pedido_incompleto') {
          setErrorPago('Falta elegir: ' + (body.detalle || 'una opción') + '.')
        } else {
          setErrorPago(ERRORES[body?.error] || 'No se ha podido enviar el pedido. Vuelve a intentarlo o pide en caja.')
        }
        if (/^kiosko_/.test(body?.error || '')) {
          const { data: k } = await supabase.from('kiosko_config').select('*').eq('establecimiento_id', est.id).maybeSingle()
          setCfg(k || null)
        }
        return
      }
      setHecho({
        codigo: body.pedido.codigo,
        totalC: Math.round(Number(body.pedido.total || 0) * 100),
        pago,
        nombre: nombre.trim(),
      })
      listoHasta.current = Date.now() + LISTO_SEG * 1000
      setCuenta(LISTO_SEG)
      setPantalla('listo')
    } catch (err) {
      setErrorPago(err?.name === 'AbortError'
        ? 'El servidor no responde. Vuelve a pulsar Confirmar: tu pedido no se duplicará.'
        : 'No hay conexión. Vuelve a pulsar Confirmar: tu pedido no se duplicará.')
    } finally {
      clearTimeout(reloj)
      setEnviando(false)
    }
  }

  // ── Personal: 5 toques en la esquina de arriba a la derecha + PIN ──
  function tocarEsquina() {
    const ahora = Date.now()
    toquesEsquina.current = toquesEsquina.current.filter((t) => ahora - t < 3000)
    toquesEsquina.current.push(ahora)
    if (toquesEsquina.current.length >= 5) {
      toquesEsquina.current = []
      setInactivo(false)
      setPersonal({ pin: '', error: false, desbloqueado: false, ocupado: false })
    }
  }

  function teclaPin(d) {
    setPersonal((s) => {
      if (!s || s.pin.length >= 4) return s
      const pin = s.pin + d
      if (pin.length < 4) return { ...s, pin, error: false }
      return pin === String(cfg?.pin_personal || '')
        ? { ...s, pin, desbloqueado: true, error: false }
        : { ...s, pin: '', error: true }
    })
  }

  async function alternarPausa() {
    if (!cfg || personal?.ocupado) return
    if (DEMO) { setCfg({ ...cfg, pausado_por_restaurante: !cfg.pausado_por_restaurante }); reiniciar(); return }
    setPersonal((s) => ({ ...s, ocupado: true }))
    // `.select()`: si la RLS no deja, el UPDATE afecta 0 filas SIN error, y esta
    // pantalla no puede decir "pausado" sin haberlo hecho.
    const { data, error } = await supabase.from('kiosko_config')
      .update({ pausado_por_restaurante: !cfg.pausado_por_restaurante })
      .eq('establecimiento_id', est.id).select('*')
    if (!error && data?.length) {
      setCfg(data[0])
      reiniciar()
    }
    setPersonal((s) => ({ ...s, ocupado: false }))
  }

  // ── Pintar ──
  const estilo = { transform: `translate(${escala.x}px, ${escala.y}px) scale(${escala.s})` }

  let contenido = null
  if (fase === 'cargando') {
    contenido = <Aviso tituloTxt="Cargando el kiosko…" />
  } else if (fase === 'sin_sesion') {
    contenido = <Acceso entrando={acceso.entrando} error={acceso.error} onEntrar={entrar} />
  } else if (fase === 'sin_restaurante') {
    contenido = <Aviso tituloTxt="Esta cuenta no tiene restaurante" texto="Entra con la cuenta del restaurante que va a usar el kiosko." />
  } else if (fase === 'sin_modulo' || (fase === 'listo' && !cfg?.activo)) {
    contenido = <Aviso tituloTxt="El kiosko no está activado" texto="Habla con Pidoo para activarlo en tu restaurante." />
  } else if (fase === 'error') {
    contenido = <Aviso tituloTxt="No se ha podido cargar el kiosko" texto="Revisa la conexión a internet." accion="Reintentar" onAccion={() => window.location.reload()} />
  } else if (pantalla === 'inicio' && (pausado || !abierto)) {
    contenido = (
      <Cerrado est={est} slides={slides} slide={slide}
        tituloTxt={pausado ? 'Kiosko en pausa' : 'Ahora estamos cerrados'}
        sub={pausado ? 'Puedes pedir en caja. Enseguida te atendemos.' : (estadoAbierto.proximaApertura || null)}
        horarioHoy={pausado ? null : horarioHoyTexto(est.horario)} />
    )
  } else {
    contenido = (
      <>
        {pantalla === 'inicio' && <Inicio est={est} slides={slides} slide={slide} horarioTexto={horarioTexto} onEmpezar={empezar} />}
        {pantalla === 'nombre' && (
          <Nombre nombre={nombre}
            onTecla={(k) => setNombre((n) => ((k === ' ' && (!n || n.endsWith(' '))) ? n : (n + k).slice(0, 14)))}
            onBorrar={() => setNombre((n) => n.slice(0, -1))}
            onVolver={reiniciar} onContinuar={irACarta} />
        )}
        {pantalla === 'carta' && (
          <Carta est={est} nombre={nombre} categorias={carta.categorias} catSel={catSel} onCat={setCatSel}
            productos={carta.productos} cantPorProd={cantPorProd} onTocar={tocarProducto}
            onCancelar={() => (carrito.length ? setCancelar(true) : reiniciar())}
            totalC={totalC} nItems={nItems} onVerPedido={() => nItems && setPantalla('resumen')} />
        )}
        {pantalla === 'resumen' && (
          <Resumen lineas={lineas} nombre={nombre} totalC={totalC} nItems={nItems}
            onMas={(k) => cambiarLinea(k, 1)} onMenos={(k) => cambiarLinea(k, -1)}
            onSeguir={() => setPantalla('carta')} onContinuar={continuarResumen} onNota={abrirNotaLinea} />
        )}
        {pantalla === 'sugerencia' && (
          <Sugerencia sugeridos={sugeridos} anadidos={anadidos} nombre={nombre} totalC={totalC}
            onToggle={alternarSugerido} onVolver={() => setPantalla('resumen')} onContinuar={irAPago} />
        )}
        {pantalla === 'pago' && (
          <Pago pago={pago} onPago={setPago} nombre={nombre} totalC={totalC} nItems={nItems}
            enviando={enviando} error={errorPago}
            onVolver={() => setPantalla('resumen')} onConfirmar={confirmar} />
        )}
        {pantalla === 'listo' && hecho && (
          <Listo codigo={hecho.codigo} nombre={hecho.nombre} pago={hecho.pago} totalC={hecho.totalC}
            cuenta={cuenta} onTerminar={reiniciar} />
        )}

        {ficha && (
          <Ficha p={ficha.p} sel={ficha.sel}
            onTamano={(id) => setFicha((f) => ({ ...f, sel: { ...f.sel, tamanoId: id } }))}
            onOp={pulsarOpcion}
            onMas={() => setFicha((f) => ({ ...f, sel: { ...f.sel, cant: Math.min(20, f.sel.cant + 1) } }))}
            onMenos={() => setFicha((f) => ({ ...f, sel: { ...f.sel, cant: Math.max(1, f.sel.cant - 1) } }))}
            onAnadir={anadirFicha} onCerrar={() => setFicha(null)}
            onNota={() => setNota({ destino: 'ficha', p: ficha.p, texto: ficha.sel.nota || '' })} />
        )}
        {nota && (
          <Nota producto={nota.p.nombre} texto={nota.texto} atajos={atajosNota(nombreCategoria(nota.p))}
            onTecla={(k) => setNota((n) => ({ ...n, texto: teclearNota(n.texto, k) }))}
            onBorrar={() => setNota((n) => ({ ...n, texto: n.texto.slice(0, -1) }))}
            onAtajo={(a) => setNota((n) => ({ ...n, texto: alternarAtajo(n.texto, a) }))}
            onQuitar={() => guardarNota('')} onGuardar={() => guardarNota(nota.texto)}
            onCerrar={() => setNota(null)} />
        )}
        {cancelar && <ConfirmarCancelar onNo={() => setCancelar(false)} onSi={reiniciar} />}
        {inactivo && !personal && (
          <AvisoInactividad segundos={avisoSeg} de={RESET_SEG - AVISO_SEG}
            onSeguir={() => { ultimoToque.current = Date.now(); setInactivo(false) }} onReiniciar={reiniciar} />
        )}
      </>
    )
  }

  return (
    <div className="kz-raiz" onPointerDown={toque}>
      <div className="kz-lienzo" style={estilo}>
        {contenido}
        {fase === 'listo' && cfg?.activo && (
          <>
            <button onClick={tocarEsquina} aria-label="Acceso del personal" style={{
              position: 'absolute', top: 0, right: 0, zIndex: 50, width: 180, height: 40,
              padding: 0, border: 0, background: 'transparent', cursor: 'default',
            }} />
            {personal && (
              <Personal pin={personal.pin} error={personal.error} desbloqueado={personal.desbloqueado}
                pausado={pausado} ocupado={personal.ocupado}
                onTecla={teclaPin} onBorrar={() => setPersonal((s) => ({ ...s, pin: s.pin.slice(0, -1), error: false }))}
                onCancelar={() => setPersonal(null)} onAlternarPausa={alternarPausa}
                onRecargar={() => { recargarCarta(); setPersonal(null) }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
