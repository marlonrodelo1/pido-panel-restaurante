// Finanzas — cierre de caja del restaurante (solo web).
//
// Responde a "¿cuánto he vendido hoy?" con el mismo criterio con el que Pidoo
// liquida los lunes, para que los números NO se contradigan. Toda la lógica de
// cálculo vive en lib/informeVentas.js y el PDF en lib/informeVentasPdf.js.
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Download, Printer, TrendingUp, Banknote, Receipt, ShoppingBag, AlertCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'
import {
  ESTADOS_VENTA, ESTADOS_NO_VENTA, LABEL_PAGO, LABEL_ORIGEN,
  hoyStr, ayerStr, lunesEstaSemana, primerDiaMes, inicioDe, finDe,
  fechaEfectiva, tituloPeriodo, fmt,
  calcularResumen, agruparProductos, contarUdsPorPedido,
} from '../lib/informeVentas'
import { construirInformeVentasPDF } from '../lib/informeVentasPdf'

const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'custom', label: 'Elegir fechas' },
]

const COLS = 'id, codigo, estado, metodo_pago, modo_entrega, origen_pedido, socio_id, subtotal, coste_envio, propina, descuento, total, promo_titulo, created_at, entregado_at, recogido_at'

export default function Finanzas() {
  const { restaurante } = useRest()

  const [rango, setRango] = useState('hoy')
  const [desde, setDesde] = useState(hoyStr)
  const [hasta, setHasta] = useState(hoyStr)

  const [pedidos, setPedidos] = useState([])
  const [items, setItems] = useState([])
  const [config, setConfig] = useState({ pct: 10, feeTelefonico: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [generando, setGenerando] = useState(false)

  function elegirRango(id) {
    setRango(id)
    if (id === 'hoy') { setDesde(hoyStr()); setHasta(hoyStr()) }
    else if (id === 'ayer') { setDesde(ayerStr()); setHasta(ayerStr()) }
    else if (id === 'semana') { setDesde(lunesEstaSemana()); setHasta(hoyStr()) }
    else if (id === 'mes') { setDesde(primerDiaMes()); setHasta(hoyStr()) }
  }

  // Comisión vigente de la plataforma (tabla de lectura pública)
  useEffect(() => {
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('configuracion_plataforma')
        .select('clave, valor')
        .in('clave', ['comision_pidoo_pct', 'comision_pedido_telefonico_eur'])
      if (cancel || !data) return
      const map = Object.fromEntries(data.map(r => [r.clave, r.valor]))
      setConfig({
        pct: Number(map.comision_pidoo_pct ?? 10) || 0,
        feeTelefonico: Number(map.comision_pedido_telefonico_eur ?? 1) || 0,
      })
    })()
    return () => { cancel = true }
  }, [])

  const cargar = useCallback(async () => {
    if (!restaurante?.id) return
    setLoading(true)
    setError(null)
    try {
      const ini = inicioDe(desde)
      const fin = finDe(hasta)
      if (ini > fin) throw new Error('rango')

      // Filtramos en SQL por created_at (indexado) con margen, y afinamos en JS
      // por la fecha de entrega, que puede caer en el día siguiente.
      const qDesde = new Date(ini); qDesde.setDate(qDesde.getDate() - 3)
      const qHasta = new Date(fin); qHasta.setDate(qHasta.getDate() + 1)

      const { data, error: err } = await supabase
        .from('pedidos')
        .select(COLS)
        .eq('establecimiento_id', restaurante.id)
        .in('estado', [...ESTADOS_VENTA, ...ESTADOS_NO_VENTA])
        .gte('created_at', qDesde.toISOString())
        .lte('created_at', qHasta.toISOString())
        .order('created_at', { ascending: true })
      if (err) throw err

      const dentro = (data || []).filter(p => {
        const f = fechaEfectiva(p)
        return f >= ini && f <= fin
      })
      setPedidos(dentro)

      const idsVenta = dentro.filter(p => ESTADOS_VENTA.includes(p.estado)).map(p => p.id)
      if (idsVenta.length === 0) { setItems([]); setLoading(false); return }

      const lotes = []
      for (let i = 0; i < idsVenta.length; i += 150) lotes.push(idsVenta.slice(i, i + 150))
      const resultados = await Promise.all(lotes.map(lote =>
        supabase
          .from('pedido_items')
          .select('pedido_id, nombre_producto, tamano, cantidad, precio_unitario')
          .in('pedido_id', lote)
      ))
      const fallo = resultados.find(r => r.error)
      if (fallo) throw fallo.error
      setItems(resultados.flatMap(r => r.data || []))
    } catch (e) {
      console.error('[Finanzas] Error:', e)
      setError(e?.message === 'rango'
        ? 'La fecha "desde" es posterior a la fecha "hasta".'
        : 'No se han podido cargar las ventas. Toca para reintentar.')
      setPedidos([])
      setItems([])
    }
    setLoading(false)
  }, [restaurante?.id, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  const resumen = useMemo(() => calcularResumen(pedidos, config), [pedidos, config])
  const productos = useMemo(() => agruparProductos(items), [items])
  const udsPorPedido = useMemo(() => contarUdsPorPedido(items), [items])
  const periodo = useMemo(() => tituloPeriodo(desde, hasta), [desde, hasta])

  async function descargarPDF() {
    if (generando) return
    setGenerando(true)
    try {
      const { doc, filename } = await construirInformeVentasPDF({
        restaurante, resumen, productos, udsPorPedido, config, desde, hasta,
      })
      doc.save(filename)
    } catch (e) {
      console.error('[Finanzas] PDF:', e)
      setError('No se ha podido generar el PDF.')
    }
    setGenerando(false)
  }

  if (!restaurante) return null

  const hayDatos = resumen.nPedidos > 0
  const notaFacturado = [
    `Envíos ${fmt(resumen.envios)}`,
    `Propinas ${fmt(resumen.propinas)}`,
    resumen.descuentos > 0 ? `Descuentos −${fmt(resumen.descuentos)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #finanzas-print, #finanzas-print * { visibility: visible; }
          #finanzas-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        .fin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 10px; }
        .fin-cols { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 900px) { .fin-cols { grid-template-columns: 1fr 1fr; } }
      `}</style>

      <div className="no-print" style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div>
          <h1 style={ds.h1}>Finanzas</h1>
          <p style={{ ...ds.muted, marginTop: 4 }}>
            Lo que has vendido, listo para descargar o imprimir.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => window.print()}
            disabled={!hayDatos}
            style={{ ...ds.secondaryBtn, opacity: hayDatos ? 1 : 0.5, cursor: hayDatos ? 'pointer' : 'not-allowed' }}
          >
            <Printer size={15} /> Imprimir
          </button>
          <button
            onClick={descargarPDF}
            disabled={!hayDatos || generando}
            style={{ ...ds.primaryBtn, opacity: hayDatos && !generando ? 1 : 0.5, cursor: hayDatos && !generando ? 'pointer' : 'not-allowed' }}
          >
            <Download size={15} /> {generando ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </div>

      <div className="no-print" style={{ ...ds.card, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGOS.map(r => {
            const activo = rango === r.id
            return (
              <button
                key={r.id}
                onClick={() => elegirRango(r.id)}
                style={{
                  ...ds.filterBtn,
                  background: activo ? colors.primarySoft : colors.paper,
                  borderColor: activo ? colors.primaryBorder : colors.border,
                  color: activo ? colors.primaryDark : colors.textDim,
                  fontWeight: activo ? 700 : 600,
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        {rango === 'custom' && (
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <div>
              <label style={ds.label}>Desde</label>
              <input type="date" value={desde} max={hasta}
                onChange={e => setDesde(e.target.value)} style={{ ...ds.input, width: 160 }} />
            </div>
            <div>
              <label style={ds.label}>Hasta</label>
              <input type="date" value={hasta} min={desde} max={hoyStr()}
                onChange={e => setHasta(e.target.value)} style={{ ...ds.input, width: 160 }} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div onClick={cargar} style={{
          ...ds.card, marginBottom: 14, cursor: 'pointer',
          background: colors.dangerSoft, borderColor: colors.dangerSoft,
          color: colors.danger, display: 'flex', alignItems: 'center', gap: 8,
          fontSize: type.sm, fontWeight: 600,
        }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ ...ds.card, textAlign: 'center', color: colors.textMute, padding: 34 }}>
          Cargando ventas…
        </div>
      ) : !hayDatos ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 34 }}>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
            Sin ventas en este periodo
          </div>
          <div style={ds.muted}>
            {resumen.perdidos.length > 0
              ? `Hubo ${resumen.perdidos.length} pedido(s) cancelado(s) o fallido(s), que no cuentan como venta.`
              : 'Cuando entregues un pedido, aparecerá aquí.'}
          </div>
        </div>
      ) : (
        <div id="finanzas-print">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.text }}>
              {restaurante.nombre}
            </div>
            <div style={ds.muted}>Informe de ventas · {periodo}</div>
          </div>

          <div className="fin-grid" style={{ marginBottom: 14 }}>
            <Kpi Icon={ShoppingBag} label="Pedidos" valor={String(resumen.nPedidos)}
              nota={`${resumen.nDelivery} a domicilio · ${resumen.nRecogida} recogida`} />
            <Kpi Icon={TrendingUp} label="Comida vendida" valor={fmt(resumen.comida)}
              nota={`Ticket medio ${fmt(resumen.ticketMedio)}`} />
            <Kpi Icon={Receipt} label="Total facturado" valor={fmt(resumen.facturado)}
              nota={notaFacturado} destacado />
            <Kpi Icon={Banknote} label="Comisión Pidoo" valor={fmt(resumen.comision)}
              nota={`Comida menos comisión: ${fmt(resumen.neto)}`} />
          </div>

          <div className="fin-cols" style={{ marginBottom: 14 }}>
            <div style={ds.card}>
              <div style={ds.sectionLabel}>Cómo has cobrado</div>
              {Object.entries(resumen.porPago).map(([k, v]) => (
                <Fila key={k} label={LABEL_PAGO[k] || k}
                  sub={`${v.n} pedido${v.n === 1 ? '' : 's'}`} valor={fmt(v.importe)} />
              ))}
              <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 10, paddingTop: 10 }}>
                <Fila label="Cobrado por Pidoo (tarjeta)" valor={fmt(resumen.cobradoTarjeta)}
                  sub="Te lo transfiere en la liquidación del lunes" />
                <Fila label="Cobrado en mano" valor={fmt(resumen.cobradoEnMano)}
                  sub="Ya lo tienes tú o el repartidor" />
              </div>
            </div>

            <div style={ds.card}>
              <div style={ds.sectionLabel}>De dónde vienen los pedidos</div>
              {Object.entries(resumen.porOrigen).map(([k, v]) => (
                <Fila key={k} label={LABEL_ORIGEN[k] || k}
                  sub={`${v.n} pedido${v.n === 1 ? '' : 's'}`} valor={fmt(v.importe)} />
              ))}
              <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 10, paddingTop: 10 }}>
                <Fila label={`Comisión ${config.pct}% sobre la comida`} valor={fmt(resumen.comisionPct)}
                  sub={`Base ${fmt(resumen.baseComisionable)}`} />
                {resumen.nTelefonicos > 0 && (
                  <Fila label="Pedidos por teléfono" valor={fmt(resumen.comisionTel)}
                    sub={`${resumen.nTelefonicos} × ${fmt(config.feeTelefonico)}`} />
                )}
              </div>
            </div>
          </div>

          {productos.length > 0 && (
            <div style={{ ...ds.table, marginBottom: 14 }}>
              <div style={ds.tableHeader}>
                <span style={{ flex: 1 }}>Producto</span>
                <span style={{ width: 60, textAlign: 'center' }}>Uds.</span>
                <span style={{ width: 90, textAlign: 'right' }}>Importe</span>
              </div>
              {productos.map(p => (
                <div key={p.nombre} style={ds.tableRow}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nombre}
                  </span>
                  <span style={{ width: 60, textAlign: 'center', fontWeight: 700 }}>{p.uds}</span>
                  <span style={{ width: 90, textAlign: 'right' }}>{fmt(p.importe)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ ...ds.table, overflowX: 'auto' }}>
            <div style={{ ...ds.tableHeader, minWidth: 640 }}>
              <span style={{ width: 92 }}>Pedido</span>
              <span style={{ width: 92 }}>Hora</span>
              <span style={{ flex: 1, minWidth: 110 }}>Origen</span>
              <span style={{ width: 96 }}>Pago</span>
              <span style={{ width: 46, textAlign: 'center' }}>Uds.</span>
              <span style={{ width: 74, textAlign: 'right' }}>Comida</span>
              <span style={{ width: 66, textAlign: 'right' }}>Envío</span>
              <span style={{ width: 80, textAlign: 'right' }}>Total</span>
            </div>
            {resumen.ventas.map(p => (
              <div key={p.id} style={{ ...ds.tableRow, minWidth: 640 }}>
                <span style={{ width: 92, fontWeight: 700, color: colors.text }}>{p.codigo || '—'}</span>
                <span style={{ width: 92, color: colors.textMute }}>
                  {fechaEfectiva(p).toLocaleString('es-ES', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span style={{ flex: 1, minWidth: 110, color: colors.textMute }}>
                  {LABEL_ORIGEN[p.origen_pedido] || p.origen_pedido || 'App Pidoo'}
                  {p.modo_entrega !== 'delivery' && ' · recogida'}
                </span>
                <span style={{ width: 96, color: colors.textMute }}>
                  {LABEL_PAGO[p.metodo_pago] || p.metodo_pago || '—'}
                </span>
                <span style={{ width: 46, textAlign: 'center' }}>{udsPorPedido.get(p.id) || 0}</span>
                <span style={{ width: 74, textAlign: 'right' }}>{fmt(p.subtotal)}</span>
                <span style={{ width: 66, textAlign: 'right' }}>
                  {fmt(p.modo_entrega === 'delivery' ? p.coste_envio : 0)}
                </span>
                <span style={{ width: 80, textAlign: 'right', fontWeight: 700, color: colors.text }}>
                  {fmt(p.total)}
                </span>
              </div>
            ))}
            <div style={{
              ...ds.tableRow, minWidth: 640, borderBottom: 'none',
              background: colors.cream2, fontWeight: 700, color: colors.text,
            }}>
              <span style={{ width: 92 }}>TOTAL</span>
              <span style={{ width: 92 }} />
              <span style={{ flex: 1, minWidth: 110 }} />
              <span style={{ width: 96 }} />
              <span style={{ width: 46, textAlign: 'center' }}>
                {[...udsPorPedido.values()].reduce((a, b) => a + b, 0)}
              </span>
              <span style={{ width: 74, textAlign: 'right' }}>{fmt(resumen.comida)}</span>
              <span style={{ width: 66, textAlign: 'right' }}>{fmt(resumen.envios)}</span>
              <span style={{ width: 80, textAlign: 'right' }}>{fmt(resumen.facturado)}</span>
            </div>
          </div>

          {resumen.perdidos.length > 0 && (
            <p style={{ ...ds.muted, marginTop: 10 }}>
              Además hubo {resumen.perdidos.length} pedido{resumen.perdidos.length === 1 ? '' : 's'} cancelado
              {resumen.perdidos.length === 1 ? '' : 's'} o fallido{resumen.perdidos.length === 1 ? '' : 's'}, que no cuentan como venta.
            </p>
          )}

          <p style={{ ...ds.muted, marginTop: 10, fontSize: type.xxs }}>
            Cuentan los pedidos entregados o recogidos, por su hora de entrega. Informe orientativo:
            la liquidación oficial con Pidoo se calcula cada lunes.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponentes ────────────────────────────────────────────────────────
function Kpi({ Icon, label, valor, nota, destacado }) {
  return (
    <div style={{
      ...ds.card,
      padding: '14px 16px',
      background: destacado ? colors.primarySoft : colors.paper,
      borderColor: destacado ? colors.primaryBorder : colors.border,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon size={14} color={destacado ? colors.primaryDark : colors.stone2} />
        <span style={{
          fontSize: type.xxs, fontWeight: 800, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: destacado ? colors.primaryDark : colors.stone2,
        }}>{label}</span>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
        color: destacado ? colors.primaryDark : colors.text,
      }}>{valor}</div>
      {nota && (
        <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4 }}>{nota}</div>
      )}
    </div>
  )
}

function Fila({ label, sub, valor }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 10, padding: '5px 0',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: type.sm, fontWeight: 600, color: colors.textDim }}>{label}</div>
        {sub && <div style={{ fontSize: type.xxs, color: colors.textMute }}>{sub}</div>}
      </div>
      <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, whiteSpace: 'nowrap' }}>
        {valor}
      </div>
    </div>
  )
}
