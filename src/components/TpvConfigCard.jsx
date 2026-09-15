// Configuración del módulo TPV, en el PANEL WEB.
//
// El TPV se usa en la tablet (la APK), pero se configura desde aquí: sentarse a
// escribir el pie del ticket o la IP de la impresora con el teclado del ordenador
// es mucho más cómodo que hacerlo en el mostrador con el dedo.
//
// Solo aparece si el restaurante tiene el módulo dado de alta. Lo que es de Pidoo
// —que esté activo, la serie del ticket y el tipo de IGIC— se muestra pero no se
// puede tocar: lo impide `tpv_config_guard` en la base de datos (PD190-PD192), así
// que aquí ni siquiera se ofrece.
//
// La base del cajón es del DUEÑO: el equipo la ve, pero solo el dueño la cambia
// (`tpv_config_guard`, PD285). El resto de esta tarjeta sí lo puede guardar el
// equipo.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { toast } from '../App'
import { Calculator, Save } from 'lucide-react'

export default function TpvConfigCard() {
  const { restaurante, tpvConfig, setTpvConfig, user } = useRest()
  const [guardando, setGuardando] = useState(false)
  const [borrador, setBorrador] = useState(null)

  if (!tpvConfig) return null

  // El dueño es quien figura en `establecimientos.user_id`: lo mismo que mira la
  // base de datos. Quien entra como equipo, o con otra cuenta por el correo, no
  // lo es. (No es un hook: puede ir detrás del return.)
  const esDueno = !!user?.id && restaurante?.user_id === user.id

  const v = borrador || tpvConfig
  const cambiar = (campo, valor) => setBorrador({ ...v, [campo]: valor })
  // La base del cajón se escribe como texto ("50,00") y en la BD es un número:
  // compararlos a pelo daría "hay cambios" nada más tocar el campo sin cambiarlo.
  // Y solo cuenta como cambio si alguien la ha ESCRITO (es texto): el número que
  // copia el borrador al tocar otro campo no es un cambio (ver `guardar`).
  const hayCambios = borrador && Object.keys(borrador).some((k) => (
    k === 'fondo_base'
      ? (typeof borrador[k] === 'string' && !mismaBase(borrador[k], tpvConfig[k]))
      : borrador[k] !== tpvConfig[k]
  ))

  async function guardar() {
    // 🔴 LA BASE SOLO SE MANDA SI SE HA ESCRITO EN EL CAMPO (15 sep 2026). Antes
    // se mandaba en cada guardado la que hubiera en el borrador, y el borrador
    // copia la configuración entera al tocar cualquier cosa. Si el dueño cambiaba
    // la base a 60 desde otro aparato, guardar aquí el pie del ticket devolvía
    // el 50 viejo sin avisar; y si guardaba alguien del equipo, el guardado entero
    // fallaba (PD285) aunque no hubiera tocado la base. Lo escrito llega como
    // texto; lo copiado, como número: por eso basta con mirar el tipo.
    const baseEscrita = typeof borrador?.fondo_base === 'string' && !mismaBase(borrador.fondo_base, tpvConfig.fondo_base)
    let base = null
    if (baseEscrita) {
      if (!esDueno) { toast('La base del cajón solo la cambia el dueño.', 'error'); return }
      base = aEuros(borrador.fondo_base)
      if (!(base >= 0)) {
        toast('Escribe la base del cajón con números, por ejemplo 50 o 50,00', 'error')
        return
      }
    }

    setGuardando(true)
    // Solo se mandan los campos que el dueño puede tocar. Enviar los demás haría
    // saltar el guard con un error que no ayudaría a nadie.
    const { data, error } = await supabase.from('tpv_config').update({
      pausado_por_restaurante: v.pausado_por_restaurante,
      abrir_cajon_efectivo: v.abrir_cajon_efectivo,
      abrir_cajon_datafono: v.abrir_cajon_datafono,
      pie_ticket: (v.pie_ticket || '').trim() || null,
      impresora_ip: (v.impresora_ip || '').trim() || null,
      impresora_puerto: Number(v.impresora_puerto) || 9100,
      ...(base != null ? { fondo_base: base } : {}),
    }).eq('establecimiento_id', restaurante.id).select().single()
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    setTpvConfig(data)
    setBorrador(null)
    toast('Configuración del TPV guardada', 'success')
  }

  return (
    <div style={caja}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Calculator size={18} color="var(--c-primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>TPV del mostrador</h3>
        {!tpvConfig.activo && <span style={chip('var(--c-muted)')}>Sin activar</span>}
        {tpvConfig.activo && v.pausado_por_restaurante && <span style={chip('var(--c-warning)')}>En pausa</span>}
        {tpvConfig.activo && !v.pausado_por_restaurante && <span style={chip('var(--c-success)')}>Activo</span>}
      </div>
      <div style={nota}>
        Se usa desde la app instalada en la tablet del mostrador. Aquí se configura.
      </div>

      {/* Lo que decide Pidoo: se enseña, no se toca */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
        <Dato titulo="Serie del ticket" valor={tpvConfig.serie_ticket} />
        <Dato titulo="IGIC" valor={`${Number(tpvConfig.igic_pct).toFixed(0)} %`} />
      </div>
      <div style={{ ...nota, marginBottom: 18 }}>
        La serie y el IGIC los configura Pidoo con tu gestor: si cambiaran a mitad de
        año, la numeración de tus tickets dejaría de ser correlativa.
      </div>

      <Interruptor
        titulo="Pausar el TPV"
        texto={v.pausado_por_restaurante
          ? 'Está en pausa: no se puede cobrar desde la tablet.'
          : 'Funcionando. Púsalo si quieres dejar de cobrar por el mostrador un rato.'}
        valor={!!v.pausado_por_restaurante}
        onChange={(x) => cambiar('pausado_por_restaurante', x)}
        alerta={!!v.pausado_por_restaurante}
      />

      <Interruptor
        titulo="Abrir el cajón al cobrar en efectivo"
        texto="La impresora manda el pulso al cajón en cuanto se cobra."
        valor={!!v.abrir_cajon_efectivo}
        onChange={(x) => cambiar('abrir_cajon_efectivo', x)}
      />

      <Interruptor
        titulo="Abrir el cajón al cobrar con datáfono"
        texto="Normalmente no hace falta: con tarjeta no hay que dar cambio."
        valor={!!v.abrir_cajon_datafono}
        onChange={(x) => cambiar('abrir_cajon_datafono', x)}
      />

      {/* LA BASE DEL CAJÓN (15 sep 2026). Al cerrar la caja, lo que pasa de aquí
          se va a la caja mayor y en el cajón se queda esta cantidad para dar
          cambio al día siguiente. Se escribe como texto para admitir la coma.
          Mientras no se escribe, se enseña la guardada, no la copia del
          borrador: si se cambió desde otro aparato, aquí se ve la buena. El
          equipo la ve pero no la puede tocar (PD285). */}
      <div style={{ marginTop: 16 }}>
        <label style={label} htmlFor="tpv-fondo-base">Base del cajón (€)</label>
        <input
          id="tpv-fondo-base"
          inputMode="decimal"
          value={typeof v.fondo_base === 'string' ? v.fondo_base : textoBase(tpvConfig.fondo_base)}
          onChange={(e) => cambiar('fondo_base', e.target.value)}
          placeholder="50,00"
          maxLength={9}
          disabled={!esDueno}
          style={{ ...input, maxWidth: 200, opacity: esDueno ? 1 : 0.6, cursor: esDueno ? 'text' : 'not-allowed' }}
        />
        <div style={nota}>
          {esDueno
            ? 'Lo que se deja en el cajón cada noche para dar cambio. Lo demás pasa a la caja mayor al cerrar.'
            : 'Lo que se deja en el cajón cada noche para dar cambio. Solo la cambia el dueño.'}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={label}>Pie del ticket</label>
        <input
          value={v.pie_ticket || ''}
          onChange={(e) => cambiar('pie_ticket', e.target.value)}
          placeholder="Gracias por su visita"
          maxLength={60}
          style={input}
        />
        <div style={nota}>Se imprime al final de cada ticket.</div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 200px' }}>
          <label style={label}>IP de la impresora</label>
          <input
            value={v.impresora_ip || ''}
            onChange={(e) => cambiar('impresora_ip', e.target.value)}
            placeholder="192.168.1.210"
            style={input}
          />
        </div>
        <div style={{ flex: '1 1 100px' }}>
          <label style={label}>Puerto</label>
          <input
            value={v.impresora_puerto ?? 9100}
            onChange={(e) => cambiar('impresora_puerto', e.target.value.replace(/\D/g, ''))}
            style={input}
          />
        </div>
      </div>
      <div style={nota}>
        Guardarla aquí evita tener que volver a configurarla si reinstalas la app o
        cambias de tablet.
      </div>

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

// "50", "50,5", "50,00" o "50.00" → 50 / 50.5. Cualquier otra cosa → NaN.
// Máximo dos decimales: así "1.250" no se cuela como uno con veinticinco.
function aEuros(texto) {
  const s = String(texto ?? '').trim().replace(/\s|€/g, '')
  if (!s) return NaN
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return NaN
  return Number(normal)
}

// La base tal como se ve en el campo: con coma, que es como se escribe aquí.
function textoBase(n) {
  if (n == null || n === '') return ''
  const x = Number(n)
  return Number.isFinite(x) ? String(x).replace('.', ',') : ''
}

// ¿Lo escrito es la misma base que la guardada? Un texto que no es un número
// cuenta como cambio, para que al guardar salga el aviso en vez de ignorarse.
function mismaBase(escrito, guardado) {
  const a = typeof escrito === 'string' ? aEuros(escrito) : (escrito == null ? null : Number(escrito))
  const b = guardado == null ? null : Number(guardado)
  if (Number.isNaN(a)) return false
  return a === b
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

function Dato({ titulo, valor }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{valor}</div>
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
