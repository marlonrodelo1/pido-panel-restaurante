import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

let audioContext = null
let alarmInterval = null
let isPlaying = false
let audioElement = null
let alarmDataUrl = null

// Genera un WAV con un chime premium de 2 notas (A5 → D6) estilo "ding-dong"
// Envelope suave (attack + sustain + release) para evitar clicks y sonar agradable
// Mantiene la intensidad alta para que no se escape al restaurante
function generateAlarmDataUrl() {
  const sampleRate = 44100
  // 0.9s de sonido + 1.6s de silencio → loop natural cada 2.5s
  const duration = 2.5
  const samples = Math.floor(sampleRate * duration)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)

  // WAV header
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples * 2, true)

  // Parámetros de las 2 notas
  const notes = [
    { freq: 880.00,  start: 0.00, dur: 0.35 }, // A5  ("ding")
    { freq: 1174.66, start: 0.28, dur: 0.45 }, // D6  ("dong")
  ]

  // Envelope ADSR sencillo: attack 20ms, release 180ms
  const attack = 0.02
  const release = 0.18

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    let sample = 0

    for (const n of notes) {
      const local = t - n.start
      if (local < 0 || local > n.dur) continue

      // Envelope
      let env
      if (local < attack) env = local / attack
      else if (local > n.dur - release) env = Math.max(0, (n.dur - local) / release)
      else env = 1

      // Sine wave puro (más agradable que square) + ligero armónico para tener cuerpo
      const fundamental = Math.sin(2 * Math.PI * n.freq * local)
      const harmonic = Math.sin(2 * Math.PI * n.freq * 2 * local) * 0.12
      sample += (fundamental + harmonic) * env * 0.75
    }

    // Clip suave y escribir
    sample = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, sample * 32767, true)
  }

  const blob = new Blob([buffer], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

// Pre-crear el audio element al cargar el módulo
function ensureAudioElement() {
  if (!alarmDataUrl) alarmDataUrl = generateAlarmDataUrl()
  if (!audioElement) {
    audioElement = new Audio(alarmDataUrl)
    audioElement.loop = true
    audioElement.volume = 1.0
  }
}

// Intentar pre-crear al cargar el módulo
try { ensureAudioElement() } catch {}

/**
 * Dispara una notificación local nativa con vibración.
 * Funciona sin gesto del usuario en Android.
 */
export async function notificarNuevoPedido(codigo) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Math.random() * 100000),
        title: '🔔 Nuevo pedido',
        body: codigo ? `Pedido ${codigo} esperando aceptación` : 'Tienes un nuevo pedido esperando',
        schedule: { at: new Date(Date.now() + 100) },
        sound: 'default',
        extra: { type: 'nuevo_pedido' },
      }],
    })
  } catch (err) {
    console.warn('[Alarm] Error notificación local:', err)
  }
}

/**
 * Inicia la alarma. Usa HTML5 Audio (funciona sin gesto en Capacitor Android)
 * con fallback a Web Audio API.
 */
export async function startAlarm() {
  if (isPlaying) return
  stopAlarm()
  isPlaying = true

  // Método 1: HTML5 Audio element (funciona sin gesto en Android WebView)
  try {
    ensureAudioElement()
    const playPromise = audioElement.play()
    if (playPromise) {
      playPromise.catch(() => {
        // Si falla el autoplay, intentar Web Audio API
        startWebAudioAlarm()
      })
    }
    return
  } catch {
    // Si falla HTML5 Audio, intentar Web Audio API
  }

  // Método 2: Web Audio API
  startWebAudioAlarm()
}

// Reintentar alarma periódicamente si isPlaying pero no hay audio activo
setInterval(() => {
  if (isPlaying && audioElement && audioElement.paused && !alarmInterval) {
    isPlaying = false
    startAlarm()
  }
}, 3000)

function startWebAudioAlarm() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
    if (audioContext.state === 'suspended') audioContext.resume()

    playAlarmTone(audioContext)
    alarmInterval = setInterval(() => {
      if (audioContext && isPlaying) playAlarmTone(audioContext)
    }, 2500)
  } catch (e) {
    console.warn('Audio no disponible:', e)
    showNotification()
  }
}

/**
 * Detiene la alarma.
 */
export function stopAlarm() {
  isPlaying = false

  if (audioElement) {
    audioElement.pause()
    audioElement.currentTime = 0
  }

  if (alarmInterval) {
    clearInterval(alarmInterval)
    alarmInterval = null
  }
  if (audioContext) {
    try { audioContext.close() } catch {}
    audioContext = null
  }
}

/**
 * Desbloquea audio (para navegadores web). En Android Capacitor no es necesario.
 */
export function unlockAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
    ctx.close()
  } catch {}

  ensureAudioElement()
}

function playAlarmTone(ctx) {
  try {
    if (ctx.state === 'closed') return
    // Chime ding-dong: A5 (0.35s) → gap 30ms → D6 (0.45s) con envelope suave
    playNote(ctx, 880.00, 0, 0.35)
    playNote(ctx, 1174.66, 0.28, 0.45)
  } catch {}
}

function playNote(ctx, freq, startOffset, duration) {
  try {
    if (ctx.state === 'closed') return
    const start = ctx.currentTime + startOffset
    // Oscilador principal (sine = tono limpio)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Pequeño armónico para darle cuerpo
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2
    // Gain con envelope ADSR
    const gain = ctx.createGain()
    const gain2 = ctx.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.75, start + 0.02)        // attack 20ms
    gain.gain.setValueAtTime(0.75, start + duration - 0.18)      // sustain
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration) // release 180ms
    gain2.gain.setValueAtTime(0, start)
    gain2.gain.linearRampToValueAtTime(0.09, start + 0.02)
    gain2.gain.setValueAtTime(0.09, start + duration - 0.18)
    gain2.gain.exponentialRampToValueAtTime(0.001, start + duration)
    osc.connect(gain).connect(ctx.destination)
    osc2.connect(gain2).connect(ctx.destination)
    osc.start(start); osc.stop(start + duration + 0.02)
    osc2.start(start); osc2.stop(start + duration + 0.02)
  } catch {}
}

function showNotification() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Nuevo pedido en pidoo', {
      body: 'Tienes un pedido nuevo esperando',
      icon: '/favicon.png',
      requireInteraction: true,
    })
  }
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
  // También pedir permiso para notificaciones locales en nativo
  if (Capacitor.isNativePlatform()) {
    LocalNotifications.requestPermissions().catch(() => {})
  }
}
