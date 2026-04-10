// Service Worker lifecycle
self.addEventListener('install', function(event) {
  self.skipWaiting()
})

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim())
})

// Firebase Messaging Service Worker
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')
} catch (e) {
  console.warn('[SW] Firebase scripts failed to load:', e)
}

if (typeof firebase !== 'undefined') {
firebase.initializeApp({
  apiKey: "AIzaSyC6z4uvYd1TVHzTN7zuE36R3nkiJBHx6rw",
  authDomain: "pidoo-push.firebaseapp.com",
  projectId: "pidoo-push",
  storageBucket: "pidoo-push.firebasestorage.app",
  messagingSenderId: "797553895667",
  appId: "1:797553895667:web:a2797733db94b6116daf86",
})

const messaging = firebase.messaging()

// Background message handler (when app is in background/closed)
messaging.onBackgroundMessage(function(payload) {
  const title = payload.notification?.title || payload.data?.title || 'Nuevo pedido'
  const options = {
    body: payload.notification?.body || payload.data?.body || 'Tienes un nuevo pedido',
    icon: '/favicon.png',
    badge: '/favicon.png',
    image: '/favicon.png',
    vibrate: [300, 100, 300, 100, 300],
    data: payload.data || {},
    requireInteraction: true,
    tag: 'pedido-' + Date.now(),
  }
  return self.registration.showNotification(title, options)
})
} // end if firebase

// Web Push handler (fallback)
self.addEventListener('push', function(event) {
  let data = { title: 'pidoo', body: 'Tienes una notificación' }
  try {
    data = event.data.json()
  } catch (e) {
    data.body = event.data?.text() || data.body
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'pidoo', {
      body: data.body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      vibrate: [300, 100, 300, 100, 300],
      data: data.data || {},
      requireInteraction: true,
    })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      if (clientList.length > 0) return clientList[0].focus()
      return clients.openWindow('/')
    })
  )
})
