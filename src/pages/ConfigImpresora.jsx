import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Printer, Wifi, LogOut, AlertTriangle, Globe, Image as IconoImagen, RefreshCw } from 'lucide-react'
import { useRest } from '../context/RestContext'
import { colors, type, ds, radius } from '../lib/uiStyles'
import {
  getPrinterConfig, savePrinterConfig,
  scanPrinters, connectAndTestPrinter, disconnectPrinter, hayImpresoraNativa,
} from '../lib/printService'
import { bytesDelLogo, previsualizar, olvidarLogo } from '../lib/logoTicket'

export default function ConfigImpresora() {
  const { restaurante, updateRestaurante, logout } = useRest()
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

  // Vista previa del logo del ticket.
  const [logoPrevia, setLogoPrevia] = useState(null)
  const [logoCargando, setLogoCargando] = useState(false)
  const [logoIntento, setLogoIntento] = useState(0)

  useEffect(() => {
    const cfg = getPrinterConfig()
    setPrinterIp(cfg.ip || '')
    setPrinterPort(cfg.port || 9100)
    setPrinterEnabled(cfg.enabled || false)
    setTicketCount(cfg.tickets ?? 2)
  }, [])

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
    const result = await connectAndTestPrinter(printerIp, printerPort)
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
            <h3 style={{ ...ds.h2, margin: 0 }}>Impresora térmica</h3>
            <div style={{ fontSize: type.xs, color: colors.stone, marginTop: 2 }}>
              Comandas en cocina y ticket cliente (80mm).
            </div>
          </div>
        </div>

        {printerEnabled && printerIp ? (
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
