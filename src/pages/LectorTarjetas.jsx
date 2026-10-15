// LectorTarjetas.jsx — el panel de control del lector de tarjetas en el móvil del mostrador.
//
// Desde la v21 (15 oct 2026) el trabajo de verdad lo hace LectorContext EN SEGUNDO PLANO: el móvil
// sigue cobrando aunque se cambie de pantalla, y conecta solo el lector al abrir la app. Aquí solo:
//   - se convierte este móvil en «el lector» (botón) o se deja de usar (botón);
//   - se ve el estado (buscando, conectado, batería, actualización del lector…);
//   - se elige el lector si hay varios, o se busca otra vez.
// El cobro en marcha sale encima de cualquier pantalla (CobroLectorFlotante, en LectorContext).
import { Bluetooth, BatteryMedium, CheckCircle2, XCircle, Loader2, RefreshCw, CreditCard, Power } from 'lucide-react'
import { colors, ds, radius, type } from '../lib/uiStyles'
import { useLector } from '../context/LectorContext'

export default function LectorTarjetas() {
  const {
    soportado, activado, esCobrador, fase, error, lectores, lector, bateria, actualizando,
    activar, desactivar, buscar, conectar, olvidarLector,
  } = useLector()

  const tarjeta = { ...ds.card, padding: 20, borderRadius: radius.lg, textAlign: 'center' }
  const botonGrande = { ...ds.primaryBtn, marginTop: 16, width: '100%', justifyContent: 'center', height: 48 }

  const estadoLinea = (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', fontSize: type.sm, color: colors.textMute, marginTop: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Bluetooth size={14} /> {lector ? (lector.label || lector.serialNumber || 'Lector conectado') : 'Sin lector'}
      </span>
      {bateria?.nivel != null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <BatteryMedium size={14} /> {Math.round(bateria.nivel * 100)} %{bateria.cargando ? ' · cargando' : ''}
        </span>
      )}
    </div>
  )

  const botonDejar = (
    <button onClick={desactivar} style={{ ...ds.ghostBtn, marginTop: 14, fontSize: type.xs, color: colors.textMute }}>
      <Power size={13} style={{ marginRight: 6 }} /> Dejar de usar este móvil como lector
    </button>
  )

  let contenido
  if (!soportado) {
    contenido = <div style={tarjeta}><Aviso texto="Este aparato no puede usar el lector de tarjetas. Hace falta la app de Pidoo en un móvil o tablet Android." /></div>
  } else if (!activado || fase === 'desactivado') {
    contenido = <div style={tarjeta}><Aviso texto="El cobro con lector de tarjetas no está activado en este restaurante. Pídeselo a Pidoo." /></div>
  } else if (!esCobrador) {
    contenido = (
      <div style={tarjeta}>
        <CreditCard size={40} color={colors.primary} />
        <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, marginTop: 8 }}>Usar este móvil como lector</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          Este móvil se conectará al lector de tarjetas por Bluetooth y cobrará lo que mande el TPV del ordenador.
          Seguirá cobrando aunque cambies de pantalla, mientras la app esté abierta. Este móvil dejará de imprimir.
        </div>
        <button onClick={activar} style={botonGrande}>
          <CreditCard size={16} style={{ marginRight: 6 }} /> Usar este móvil como lector
        </button>
      </div>
    )
  } else if (['comprobando', 'buscando', 'conectando', 'apagado'].includes(fase)) {
    contenido = (
      <div style={tarjeta}>
        <Loader2 size={36} color={colors.primary} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginTop: 10 }}>
          {fase === 'buscando' ? 'Buscando el lector…'
            : fase === 'conectando' ? (actualizando != null ? 'Actualizando el lector…' : 'Conectando con el lector…')
              : 'Preparando…'}
        </div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          {actualizando != null
            ? `${Math.round(actualizando * 100)} %. No lo apagues ni lo alejes del móvil: la primera vez puede tardar unos minutos.`
            : fase === 'buscando' ? 'Enciende el lector (botón del lateral) y déjalo cerca del móvil.' : ''}
        </div>
        {botonDejar}
      </div>
    )
  } else if (fase === 'elegir') {
    contenido = (
      <div style={tarjeta}>
        <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginBottom: 12 }}>Elige tu lector</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {lectores.map((l) => (
            <button key={l.serialNumber} onClick={() => conectar(l)} style={{ ...ds.secondaryBtn, justifyContent: 'center', height: 48 }}>
              <Bluetooth size={16} style={{ marginRight: 6 }} /> {l.label || l.serialNumber}
            </button>
          ))}
        </div>
        <button onClick={() => buscar()} style={{ ...ds.ghostBtn, marginTop: 12 }}><RefreshCw size={14} style={{ marginRight: 6 }} />Buscar otra vez</button>
        {botonDejar}
      </div>
    )
  } else if (fase === 'sin_lector' || fase === 'error') {
    contenido = (
      <div style={tarjeta}>
        <Aviso texto={error || 'No se encuentra el lector.'} />
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 8 }}>Se vuelve a intentar solo cada 30 segundos.</div>
        <button onClick={() => buscar()} style={botonGrande}>
          <RefreshCw size={16} style={{ marginRight: 6 }} /> Buscar ahora
        </button>
        {botonDejar}
      </div>
    )
  } else {
    // listo, cobrando o resultado: el cobro en sí sale flotando encima de todo.
    contenido = (
      <div style={tarjeta}>
        <CheckCircle2 size={44} color={colors.sage} />
        <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, marginTop: 8 }}>Listo para cobrar</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, lineHeight: 1.5 }}>
          Cobra con «Tarjeta» en el TPV del ordenador y el importe saldrá en el lector.
          Ya puedes volver al mostrador: este móvil sigue cobrando aunque cambies de pantalla.
          Déjalo con la app abierta y enchufado.
        </div>
        {estadoLinea}
        <button onClick={olvidarLector} style={{ ...ds.ghostBtn, marginTop: 14, fontSize: type.xs }}>Usar otro lector</button>
        <div>{botonDejar}</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', display: 'grid', gap: 14 }}>
      {contenido}
      <div style={{ fontSize: type.xs, color: colors.textFaint, textAlign: 'center', lineHeight: 1.5, padding: '0 10px' }}>
        El cobro queda apuntado en la venta como tarjeta y entra en la liquidación de los lunes.
      </div>
    </div>
  )
}

function Aviso({ texto }) {
  return (
    <>
      <XCircle size={40} color={colors.warning} />
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginTop: 10, lineHeight: 1.5 }}>{texto}</div>
    </>
  )
}
