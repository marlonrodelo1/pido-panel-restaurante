import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'

// ─────────────────────────────────────────────────────────────────────────────
// CUOTA MENSUAL DEL RESTAURANTE (30 € + 7% IGIC = 32,10 €/mes)
//
// Solo se pinta si `establecimientos.plan_cuota_mensual` está encendido, que lo
// enciende Pidoo desde el super-admin. Para el resto de restaurantes (los que
// pagan comisión por pedido) este componente no existe: devuelve null.
//
// El botón NO cobra nada: abre un Checkout de Stripe. Quien da la suscripción por
// buena es el webhook al recibir el pago. Por eso al volver del Checkout la
// tarjeta puede tardar unos segundos en decir "Al día" — es correcto, no es un
// fallo: preferimos enseñar la verdad tarde que una mentira rápida.
//
// `variant="banner"` es el aviso rojo de arriba del panel: el dueño que no ha
// pagado no va a entrar en Ajustes por su cuenta a buscarlo.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS = {
  active:   { txt: 'Al día',              color: '#2E7D32', fondo: 'rgba(46,125,50,0.10)',  borde: 'rgba(46,125,50,0.25)' },
  past_due: { txt: 'Pago pendiente',      color: '#B5564A', fondo: 'rgba(220,38,38,0.08)',  borde: 'rgba(185,28,28,0.25)' },
  unpaid:   { txt: 'Impagada',            color: '#B5564A', fondo: 'rgba(220,38,38,0.08)',  borde: 'rgba(185,28,28,0.25)' },
  canceled: { txt: 'Cancelada',           color: 'var(--c-muted)', fondo: 'transparent',    borde: 'var(--c-border)' },
  pending:  { txt: 'Sin activar',         color: '#B5564A', fondo: 'rgba(220,38,38,0.08)',  borde: 'rgba(185,28,28,0.25)' },
}

function euro(v) { return `${Number(v || 0).toFixed(2).replace('.', ',')} €` }

// El plazo sale de `establecimientos.cuota_fecha_limite`, no del codigo: asi vale
// para el siguiente cliente de cuota fija y no se queda diciendo "manana" para
// siempre. Solo informa; lo que apaga la tienda es el impago real.
function plazo(fecha) {
  if (!fecha) return null
  // 'YYYY-MM-DD' partido a mano: `new Date('2026-08-19')` lo lee como UTC y en
  // Canarias (UTC+1 en verano) puede pintar el dia anterior.
  const [a, m, d] = String(fecha).split('-').map(Number)
  if (!a || !m || !d) return null
  const limite = new Date(a, m - 1, d)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const dias = Math.round((limite - hoy) / 86400000)
  const texto = limite.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  if (dias < 0) return { vencido: true, frase: `El plazo terminó el ${texto}.` }
  if (dias === 0) return { vencido: false, frase: 'Tienes de plazo hasta hoy.' }
  if (dias === 1) return { vencido: false, frase: 'Tienes de plazo hasta mañana.' }
  return { vencido: false, frase: `Tienes de plazo hasta el ${texto}.` }
}

