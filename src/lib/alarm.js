import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

let audioContext = null
let alarmInterval = null
let isPlaying = false
let audioElement = null
let alarmDataUrl = null

// Generar un wav de alarma en base64 (sirena corta) para no depender de archivos externos
function generateAlarmDataUrl() {
  const sampleRate = 22050
  const duration = 0.5
  const samples = sampleRate * duration
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

  // Generate two-tone siren
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    const freq = t < 0.25 ? 1000 : 1400
    const val = Math.sin(2 * Math.PI * freq * t) * 0.9
    view.setInt16(44 + i * 2, val * 32767, true)
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
    }, 600)
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
    playBeep(ctx, 1000, 0.25, 1.0)
    setTimeout(() => {
      if (isPlaying && ctx.state !== 'closed') playBeep(ctx, 1400, 0.25, 1.0)
    }, 280)
  } catch {}
}

function playBeep(ctx, frequency, duration, volume) {
  try {
    if (ctx.state === 'closed') return
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    oscillator.frequency.value = frequency
    oscillator.type = 'square'
    gainNode.gain.setValueAtTime(volume, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration)
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
