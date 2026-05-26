import { useState, useEffect, useRef } from 'react'
import { Send, MessageCircle, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'
import { colors, type, ds } from '../lib/uiStyles'

export default function Soporte() {
  const { restaurante } = useRest()
  const [mensajes, setMensajes] = useState([])
  const [input, setInput] = useState('')
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const endRef = useRef(null)
  const ultimoEnvio = useRef(0)
  const contadorMinuto = useRef(0)
  const resetContador = useRef(null)

  useEffect(() => {
    if (!restaurante) return
    fetchMensajes()

    const channel = supabase.channel('soporte-rest')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'mensajes',
        filter: `establecimiento_id=eq.${restaurante.id}`,
      }, payload => {
        if (payload.new.tipo === 'soporte') {
          setMensajes(prev => {
            if (prev.some(m => m.id === payload.new.id)) return prev
            return [...prev, payload.new]
          })
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurante?.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes])

  async function fetchMensajes() {
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('establecimiento_id', restaurante.id)
      .eq('tipo', 'soporte')
      .order('created_at', { ascending: true })
      .limit(100)
    setMensajes(data || [])
  }

  async function enviar() {
    if (!input.trim() || enviando) return

    const ahora = Date.now()
    if (ahora - ultimoEnvio.current < 2000) return

    if (contadorMinuto.current >= 30) {
      setErrorEnvio('Espera un momento antes de enviar otro mensaje.')
      return
    }

    const texto = input.trim()
    setInput('')
    setErrorEnvio(null)
    setEnviando(true)
    ultimoEnvio.current = ahora
    contadorMinuto.current += 1
    clearTimeout(resetContador.current)
    resetContador.current = setTimeout(() => { contadorMinuto.current = 0 }, 60000)

    const { error } = await supabase.from('mensajes').insert({
      tipo: 'soporte',
      establecimiento_id: restaurante.id,
      de: 'restaurante',
      texto,
    })
    setEnviando(false)
    if (error) {
      setInput(texto)
      setErrorEnvio('No se pudo enviar. Intenta de nuevo.')
    }
  }

  function formatHora(fecha) {
    return new Date(fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ ...ds.h1, marginBottom: 4 }}>Soporte Pidoo</h2>
      <div style={{ fontSize: type.sm, color: colors.stone, marginBottom: 18 }}>
        Respuesta media en 12 minutos
      </div>

      {/* Card chat */}
      <div style={{
        ...ds.card,
        padding: 0,
        height: 580,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Mensajes scrollables */}
        <div style={{
          flex: 1, padding: 22, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {mensajes.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: colors.stone }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: colors.cream2, color: colors.stone2,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                <MessageCircle size={26} strokeWidth={1.7} />
              </div>
              <div style={{ fontSize: type.sm, color: colors.stone }}>
                Escribe tu mensaje para contactar con soporte
              </div>
            </div>
          )}
          {mensajes.map((m) => {
            const isRest = m.de === 'restaurante'
            return (
              <div key={m.id || m.created_at} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isRest ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '70%',
                  padding: '10px 14px',
                  borderRadius: 14,
                  borderBottomRightRadius: isRest ? 4 : 14,
                  borderBottomLeftRadius: isRest ? 14 : 4,
                  background: isRest ? colors.terracotta : colors.paper,
                  color: isRest ? '#fff' : colors.ink,
                  border: isRest ? 'none' : `1px solid ${colors.border}`,
                  fontSize: type.sm,
                  lineHeight: 1.5,
                }}>
                  {m.texto}
                </div>
                <div style={{ fontSize: 10, color: colors.stone2, marginTop: 4 }}>
                  {formatHora(m.created_at)}
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        {/* Input bar + botón circular ink glossy */}
        <div style={{
          borderTop: `1px solid ${colors.border}`,
          padding: 14, display: 'flex', gap: 10, alignItems: 'center',
          background: colors.paper,
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !enviando && enviar()}
            placeholder="Escribe tu mensaje…"
            style={{ ...ds.formInput, flex: 1 }}
          />
          <button
            onClick={enviar}
            disabled={enviando || !input.trim()}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
              color: colors.cream,
              border: '1px solid rgba(0,0,0,0.4)',
              cursor: enviando || !input.trim() ? 'default' : 'pointer',
              opacity: enviando || !input.trim() ? 0.5 : 1,
              boxShadow: colors.shadowGlossy,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Send size={18} strokeWidth={2} />
          </button>
        </div>

        {errorEnvio && (
          <div style={{
            background: colors.dangerSoft, color: colors.danger,
            padding: '10px 14px', fontSize: type.xs, fontWeight: 600,
            borderTop: `1px solid ${colors.border}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={14} /> {errorEnvio}
          </div>
        )}
      </div>
    </div>
  )
}