export default function SuscripcionCard({ variant = 'card' }) {
  const { restaurante } = useRest()
  const [sus, setSus] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const estId = restaurante?.id
  const enPlan = restaurante?.plan_cuota_mensual === true
  const limite = plazo(restaurante?.cuota_fecha_limite)

  useEffect(() => {
    if (!estId || !enPlan) { setCargando(false); return }
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('suscripciones_tienda')
        .select('estado, monto_mensual, fecha_proximo_pago, intentos_fallidos, stripe_subscription_id')
        .eq('establecimiento_id', estId).maybeSingle()
      if (vivo) { setSus(data || null); setCargando(false) }
    })()
    return () => { vivo = false }
  }, [estId, enPlan])

  async function activar() {
    setEnviando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { toast('Vuelve a iniciar sesión', 'error'); return }
      const { data, error } = await supabase.functions.invoke('crear-suscripcion-restaurante')
      // `error` de invoke NO trae el cuerpo: sin leer `data.error` el dueño vería
      // "Edge Function returned a non-2xx status code" y no sabría qué hacer.
      const msg = data?.error
      if (msg) { toast(msg, 'error'); return }
      if (error) { toast('No se pudo abrir el pago. Inténtalo de nuevo.', 'error'); return }
      if (!data?.url) { toast('Respuesta inesperada de Stripe', 'error'); return }
      window.location.href = data.url
    } catch (e) {
      toast('Error: ' + (e.message || e), 'error')
    } finally {
      setEnviando(false)
    }
  }

  if (!enPlan || cargando) return null

  const estado = sus?.stripe_subscription_id ? (sus.estado || 'pending') : 'pending'
  const alDia = estado === 'active'
  const info = ESTADOS[estado] || ESTADOS.pending

  const base = Number(sus?.monto_mensual || 30)
  const total = Math.round(base * 1.07 * 100) / 100

  // ── Banner rojo arriba del panel, solo si NO está al día ───────────────────
  if (variant === 'banner') {
    if (alDia) return null
    return (
      <div style={{
        background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(185,28,28,0.25)',
        borderRadius: 12, padding: '14px 16px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#B5564A' }}>
            {estado === 'unpaid'
              ? 'Tu tienda está pausada por impago'
              : 'Te falta activar tu cuota mensual'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--c-muted)', marginTop: 3, lineHeight: 1.5 }}>
            {estado === 'unpaid'
              ? `No hemos podido cobrar los ${euro(total)}. Actualiza la tarjeta y tu tienda vuelve a abrir al instante.`
              : `${euro(total)} al mes (${euro(base)} + 7% IGIC). Sin comisión por pedido.`}
          </div>
          {estado !== 'unpaid' && limite && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#B5564A', marginTop: 4 }}>
              {limite.frase}
            </div>
          )}
        </div>
        <button onClick={activar} disabled={enviando} style={{
          padding: '11px 18px', borderRadius: 9, border: 'none', flexShrink: 0,
          background: '#B5564A', color: '#fff', fontSize: 13, fontWeight: 700,
          cursor: enviando ? 'default' : 'pointer', fontFamily: 'inherit', opacity: enviando ? 0.6 : 1,
        }}>
          {enviando ? 'Abriendo…' : 'Añadir tarjeta'}
        </button>
      </div>
    )
  }

  // ── Tarjeta en Ajustes ─────────────────────────────────────────────────────
  return (
    <div style={{
      background: 'var(--c-surface)', borderRadius: 14, padding: 18,
      border: '1px solid var(--c-border)', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Mi plan</h3>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
          background: info.fondo, color: info.color, border: `1px solid ${info.borde}`,
        }}>{info.txt}</span>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--c-muted)', marginBottom: 14, lineHeight: 1.55 }}>
        Cuota fija de <strong style={{ color: 'var(--c-text)' }}>{euro(total)} al mes</strong>{' '}
        ({euro(base)} + 7% de IGIC) por tener tu tienda y tu app activas.
        <strong style={{ color: 'var(--c-text)' }}> No pagas comisión por pedido.</strong>
      </div>

      {!alDia && limite && (
        <div style={{
          fontSize: 12.5, fontWeight: 700, lineHeight: 1.5, marginBottom: 14,
          padding: '10px 12px', borderRadius: 9, color: '#B5564A',
          background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(185,28,28,0.2)',
        }}>
          {limite.frase}
        </div>
      )}

      {alDia ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-muted)', lineHeight: 1.6 }}>
          Se cobra solo cada mes a tu tarjeta.
          {sus?.fecha_proximo_pago && (
            <> Próximo cobro el{' '}
              <strong style={{ color: 'var(--c-text)' }}>
                {new Date(sus.fecha_proximo_pago).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
              </strong>.
            </>
          )}
          <div style={{ marginTop: 8 }}>
            Para cambiar la tarjeta o darte de baja, escríbenos desde Soporte.
          </div>
        </div>
      ) : (
        <>
          {estado === 'unpaid' && (
            <div style={{
              fontSize: 12.5, lineHeight: 1.55, color: '#B5564A', marginBottom: 12,
              padding: '10px 12px', borderRadius: 9,
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(185,28,28,0.2)',
            }}>
              Lo intentamos {sus?.intentos_fallidos || 3} veces y no se pudo cobrar, así que tu tienda
              está pausada. En cuanto el pago entre, vuelve a abrir sola.
            </div>
          )}
          <button onClick={activar} disabled={enviando} style={{
            padding: '12px 20px', borderRadius: 9, border: 'none',
            background: 'var(--c-primary)', color: '#fff', fontSize: 13.5, fontWeight: 700,
            cursor: enviando ? 'default' : 'pointer', fontFamily: 'inherit', opacity: enviando ? 0.6 : 1,
          }}>
            {enviando ? 'Abriendo el pago…' : 'Añadir tarjeta y activar'}
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 10, lineHeight: 1.5 }}>
            Se abre la pasarela segura de Stripe. Pidoo no guarda tu tarjeta en ningún momento.
          </div>
        </>
      )}
    </div>
  )
}
