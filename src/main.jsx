import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// El service worker se registra SIEMPRE, no solo al activar el push: además de
// las notificaciones, desde el modo sin internet guarda la última versión de
// la app para poder abrirla con el router caído. Si el entorno no lo soporta
// (WebView vieja), no pasa nada.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
