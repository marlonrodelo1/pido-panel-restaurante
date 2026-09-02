// Elegir la impresora térmica enchufada por USB a ESTE ordenador.
//
// Solo aparece en la app de Windows: en la tablet la impresora va por red, y en un
// navegador no hay forma de hablar con ninguna.
//
// Por qué existe: la térmica del mostrador de Duende Burger cuelga por USB del
// ordenador, no del router. Comprobado escaneando su red el 2 sep 2026 — el puerto
// 9100 de ese equipo está cerrado, así que por el camino de la IP no había nada que
// hacer.
import { useState, useEffect, useCallback } from 'react'
import { Usb, RefreshCw, Printer, AlertTriangle, Check } from 'lucide-react'
import { colors, type, radius } from '../lib/uiStyles'
import { listarImpresorasUsb, probarImpresoraUsb, getPrinterConfig, savePrinterConfig } from '../lib/printService'

export default function ImpresoraUsb({ logoBytes = null }) {
  const [lista, setLista] = useState([])
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [elegida, setElegida] = useState(getPrinterConfig().impresoraUsb || '')
  const [probando, setProbando] = useState(false)
  const [resultado, setResultado] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await listarImpresorasUsb()
    setLista(r.impresoras || [])
    if (r.error) setError(r.error)
    setCargando(false)
  }, [])

  // El efecto no llama a `cargar` directamente: envuelto en una funcion asincrona,
  // el estado se escribe DESPUES del await y no dispara renders en cascada.
  useEffect(() => { (async () => { await cargar() })() }, [cargar])

  function elegir(nombre) {
    setElegida(nombre)
    setResultado(null)
    // Se guarda al elegir, no solo al probar: si alguien cierra la pantalla sin
    // pulsar Probar, la elección no se pierde.
    const cfg = getPrinterConfig()
    savePrinterConfig({ ...cfg, modo: 'usb', impresoraUsb: nombre, enabled: true })
  }

  async function probar() {
    setProbando(true)
    setResultado(null)
    const r = await probarImpresoraUsb(elegida, logoBytes)
    setProbando(false)
    setResultado(r)
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: 10,
      }}>
        <div style={{ fontSize: type.xs, color: colors.stone, minWidth: 0 }}>
          Impresoras instaladas en este ordenador. Elige la térmica del mostrador.
        </div>
        <button onClick={cargar} disabled={cargando} style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          height: 34, padding: '0 12px', borderRadius: radius.sm,
          border: `1px solid ${colors.border}`, background: 'transparent',
          color: colors.ink, fontFamily: 'inherit', fontSize: type.xs, fontWeight: 600,
          cursor: cargando ? 'wait' : 'pointer',
        }}>
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {cargando ? (
        <div style={{ padding: 18, textAlign: 'center', color: colors.stone, fontSize: type.sm }}>
          Buscando impresoras…
        </div>
      ) : error ? (
        <div style={{
          display: 'flex', gap: 8, padding: 12, borderRadius: radius.sm,
          background: colors.dangerSoft, color: colors.ink, fontSize: type.xs,
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      ) : !lista.length ? (
        <div style={{
          padding: 16, borderRadius: radius.sm, background: colors.cream2,
          fontSize: type.xs, color: colors.stone, lineHeight: 1.5,
        }}>
          Windows no ve ninguna impresora instalada. Enchufa la térmica e instala su
          driver; cuando aparezca en «Impresoras y escáneres» de Windows, pulsa Actualizar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lista.map((p) => {
            const activa = p.nombre === elegida
            return (
              <button key={p.nombre} onClick={() => elegir(p.nombre)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '11px 12px', borderRadius: radius.sm, cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit',
                border: `1px solid ${activa ? colors.sage : colors.border}`,
                background: activa ? colors.sageSoft : 'transparent',
              }}>
                <Printer size={16} color={activa ? colors.sage : colors.stone} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: type.sm, fontWeight: activa ? 700 : 500,
                    color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.nombre}</span>
                  <span style={{ display: 'block', fontSize: type.xxs, color: colors.stone, marginTop: 2 }}>
                    {p.puerto || 'sin puerto'}
                    {p.pordefecto ? ' · predeterminada' : ''}
                    {p.desconectada ? ' · DESCONECTADA' : ''}
                  </span>
                </span>
                {activa && <Check size={16} color={colors.sage} style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}

      <button onClick={probar} disabled={!elegida || probando} style={{
        marginTop: 12, width: '100%', height: 46, borderRadius: radius.sm, border: 'none',
        background: elegida ? colors.ink : colors.border,
        color: elegida ? '#fff' : colors.stone,
        fontFamily: 'inherit', fontSize: type.sm, fontWeight: 700,
        cursor: elegida && !probando ? 'pointer' : 'not-allowed',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <Usb size={16} /> {probando ? 'Imprimiendo…' : 'Imprimir una prueba'}
      </button>

      {resultado && (
        <div style={{
          marginTop: 10, padding: 12, borderRadius: radius.sm, fontSize: type.xs,
          lineHeight: 1.5,
          background: resultado.ok ? colors.sageSoft : colors.dangerSoft,
          color: colors.ink,
        }}>
          {resultado.ok
            ? '✅ Enviado a la impresora. Mira si ha salido el papel: si no sale nada, el problema está en la impresora o en su driver, no en la app.'
            : `❌ No se pudo imprimir${resultado.error ? ': ' + resultado.error : ''}. La impresora sigue sin quedar configurada.`}
        </div>
      )}
    </div>
  )
}
