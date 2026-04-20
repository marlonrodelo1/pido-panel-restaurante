import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRest } from '../context/RestContext'

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>Soporte PIDO</h2>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {mensajes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--c-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13 }}>Escribe tu mensaje para contactar con soporte</div>
          </div>
        )}
        {mensajes.map((m) => (
          <div key={m.id || m.created_at} style={{ alignSelf: m.de === 'restaurante' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{
              background: m.de === 'restaurante' ? 'var(--c-primary)' : 'var(--c-surface)',
              color: m.de === 'restaurante' ? '#fff' : 'var(--c-text)',
              borderRadius: 14,
              borderBottomRightRadius: m.de === 'restaurante' ? 4 : 14,
              borderBottomLeftRadius: m.de === 'soporte' ? 4 : 14,
              padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
              border: m.de === 'soporte' ? '1px solid var(--c-border)' : 'none',
            }}>{m.texto}</div>
            <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 4, textAlign: m.de === 'restaurante' ? 'right' : 'left' }}>
              {formatHora(m.created_at)}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {errorEnvio && (
        <div style={{ color: '#DC2626', fontSize: 12, fontWeight: 600, marginBottom: 8, padding: '8px 12px', background: 'rgba(220,38,38,0.1)', borderRadius: 8 }}>
          ⚠️ {errorEnvio}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !enviando && enviar()}
          placeholder="Escribe tu mensaje..."
          style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid var(--c-border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none' }} />
        <button onClick={enviar} disabled={enviando || !input.trim()} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: enviando || !input.trim() ? 'rgba(0,0,0,0.1)' : 'var(--c-primary)', color: '#fff', cursor: enviando || !input.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  )
}
