// Pidoo Negocios para Windows.
//
// POR QUE EXISTE ESTO Y NO BASTA CON ABRIR panel.pidoo.es EN EL NAVEGADOR:
// la impresora termica y el cajon portamonedas se hablan por un SOCKET TCP al puerto
// 9100. Un navegador no puede abrir un socket crudo — no hay API, ni permiso, ni
// truco. Una app de escritorio si. Eso es todo lo que anade esta carcasa: los tres
// metodos de impresion. La aplicacion en si sigue siendo la web.
//
// Y por eso carga la URL REMOTA en vez de empaquetar el frontend: cuando se despliega
// panel.pidoo.es, el escritorio se actualiza solo. Solo hay que volver a firmar y
// distribuir el instalador cuando cambie ESTA carcasa, que es casi nunca.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
// La parte que habla con la impresora vive aparte para poder PROBARLA sin Electron:
// `node prueba-impresion.js`. Ver ahi lo que cubre.
const { registrarCanales } = require('./impresion')

const URL_PANEL = process.env.PIDOO_URL || 'https://panel.pidoo.es'
const ORIGEN = new URL(URL_PANEL).origin

registrarCanales(ipcMain)

// ─── La ventana ─────────────────────────────────────────────────────────────

let ventana = null

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#F7F3EC',
    show: false,
    title: 'Pidoo Negocios',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Las tres de seguridad. El puente expone SOLO los tres metodos de impresion:
      // la pagina no puede tocar el sistema de ficheros ni nada de Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // el preload necesita `require('electron')`
    },
  })

  ventana.once('ready-to-show', () => ventana.show())
  ventana.loadURL(URL_PANEL)

  // Nada de navegar fuera del panel dentro de la ventana. Un enlace externo se abre en
  // el navegador del sistema, donde el usuario ve la barra de direcciones y sabe donde
  // esta. Sin esto, un enlace en una reseña podria pintar una pantalla de login falsa
  // dentro de una ventana que parece la app.
  const esNuestro = (u) => { try { return new URL(u).origin === ORIGEN } catch { return false } }
  ventana.webContents.on('will-navigate', (e, u) => {
    if (!esNuestro(u)) { e.preventDefault(); shell.openExternal(u) }
  })
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (esNuestro(url)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  ventana.webContents.on('did-fail-load', (_e, codigo, desc, urlFallida, esPrincipal) => {
    if (!esPrincipal || codigo === -3) return // -3 es una navegacion abortada, no un fallo
    dialog.showMessageBox(ventana, {
      type: 'warning',
      title: 'Sin conexion',
      message: 'No se ha podido cargar el panel.',
      detail: 'Comprueba la conexion a internet y pulsa Reintentar.\n\n' + desc + ' (' + urlFallida + ')',
      buttons: ['Reintentar', 'Salir'],
      defaultId: 0,
    }).then(({ response }) => (response === 0 ? ventana.loadURL(URL_PANEL) : app.quit()))
  })

  ventana.on('closed', () => { ventana = null })
}

// Una sola ventana: dos copias abiertas contra la misma impresora sacan la comanda dos
// veces, y en cocina eso es una hamburguesa de mas.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus() }
  })
  app.whenReady().then(() => {
    crearVentana()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) crearVentana() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
