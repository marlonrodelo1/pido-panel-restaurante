import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// El KIOSKO de autopedido (panel.pidoo.es/kiosko) es una app aparte en su propio
// trozo: no monta el panel, ni la alarma, ni la impresora. Ver kiosko/KioskoApp.jsx.
const KioskoApp = lazy(() => import('./kiosko/KioskoApp.jsx'))
const esKiosko = typeof window !== 'undefined' && /^\/kiosko\/?$/.test(window.location.pathname)

// El service worker se registra SIEMPRE, no solo al activar el push: además de
// las notificaciones, desde el modo sin internet guarda la última versión de
// la app para poder abrirla con el router caído. Si el entorno no lo soporta
// (WebView vieja), no pasa nada.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {esKiosko
      ? <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#1A1815' }} />}><KioskoApp /></Suspense>
      : <App />}
  </StrictMode>,
)
