import { useState } from 'react'
import { Search, Plus, Trash2, ClipboardCheck, Pencil } from 'lucide-react'
import { colors, ds, radius, type, col, tablaScroll, filaMin } from '../../lib/uiStyles'
import { toast } from '../../App'
import { cantidad, eur, eurCoste, apuntarMerma, recuento, MOTIVOS_MERMA } from '../../lib/stock'
import ArticuloModal from './ArticuloModal'

export default function ArticulosTab({ estId, articulos, onCambio }) {
  const [busca, setBusca] = useState('')
  const [familia, setFamilia] = useState('')
  const [editando, setEditando] = useState(null)   // artículo o {} para nuevo
  const [accion, setAccion] = useState(null)       // { articulo, tipo: 'merma' | 'recuento' }

  const visibles = articulos.filter(a => {
    if (familia && (a.familia || 'Otros') !== familia) return false
    if (busca.trim() && !a.nombre.toLowerCase().includes(busca.trim().toLowerCase())) return false
    return true
  })

  const familiasUsadas = [...new Set(articulos.map(a => a.familia).filter(Boolean))]

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={15} color={colors.textMute}
            style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar carne, pan, queso…" style={{ ...ds.input, paddingLeft: 34 }} />
        </div>
        {familiasUsadas.length > 0 && (
          <select value={familia} onChange={e => setFamilia(e.target.value)}
            style={{ ...ds.select, width: 'auto', minWidth: 160 }}>
            <option value="">Todas las familias</option>
            {familiasUsadas.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <button onClick={() => setEditando({})} style={ds.primaryBtn}>
          <Plus size={15} /> Añadir artículo
        </button>
      </div>

      <div style={{ ...ds.table, ...tablaScroll }}>
        <div style={{ ...ds.tableHeader, ...filaMin(880) }}>
          <div style={{ flex: 1, minWidth: 0 }}>Lo que compras</div>
          <div style={col(96)}>Quedan</div>
          <div style={col(96)}>Te cuesta</div>
          <div style={col(96)}>Valor</div>
          <div style={col(316, 'right')}></div>
        </div>

        {!visibles.length && (
          <div style={{ ...ds.muted, padding: 30, textAlign: 'center' }}>
            {articulos.length
              ? 'Ningún artículo con esos filtros.'
              : (
                <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'left', lineHeight: 1.7 }}>
                  Aquí va <strong>lo que le compras al proveedor</strong>: carne, pan, queso,
                  aceite… cada uno con su unidad y su precio.
                  <br />
                  Los platos de tu carta no se apuntan aquí: se montan en{' '}
                  <strong>Escandallos</strong>, con estos artículos dentro.
                  <br />
                  Lo que compras y vendes igual —una lata, una cerveza, un agua— sí va en los
                  dos sitios. Créalos con el botón de arriba.
                </div>
              )}
          </div>
        )}

        {visibles.map(a => {
          const ex = Number(a.existencia)
          const negativo = ex < 0
          const bajo = !negativo && Number(a.minimo) > 0 && ex <= Number(a.minimo)
          return (
            <div key={a.id} style={{
              ...ds.tableRow, ...filaMin(880),
              background: negativo ? colors.dangerSoft : bajo ? colors.warningSoft : undefined,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button onClick={() => setEditando(a)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: type.sm, fontWeight: 600,
                  color: colors.text, textAlign: 'left', display: 'block',
                  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {a.nombre}
                </button>
                {/* Solo se dice lo que se sale de lo normal. Repetir "Sin familia" en
                    cada fila era ruido y ademas hacia la fila el doble de alta. */}
                {(a.familia || !a.activo || !a.controla_agotado) && (
                  <div style={{ ...ds.muted, marginTop: 1 }}>
                    {[a.familia, !a.activo && 'archivado',
                      !a.controla_agotado && 'no agota la carta']
                      .filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <div style={{
                ...col(96),
                fontWeight: 700, color: negativo ? colors.danger : colors.text,
              }}>
                {cantidad(ex, a.unidad)}
              </div>
              <div style={{ ...col(96), color: colors.textMute }}>
                {Number(a.coste_medio) > 0 ? eurCoste(a.coste_medio) : '—'}
              </div>
              <div style={{ ...col(96), fontWeight: 600 }}>
                {eur(ex * Number(a.coste_medio))}
              </div>
              <div style={{ ...col(316), display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setAccion({ articulo: a, tipo: 'merma' })}
                  style={{ ...ds.miniBtn, flexShrink: 0 }} title="Apuntar una merma">
                  <Trash2 size={12} /> Merma
                </button>
                <button onClick={() => setAccion({ articulo: a, tipo: 'recuento' })}
                  style={{ ...ds.miniBtn, flexShrink: 0 }} title="Contar lo que hay de verdad">
                  <ClipboardCheck size={12} /> Contar
                </button>
                {/* Antes solo se podia editar tocando el nombre, y eso no se ve. */}
                <button onClick={() => setEditando(a)}
                  style={{ ...ds.miniBtn, flexShrink: 0 }} title="Editar el artículo">
                  <Pencil size={12} /> Editar
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editando && (
        <ArticuloModal
          estId={estId}
          familiasUsadas={familiasUsadas}
          articulo={editando.id ? editando : null}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); onCambio() }}
        />
      )}

      {accion && (
        <AccionModal
          {...accion}
          onCerrar={() => setAccion(null)}
          onHecho={() => { setAccion(null); onCambio() }}
        />
      )}
    </div>
  )
}

// Merma y recuento en un solo modal de un campo: son las dos acciones del día a día
// y ninguna admite discusión. La merma resta lo que se ha perdido; el recuento pone
// la cifra real y absorbe todo lo que el sistema no supo descontar.
function AccionModal({ articulo, tipo, onCerrar, onHecho }) {
  const [valor, setValor] = useState('')
  const [coste, setCoste] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS_MERMA[0])
  const [guardando, setGuardando] = useState(false)

  const esMerma = tipo === 'merma'
  const num = Number(String(valor).replace(',', '.'))
  const valido = valor !== '' && !Number.isNaN(num) && (esMerma ? num > 0 : num >= 0)
  const diferencia = !esMerma && valido ? num - Number(articulo.existencia) : null

  async function guardar() {
    setGuardando(true)
    try {
      if (esMerma) await apuntarMerma(articulo.id, num, motivo)
      else await recuento(articulo.id, num, coste ? Number(String(coste).replace(',', '.')) : null)
      toast(esMerma ? 'Merma apuntada' : 'Recuento guardado', 'success')
      onHecho()
    } catch (e) {
      toast(e.message, 'error')
      setGuardando(false)
    }
  }

  return (
    <div style={ds.modal} onClick={onCerrar}>
      <div style={ds.modalContent} onClick={e => e.stopPropagation()}>
        <h2 style={ds.h2}>{esMerma ? 'Apuntar merma' : 'Recuento'}</h2>
        <div style={{ ...ds.dim, marginBottom: 4 }}>{articulo.nombre}</div>
        <div style={{ ...ds.muted, marginBottom: 16 }}>
          El sistema dice que quedan <strong>{cantidad(articulo.existencia, articulo.unidad)}</strong>
        </div>

        <label style={ds.label}>
          {esMerma ? '¿Cuánto se ha perdido?' : '¿Cuánto hay de verdad?'}
        </label>
        <input autoFocus inputMode="decimal" value={valor}
          onChange={e => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0" style={{ ...ds.formInput, height: 46, fontSize: 20, fontWeight: 700, textAlign: 'right' }} />

        {esMerma && (
          <>
            <label style={{ ...ds.label, marginTop: 16 }}>¿Qué ha pasado?</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MOTIVOS_MERMA.map(m => (
                <button key={m} onClick={() => setMotivo(m)} style={{
                  ...ds.filterBtn,
                  background: motivo === m ? colors.primary : colors.paper,
                  color: motivo === m ? colors.cream : colors.textDim,
                  borderColor: motivo === m ? colors.primary : colors.border,
                }}>{m}</button>
              ))}
            </div>
          </>
        )}

        {!esMerma && (
          <>
            <label style={{ ...ds.label, marginTop: 16 }}>¿A cómo te sale? (opcional)</label>
            <input inputMode="decimal" value={coste}
              onChange={e => setCoste(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder={`€ por ${articulo.unidad}`} style={ds.formInput} />
            {diferencia !== null && diferencia !== 0 && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: radius.sm,
                background: colors.surface2, fontSize: type.sm, color: colors.textDim,
              }}>
                Se apuntará una diferencia de{' '}
                <strong style={{ color: diferencia > 0 ? colors.sage2 : colors.danger }}>
                  {diferencia > 0 ? '+' : '−'}{cantidad(Math.abs(diferencia), articulo.unidad)}
                </strong>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onCerrar} style={ds.secondaryBtn}>Cancelar</button>
          <button onClick={guardar} disabled={!valido || guardando} style={{
            ...ds.primaryBtn,
            opacity: (!valido || guardando) ? 0.5 : 1,
            cursor: (!valido || guardando) ? 'not-allowed' : 'pointer',
          }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
