// Módulo KIOSKO en Ajustes (14 oct 2026): la pantalla táctil de autopedido del local.
//
// Mismo contrato que el TPV y el Almacén: lo ACTIVA Pidoo (`kiosko_config.activo`,
// congelado para el dueño por `kiosko_config_guard`, PD350) y aquí solo se pausa y se
// cambia el PIN del personal. Sin fila no hay módulo y la tarjeta no se pinta.
//
// Se lee sola en vez de ir por RestContext: es la única pantalla del panel que la
// necesita, y así el módulo no añade una consulta más al arrancar el TPV.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { MonitorSmartphone, Save, ExternalLink } from 'lucide-react'

export default function KioskoConfigCard() {
  const { restaurante } = useRest()
  const [cfg, setCfg] = useState(undefined)   // undefined = cargando, null = sin módulo
  const [pin, setPin] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!restaurante?.id) return
    supabase.from('kiosko_config').select('*').eq('establecimiento_id', restaurante.id).maybeSingle()
      .then(({ data, error }) => { if (!error) { setCfg(data || null); setPin(data?.pin_personal || '') } })
  }, [restaurante?.id])

  if (!cfg) return null

  // `.select()` en los dos updates: si la RLS no dejara, el UPDATE afecta 0 filas
  // SIN error y la tarjeta diría "guardado" sin haberlo hecho.
  async function guardar(cambio, ok) {
    setOcupado(true)
    const { data, error } = await supabase.from('kiosko_config').update(cambio)
      .eq('establecimiento_id', restaurante.id).select('*')
    setOcupado(false)
    if (error || !data?.length) {
      toast('No se pudo guardar' + (error ? ': ' + error.message : ''), 'error')
      return
    }
    setCfg(data[0])
    setPin(data[0].pin_personal || '')
    toast(ok, 'success')
  }

  const pinValido = /^\d{4}$/.test(pin)
  const pinCambiado = pin !== cfg.pin_personal

  return (
    <div style={caja}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <MonitorSmartphone size={18} color="var(--c-primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Kiosko de autopedido</h3>
        {!cfg.activo && <span style={chip('var(--c-muted)')}>Sin activar</span>}
        {cfg.activo && cfg.pausado_por_restaurante && <span style={chip('var(--c-warning)')}>En pausa</span>}
        {cfg.activo && !cfg.pausado_por_restaurante && <span style={chip('var(--c-success)')}>Activo</span>}
      </div>
      <div style={nota}>
        La pantalla táctil del local donde el cliente pide para llevar. El pedido entra
        en cocina al momento y se cobra en caja, antes o al entregarlo.
      </div>

      <a href="/kiosko" target="_blank" rel="noopener" style={{
        marginTop: 14, height: 44, padding: '0 16px', borderRadius: 12, display: 'inline-flex',
        alignItems: 'center', gap: 8, textDecoration: 'none', fontWeight: 700, fontSize: 14,
        border: '1px solid var(--c-border-strong)', color: 'var(--c-text)', background: 'var(--c-surface2)',
      }}>
        <ExternalLink size={16} /> Abrir el kiosko
      </a>
      <div style={nota}>
        Se abre en panel.pidoo.es/kiosko con esta misma cuenta. En la pantalla del
        local, ponlo a pantalla completa (F11).
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginTop: 14,
        borderRadius: 12,
        border: `1px solid ${cfg.pausado_por_restaurante ? 'var(--c-warning)' : 'var(--c-border)'}`,
        background: cfg.pausado_por_restaurante ? 'var(--c-warning-soft)' : 'var(--c-surface2)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Pausar el kiosko</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>
            {cfg.pausado_por_restaurante
              ? 'En pausa: la pantalla enseña «Pide en caja» y no admite pedidos.'
              : 'Funcionando. Púsalo si no podéis atender pedidos del kiosko un rato.'}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={!!cfg.pausado_por_restaurante}
          aria-label="Pausar el kiosko"
          disabled={ocupado}
          onClick={() => guardar(
            { pausado_por_restaurante: !cfg.pausado_por_restaurante },
            cfg.pausado_por_restaurante ? 'Kiosko en marcha' : 'Kiosko en pausa',
          )}
          style={{
            width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
            background: cfg.pausado_por_restaurante ? 'var(--c-primary)' : 'var(--c-border-strong)',
            position: 'relative', flexShrink: 0, transition: 'background .15s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: cfg.pausado_por_restaurante ? 23 : 3, width: 22, height: 22,
            borderRadius: '50%', background: '#fff', transition: 'left .15s',
          }} />
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={label} htmlFor="kiosko-pin">PIN del personal</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            id="kiosko-pin"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
            maxLength={4}
            style={{ ...input, maxWidth: 140, letterSpacing: '0.3em', fontWeight: 700 }}
          />
          <button
            onClick={() => guardar({ pin_personal: pin }, 'PIN guardado')}
            disabled={!pinValido || !pinCambiado || ocupado}
            style={{
              height: 44, padding: '0 18px', borderRadius: 12, border: 'none',
              background: 'var(--c-primary)', color: '#fff', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
              cursor: (!pinValido || !pinCambiado || ocupado) ? 'not-allowed' : 'pointer',
              opacity: (!pinValido || !pinCambiado || ocupado) ? 0.5 : 1,
            }}
          >
            <Save size={16} /> Guardar PIN
          </button>
        </div>
        <div style={nota}>
          4 cifras. En el kiosko, toca 5 veces seguidas la esquina de arriba a la derecha
          y escribe el PIN para pausarlo desde la propia pantalla.
        </div>
      </div>
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
