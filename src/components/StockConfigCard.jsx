// Configuración del módulo Almacén, en Ajustes.
//
// Solo aparece si Pidoo le ha dado de alta el módulo al restaurante (sin fila de
// `stock_config` no hay nada que enseñar).
//
// Lo que es de Pidoo —que el módulo esté activo— se muestra pero no se puede tocar:
// lo impide `stock_config_guard` (PD231), así que aquí ni siquiera se ofrece. Lo que
// sí es del dueño: pausarlo, y decidir si un producto sin existencias desaparece de
// la web o solo se avisa.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { Boxes, Save } from 'lucide-react'

export default function StockConfigCard() {
  const { restaurante, stockConfig, setStockConfig } = useRest()
  const [guardando, setGuardando] = useState(false)
  const [borrador, setBorrador] = useState(null)

  if (!stockConfig) return null

  const v = borrador || stockConfig
  const cambiar = (campo, valor) => setBorrador({ ...v, [campo]: valor })
  const hayCambios = borrador && Object.keys(borrador).some(k => borrador[k] !== stockConfig[k])

  async function guardar() {
    setGuardando(true)
    // Solo los campos que el dueño puede tocar. Mandar los demás haría saltar el
    // guard con un error que no ayudaría a nadie.
    const { data, error } = await supabase.from('stock_config').update({
      pausado_por_restaurante: v.pausado_por_restaurante,
      agotar_web: v.agotar_web,
      avisar_bajo_minimo: v.avisar_bajo_minimo,
    }).eq('establecimiento_id', restaurante.id).select().single()
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    setStockConfig(data)
    setBorrador(null)
    toast('Configuración del almacén guardada', 'success')
  }

  return (
    <div style={caja}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Boxes size={18} color="var(--c-primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Almacén y escandallos</h3>
        {!stockConfig.activo && <span style={chip('var(--c-muted)')}>Sin activar</span>}
        {stockConfig.activo && v.pausado_por_restaurante && <span style={chip('var(--c-warning)')}>En pausa</span>}
        {stockConfig.activo && !v.pausado_por_restaurante && <span style={chip('var(--c-success)')}>Activo</span>}
      </div>
      <div style={nota}>
        Aquí llevas lo que compras a tus proveedores —pan, carne, queso— y el escandallo
        de cada plato: su receta, para saber lo que te cuesta. Se gestiona desde la sección{' '}
        <strong>Almacén</strong> de este panel. En la tablet del mostrador tienes lo del día
        a día dentro del TPV: ver lo que queda, apuntar una merma y hacer recuento.
      </div>

      {!stockConfig.arranque_at && stockConfig.activo && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--c-warning)', background: 'var(--c-warning-soft)',
          fontSize: 12, lineHeight: 1.5,
        }}>
          Todavía no has hecho el <strong>recuento inicial</strong>. Hasta que lo hagas,
          el inventario está a cero. Entra en Almacén y son tres pasos.
        </div>
      )}

      <Interruptor
        titulo="Pausar el almacén"
        texto={v.pausado_por_restaurante
          ? 'En pausa: las ventas no descuentan existencias. Cuando lo reactives, lo vendido mientras tanto no se habrá restado — hazte un recuento.'
          : 'Funcionando. Cada plato que vendes descuenta los artículos de su receta.'}
        valor={!!v.pausado_por_restaurante}
        onChange={x => cambiar('pausado_por_restaurante', x)}
        alerta={!!v.pausado_por_restaurante}
      />

      <Interruptor
        titulo="Agotar productos en la web cuando no queden existencias"
        texto={v.agotar_web
          ? 'Si se acaba un ingrediente, los platos que lo llevan desaparecen de la carta en pidoo.es y en el QR hasta que vuelva a entrar género. En el mostrador se sigue vendiendo igual: la barra nunca se frena.'
          : 'No se apaga nada solo. Podrás recibir pedidos de platos sin género.'}
        valor={!!v.agotar_web}
        onChange={x => cambiar('agotar_web', x)}
      />

      <Interruptor
        titulo="Avisarme cuando algo baje del mínimo"
        texto="Aparece en el resumen del almacén."
        valor={!!v.avisar_bajo_minimo}
        onChange={x => cambiar('avisar_bajo_minimo', x)}
      />

      <button onClick={guardar} disabled={!hayCambios || guardando} style={{
        marginTop: 18, height: 44, padding: '0 20px', borderRadius: 12, border: 'none',
        background: 'var(--c-primary)', color: '#fff', fontWeight: 700, fontSize: 14,
        fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
        cursor: (!hayCambios || guardando) ? 'not-allowed' : 'pointer',
        opacity: (!hayCambios || guardando) ? 0.5 : 1,
      }}>
        <Save size={16} />
        {guardando ? 'Guardando…' : hayCambios ? 'Guardar cambios' : 'Sin cambios'}
      </button>
    </div>
  )
}

function Interruptor({ titulo, texto, valor, onChange, alerta }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginTop: 10,
      borderRadius: 12,
      border: `1px solid ${alerta ? 'var(--c-warning)' : 'var(--c-border)'}`,
      background: alerta ? 'var(--c-warning-soft)' : 'var(--c-surface2)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, lineHeight: 1.5 }}>{texto}</div>
      </div>
      <button role="switch" aria-checked={valor} aria-label={titulo}
        onClick={() => onChange(!valor)}
        style={{
          width: 48, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
          background: valor ? 'var(--c-primary)' : 'var(--c-border-strong)',
          position: 'relative', flexShrink: 0, transition: 'background .15s',
        }}>
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
const chip = (color) => ({
  fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`,
  borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.04em',
})
