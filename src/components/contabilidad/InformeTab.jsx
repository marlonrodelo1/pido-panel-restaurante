import { useState, useEffect } from 'react'
import { Printer, Download } from 'lucide-react'
import { colors, ds, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast } from '../../App'
import { eur, informeMes } from '../../lib/stock'

// El informe del mes para la gestoría: ventas por día, facturas de compra y gastos,
// con sus totales. Imprimible (el navegador ya sabe hacer PDF) y descargable en CSV.
// Es el mismo dato del Resumen, ordenado como lo quiere leer una asesoría.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function opcionesMeses(n = 6) {
  const hoy = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    return {
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
      label: `${MESES[d.getMonth()]} ${d.getFullYear()}`,
    }
  })
}

function fechaCorta(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export default function InformeTab({ estId, nombreRestaurante }) {
  const meses = opcionesMeses()
  const [mes, setMes] = useState(meses[0].valor)
  const [datos, setDatos] = useState(null)

  useEffect(() => {
    if (!estId) return
    let vivo = true
    setDatos(null)
    informeMes(estId, mes)
      .then(r => { if (vivo) setDatos(r) })
      .catch(e => { if (vivo) { toast(e.message, 'error'); setDatos(false) } })
    return () => { vivo = false }
  }, [estId, mes])

  const mesLabel = meses.find(m => m.valor === mes)?.label || mes
  const t = datos?.totales

  function descargarCsv() {
    // Un solo CSV con las tres secciones, separadas por una línea en blanco: lo que
    // una asesoría abre en Excel sin pelearse. Separador ';' (Excel en español).
    const num = n => String(Number(n || 0).toFixed(2)).replace('.', ',')
    const filas = []
    filas.push([`Informe ${mesLabel}`, nombreRestaurante || ''])
    filas.push([])
    filas.push(['VENTAS POR DIA'])
    filas.push(['Dia', 'Pedidos', 'Vendido', 'Descuentos', 'Comision Pidoo'])
    for (const v of (datos.ventas_por_dia || [])) {
      filas.push([v.dia, v.pedidos, num(v.vendido), num(v.descuentos), num(v.comision)])
    }
    filas.push(['TOTAL', t.pedidos, num(t.vendido), num(t.descuentos), num(t.comision)])
    filas.push([])
    filas.push(['COMPRAS (facturas contabilizadas)'])
    filas.push(['Fecha', 'Numero', 'Proveedor', 'Total'])
    for (const c of (datos.compras || [])) filas.push([c.fecha, c.numero || '', c.proveedor, num(c.total)])
    filas.push(['TOTAL', '', '', num(t.compras)])
    filas.push([])
    filas.push(['GASTOS'])
    filas.push(['Fecha', 'Categoria', 'Concepto', 'Importe'])
    for (const g of (datos.gastos || [])) filas.push([g.fecha, g.categoria, g.concepto || '', num(g.importe)])
    filas.push(['TOTAL', '', '', num(t.gastos)])
    filas.push([])
    filas.push(['RESULTADO (neto - compras - gastos)', '', '', num(t.resultado)])

    const csv = '﻿' + filas.map(f => f.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `informe-${mes.slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={mes} onChange={e => setMes(e.target.value)} style={{ ...ds.select, width: 'auto', minWidth: 180 }}>
          {meses.map(m => <option key={m.valor} value={m.valor}>{m.label}</option>)}
        </select>
        {datos && (
          <>
            <button onClick={() => window.print()} style={ds.miniBtn} title="Imprimir o guardar en PDF">
              <Printer size={13} /> Imprimir
            </button>
            <button onClick={descargarCsv} style={ds.miniBtn} title="Bajar el mes en CSV para la gestoría">
              <Download size={13} /> Descargar CSV
            </button>
          </>
        )}
      </div>

      {datos === null && <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>Preparando el informe…</div>}
      {datos === false && <div style={{ ...ds.muted, padding: 40, textAlign: 'center' }}>No se ha podido cargar.</div>}

      {datos && (
        <>
          <div className="ds-cards" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
            <Dato label="Vendido" valor={eur(t.vendido)} pie={`${t.pedidos} pedidos`} />
            <Dato label="Comisión Pidoo" valor={'− ' + eur(t.comision)} />
            <Dato label="Compras" valor={'− ' + eur(t.compras)} />
            <Dato label="Gastos" valor={'− ' + eur(t.gastos)} />
            <Dato label="Resultado" valor={eur(t.resultado)} tono={t.resultado > 0 ? 'sage' : t.resultado < 0 ? 'danger' : null} />
          </div>

          <div style={{ display: 'grid', gap: 14, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <Bloque titulo={`Ventas por día (${mesLabel})`}>
              {(datos.ventas_por_dia || []).length === 0
                ? <Vacio texto="Sin ventas este mes." />
                : (
                  <div style={tablaScroll}>
                    <div style={{ ...ds.tableHeader, ...filaMin(320) }}>
                      <span style={col(70, 'left')}>Día</span>
                      <span style={col(70)}>Pedidos</span>
                      <span style={{ flex: 1 }} />
                      <span style={col(90)}>Vendido</span>
                    </div>
                    {datos.ventas_por_dia.map(v => (
                      <div key={v.dia} style={{ ...ds.tableRow, ...filaMin(320) }}>
                        <span style={{ ...col(70, 'left'), fontSize: type.sm }}>{fechaCorta(v.dia)}</span>
                        <span style={col(70)}>{v.pedidos}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ ...col(90), fontWeight: 700 }}>{eur(v.vendido)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </Bloque>

            <Bloque titulo="Facturas de compra">
              {(datos.compras || []).length === 0
                ? <Vacio texto="Sin facturas contabilizadas este mes." />
                : datos.compras.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', padding: '6px 0', fontSize: type.sm }}>
                    <span style={{ color: colors.textMute, flexShrink: 0 }}>{fechaCorta(c.fecha)}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.proveedor}{c.numero ? ` · ${c.numero}` : ''}
                    </span>
                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{eur(c.total)}</span>
                  </div>
                ))}
            </Bloque>

            <Bloque titulo="Gastos">
              {(datos.gastos || []).length === 0
                ? <Vacio texto="Sin gastos apuntados este mes." />
                : datos.gastos.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', padding: '6px 0', fontSize: type.sm }}>
                    <span style={{ color: colors.textMute, flexShrink: 0 }}>{fechaCorta(g.fecha)}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.categoria}{g.concepto ? ` · ${g.concepto}` : ''}
                    </span>
                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{eur(g.importe)}</span>
                  </div>
                ))}
            </Bloque>
          </div>
        </>
      )}
    </div>
  )
}

function Dato({ label, valor, pie, tono }) {
  const color = tono === 'sage' ? colors.sage : tono === 'danger' ? colors.danger : colors.text
  return (
    <div style={{ ...ds.card, padding: 14 }}>
      <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {pie && <div style={{ ...ds.muted, fontSize: type.xxs, marginTop: 2 }}>{pie}</div>}
    </div>
  )
}

function Bloque({ titulo, children }) {
  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}

function Vacio({ texto }) {
  return <div style={{ ...ds.muted, fontSize: type.sm }}>{texto}</div>
}
