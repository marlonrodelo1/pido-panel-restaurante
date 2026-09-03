import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Printer, Wifi, LogOut, AlertTriangle, Globe, Image as IconoImagen, RefreshCw, Plus, Pencil, Trash2, Usb } from 'lucide-react'
import { useRest } from '../context/RestContext'
import { supabase } from '../lib/supabase'
import { colors, type, ds, radius } from '../lib/uiStyles'
import {
  getPrinterConfig, savePrinterConfig,
  scanPrinters, connectAndTestPrinter, disconnectPrinter, hayImpresoraNativa, esEscritorio,
  probarImpresoraCocina, listarImpresorasUsb, intercambiarImpresoras,
  cargarImpresoras, invalidarImpresoras, probarImpresoraNube,
} from '../lib/printService'
import { invalidarDestinos } from '../lib/destinosImpresion'
import { confirmar, toast } from '../App'
import ImpresoraUsb from '../components/ImpresoraUsb'
import { bytesDelLogo, previsualizar, olvidarLogo } from '../lib/logoTicket'

export default function ConfigImpresora() {
  const { restaurante, updateRestaurante, logout, tpvActivo } = useRest()
  const [activo, setActivo] = useState(restaurante?.activo ?? true)

  const [printerIp, setPrinterIp] = useState('')
  const [printerPort, setPrinterPort] = useState(9100)
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [foundPrinters, setFoundPrinters] = useState([])
  const [scanDone, setScanDone] = useState(false)
  const [connecting, setConnecting] = useState(null)
  const [connectResult, setConnectResult] = useState(null)
  const [manualIp, setManualIp] = useState('')
  const [ticketCount, setTicketCount] = useState(2)
  // 'red' = socket TCP al 9100 · 'usb' = impresora enchufada a este ordenador.
  const [modo, setModo] = useState('red')
  // Con el módulo TPV la gestión vive en la NUBE (GestorImpresoras) y la
  // configuración clásica de este aparato queda plegada como respaldo.
  const [mostrarClasica, setMostrarClasica] = useState(false)

  // Vista previa del logo del ticket.
  const [logoPrevia, setLogoPrevia] = useState(null)
  // Los BYTES, no solo la imagen: son los que se mandan al pulsar Probar, para que la
  // prueba recorra el mismo camino que un ticket de verdad.
  const [logoBytes, setLogoBytes] = useState(null)
  const [logoCargando, setLogoCargando] = useState(false)
  const [logoIntento, setLogoIntento] = useState(0)

  useEffect(() => {
    const cfg = getPrinterConfig()
    setPrinterIp(cfg.ip || '')
    setPrinterPort(cfg.port || 9100)
    setPrinterEnabled(cfg.enabled || false)
    setTicketCount(cfg.tickets ?? 2)
    setModo(cfg.modo || 'red')
  }, [])

  // Cambiar de camino NO borra lo del otro: si alguien prueba el USB y no le va, al
  // volver a Red se encuentra su IP donde la dejó.
  function cambiarModo(nuevo) {
    setModo(nuevo)
    savePrinterConfig({ ...getPrinterConfig(), modo: nuevo })
  }

  // INTERCAMBIAR los papeles de las dos impresoras (caja ↔ cocina) en un toque:
  // montar el local al revés es un clásico, y re-teclear IPs para arreglarlo, no.
  // Tras el cruce se refrescan los estados de ESTA tarjeta y se remonta la de
  // cocina (via `versionSwap`) para que las dos enseñen la verdad nueva.
  const [versionSwap, setVersionSwap] = useState(0)
  async function manejarIntercambio() {
    const seguro = await confirmar('¿Intercambiar las impresoras? La de CAJA pasará a imprimir las comandas de cocina, y la de COCINA imprimirá los tickets, el cajón y los cierres.')
    if (!seguro) return
    const cfg = intercambiarImpresoras()
    setPrinterIp(cfg.ip || '')
    setPrinterPort(cfg.port || 9100)
    setPrinterEnabled(cfg.enabled || false)
    setModo(cfg.modo || 'red')
    setVersionSwap((v) => v + 1)
    toast('Impresoras intercambiadas: comprueba las dos con sus botones de Probar', 'success')
  }

  async function toggleActivo() {
    const nuevo = !activo
    setActivo(nuevo)
    await updateRestaurante({ activo: nuevo })
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
    const result = await connectAndTestPrinter(ip, port, logoBytes)
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

  async function abrirPanelWeb() {
    try {
      await Browser.open({ url: 'https://panel.pidoo.es' })
    } catch {
      window.open('https://panel.pidoo.es', '_blank')
    }
  }

  async function handleRetest() {
    if (!printerIp) return
    setConnecting(printerIp)
    setConnectResult(null)
    const result = await connectAndTestPrinter(printerIp, printerPort, logoBytes)
    setConnecting(null)
    setConnectResult({ ip: printerIp, ok: result.ok })
    setTimeout(() => setConnectResult(null), 5000)
  }

  const inp = {
    ...ds.input,
    height: 42,
    fontSize: type.sm,
  }

  // La vista previa del logo del ticket. Se prepara sola al abrir la pantalla: es la
  // MISMA conversion que usa la impresion, asi que de paso deja el logo ya guardado y
  // el primer cobro no tiene que esperar por ella.
  // Todos los cambios de estado van DENTRO de la funcion asincrona, no sueltos en el
  // cuerpo del efecto: es el patron de la casa y lo que pide `react-hooks`.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const url = restaurante?.logo_url
      if (!url) { if (vivo) { setLogoPrevia(null); setLogoCargando(false) } return }
      setLogoCargando(true)
      const bytes = await bytesDelLogo(url)
      if (!vivo) return
      setLogoBytes(bytes || null)
      setLogoPrevia(bytes ? previsualizar(bytes) : null)
      setLogoCargando(false)
    })()
    return () => { vivo = false }
  }, [restaurante?.logo_url, logoIntento])

  return (
    <div>
      <h2 style={{ ...ds.h1, margin: '0 0 6px' }}>Configuración</h2>
      <p style={{ fontSize: type.xs, color: colors.stone, marginBottom: 20 }}>
        Estado del local, impresora y sesión.
      </p>

      {/* Estado abierto/cerrado — card sageSoft/dangerSoft grande */}
      <div style={{
        background: activo ? colors.sageSoft : colors.dangerSoft,
        borderRadius: 14, padding: '16px 18px', marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: type.xxs, fontWeight: 700,
            color: activo ? colors.sage2 : colors.danger,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Estado
          </div>
          <div style={{
            fontSize: type.lg, fontWeight: 700,
            color: colors.ink, marginTop: 4,
            letterSpacing: '-0.01em',
          }}>
            {activo ? 'Abierto · aceptando pedidos' : 'Cerrado'}
          </div>
          <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 4 }}>
            {activo ? 'Los clientes pueden hacer pedidos ahora.' : 'No se reciben pedidos.'}
          </div>
        </div>
        {/* Toggle grande estilo bundle 56×32 */}
        <button
          onClick={toggleActivo}
          aria-label={activo ? 'Cerrar restaurante' : 'Abrir restaurante'}
          style={{
            width: 56, height: 32, borderRadius: 16, border: 'none',
            background: activo ? colors.sage : colors.stone2,
            cursor: 'pointer', position: 'relative',
            transition: 'background 0.2s',
            minHeight: 44, minWidth: 56,
            display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: activo ? 27 : 3,
            width: 26, height: 26, borderRadius: 13,
            background: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(26,24,21,0.25)',
          }} />
        </button>
      </div>

      {/* Impresora térmica */}
      <div style={{
        background: colors.paper,
        borderRadius: 14,
        padding: 18,
        border: `1px solid ${colors.border}`,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: colors.cream2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: colors.stone, flexShrink: 0,
          }}>
            <Printer size={22} strokeWidth={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ ...ds.h2, margin: 0 }}>{tpvActivo ? 'Impresoras' : 'Impresora de caja'}</h3>
            <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
              {tpvActivo
                ? 'Las de todo el local, con su nombre. Una es la de CAJA: tickets, cajón, informes y cierres.'
                : 'La principal (80mm): tickets del cliente, cajón, informes y cierres. Sin segunda impresora, también las comandas.'}
            </div>
          </div>
        </div>

        {/* Con el módulo TPV, las impresoras se gestionan EN LA NUBE: se dan de
            alta UNA VEZ y valen para todos los aparatos del local. La
            configuración clásica de este aparato queda debajo, plegada, como
            respaldo (y para poder importarla). */}
        {tpvActivo && <GestorImpresoras />}

        {tpvActivo && !mostrarClasica && (
          <button
            onClick={() => setMostrarClasica(true)}
            style={{ ...ds.ghostBtn, marginTop: 14, width: '100%', justifyContent: 'center' }}
          >
            Configuración clásica de este aparato (respaldo)…
          </button>
        )}
        {(!tpvActivo || mostrarClasica) && (<>

        {/* POR DONDE SALE EL TICKET. Solo en la app de Windows: en la tablet la
            impresora va por red, y en un navegador no hay ninguna de las dos. */}
        {esEscritorio && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {[
              { id: 'red', txt: 'Por red (IP)', nota: 'La impresora cuelga del router' },
              { id: 'usb', txt: 'Por USB', nota: 'Enchufada a este ordenador' },
            ].map((o) => {
              const activa = modo === o.id
              return (
                <button key={o.id} onClick={() => cambiarModo(o.id)} style={{
                  flex: 1, padding: '10px 12px', borderRadius: radius.sm, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  border: `1px solid ${activa ? colors.ink : colors.border}`,
                  background: activa ? colors.cream2 : 'transparent',
                }}>
                  <div style={{ fontSize: type.sm, fontWeight: activa ? 700 : 500, color: colors.ink }}>
                    {o.txt}
                  </div>
                  <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>{o.nota}</div>
                </button>
              )
            })}
          </div>
        )}

        {modo === 'usb' ? (
          <ImpresoraUsb logoBytes={logoBytes} />
        ) : printerEnabled && printerIp ? (
          /* CONECTADA — card sageSoft con punto verde glow */
          <div>
            <div style={{
              background: colors.sageSoft,
              borderRadius: 12,
              padding: '14px 16px',
              marginTop: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {/* Punto verde con glow estilo bundle */}
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: colors.sage,
                  boxShadow: `0 0 10px ${colors.sage}, 0 0 4px ${colors.sage}`,
                  flexShrink: 0,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: colors.ink, fontSize: type.sm }}>
                    Conectada
                  </div>
                  <div style={{
                    fontFamily: type.mono, fontSize: type.xxs,
                    color: colors.stone, marginTop: 2,
                  }}>
                    {printerIp}:{printerPort}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={handleRetest}
                disabled={connecting === printerIp}
                style={{
                  ...ds.secondaryBtn,
                  flex: 1, height: 40,
                  cursor: connecting === printerIp ? 'not-allowed' : 'pointer',
                  opacity: connecting === printerIp ? 0.6 : 1,
                }}
              >
                <Printer size={14} strokeWidth={2.2} />
                {connecting === printerIp ? 'Probando…' : 'Probar'}
              </button>
              <button
                onClick={handleDisconnect}
                style={{
                  flex: 1, height: 40, padding: '0 14px',
                  borderRadius: 8,
                  border: `1px solid ${colors.dangerSoft}`,
                  background: colors.dangerSoft,
                  color: colors.danger,
                  fontSize: type.sm, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                Desconectar
              </button>
            </div>

            {connectResult && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? colors.sageSoft : colors.dangerSoft,
                color: connectResult.ok ? colors.sage2 : colors.danger,
                fontSize: type.xs, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok
                  ? 'Ticket de prueba enviado correctamente.'
                  : 'Error al imprimir. Verifica que la impresora esté encendida.'}
              </div>
            )}

            {/* Tickets */}
            <div style={{
              marginTop: 14,
              padding: '14px 16px',
              background: colors.cream2,
              borderRadius: 12,
            }}>
              <div style={{ ...ds.label, marginBottom: 10 }}>
                ¿Qué imprimir en cada pedido?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { v: 2, label: 'Comanda + Cliente' },
                  { v: 1, label: 'Solo comanda' },
                ].map(opt => {
                  const active = ticketCount === opt.v
                  return (
                    <button
                      key={opt.v}
                      onClick={() => {
                        setTicketCount(opt.v)
                        const cfg = getPrinterConfig()
                        savePrinterConfig({ ...cfg, tickets: opt.v })
                      }}
                      style={{
                        flex: 1, padding: '10px 8px', borderRadius: 10,
                        border: active ? 'none' : `1px solid ${colors.border}`,
                        background: active
                          ? `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)`
                          : colors.paper,
                        color: active ? colors.cream : colors.ink,
                        fontSize: type.sm, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit', minHeight: 44,
                        boxShadow: active ? colors.shadowGlossy : 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 8 }}>
                {ticketCount === 2
                  ? 'Se imprimirán 2 tickets: comanda para cocina + ticket para cliente.'
                  : 'Se imprimirá solo la comanda para cocina.'}
              </div>
            </div>

            {/* La segunda impresora es una pieza del MODULO TPV: sin el modulo
                contratado, esta seccion no existe. Los restaurantes que solo
                reciben pedidos de Pidoo siguen viendo su pantalla de impresora
                EXACTAMENTE como siempre. La `key` remonta la seccion tras un
                intercambio de papeles, para que relea la config cruzada. */}
            {tpvActivo && <SeccionCocina key={versionSwap} onIntercambiar={manejarIntercambio} />}

          </div>
        ) : (
          /* DESCONECTADA */
          <div style={{ marginTop: 14 }}>
            <button
              onClick={handleScan}
              disabled={scanning}
              style={{
                ...ds.glossyBtn,
                width: '100%', height: 46,
                cursor: scanning ? 'default' : 'pointer',
                opacity: scanning ? 0.7 : 1,
                marginBottom: 14,
                fontSize: type.base,
              }}
            >
              {scanning ? (
                <>
                  <span style={{
                    display: 'inline-block', width: 14, height: 14,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Buscando impresoras…
                </>
              ) : (
                <>
                  <Wifi size={15} strokeWidth={2.2} />
                  Buscar impresoras en la red
                </>
              )}
            </button>

            {scanning && (
              <div style={{
                textAlign: 'center', padding: 14, color: colors.stone, fontSize: type.xs,
                lineHeight: 1.5,
              }}>
                Escaneando todos los dispositivos de tu red local…<br />Esto puede tardar unos segundos.
              </div>
            )}

            {scanDone && !scanning && foundPrinters.length === 0 && (
              <div style={{
                background: colors.cream2, borderRadius: 12,
                padding: 16, textAlign: 'center', marginBottom: 14,
              }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
                  No se encontraron impresoras
                </div>
                <div style={{ fontSize: type.xs, color: colors.stone, lineHeight: 1.5 }}>
                  Asegúrate de que la impresora esté encendida y conectada a la misma red por cable LAN.
                </div>
              </div>
            )}

            {foundPrinters.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...ds.label, marginBottom: 8 }}>
                  {foundPrinters.length} encontrada{foundPrinters.length > 1 ? 's' : ''}
                </div>
                {foundPrinters.map(p => (
                  <div key={p.ip} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: colors.paper, borderRadius: 12,
                    padding: '12px 14px', marginBottom: 8,
                    border: `1px solid ${colors.border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: colors.cream2, color: colors.stone,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Printer size={18} strokeWidth={2} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: type.sm, color: colors.ink }}>
                          {p.hostname && p.hostname !== p.ip ? p.hostname : 'Impresora térmica'}
                        </div>
                        <div style={{ fontSize: type.xxs, color: colors.stone, fontFamily: type.mono }}>
                          {p.ip}:{p.port || 9100}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnect(p.ip, p.port || 9100)}
                      disabled={connecting === p.ip}
                      style={{
                        padding: '8px 14px', borderRadius: 8, border: 'none',
                        background: connecting === p.ip ? colors.cream2 : colors.sage,
                        color: connecting === p.ip ? colors.stone : '#fff',
                        fontSize: type.xs, fontWeight: 700,
                        cursor: connecting === p.ip ? 'default' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {connecting === p.ip ? 'Conectando…' : 'Conectar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {connectResult && !printerEnabled && (
              <div style={{
                marginBottom: 14, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? colors.sageSoft : colors.dangerSoft,
                color: connectResult.ok ? colors.sage2 : colors.danger,
                fontSize: type.xs, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok
                  ? `Conectada a ${connectResult.ip} - ticket de prueba enviado.`
                  : `No se pudo conectar a ${connectResult.ip}. Verifica que esté encendida.`}
              </div>
            )}

            {/* Separador o conectar manualmente */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: colors.stone2, fontSize: type.xxs, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: colors.border }} />
              o conectar manualmente
              <div style={{ flex: 1, height: 1, background: colors.border }} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={manualIp}
                onChange={e => setManualIp(e.target.value)}
                placeholder="192.168.1.100"
                onKeyDown={e => e.key === 'Enter' && handleManualConnect()}
                style={{ ...inp, flex: 1, fontFamily: type.mono }}
              />
              <button
                onClick={handleManualConnect}
                disabled={!manualIp.trim() || !!connecting}
                style={{
                  padding: '0 18px', height: 42, borderRadius: 8, border: 'none',
                  background: !manualIp.trim() ? colors.cream2 : colors.primary,
                  color: !manualIp.trim() ? colors.stone : '#fff',
                  fontSize: type.sm, fontWeight: 700,
                  cursor: !manualIp.trim() ? 'default' : 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {connecting ? '…' : 'Conectar'}
              </button>
            </div>

            {!hayImpresoraNativa && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: colors.warningSoft, color: '#8B6126',
                fontSize: type.xxs, fontWeight: 600,
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <AlertTriangle size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>La búsqueda automática y la impresión directa funcionan en la app, tanto en Android como en Windows. En el navegador no: no puede abrir una conexión con la impresora.</span>
              </div>
            )}
          </div>
        )}

        </>)}

          {/* EL LOGO DEL TICKET.
              En pantalla el logo se ve en color y con degradados; en el papel son
              puntos negros o nada. Un logo con sombras o poco contraste puede acabar
              en una mancha, y descubrirlo con la impresora echando papel es tarde.
              Esto ensena los MISMOS bits que se van a mandar. */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <IconoImagen size={14} color={colors.stone} strokeWidth={2.2} />
              <span style={{ ...ds.label, marginBottom: 0 }}>Logo del ticket</span>
            </div>

            {!restaurante?.logo_url ? (
              <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 6, lineHeight: 1.5 }}>
                Este restaurante no tiene logo. Súbelo en Ajustes y aparecerá arriba
                del ticket.
              </div>
            ) : logoCargando ? (
              <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 6 }}>Preparándolo…</div>
            ) : !logoPrevia ? (
              <div style={{ fontSize: type.xxs, color: 'var(--c-warning-text, #7A5520)', marginTop: 6, lineHeight: 1.5 }}>
                No se ha podido preparar el logo, así que el ticket saldrá sin él.
                El resto del ticket no cambia.
              </div>
            ) : (
              <>
                <div style={{ fontSize: type.xxs, color: colors.stone, marginBottom: 10, lineHeight: 1.5 }}>
                  Así saldrá impreso, punto por punto.
                </div>
                <div style={{
                  display: 'inline-block', background: '#FFFFFF', padding: 12,
                  borderRadius: radius.sm, border: `1px solid ${colors.border}`,
                }}>
                  <img
                    src={logoPrevia.url}
                    alt="Vista previa del logo tal como se imprimirá"
                    // A tamano real (1 punto = 1 pixel): ampliarlo mentiria sobre lo
                    // que se va a ver en el papel.
                    style={{ display: 'block', width: logoPrevia.ancho, height: logoPrevia.alto, imageRendering: 'pixelated' }}
                  />
                </div>
                <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 8 }}>
                  {logoPrevia.ancho} × {logoPrevia.alto} puntos · {logoPrevia.mm} mm de ancho
                </div>
                <button
                  onClick={() => { olvidarLogo(); setLogoIntento((n) => n + 1) }}
                  style={{ ...ds.ghostBtn, marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={13} strokeWidth={2.2} /> Volver a generarlo
                </button>
                <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 6, lineHeight: 1.5 }}>
                  Solo hace falta si acabas de cambiar el logo en Ajustes.
                </div>
              </>
            )}
          </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Panel web completo (abre el navegador) */}
      <button
        onClick={abrirPanelWeb}
        style={{
          width: '100%', padding: '14px 16px', borderRadius: 12,
          border: `1px solid ${colors.border}`,
          background: colors.paper,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 12, textAlign: 'left',
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: colors.cream2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colors.stone, flexShrink: 0,
        }}>
          <Globe size={20} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: colors.ink, fontSize: type.sm }}>Panel web completo</div>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 2, fontWeight: 500 }}>
            Carta, promociones, finanzas y ajustes en el navegador.
          </div>
        </div>
      </button>

      {/* Cerrar sesión */}
      <button
        onClick={logout}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
          background: colors.dangerSoft, color: colors.danger,
          fontSize: type.sm, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          marginBottom: 20,
        }}
      >
        <LogOut size={15} strokeWidth={2.2} />
        Cerrar sesión
      </button>
    </div>
  )
}

// ── Segunda impresora: LA DE COCINA (opcional) ───────────────────────────────
//
// Solo las COMANDAS salen por ella; el ticket del cliente, los informes y el
// cajón siguen en la principal. Si falla, la comanda cae a la principal sola
// (printService.sendComanda): molesta en barra, pero nunca sin comanda.
function SeccionCocina({ onIntercambiar }) {
  const [c, setC] = useState(() => getPrinterConfig().cocina || {
    activa: false, modo: 'red', ip: '', port: 9100, impresoraUsb: '',
  })
  const [usbLista, setUsbLista] = useState([])
  const [probando, setProbando] = useState(false)
  const [resultado, setResultado] = useState(null)

  function guardarCocina(cambios) {
    const nueva = { ...c, ...cambios }
    setC(nueva)
    setResultado(null)
    savePrinterConfig({ ...getPrinterConfig(), cocina: nueva })
  }

  useEffect(() => {
    if (!c.activa || c.modo !== 'usb' || !esEscritorio) return
    listarImpresorasUsb().then((r) => setUsbLista(r.impresoras || []))
  }, [c.activa, c.modo])

  async function probar() {
    setProbando(true)
    setResultado(null)
    const r = await probarImpresoraCocina(c)
    setResultado(r)
    setProbando(false)
  }

  const destinoListo = c.modo === 'usb' ? !!c.impresoraUsb : !!c.ip

  return (
    <div style={{ marginTop: 14, padding: '14px 16px', background: colors.cream2, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={ds.label}>Segunda impresora para cocina</div>
          <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 4 }}>
            Las comandas salen por ella; el ticket del cliente sigue en la de barra.
            Si no responde, la comanda sale por la principal.
          </div>
        </div>
        <button
          onClick={() => guardarCocina({ activa: !c.activa })}
          role="switch" aria-checked={c.activa}
          style={{
            width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
            background: c.activa ? colors.terracotta : colors.border, position: 'relative',
            flexShrink: 0, transition: 'background 0.15s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: c.activa ? 23 : 3,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }} />
        </button>
      </div>

      {c.activa && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'red', txt: 'Por red (IP)' },
              { id: 'usb', txt: 'Por USB' },
            ].map((o) => {
              const activa = c.modo === o.id
              return (
                <button key={o.id} onClick={() => guardarCocina({ modo: o.id })} style={{
                  flex: 1, padding: '9px 8px', borderRadius: 10,
                  border: activa ? 'none' : `1px solid ${colors.border}`,
                  background: activa ? `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)` : colors.paper,
                  color: activa ? colors.cream : colors.ink,
                  fontSize: type.sm, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 40,
                }}>
                  {o.txt}
                </button>
              )
            })}
          </div>

          {c.modo === 'usb' ? (
            esEscritorio ? (
              <select
                value={c.impresoraUsb}
                onChange={(e) => guardarCocina({ impresoraUsb: e.target.value })}
                style={{ ...ds.input, height: 44 }}
              >
                <option value="">Elige la impresora de cocina…</option>
                {/* 🔴 El canal devuelve `{ nombre, puerto, desconectada }` — la
                    propiedad va EN ESPAÑOL. Buscando `.name` las opciones salían
                    en blanco y el desplegable parecía vacío. */}
                {usbLista.map((n) => {
                  const nombre = typeof n === 'string' ? n : (n?.nombre || n?.name || '')
                  if (!nombre) return null
                  return (
                    <option key={nombre} value={nombre}>
                      {nombre}{n?.puerto ? ` (${n.puerto})` : ''}{n?.desconectada ? ' — sin conexión' : ''}
                    </option>
                  )
                })}
              </select>
            ) : (
              <div style={{ fontSize: type.xxs, color: colors.stone }}>
                El USB solo funciona en la app de Windows: en la tablet usa "Por red".
              </div>
            )
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={c.ip}
                onChange={(e) => guardarCocina({ ip: e.target.value.trim() })}
                placeholder="IP de la impresora de cocina"
                inputMode="decimal"
                style={{ ...ds.input, flex: 1, height: 44 }}
              />
              <input
                value={c.port}
                onChange={(e) => guardarCocina({ port: Number(e.target.value.replace(/\D/g, '')) || 9100 })}
                placeholder="9100"
                inputMode="numeric"
                style={{ ...ds.input, width: 84, height: 44 }}
              />
            </div>
          )}

          <button onClick={probar} disabled={probando || !destinoListo} style={{
            ...ds.glossyBtn, height: 44,
            opacity: (probando || !destinoListo) ? 0.6 : 1,
            cursor: (probando || !destinoListo) ? 'default' : 'pointer',
          }}>
            {probando ? 'Imprimiendo prueba…' : 'Imprimir una comanda de prueba'}
          </button>

          {resultado && (
            <div style={{
              fontSize: type.sm, fontWeight: 700,
              color: resultado.ok ? colors.success || '#4a7c59' : colors.danger || '#B5564A',
            }}>
              {resultado.ok
                ? 'Ha salido la comanda de prueba: cocina lista.'
                : `No respondió${resultado.error ? ': ' + resultado.error : ''}. Revisa la IP o el nombre.`}
            </div>
          )}

          <DestinosCategorias />

          {/* Cruzar los papeles en un toque: la de caja pasa a cocina y al revés,
              cada una con su conexión (red o USB) tal cual la tenía. */}
          {onIntercambiar && destinoListo && (
            <button onClick={onIntercambiar} style={{
              ...ds.glossyBtn, height: 44, background: 'transparent',
              border: `1px solid ${colors.border}`, color: colors.ink, boxShadow: 'none',
            }}>
              ⇄ Intercambiar: esta pasa a CAJA y la de arriba a COCINA
            </button>
          )}

          <div style={{ fontSize: type.xxs, color: colors.stone, lineHeight: 1.5 }}>
            La impresora de arriba es la de <strong>CAJA</strong>: abre el
            cajón e imprime los tickets del cliente, los informes y los cierres.
            Por la de cocina solo salen comandas.
          </div>
        </div>
      )}
    </div>
  )
}

// ── GESTOR DE IMPRESORAS EN LA NUBE (módulo TPV) ─────────────────────────────
//
// Todas las impresoras del local, con su NOMBRE, en `tpv_impresoras`: se dan
// de alta UNA VEZ y valen para todos los aparatos. Una es la de CAJA (tickets
// del cliente, cajón, informes y cierres); por las demás solo salen comandas,
// repartidas por categoría de la carta. Si una no responde, su papel cae a la
// de caja.
function GestorImpresoras() {
  const { restaurante } = useRest()
  const est = restaurante?.id
  const [lista, setLista] = useState(null)       // null = cargando
  const [form, setForm] = useState(null)         // null = cerrado · {} = alta · {id} = edición
  const [usbLista, setUsbLista] = useState(null) // null = sin pedir aún
  const [ocupado, setOcupado] = useState(null)   // id (o 'guardar'/'importar') de la acción en curso
  const [probeRes, setProbeRes] = useState({})   // id -> { ok, error }
  const [tickets, setTickets] = useState(() => getPrinterConfig().tickets ?? 2)

  async function recargar() {
    const l = await cargarImpresoras(est, { fresco: true })
    setLista(l || [])
    invalidarDestinos(est)
  }
  useEffect(() => { if (est) recargar() }, [est]) // eslint-disable-line react-hooks/exhaustive-deps

  // El desplegable de USB solo tiene sentido en la app de Windows, y solo
  // cuando el formulario está en ese modo.
  useEffect(() => {
    if (!form || form.modo !== 'usb' || !esEscritorio) return
    let vivo = true
    listarImpresorasUsb().then((r) => { if (vivo) setUsbLista(r.impresoras || []) })
    return () => { vivo = false }
  }, [form?.modo, !!form]) // eslint-disable-line react-hooks/exhaustive-deps

  function abrirAlta() {
    setForm({ nombre: '', modo: esEscritorio ? 'usb' : 'red', ip: '', puerto: 9100, impresora_usb: '' })
  }
  function abrirEdicion(imp) {
    setForm({
      id: imp.id, nombre: imp.nombre || '', modo: imp.modo || 'red',
      ip: imp.ip || '', puerto: imp.puerto || 9100, impresora_usb: imp.impresora_usb || '',
    })
  }

  async function guardar() {
    const nombre = (form.nombre || '').trim()
    if (!nombre) { toast('Ponle un nombre a la impresora (Caja, Cocina, Barra…)', 'error'); return }
    if (form.modo === 'usb' ? !form.impresora_usb : !(form.ip || '').trim()) {
      toast(form.modo === 'usb' ? 'Elige la impresora USB de la lista' : 'Falta la IP de la impresora', 'error')
      return
    }
    setOcupado('guardar')
    const datos = {
      nombre,
      modo: form.modo === 'usb' ? 'usb' : 'red',
      ip: form.modo === 'usb' ? null : form.ip.trim(),
      puerto: form.modo === 'usb' ? null : (Number(form.puerto) || 9100),
      impresora_usb: form.modo === 'usb' ? form.impresora_usb : null,
    }
    let error
    if (form.id) {
      ({ error } = await supabase.from('tpv_impresoras').update(datos).eq('id', form.id))
    } else {
      // La PRIMERA impresora del local es la de caja automáticamente.
      ({ error } = await supabase.from('tpv_impresoras').insert({
        ...datos, establecimiento_id: est,
        es_caja: !(lista || []).length,
        orden: (lista || []).length,
      }))
    }
    setOcupado(null)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    const eraAlta = !form.id
    setForm(null)
    invalidarImpresoras()
    await recargar()
    toast(eraAlta ? 'Impresora añadida para todo el local' : 'Impresora actualizada', 'success')
  }

  async function hacerDeCaja(imp) {
    if (imp.es_caja) return
    const seguro = await confirmar(`¿Hacer de "${imp.nombre}" la impresora de CAJA? Pasará a imprimir los tickets del cliente, abrir el cajón y sacar los informes y cierres.`)
    if (!seguro) return
    setOcupado(imp.id)
    // Dos pasos por el candado de "una sola caja por local": primero se le
    // quita el papel a la actual y luego se le da a la nueva.
    const { error: e1 } = await supabase.from('tpv_impresoras')
      .update({ es_caja: false }).eq('establecimiento_id', est).eq('es_caja', true)
    const { error: e2 } = e1 ? { error: e1 }
      : await supabase.from('tpv_impresoras').update({ es_caja: true }).eq('id', imp.id)
    setOcupado(null)
    if (e1 || e2) toast('No se pudo cambiar la caja: ' + (e1 || e2).message, 'error')
    invalidarImpresoras()
    await recargar()
  }

  async function borrar(imp) {
    const seguro = await confirmar(`¿Quitar la impresora "${imp.nombre}" de todo el local?`
      + (imp.es_caja && (lista || []).length > 1 ? ' Es la de CAJA: otra pasará a serlo.' : ''))
    if (!seguro) return
    setOcupado(imp.id)
    const { error } = await supabase.from('tpv_impresoras').delete().eq('id', imp.id)
    if (!error && imp.es_caja) {
      const resto = (lista || []).filter((i) => i.id !== imp.id)
      if (resto.length) {
        await supabase.from('tpv_impresoras').update({ es_caja: true }).eq('id', resto[0].id)
      }
    }
    setOcupado(null)
    if (error) { toast('No se pudo quitar: ' + error.message, 'error'); return }
    invalidarImpresoras()
    await recargar()
  }

  async function probar(imp) {
    setOcupado(imp.id)
    setProbeRes((p) => ({ ...p, [imp.id]: null }))
    const r = await probarImpresoraNube(imp)
    setOcupado(null)
    setProbeRes((p) => ({ ...p, [imp.id]: r }))
    setTimeout(() => setProbeRes((p) => ({ ...p, [imp.id]: null })), 6000)
  }

  // Da de alta en la nube lo que este aparato ya tenía configurado a la
  // antigua: la principal como "Caja" y la segunda como "Cocina".
  async function importarDeEsteAparato() {
    const cfg = getPrinterConfig()
    const filas = []
    if (cfg.enabled && (cfg.modo === 'usb' ? cfg.impresoraUsb : cfg.ip)) {
      filas.push({
        establecimiento_id: est, nombre: 'Caja',
        modo: cfg.modo === 'usb' ? 'usb' : 'red',
        ip: cfg.modo === 'usb' ? null : cfg.ip,
        puerto: cfg.modo === 'usb' ? null : (cfg.port || 9100),
        impresora_usb: cfg.modo === 'usb' ? cfg.impresoraUsb : null,
        es_caja: true, orden: 0,
      })
    }
    const co = cfg.cocina
    if (co?.activa && (co.modo === 'usb' ? co.impresoraUsb : co.ip)) {
      filas.push({
        establecimiento_id: est, nombre: 'Cocina',
        modo: co.modo === 'usb' ? 'usb' : 'red',
        ip: co.modo === 'usb' ? null : co.ip,
        puerto: co.modo === 'usb' ? null : (co.port || 9100),
        impresora_usb: co.modo === 'usb' ? co.impresoraUsb : null,
        es_caja: !filas.length, orden: filas.length,
      })
    }
    if (!filas.length) { toast('Este aparato no tiene ninguna impresora configurada que importar', 'error'); return }
    setOcupado('importar')
    const { error } = await supabase.from('tpv_impresoras').insert(filas)
    setOcupado(null)
    if (error) { toast('No se pudo importar: ' + error.message, 'error'); return }
    invalidarImpresoras()
    await recargar()
    toast('Listo: la configuración de este aparato ya vale para todo el local', 'success')
  }

  const btnMini = {
    padding: '7px 10px', borderRadius: 8, border: `1px solid ${colors.border}`,
    background: 'transparent', color: colors.ink, fontSize: type.xs, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit', minHeight: 36,
    display: 'inline-flex', alignItems: 'center', gap: 5,
  }

  if (!est) return null
  if (lista === null) {
    return <div style={{ marginTop: 14, fontSize: type.xs, color: colors.stone }}>Cargando impresoras…</div>
  }

  const legacy = getPrinterConfig()
  const hayLegacy = legacy.enabled && (legacy.modo === 'usb' ? legacy.impresoraUsb : legacy.ip)

  return (
    <div style={{ marginTop: 14 }}>
      {/* Sin ninguna dada de alta: explicación + alta o importación */}
      {!lista.length && (
        <div style={{ background: colors.cream2, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink }}>
            Aún no hay impresoras dadas de alta
          </div>
          <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 4, lineHeight: 1.5 }}>
            Añade las de tu local (una, dos, tres… las que tengas), cada una con su
            nombre. La primera será la de CAJA. Se configuran una sola vez y valen
            para todos los aparatos.
          </div>
          {hayLegacy && (
            <button
              onClick={importarDeEsteAparato}
              disabled={ocupado === 'importar'}
              style={{ ...ds.secondaryBtn, marginTop: 10, width: '100%', height: 42, opacity: ocupado === 'importar' ? 0.6 : 1 }}
            >
              {ocupado === 'importar' ? 'Importando…' : 'Usar la configuración de este aparato'}
            </button>
          )}
        </div>
      )}

      {/* La lista */}
      {lista.map((imp) => {
        const res = probeRes[imp.id]
        const conexion = imp.modo === 'usb'
          ? (imp.impresora_usb || 'USB')
          : `${imp.ip}:${imp.puerto || 9100}`
        return (
          <div key={imp.id} style={{
            background: colors.paper, border: `1px solid ${colors.border}`,
            borderRadius: 12, padding: '10px 12px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: imp.es_caja ? colors.terracotta : colors.cream2,
                color: imp.es_caja ? '#fff' : colors.stone,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {imp.modo === 'usb' ? <Usb size={17} strokeWidth={2.2} /> : <Printer size={17} strokeWidth={2.2} />}
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: type.sm, fontWeight: 700, color: colors.ink }}>{imp.nombre}</span>
                  {imp.es_caja && (
                    <span style={{
                      fontSize: type.xxs, fontWeight: 800, letterSpacing: '0.03em',
                      background: colors.terracotta, color: '#fff',
                      borderRadius: 6, padding: '2px 7px',
                    }}>
                      CAJA
                    </span>
                  )}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.stone, fontFamily: imp.modo === 'usb' ? 'inherit' : type.mono, marginTop: 2 }}>
                  {imp.modo === 'usb' ? 'USB · ' + conexion : conexion}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => probar(imp)} disabled={ocupado === imp.id} style={{ ...btnMini, opacity: ocupado === imp.id ? 0.5 : 1 }}>
                  <Printer size={13} strokeWidth={2.2} />
                  {ocupado === imp.id ? '…' : 'Probar'}
                </button>
                {!imp.es_caja && (
                  <button onClick={() => hacerDeCaja(imp)} disabled={!!ocupado} style={btnMini}>
                    Hacer de caja
                  </button>
                )}
                <button onClick={() => abrirEdicion(imp)} aria-label={'Editar ' + imp.nombre} style={{ ...btnMini, padding: '7px 9px' }}>
                  <Pencil size={13} strokeWidth={2.2} />
                </button>
                <button
                  onClick={() => borrar(imp)}
                  aria-label={'Quitar ' + imp.nombre}
                  style={{ ...btnMini, padding: '7px 9px', border: 'none', background: colors.dangerSoft, color: colors.danger }}
                >
                  <Trash2 size={13} strokeWidth={2.2} />
                </button>
              </div>
            </div>
            {res && (
              <div style={{
                marginTop: 8, fontSize: type.xs, fontWeight: 700,
                color: res.ok ? (colors.success || '#4a7c59') : colors.danger,
              }}>
                {res.ok
                  ? 'Ha salido el papel de prueba.'
                  : 'No respondió' + (res.error ? ': ' + res.error : '. Revisa que esté encendida y en la misma red.')}
              </div>
            )}
          </div>
        )
      })}

      {/* Alta / edición */}
      {form ? (
        <div style={{ background: colors.cream2, borderRadius: 12, padding: '14px 16px', marginTop: 4 }}>
          <div style={{ ...ds.label, marginBottom: 10 }}>
            {form.id ? 'Editar impresora' : 'Nueva impresora'}
          </div>
          <input
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            placeholder="Nombre (Caja, Cocina, Barra, Postres…)"
            maxLength={30}
            style={{ ...ds.input, height: 44, width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {[
              { id: 'red', txt: 'Por red (IP)' },
              ...(esEscritorio ? [{ id: 'usb', txt: 'Por USB (este PC)' }] : []),
            ].map((o) => {
              const activa = form.modo === o.id
              return (
                <button key={o.id} onClick={() => setForm((f) => ({ ...f, modo: o.id }))} style={{
                  flex: 1, padding: '9px 8px', borderRadius: 10,
                  border: activa ? 'none' : `1px solid ${colors.border}`,
                  background: activa ? `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)` : colors.paper,
                  color: activa ? colors.cream : colors.ink,
                  fontSize: type.sm, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 40,
                }}>
                  {o.txt}
                </button>
              )
            })}
          </div>

          {form.modo === 'usb' ? (
            <select
              value={form.impresora_usb}
              onChange={(e) => setForm((f) => ({ ...f, impresora_usb: e.target.value }))}
              style={{ ...ds.input, height: 44, width: '100%', marginTop: 10, boxSizing: 'border-box' }}
            >
              <option value="">{usbLista === null ? 'Buscando impresoras USB…' : 'Elige la impresora…'}</option>
              {(usbLista || []).map((n) => {
                const nombre = typeof n === 'string' ? n : (n?.nombre || n?.name || '')
                if (!nombre) return null
                return (
                  <option key={nombre} value={nombre}>
                    {nombre}{n?.puerto ? ` (${n.puerto})` : ''}{n?.desconectada ? ' — sin conexión' : ''}
                  </option>
                )
              })}
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                value={form.ip}
                onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value.trim() }))}
                placeholder="IP (192.168.1.100)"
                inputMode="decimal"
                style={{ ...ds.input, flex: 1, height: 44, fontFamily: type.mono, minWidth: 0 }}
              />
              <input
                value={form.puerto}
                onChange={(e) => setForm((f) => ({ ...f, puerto: Number(e.target.value.replace(/\D/g, '')) || '' }))}
                placeholder="9100"
                inputMode="numeric"
                style={{ ...ds.input, width: 80, height: 44, fontFamily: type.mono }}
              />
            </div>
          )}

          {form.modo === 'usb' && (
            <div style={{ fontSize: type.xxs, color: colors.stone, marginTop: 8, lineHeight: 1.5 }}>
              Una impresora USB solo imprime desde el aparato que la tiene enchufada.
              Para compartirla entre aparatos, conéctala por red.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={guardar}
              disabled={ocupado === 'guardar'}
              style={{ ...ds.glossyBtn, flex: 1, height: 44, opacity: ocupado === 'guardar' ? 0.6 : 1 }}
            >
              {ocupado === 'guardar' ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Añadir impresora')}
            </button>
            <button onClick={() => setForm(null)} style={{ ...ds.secondaryBtn, height: 44, padding: '0 16px' }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={abrirAlta} style={{ ...ds.secondaryBtn, width: '100%', height: 44, marginTop: 4 }}>
          <Plus size={15} strokeWidth={2.4} />
          Añadir impresora
        </button>
      )}

      {/* Qué imprime cada una, por categoría de la carta */}
      {lista.length >= 2 && <DestinosPorImpresora lista={lista} />}

      {/* Cuántos papeles por pedido (ajuste de ESTE aparato, como siempre) */}
      {lista.length > 0 && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: colors.cream2, borderRadius: 12 }}>
          <div style={{ ...ds.label, marginBottom: 8 }}>¿Qué imprimir en cada pedido?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { v: 2, label: 'Comanda + Cliente' },
              { v: 1, label: 'Solo comanda' },
            ].map((opt) => {
              const active = tickets === opt.v
              return (
                <button
                  key={opt.v}
                  onClick={() => {
                    setTickets(opt.v)
                    savePrinterConfig({ ...getPrinterConfig(), tickets: opt.v })
                  }}
                  style={{
                    flex: 1, padding: '9px 8px', borderRadius: 10,
                    border: active ? 'none' : `1px solid ${colors.border}`,
                    background: active ? `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)` : colors.paper,
                    color: active ? colors.cream : colors.ink,
                    fontSize: type.sm, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 42,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Qué impresora imprime la comanda de cada CATEGORÍA de la carta. Vive en la
// carta (`categorias.impresora_id`), así que vale para todos los aparatos.
// Sin elegir nada, todo sale por la de caja.
function DestinosPorImpresora({ lista }) {
  const { restaurante } = useRest()
  const [cats, setCats] = useState(null)
  const caja = lista.find((i) => i.es_caja) || lista[0]

  useEffect(() => {
    if (!restaurante?.id) return
    supabase.from('categorias')
      .select('id, nombre, impresora_id')
      .eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden')
      .then(({ data }) => setCats(data || []))
  }, [restaurante?.id])

  async function cambiar(id, impresoraId) {
    const antes = cats.find((c) => c.id === id)?.impresora_id ?? null
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, impresora_id: impresoraId || null } : c)))
    // `.select('id')` para distinguir el fallo TRAICIONERO: una RLS que no
    // cubre a esta cuenta hace que el update afecte 0 filas SIN error, y la
    // pantalla enseñaba el cambio que nunca se guardó (pasó con las cuentas
    // de equipo antes de `carta_update_tambien_para_equipo`).
    const { data, error } = await supabase.from('categorias')
      .update({ impresora_id: impresoraId || null }).eq('id', id).select('id')
    if (error || !data?.length) {
      setCats((prev) => prev.map((c) => (c.id === id ? { ...c, impresora_id: antes } : c)))
      toast('No se pudo guardar el destino' + (error ? ': ' + error.message : ' (esta cuenta no puede)'), 'error')
    }
    invalidarDestinos(restaurante.id)
  }

  if (!cats?.length) return null

  const idsValidos = new Set(lista.map((i) => i.id))

  return (
    <div style={{ marginTop: 14, padding: '12px 14px', background: colors.cream2, borderRadius: 12 }}>
      <div style={{ ...ds.label, marginBottom: 4 }}>¿Por dónde sale cada categoría?</div>
      <div style={{ fontSize: type.xxs, color: colors.stone, marginBottom: 10, lineHeight: 1.5 }}>
        Solo las comandas: el ticket del cliente siempre sale por la de caja.
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {cats.map((c) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '8px 10px', borderRadius: 10, background: colors.paper,
            border: `1px solid ${colors.border}`,
          }}>
            <span style={{
              flex: 1, minWidth: 110, fontSize: type.sm, fontWeight: 600, color: colors.ink,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {c.nombre}
            </span>
            <select
              value={idsValidos.has(c.impresora_id) ? c.impresora_id : ''}
              onChange={(e) => cambiar(c.id, e.target.value)}
              style={{ ...ds.input, height: 38, fontSize: type.xs, width: 150, flexShrink: 0 }}
            >
              <option value="">{(caja?.nombre || 'Caja') + ' (caja)'}</option>
              {lista.filter((i) => !i.es_caja).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// Qué categorías de la carta salen por COCINA y cuáles por BARRA (la
// principal). Se guarda en la propia carta (`categorias.impresora_destino`),
// así vale para todos los aparatos del local a la vez. Sin tocar nada, todo
// sale por cocina, que es el comportamiento de siempre.
function DestinosCategorias() {
  const { restaurante } = useRest()
  const [cats, setCats] = useState(null)

  useEffect(() => {
    if (!restaurante?.id) return
    supabase.from('categorias')
      .select('id, nombre, impresora_destino')
      .eq('establecimiento_id', restaurante.id).eq('activa', true).order('orden')
      .then(({ data }) => setCats(data || []))
  }, [restaurante?.id])

  async function cambiar(id, destino) {
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, impresora_destino: destino } : c)))
    await supabase.from('categorias').update({ impresora_destino: destino }).eq('id', id)
  }

  if (!cats) return null
  if (!cats.length) return null

  return (
    <div>
      <div style={{ ...ds.label, marginBottom: 8 }}>
        ¿Qué sale por cada impresora? (solo las comandas)
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {cats.map((c) => {
          const enBarra = c.impresora_destino === 'barra'
          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 10, background: colors.paper,
              border: `1px solid ${colors.border}`,
            }}>
              <span style={{
                flex: 1, minWidth: 0, fontSize: type.sm, fontWeight: 600, color: colors.ink,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.nombre}
              </span>
              {[
                { v: 'cocina', txt: 'Cocina' },
                { v: 'barra', txt: 'Barra' },
              ].map((o) => {
                const activa = (o.v === 'barra') === enBarra
                return (
                  <button key={o.v} onClick={() => cambiar(c.id, o.v)} style={{
                    padding: '7px 12px', borderRadius: 8,
                    border: activa ? 'none' : `1px solid ${colors.border}`,
                    background: activa ? colors.terracotta : 'transparent',
                    color: activa ? '#fff' : colors.stone,
                    fontSize: type.xs, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    flexShrink: 0, minHeight: 36,
                  }}>
                    {o.txt}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
