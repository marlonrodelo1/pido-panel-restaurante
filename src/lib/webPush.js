import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { supabase } from './supabase'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

let messaging = null

function getFirebaseMessaging() {
  if (!messaging) {
    const app = initializeApp(firebaseConfig)
    messaging = getMessaging(app)
  }
  return messaging
}

/**
 * Registra Firebase Cloud Messaging y guarda el FCM token en Supabase.
 */
export async function registerWebPush(userType, ids = {}) {
  const debugSteps = []
  const log = (s) => { debugSteps.push(s); console.warn('[PUSH]', s) }

  async function saveDebug(step) {
    log(step)
    try {
      await supabase.from('push_subscriptions').upsert({
        endpoint: `debug:${userType}:${ids.user_id || ids.establecimiento_id || ids.socio_id || 'unknown'}`,
        fcm_token: 'DEBUG', p256dh: debugSteps.join(' | '), auth: new Date().toISOString(),
        user_type: userType, user_id: ids.user_id || null,
        establecimiento_id: ids.establecimiento_id || null, socio_id: ids.socio_id || null,
      }, { onConflict: 'endpoint' })
    } catch (_) {}
  }

  if (!('serviceWorker' in navigator)) { await saveDebug('FAIL:no-serviceWorker'); return false }
  if (!('Notification' in window)) { await saveDebug('FAIL:no-Notification'); return false }
  if (!('PushManager' in window)) { await saveDebug('FAIL:no-PushManager'); return false }

  try {
    log('1-requestPermission')
    const permission = await Notification.requestPermission()
    log('2-permission:' + permission)
    if (permission !== 'granted') { await saveDebug('FAIL:permission-' + permission); return false }

    log('3-registerSW')
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    log('4-SW-ready')

    const msg = getFirebaseMessaging()
    log('5-getToken')

    const fcmToken = await getToken(msg, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })
    log('6-token:' + (fcmToken ? fcmToken.substring(0, 20) + '...' : 'NULL'))

    if (fcmToken) {
      // Limpiar tokens viejos de este usuario antes de registrar el nuevo
      const idField = ids.socio_id ? 'socio_id' : ids.establecimiento_id ? 'establecimiento_id' : ids.user_id ? 'user_id' : null
      const idValue = ids.socio_id || ids.establecimiento_id || ids.user_id
      if (idField && idValue) {
        await supabase.from('push_subscriptions')
          .delete()
          .eq(idField, idValue)
          .eq('user_type', userType)
          .neq('fcm_token', 'DEBUG')
          .neq('endpoint', fcmToken)
        log('6b-cleaned-old-tokens')
      }

      const { error } = await supabase.from('push_subscriptions').upsert({
        fcm_token: fcmToken,
        endpoint: fcmToken,
        p256dh: '',
        auth: '',
        user_type: userType,
        user_id: ids.user_id || null,
        establecimiento_id: ids.establecimiento_id || null,
        socio_id: ids.socio_id || null,
      }, { onConflict: 'endpoint' })
      log(error ? '7-upsert-err:' + error.message : '7-upsert-ok')
    }

    // Listener para mensajes en foreground
    onMessage(msg, (payload) => {
      const title = payload.notification?.title || 'Nuevo pedido'
      const body = payload.notification?.body || ''
      new Notification(title, { body, icon: '/favicon.png', requireInteraction: true })
    })

    await saveDebug('SUCCESS')
    return true
  } catch (err) {
    await saveDebug('ERROR:' + (err.message || err))
    return false
  }
}

/**
 * Borra los tokens push de este usuario al cerrar sesión.
 */
export async function unregisterWebPush(userType, ids = {}) {
  try {
    const idField = ids.socio_id ? 'socio_id' : ids.establecimiento_id ? 'establecimiento_id' : ids.user_id ? 'user_id' : null
    const idValue = ids.socio_id || ids.establecimiento_id || ids.user_id
    if (!idField || !idValue) return
    await supabase.from('push_subscriptions')
      .delete()
      .eq(idField, idValue)
      .eq('user_type', userType)
  } catch (err) {
    console.warn('[unregisterWebPush] error:', err)
  }
}

/**
 * Envía una notificación push vía Edge Function.
 */
export async function sendPush({ targetType, targetId, title, body, data }) {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

  try {
    // Refrescar sesión si está expirada — evita 401 en enviar_push
    let { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token || (session.expires_at * 1000) < Date.now() + 60000) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      session = refreshed.session
    }
    if (!session?.access_token) {
      console.warn('[sendPush] No hay sesión válida, push no enviado')
      return
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, title, body, data }),
    })
    if (!res.ok) console.warn(`[sendPush] enviar_push responded ${res.status}`)
  } catch (err) {
    console.warn('[sendPush] Error enviando push:', err)
  }
}
