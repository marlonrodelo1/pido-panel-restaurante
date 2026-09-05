// Service Worker lifecycle
self.addEventListener('install', function(event) {
  self.skipWaiting()
})

// ── MODO SIN INTERNET (fase 1) ───────────────────────────────────────────────
// La app (también la de Windows, que carga esta web) guarda aquí su última
// versión buena para poder ABRIR sin conexión:
//  - Navegación (index.html): red primero — con internet SIEMPRE la versión
//    nueva, como hasta ahora — y si no hay red, la última copia guardada.
//  - /assets/* llevan hash en el nombre (inmutables): caché primero, y a la
//    caché entran la primera vez que se piden con red.
// Lo de fuera (Supabase, FCM, Google) NI SE TOCA: el SW solo media en lo
// servido por este mismo dominio.
var CACHE_OFFLINE = 'pidoo-offline-v1'

self.addEventListener('activate', function(event) {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(function(claves) {
      return Promise.all(claves
        .filter(function(k) { return k.indexOf('pidoo-offline-') === 0 && k !== CACHE_OFFLINE })
        .map(function(k) { return caches.delete(k) }))
    }),
  ]))
})

self.addEventListener('fetch', function(event) {
  var req = event.request
  if (req.method !== 'GET') return
  var url
  try { url = new URL(req.url) } catch (e) { return }
  if (url.origin !== self.location.origin) return

  // La página en sí: red primero, copia local de respaldo.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function(resp) {
        if (resp && resp.ok) {
          var copia = resp.clone()
          caches.open(CACHE_OFFLINE).then(function(c) { c.put('/__shell', copia) }).catch(function() {})
        }
        return resp
      }).catch(function() {
        return caches.match('/__shell').then(function(hit) {
          return hit || new Response('Sin conexion y sin copia guardada. Abre la app una vez con internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        })
      })
    )
    return
  }

  // Assets con hash y estáticos del propio dominio: caché primero.
  var estatico = url.pathname.indexOf('/assets/') === 0
    || /\.(js|css|png|svg|ico|woff2?|ttf|webmanifest|mp3|wav)$/.test(url.pathname)
  if (estatico) {
    event.respondWith(
      caches.match(req).then(function(hit) {
        if (hit) return hit
        return fetch(req).then(function(resp) {
          if (resp && resp.ok) {
            var copia = resp.clone()
            caches.open(CACHE_OFFLINE).then(function(c) { c.put(req, copia) }).catch(function() {})
          }
          return resp
        })
      })
    )
  }
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
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
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
  var data = event.notification.data || {}
  var target = '/'
  if (data.url) target = data.url
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i]
        if ('focus' in c) {
          c.postMessage({ type: 'navigate', target: target, pedido_id: data.pedido_id || null })
          return c.focus()
        }
      }
      return clients.openWindow(target)
    })
  )
})
