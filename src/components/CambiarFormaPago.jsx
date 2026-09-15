import { useState } from 'react'
import { Wallet, CreditCard, X } from 'lucide-react'
import { colors, ds, radius, type } from '../lib/uiStyles'
import { toast } from '../App'
import { eur, cambiarFormaPago } from '../lib/stock'

// «¿Cómo pagó de verdad?» — cambiar un pedido entre efectivo y datáfono.
//
// Marlon (15 sep 2026): «pide a domicilio en efectivo, al llegar no tiene y paga con
// datáfono, y el repartidor me dice tienes 35 y tengo 10». Con esto se corrige en un toque:
// si la caja sigue abierta, el cajón se recalcula solo; si ya se cerró, se rehace la foto de
// ese cierre; y si se entregó con la caja cerrada, se corrige la apertura de la caja siguiente
// (que ya lo había contado como efectivo). Queda apuntado quién y cuándo (`pedido_ediciones`).
//
// Solo efectivo ↔ datáfono (lo exige también la base de datos, PD273-PD276): la tarjeta de
// la app ya la cobró Pidoo y el mostrador tiene ticket fiscal. No cambia lo que paga Pidoo
// ni lo que cobra el repartidor.
//
// `pedido` admite las dos formas de la casa: la fila de `pedidos` (metodo_pago, origen_pedido)
// o la del día de Contabilidad (pago, via).

const OPCIONES = [
  { id: 'efectivo', label: 'Efectivo', Icono: Wallet },
  { id: 'datafono', label: 'Datáfono', Icono: CreditCard },
]

export default function CambiarFormaPago({ pedido, onCerrar, onHecho }) {
  const actual = pedido?.metodo_pago ?? pedido?.pago
  const [nuevo, setNuevo] = useState(actual === 'efectivo' ? 'datafono' : 'efectivo')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const total = Number(pedido?.total || 0)

  async function guardar() {
    if (guardando || nuevo === actual) return
    setGuardando(true)
    try {
      const r = await cambiarFormaPago(pedido.id, nuevo, motivo.trim() || null)
      // Alguien lo cambió antes (otro aparato, o esta pantalla tenía el pedido viejo): la RPC no
      // toca nada y lo dice con `sin_cambios`. Se cierra y se recarga igual para verlo al día.
      if (r?.sin_cambios) {
        const quedo = (r.despues || nuevo) === 'datafono' ? 'datáfono' : 'efectivo'
        toast(`Ya estaba como ${quedo}: alguien lo cambió antes. No se ha tocado nada.`, 'success')
        onHecho?.(r)
        return
      }
      const extra = r.caja === 'abierta' ? 'Lo que debe haber en el cajón ya está corregido.'
        : r.caja === 'cerrada_corregida' ? 'También se ha corregido el cierre de esa caja.'
          // Se entregó con la caja cerrada y la caja siguiente ya lo había contado al abrir.
          : r.caja === 'apertura_corregida' ? 'Se entregó con la caja cerrada: también se ha corregido la apertura de la caja siguiente y la caja mayor.'
            : r.caja === 'sin_caja' ? 'Se entregó sin caja abierta en el TPV: no había cajón que corregir.'
              : r.caja === 'sin_entregar' ? `Se cobrará con ${nuevo === 'datafono' ? 'datáfono' : 'efectivo'} al entregar.`
                : ''
      toast(['Forma de pago cambiada.', extra].filter(Boolean).join(' '), 'success')
      onHecho?.(r)
    } catch (e) {
      toast(e.message, 'error')
      setGuardando(false)
    }
  }

  const aDatafono = nuevo === 'datafono'

  return (
    <div style={{ ...ds.modal, zIndex: 1200 }}>
      <div style={{ ...ds.modalContent, maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text }}>¿Cómo pagó de verdad?</div>
            <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 2 }}>
              {pedido?.codigo ? `${pedido.codigo} · ` : ''}{eur(total)} · ahora pone <strong>{actual === 'datafono' ? 'Datáfono' : 'Efectivo'}</strong>
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ ...ds.miniBtn, width: 30, height: 30, padding: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          {OPCIONES.map(({ id, label, Icono }) => {
            const activo = nuevo === id
            return (
              <button key={id} onClick={() => setNuevo(id)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '16px 10px', borderRadius: radius.md, cursor: 'pointer', fontFamily: 'inherit',
                background: activo ? colors.primarySoft : colors.paper,
                border: `2px solid ${activo ? colors.primary : colors.border}`,
                color: activo ? colors.primaryDark : colors.text,
              }}>
                <Icono size={22} />
                <span style={{ fontSize: type.base, fontWeight: 800 }}>{label}</span>
                {id === actual && <span style={{ fontSize: type.xxs, color: colors.textMute }}>lo que pone ahora</span>}
              </button>
            )
          })}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={ds.label}>Nota (opcional)</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={140}
            placeholder={aDatafono ? 'No tenía efectivo' : 'Al final pagó en efectivo'}
            style={ds.formInput} />
        </div>

        {nuevo !== actual && (
          <div style={{
            marginTop: 14, padding: '12px 14px', borderRadius: radius.sm,
            background: colors.surface2, border: `1px solid ${colors.border}`,
            fontSize: type.sm, color: colors.textDim, lineHeight: 1.5,
          }}>
            {aDatafono
              ? <>En el cajón deberá haber <strong>{eur(total)} menos</strong>: ese dinero va al banco.</>
              : <>En el cajón deberá haber <strong>{eur(total)} más</strong>: ese dinero ya no va al banco.</>}
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
              No cambia lo que te paga Pidoo ni lo que cobra el repartidor.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
          <button onClick={guardar} disabled={guardando || nuevo === actual}
            style={{ ...ds.primaryBtn, opacity: guardando || nuevo === actual ? 0.5 : 1 }}>
            {guardando ? 'Guardando…' : `Pasar a ${aDatafono ? 'datáfono' : 'efectivo'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
