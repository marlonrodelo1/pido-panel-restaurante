// Aceptación automática de pedidos, en los AJUSTES del restaurante.
//
// Con esto encendido, el pedido que entra se acepta solo con los minutos que el
// dueño haya puesto, sin que nadie toque nada. Quien lo hace es el SERVIDOR
// (`motor_auto_aceptar_pedidos`, dentro del cron de cada minuto), no esta pantalla
// ni la app: si dependiera de tener una pantalla abierta no seria automatico, y el
// caso que lo justifica es justo el contrario — el restaurante con TPV que no tiene
// una tablet encendida vigilando.
//
// Va en tarjeta aparte con su propio botón, como el TPV y el Almacén, en vez de
// colgar del "Guardar cambios" general: son dos ajustes que se tocan una vez y no
// tienen nada que ver con el resto de la pantalla.
//
// El reparto no hay que lanzarlo desde aquí: al pasar el pedido a `preparando`, el
// propio cron le busca repartidor.
import { useState } from 'react'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { Zap, Save } from 'lucide-react'

// Los mismos topes que el CHECK de la base de datos (`auto_aceptar_minutos_rango`).
// Se validan aquí también para que el error salga en la pantalla y no como un
// mensaje de Postgres que no le dice nada al dueño.
const MIN = 5
const MAX = 180

export default function AutoAceptarCard() {
  const { restaurante, updateRestaurante } = useRest()
  const [guardando, setGuardando] = useState(false)
  const [borrador, setBorrador] = useState(null)

  if (!restaurante) return null

  const actual = {
    auto_aceptar: !!restaurante.auto_aceptar,
    auto_aceptar_min_reparto: restaurante.auto_aceptar_min_reparto ?? 40,
    auto_aceptar_min_recogida: restaurante.auto_aceptar_min_recogida ?? 20,
  }
  const v = borrador || actual
  const cambiar = (campo, valor) => setBorrador({ ...v, [campo]: valor })
  const hayCambios = borrador && Object.keys(actual).some((k) => borrador[k] !== actual[k])

  const fueraDeRango = (n) => !Number.isFinite(Number(n)) || Number(n) < MIN || Number(n) > MAX
  const malReparto = v.auto_aceptar && fueraDeRango(v.auto_aceptar_min_reparto)
  const malRecogida = v.auto_aceptar && fueraDeRango(v.auto_aceptar_min_recogida)

  async function guardar() {
    if (malReparto || malRecogida) {
      toast(`Los minutos tienen que estar entre ${MIN} y ${MAX}`, 'error')
      return
    }
    setGuardando(true)
    const { error } = await updateRestaurante({
      auto_aceptar: v.auto_aceptar,
      auto_aceptar_min_reparto: Number(v.auto_aceptar_min_reparto),
      auto_aceptar_min_recogida: Number(v.auto_aceptar_min_recogida),
    }) || {}
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    setBorrador(null)
    toast(v.auto_aceptar
      ? 'Los pedidos se aceptarán solos'
      : 'Los pedidos vuelven a aceptarse a mano', 'success')
  }

  return (
    <div style={caja}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Zap size={18} color="var(--c-primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Aceptar los pedidos solos</h3>
        {v.auto_aceptar
          ? <span style={chip('var(--c-success)')}>Activo</span>
          : <span style={chip('var(--c-muted)')}>Apagado</span>}
      </div>
      <div style={nota}>
        Cuando entre un pedido, se acepta solo con el tiempo de preparación que pongas
        aquí. Nadie tiene que estar delante de la pantalla para aceptarlo.
      </div>

      <Interruptor
        titulo="Aceptar sin que nadie lo toque"
        texto={v.auto_aceptar
          ? 'Los pedidos entran ya aceptados y el cliente ve su hora al momento.'
          : 'Ahora mismo cada pedido hay que aceptarlo a mano desde Pedidos.'}
        valor={!!v.auto_aceptar}
        onChange={(x) => cambiar('auto_aceptar', x)}
      />

      {v.auto_aceptar && (
        <>
          <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={label} htmlFor="min-reparto">Minutos a domicilio</label>
              <input id="min-reparto" type="number" min={MIN} max={MAX}
                value={v.auto_aceptar_min_reparto}
                onChange={(e) => cambiar('auto_aceptar_min_reparto', e.target.value)}
                style={{ ...input, borderColor: malReparto ? 'var(--c-danger)' : 'var(--c-border)' }} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={label} htmlFor="min-recogida">Minutos para recoger</label>
              <input id="min-recogida" type="number" min={MIN} max={MAX}
                value={v.auto_aceptar_min_recogida}
                onChange={(e) => cambiar('auto_aceptar_min_recogida', e.target.value)}
                style={{ ...input, borderColor: malRecogida ? 'var(--c-danger)' : 'var(--c-border)' }} />
            </div>
          </div>
          <div style={nota}>
            Al de recoger se le suele poner menos: no hay viaje por medio. Entre {MIN} y {MAX} minutos.
          </div>
          <div style={{ ...nota, marginTop: 10 }}>
            <strong>Ten en cuenta:</strong> el pedido se dará por aceptado aunque no
            estéis mirando. Si un día no podéis hacerlo, hay que cancelarlo desde Pedidos.
          </div>
        </>
      )}

      <button onClick={guardar} disabled={!hayCambios || guardando} style={{
        marginTop: 16, height: 44, padding: '0 18px', borderRadius: 10, border: 'none',
        background: hayCambios ? 'var(--c-primary)' : 'var(--c-border)',
        color: hayCambios ? '#fff' : 'var(--c-muted)',
        fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
        cursor: hayCambios && !guardando ? 'pointer' : 'not-allowed',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Save size={16} /> {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

function Interruptor({ titulo, texto, valor, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginTop: 10,
      borderRadius: 12, border: '1px solid var(--c-border)', background: 'var(--c-surface2)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{texto}</div>
      </div>
      <button
        role="switch"
        aria-checked={valor}
        aria-label={titulo}
        onClick={() => onChange(!valor)}
        style={{
          width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: valor ? 'var(--c-primary)' : 'var(--c-border-strong)',
          position: 'relative', flexShrink: 0, transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: valor ? 23 : 3, width: 22, height: 22,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
        }} />
      </button>
    </div>
  )
}

const caja = {
  background: 'var(--c-surface)', borderRadius: 14, padding: 18,
  border: '1px solid var(--c-border)', marginBottom: 16,
}
const nota = { fontSize: 12, color: 'var(--c-muted)', marginTop: 6, lineHeight: 1.5 }
const label = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--c-muted)' }
const input = {
  width: '100%', height: 44, padding: '0 12px', borderRadius: 10,
  border: '1px solid var(--c-border)', background: 'var(--c-bg)',
  color: 'var(--c-text)', fontSize: 14, fontFamily: 'inherit',
}
const chip = (color) => ({
  fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`,
  borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.04em',
})
