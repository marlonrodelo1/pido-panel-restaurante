// LA CAJA del mostrador: abrir con un fondo, meter y sacar efectivo, y cerrar
// contando lo que hay de verdad.
//
// La diferencia que da sentido a todo esto: el informe del día dice lo que se ha
// VENDIDO; la caja dice lo que hay EN EL CAJÓN. Entre una cosa y otra están el
// fondo inicial, lo que se saca para pagar al proveedor y lo que se mete de la
// caja fuerte. El descuadre es la resta de las dos.
//
// Las cuentas NO se hacen aquí: se piden al servidor (`tpv_estado_caja`,
// `tpv_cerrar_caja`). Si se hicieran en la tablet, un cierre podría guardarse
// "cuadrado" sin serlo.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../App'
import { T, cents, eur, btnAccion, btnSecundario, inputOscuro } from '../lib/tpvTheme'
import { imprimirReporteCaja } from '../lib/printService'
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock, Unlock, Printer } from 'lucide-react'

export default function TpvCaja({ establecimientoId, restaurante, vistaInicial = 'resumen', onCerrarModal }) {
  const [estado, setEstado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [vista, setVista] = useState(vistaInicial)   // resumen | entrada | salida | cierre
  const [importe, setImporte] = useState('')
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('tpv_estado_caja', { p_establecimiento_id: establecimientoId })
    if (error) { toast('No se pudo leer la caja: ' + error.message, 'error'); setCargando(false); return }
    setEstado(data)
    setCargando(false)
  }, [establecimientoId])

  useEffect(() => { cargar() }, [cargar])

  const importeC = cents(String(importe).replace(',', '.'))

  async function abrir() {
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_abrir_caja', {
      p_establecimiento_id: establecimientoId, p_fondo: importeC / 100,
    })
    setOcupado(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Caja abierta con ' + eur(importeC), 'success')
    setImporte(''); setVista('resumen'); cargar()
  }

  async function mover(tipo) {
    if (importeC <= 0) { toast('Escribe el importe', 'error'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('tpv_movimiento_caja', {
      p_establecimiento_id: establecimientoId, p_tipo: tipo,
      p_importe: importeC / 100, p_motivo: motivo || null,
    })
    setOcupado(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${eur(importeC)} apuntada`, 'success')
    setImporte(''); setMotivo(''); setVista('resumen'); cargar()
  }

  async function cerrar() {
    setOcupado(true)
    const { data, error } = await supabase.rpc('tpv_cerrar_caja', {
      p_establecimiento_id: establecimientoId, p_contado: importeC / 100, p_notas: motivo || null,
    })
    setOcupado(false)
    if (error) { toast(error.message, 'error'); return }
    const d = cents(data.descuadre)
    toast(d === 0 ? 'Caja cerrada y cuadrada'
      : `Caja cerrada · ${d > 0 ? 'sobran' : 'faltan'} ${eur(Math.abs(d))}`,
      d === 0 ? 'success' : 'error')
    // El Z sale solo al cerrar: es el papel que se guarda del dia.
    imprimirReporteCaja(data, restaurante, 'Z').catch(() => {})
    setImporte(''); setMotivo(''); setVista('resumen'); cargar()
  }

  if (cargando) return <div style={{ padding: 20, textAlign: 'center', color: T.muted }}>Mirando la caja…</div>

  // ── Sin caja abierta ──────────────────────────────────────────────────────
  if (!estado?.abierta) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: T.muted, fontSize: 14 }}>
          <Unlock size={18} color={T.accent} />
          No tienes ninguna caja abierta.
        </div>
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
          Puedes vender sin abrir caja, pero esas ventas no entrarán en ningún arqueo.
          Ábrela con el dinero que dejas para dar cambio.
        </div>
        <div>
          <label style={etiqueta}>Fondo inicial</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="50,00" inputMode="decimal" style={inputOscuro} />
        </div>
        <button onClick={abrir} disabled={ocupado} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
          <Wallet size={18} style={{ marginRight: 8 }} />
          {ocupado ? 'Abriendo…' : 'Abrir caja'}
        </button>
      </div>
    )
  }

  const esperado = cents(estado.esperado)

  // ── Entrada / salida ──────────────────────────────────────────────────────
  if (vista === 'entrada' || vista === 'salida') {
    const esEntrada = vista === 'entrada'
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 15, color: T.text }}>
          {esEntrada ? 'Meter dinero en la caja' : 'Sacar dinero de la caja'}
        </strong>
        <div>
          <label style={etiqueta}>Importe</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="20,00" inputMode="decimal" autoFocus style={inputOscuro} />
        </div>
        <div>
          <label style={etiqueta}>Motivo</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={esEntrada ? 'Cambio de la caja fuerte' : 'Pago al proveedor'}
            maxLength={80} style={inputOscuro} />
        </div>
        <button onClick={() => mover(vista)} disabled={ocupado || importeC <= 0}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importeC <= 0) ? 0.4 : 1 }}>
          {ocupado ? 'Guardando…' : `Apuntar ${esEntrada ? 'entrada' : 'salida'}`}
        </button>
        <button onClick={() => { setVista('resumen'); setImporte(''); setMotivo('') }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── Cierre ────────────────────────────────────────────────────────────────
  if (vista === 'cierre') {
    const descuadre = importe === '' ? null : importeC - esperado
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 15, color: T.text }}>Cerrar la caja</strong>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          Cuenta el dinero que hay en el cajón y escríbelo. Cuenta primero y mira
          después lo que debería haber: si no, cuadra siempre y no sirve de nada.
        </div>
        <div>
          <label style={etiqueta}>Dinero contado</label>
          <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0,00" inputMode="decimal" autoFocus style={inputOscuro} />
        </div>

        {descuadre != null && (
          <div style={{
            padding: 14, borderRadius: 12, textAlign: 'center',
            background: descuadre === 0 ? 'rgba(143,196,107,0.14)' : 'rgba(255,122,107,0.12)',
          }}>
            <div style={{ fontSize: 12, color: T.muted }}>Debería haber {eur(esperado)}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: descuadre === 0 ? T.ok : T.danger, marginTop: 4 }}>
              {descuadre === 0 ? 'Cuadra' : `${descuadre > 0 ? 'Sobran' : 'Faltan'} ${eur(Math.abs(descuadre))}`}
            </div>
          </div>
        )}

        <div>
          <label style={etiqueta}>Nota (opcional)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Se rompió un billete, propina..." maxLength={120} style={inputOscuro} />
        </div>

        <button onClick={cerrar} disabled={ocupado || importe === ''}
          style={{ ...btnAccion, height: 52, fontSize: 16, opacity: (ocupado || importe === '') ? 0.4 : 1 }}>
          <Lock size={17} style={{ marginRight: 8 }} />
          {ocupado ? 'Cerrando…' : 'Cerrar caja'}
        </button>
        <button onClick={() => { setVista('resumen'); setImporte(''); setMotivo('') }}
          style={{ ...btnSecundario, height: 44 }}>Volver</button>
      </div>
    )
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: T.muted }}>
        Abierta {new Date(estado.abierta_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        {' · '}{estado.tickets} ticket{estado.tickets === 1 ? '' : 's'}
      </div>

      <div style={{ background: T.surface2, borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <Fila etiqueta="Fondo inicial" valor={eur(cents(estado.fondo_inicial))} />
        <Fila etiqueta="Ventas en efectivo" valor={eur(cents(estado.ventas_efectivo))} />
        <Fila etiqueta="Entradas" valor={eur(cents(estado.entradas))} />
        <Fila etiqueta="Salidas" valor={'-' + eur(cents(estado.salidas))} />
        <div style={{ height: 1, background: T.border, margin: '4px 0' }} />
        <Fila etiqueta="Debería haber en el cajón" valor={eur(esperado)} fuerte />
        <div style={{ fontSize: 11, color: T.muted }}>
          Lo cobrado con datáfono ({eur(cents(estado.ventas_datafono))}) no está aquí: no pasa por el cajón.
        </div>
      </div>

      <button onClick={async () => {
        const ok = await imprimirReporteCaja(estado, restaurante, 'X')
        toast(ok ? 'Informe X impreso' : 'La impresora no responde', ok ? 'success' : 'error')
      }} style={{ ...btnSecundario, width: '100%', height: 46 }}>
        <Printer size={16} style={{ marginRight: 6 }} /> Imprimir informe X (sin cerrar)
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setVista('entrada')} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowDownLeft size={16} style={{ marginRight: 6 }} /> Entrada
        </button>
        <button onClick={() => setVista('salida')} style={{ ...btnSecundario, flex: 1, height: 46 }}>
          <ArrowUpRight size={16} style={{ marginRight: 6 }} /> Salida
        </button>
      </div>

      <button onClick={() => setVista('cierre')} style={{ ...btnAccion, height: 52, fontSize: 16 }}>
        <Lock size={17} style={{ marginRight: 8 }} /> Cerrar caja
      </button>
      {onCerrarModal && (
        <button onClick={onCerrarModal} style={{ ...btnSecundario, height: 44 }}>Seguir vendiendo</button>
      )}
    </div>
  )
}

function Fila({ etiqueta: e, valor, fuerte }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: fuerte ? 14 : 13, color: fuerte ? T.text : T.muted, fontWeight: fuerte ? 700 : 400 }}>{e}</span>
      <span style={{
        fontSize: fuerte ? 20 : 14, fontWeight: fuerte ? 800 : 600, color: T.text,
        fontVariantNumeric: 'tabular-nums',
      }}>{valor}</span>
    </div>
  )
}

const etiqueta = {
  display: 'block', fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6,
}
