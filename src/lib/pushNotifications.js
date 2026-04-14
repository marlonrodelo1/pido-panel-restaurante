import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Registra push notifications nativas (FCM/APNs via Capacitor).
 * Guarda el token en Supabase para enviar push desde el servidor.
 * @param {string} userType - 'cliente' | 'restaurante' | 'socio'
 * @param {object} ids - { user_id, establecimiento_id, socio_id }
 * @param {function} onNotification - callback cuando llega una notificación
 */
export async function registerPushNotifications(userType, ids = {}, onNotification) {
  if (!Capacitor.isNativePlatform()) return null

  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return null

  await PushNotifications.register()

  // Obtener token FCM y guardarlo en DB
  PushNotifications.addListener('registration', async (t) => {
    const fcmToken = t.value
    await supabase.from('push_subscriptions').upsert({
      endpoint: `fcm:${fcmToken}`,
      p256dh: '',
      auth: '',
      fcm_token: fcmToken,
      user_type: userType,
      user_id: ids.user_id || null,
      establecimiento_id: ids.establecimiento_id || null,
      socio_id: ids.socio_id || null,
    }, { onConflict: 'endpoint' })
  })

  PushNotifications.addListener('registrationError', (err) => {
    console.error('Error registrando push:', err)
  })

  // Notificación recibida en primer plano
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    if (onNotification) onNotification(notification)
  })

  // Usuario toca la notificación
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    if (onNotification) onNotification(action.notification, true)
  })
}

export async function unregisterPushNotifications() {
  if (!Capacitor.isNativePlatform()) return
  await PushNotifications.removeAllListeners()
}
