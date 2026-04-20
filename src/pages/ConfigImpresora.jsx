import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useRest } from '../context/RestContext'
import {
  getPrinterConfig, savePrinterConfig,
  scanPrinters, connectAndTestPrinter, disconnectPrinter,
} from '../lib/printService'

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
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.12)', fontSize: 13,
    fontFamily: 'inherit', background: 'rgba(0,0,0,0.06)',
    color: 'var(--c-text)', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 20px' }}>Configuración</h2>

      {/* Estado abierto/cerrado */}
      <div style={{
        background: activo ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        borderRadius: 14, padding: '16px 18px', marginBottom: 20,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: activo ? '#16A34A' : '#DC2626' }}>
            {activo ? 'Abierto' : 'Cerrado'}
          </div>
          <div style={{ fontSize: 12, color: activo ? '#22C55E' : '#DC2626', marginTop: 2 }}>
            {activo ? 'Recibiendo pedidos' : 'No se reciben pedidos'}
          </div>
        </div>
        <button
          onClick={toggleActivo}
          style={{
            width: 52, height: 28, borderRadius: 14, border: 'none',
            background: activo ? '#16A34A' : 'rgba(0,0,0,0.2)',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
            minHeight: 44, minWidth: 52, display: 'flex', alignItems: 'center', padding: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: activo ? 27 : 3,
            width: 22, height: 22, borderRadius: 11,
            background: '#fff', transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>

      {/* Impresora térmica */}
      <div style={{ background: 'var(--c-surface)', borderRadius: 14, padding: 18, border: '1px solid var(--c-border)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🖨️</span>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Impresora de tickets</h3>
        </div>
        <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 16 }}>
          Conecta tu impresora térmica 80mm por red LAN. Al aceptar un pedido se imprimen automáticamente los tickets.
        </p>

        {printerEnabled && printerIp ? (
          /* CONECTADA */
          <div>
            <div style={{ background: 'rgba(34,197,94,0.1)', borderRadius: 12, padding: 16, marginBottom: 14, border: '1px solid rgba(34,197,94,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, background: '#16A34A', boxShadow: '0 0 8px rgba(74,222,128,0.6)' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#16A34A' }}>Conectada</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>🖨️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Impresora térmica</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{printerIp}:{printerPort}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.7)', marginTop: 8 }}>
                Se imprimirá automáticamente al aceptar cada pedido
              </div>
            </div>

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
                {connecting === printerIp ? 'Probando...' : 'Probar impresión'}
              </button>
              <button
                onClick={handleDisconnect}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.08)', color: '#DC2626',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Desconectar
              </button>
            </div>

            {connectResult && (
              <div style={{
                marginTop: 10, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: connectResult.ok ? '#16A34A' : '#DC2626',
                fontSize: 12, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok ? 'Ticket de prueba enviado!' : 'Error al imprimir. Verifica que la impresora esté encendida.'}
              </div>
            )}

            {/* Tickets */}
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
                    background: ticketCount === opt.v ? 'var(--c-primary)' : 'rgba(0,0,0,0.08)',
                    color: ticketCount === opt.v ? '#fff' : 'var(--c-muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44,
                  }}>{opt.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 6 }}>
                {ticketCount === 2
                  ? 'Se imprimirán 2 tickets: comanda para cocina y ticket para el cliente'
                  : 'Se imprimirá solo la comanda para cocina'}
              </div>
            </div>
          </div>
        ) : (
          /* DESCONECTADA */
          <div>
            <button
              onClick={handleScan}
              disabled={scanning}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: scanning ? 'rgba(0,0,0,0.06)' : 'linear-gradient(135deg, var(--c-primary), #D94420)',
                color: '#fff', fontSize: 14, fontWeight: 800,
                cursor: scanning ? 'default' : 'pointer', fontFamily: 'inherit',
                marginBottom: 14, opacity: scanning ? 0.7 : 1,
              }}
            >
              {scanning ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Buscando impresoras...
                </span>
              ) : 'Buscar impresoras en la red'}
            </button>

            {scanning && (
              <div style={{ textAlign: 'center', padding: 16, color: 'var(--c-muted)', fontSize: 12 }}>
                Escaneando todos los dispositivos de tu red local...<br />Esto puede tardar unos segundos.
              </div>
            )}

            {scanDone && !scanning && foundPrinters.length === 0 && (
              <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 16, textAlign: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>🔍</span>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>No se encontraron impresoras</div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>
                  Asegúrate de que la impresora esté encendida y conectada a la misma red por cable LAN.
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
                    background: 'rgba(0,0,0,0.04)', borderRadius: 12, padding: '12px 14px',
                    marginBottom: 8, border: '1px solid var(--c-border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 24 }}>🖨️</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {p.hostname && p.hostname !== p.ip ? p.hostname : 'Impresora térmica'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>{p.ip}:{p.port || 9100}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnect(p.ip, p.port || 9100)}
                      disabled={connecting === p.ip}
                      style={{
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: connecting === p.ip ? 'rgba(0,0,0,0.1)' : '#16A34A',
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

            {connectResult && !printerEnabled && (
              <div style={{
                marginBottom: 14, padding: '10px 14px', borderRadius: 8,
                background: connectResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                color: connectResult.ok ? '#16A34A' : '#DC2626',
                fontSize: 12, fontWeight: 600, textAlign: 'center',
              }}>
                {connectResult.ok
                  ? `Conectada a ${connectResult.ip} - Ticket de prueba enviado!`
                  : `No se pudo conectar a ${connectResult.ip}. Verifica que esté encendida.`}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
              <span style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600 }}>o conectar manualmente</span>
              <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
            </div>

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
                disabled={!manualIp.trim() || !!connecting}
                style={{
                  padding: '12px 18px', borderRadius: 10, border: 'none',
                  background: !manualIp.trim() ? 'rgba(0,0,0,0.06)' : 'var(--c-primary)',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: !manualIp.trim() ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {connecting ? '...' : 'Conectar'}
              </button>
            </div>

            {!Capacitor.isNativePlatform() && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.1)', fontSize: 11, color: '#FBBF24' }}>
                La búsqueda automática y la impresión directa solo funcionan en la app Android.
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Cerrar sesión */}
      <button
        onClick={logout}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
          background: 'rgba(239,68,68,0.12)', color: '#DC2626',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 20,
        }}
      >
        Cerrar sesión
      </button>
    </div>
  )
}
