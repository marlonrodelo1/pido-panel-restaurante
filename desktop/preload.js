// El puente entre la pagina y el sistema. Expone EXACTAMENTE tres cosas, las tres de
// impresion, y ninguna mas: la pagina no puede leer ficheros, ni lanzar procesos, ni
// tocar nada de Node. Si algun dia hace falta algo mas, se anade aqui a mano y se
// piensa dos veces.
//
// Los nombres y la forma de los argumentos son los MISMOS que los del plugin de
// Android (`ThermalPrinterPlugin`), asi que `printService.js` no necesita saber en
// cual de las dos plataformas esta corriendo.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pidooDesktop', {
  esEscritorio: true,
  plataforma: process.platform,

  // data va en base64, igual que en Android
  print: ({ ip, port, data }) => ipcRenderer.invoke('pidoo:print', { ip, port, data }),
  checkConnection: ({ ip, port }) => ipcRenderer.invoke('pidoo:check', { ip, port }),
  scanNetwork: ({ port } = {}) => ipcRenderer.invoke('pidoo:scan', { port }),
})
