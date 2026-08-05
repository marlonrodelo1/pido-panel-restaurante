// Genera el PDF del informe de ventas (Finanzas del restaurante).
//
// jspdf y jspdf-autotable se importan de forma diferida: solo se descargan
// cuando el dueño pulsa "Descargar PDF", no en el arranque del panel.
//
// Las fuentes estándar de jsPDF (helvetica) usan WinAnsi: los acentos y la ñ
// salen bien, pero se evita el símbolo € en el PDF y se escribe "EUR".
import {
  fechaEfectiva, fmtPlano, slugify, tituloPeriodo,
  LABEL_PAGO, LABEL_ORIGEN,
} from './informeVentas.js'

const M = 14 // margen en mm

export async function construirInformeVentasPDF({
  restaurante, resumen, productos, udsPorPedido, config, desde, hasta, generadoEn,
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const periodo = tituloPeriodo(desde, hasta)
  const fecha = generadoEn || new Date()
  let y = 16

  const finalY = () => (doc.lastAutoTable?.finalY ?? y) + 6

  // ── Cabecera ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26)
  doc.text(restaurante?.nombre || 'Restaurante', M, y)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
  y += 5
  const fiscal = [restaurante?.razon_social, restaurante?.nif, restaurante?.direccion_fiscal]
    .filter(Boolean).join(' · ')
  if (fiscal) { doc.text(fiscal, M, y); y += 4 }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30)
  doc.text(`Informe de ventas · ${periodo}`, M, y + 2)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generado el ${fecha.toLocaleString('es-ES')}`, W - M, y + 2, { align: 'right' })
  y += 8

  // ── Resumen ──────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['Resumen del periodo', 'Importe']],
    body: [
      ['Pedidos completados', String(resumen.nPedidos)],
      ['Comida vendida (subtotal)', fmtPlano(resumen.comida) + ' EUR'],
      ['Envíos cobrados', fmtPlano(resumen.envios) + ' EUR'],
      ['Propinas', fmtPlano(resumen.propinas) + ' EUR'],
      ['Descuentos y promociones', '-' + fmtPlano(resumen.descuentos) + ' EUR'],
      ['TOTAL FACTURADO', fmtPlano(resumen.facturado) + ' EUR'],
      ['Ticket medio', fmtPlano(resumen.ticketMedio) + ' EUR'],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: [197, 86, 44], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 42 } },
    margin: { left: M, right: M },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === 5) d.cell.styles.fontStyle = 'bold'
    },
  })
  y = finalY()

  // ── Cómo se ha cobrado ───────────────────────────────────────────────────
  const filasPago = Object.entries(resumen.porPago)
    .map(([k, v]) => [LABEL_PAGO[k] || k, String(v.n), fmtPlano(v.importe) + ' EUR'])
  if (filasPago.length) {
    autoTable(doc, {
      startY: y,
      head: [['Cómo se ha cobrado', 'Pedidos', 'Importe']],
      body: [
        ...filasPago,
        ['Cobrado por Pidoo (tarjeta)', '', fmtPlano(resumen.cobradoTarjeta) + ' EUR'],
        ['Cobrado en mano', '', fmtPlano(resumen.cobradoEnMano) + ' EUR'],
      ],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2.2 },
      headStyles: { fillColor: [107, 99, 86], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        1: { halign: 'center', cellWidth: 24 },
        2: { halign: 'right', cellWidth: 34 },
      },
      margin: { left: M, right: M },
      didParseCell: (d) => {
        if (d.section === 'body' && d.row.index >= filasPago.length) {
          d.cell.styles.textColor = [110, 110, 110]
        }
      },
    })
    y = finalY()
  }

  // ── Comisión ─────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [['Comisión de Pidoo (estimada)', 'Importe']],
    body: [
      ['Base comisionable (comida, sin pedidos por teléfono)', fmtPlano(resumen.baseComisionable) + ' EUR'],
      [`Comisión ${config.pct}%`, fmtPlano(resumen.comisionPct) + ' EUR'],
      [`Pedidos por teléfono (${resumen.nTelefonicos} x ${fmtPlano(config.feeTelefonico)} EUR)`, fmtPlano(resumen.comisionTel) + ' EUR'],
      ['TOTAL COMISIÓN', fmtPlano(resumen.comision) + ' EUR'],
      ['Comida menos comisión', fmtPlano(resumen.neto) + ' EUR'],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: [107, 99, 86], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 42 } },
    margin: { left: M, right: M },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === 3) d.cell.styles.fontStyle = 'bold'
    },
  })
  y = finalY()

  // ── Productos vendidos ───────────────────────────────────────────────────
  if (productos.length) {
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Uds.', 'Importe']],
      body: productos.map(p => [p.nombre, String(p.uds), fmtPlano(p.importe) + ' EUR']),
      foot: [[
        'TOTAL',
        String(productos.reduce((a, p) => a + p.uds, 0)),
        fmtPlano(productos.reduce((a, p) => a + p.importe, 0)) + ' EUR',
      ]],
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 1.8 },
      headStyles: { fillColor: [26, 24, 21], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [239, 233, 221], textColor: 26, fontStyle: 'bold' },
      columnStyles: {
        1: { halign: 'center', cellWidth: 18 },
        2: { halign: 'right', cellWidth: 30 },
      },
      margin: { left: M, right: M },
    })
    y = finalY()
  }

  // ── Detalle de pedidos ───────────────────────────────────────────────────
  if (resumen.ventas.length) {
    autoTable(doc, {
      startY: y,
      head: [['Pedido', 'Hora', 'Origen', 'Pago', 'Entrega', 'Uds.', 'Comida', 'Envío', 'Propina', 'Total']],
      body: resumen.ventas.map(p => [
        p.codigo || '—',
        fechaEfectiva(p).toLocaleString('es-ES', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        }),
        LABEL_ORIGEN[p.origen_pedido] || p.origen_pedido || 'App Pidoo',
        LABEL_PAGO[p.metodo_pago] || p.metodo_pago || '—',
        p.modo_entrega === 'delivery' ? 'Envío' : 'Recogida',
        String(udsPorPedido.get(p.id) || 0),
        fmtPlano(p.subtotal),
        fmtPlano(p.modo_entrega === 'delivery' ? p.coste_envio : 0),
        fmtPlano(p.propina),
        fmtPlano(p.total),
      ]),
      foot: [[
        'TOTAL', '', '', '', '',
        String([...udsPorPedido.values()].reduce((a, b) => a + b, 0)),
        fmtPlano(resumen.comida),
        fmtPlano(resumen.envios),
        fmtPlano(resumen.propinas),
        fmtPlano(resumen.facturado),
      ]],
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [197, 86, 44], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [239, 233, 221], textColor: 26, fontStyle: 'bold' },
      columnStyles: {
        5: { halign: 'center' },
        6: { halign: 'right' }, 7: { halign: 'right' },
        8: { halign: 'right' }, 9: { halign: 'right' },
      },
      margin: { left: M, right: M },
    })
    y = finalY()
  }

  if (resumen.perdidos.length) {
    const n = resumen.perdidos.length
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130)
    doc.text(
      `Además hubo ${n} pedido${n === 1 ? '' : 's'} cancelado${n === 1 ? '' : 's'} o fallido${n === 1 ? '' : 's'}, que no cuenta${n === 1 ? '' : 'n'} como venta.`,
      M, Math.min(y, H - 20)
    )
  }

  // ── Pie en todas las páginas ─────────────────────────────────────────────
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150)
    doc.text(
      'Cuentan los pedidos entregados o recogidos. Informe orientativo: la liquidación oficial con Pidoo se calcula cada lunes.',
      M, H - 8
    )
    doc.text(`${i} / ${paginas}`, W - M, H - 8, { align: 'right' })
  }

  const slug = slugify(restaurante?.nombre)
  const filename = `ventas_${slug}_${desde}${desde === hasta ? '' : '_' + hasta}.pdf`
  return { doc, filename }
}
