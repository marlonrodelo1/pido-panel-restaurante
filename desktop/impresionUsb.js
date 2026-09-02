// Imprimir en una impresora térmica conectada por USB a este ordenador.
//
// POR QUÉ HACE FALTA, teniendo ya la impresión por red: la impresora del mostrador
// de Duende Burger está enchufada por USB al ordenador, no al router. Comprobado el
// 2 sep 2026 escaneando su red: el puerto 9100 de ese equipo está CERRADO, así que
// por el camino de siempre no hay nada que hacer. No es que esté mal configurada —
// es que le faltaba este camino.
//
// CÓMO SE MANDA UN TICKET A UNA IMPRESORA USB EN WINDOWS
//
// Hay que meterle los bytes ESC/POS **crudos**, sin que el driver los interprete: si
// pasaran por el dibujado normal de Windows saldría una página en blanco o una hoja
// A4 con basura. Eso en Windows es el «datatype RAW» del spooler, y para llegar ahí
// hay que llamar a `winspool.drv` (OpenPrinter → StartDocPrinter → WritePrinter).
//
// Se hace con PowerShell y no con un módulo nativo de Node A PROPÓSITO: un módulo
// nativo hay que recompilarlo para cada versión de Electron, y el día que Electron
// suba de versión el restaurante se queda sin imprimir sin que nadie sepa por qué.
// PowerShell viene en todos los Windows y no se rompe.
//
// 🔴 EL NOMBRE DE LA IMPRESORA NO SE INTERPOLA EN EL SCRIPT. Viaja por VARIABLE DE
// ENTORNO. Si se pegara dentro del texto de PowerShell, una impresora llamada
// `HP"; Remove-Item C:\ -Recurse` ejecutaría eso. Parece rebuscado, pero el nombre
// lo escribe quien instala el driver y no cuesta nada hacerlo bien.
//
// Sin nada de Electron dentro, igual que `impresion.js`, para poder probarlo con
// `node prueba-impresion-usb.js`.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// PowerShell quiere el script en base64 de UTF-16LE. Mandarlo así evita pelearse con
// las comillas y con los acentos.
function aEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function correrPowerShell(script, entorno = {}, msTope = 20000) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', aEncodedCommand(script),
    ], { env: { ...process.env, ...entorno }, windowsHide: true })

    let salida = '', error = ''
    let hecho = false
    const terminar = (err, res) => {
      if (hecho) return
      hecho = true
      clearTimeout(reloj)
      err ? reject(err) : resolve(res)
    }
    const reloj = setTimeout(() => {
      ps.kill()
      terminar(new Error('PowerShell no respondió a tiempo'))
    }, msTope)

    ps.stdout.on('data', (d) => { salida += d.toString() })
    ps.stderr.on('data', (d) => { error += d.toString() })
    ps.once('error', (e) => terminar(new Error(
      e.code === 'ENOENT' ? 'No se encuentra PowerShell en este equipo' : e.message)))
    ps.once('close', (codigo) => {
      if (codigo !== 0) return terminar(new Error(error.trim() || `PowerShell terminó con código ${codigo}`))
      terminar(null, salida.trim())
    })
  })
}

// Las impresoras que Windows tiene instaladas en este equipo.
//
// Se usa CIM/WMI y no `Get-Printer` porque `Get-Printer` viene del módulo
// PrintManagement, que no está en todas las ediciones; `Win32_Printer` lleva ahí
// desde siempre.
const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
$ps = Get-CimInstance -ClassName Win32_Printer |
  Select-Object -Property Name, Default, WorkOffline, PortName
if ($null -eq $ps) { '[]' }
else { ConvertTo-Json -InputObject @($ps) -Compress }
`

async function listarImpresoras() {
  if (process.platform !== 'win32') return { impresoras: [], error: 'Solo en Windows' }
  try {
    const salida = await correrPowerShell(SCRIPT_LISTAR, {}, 15000)
    const crudo = JSON.parse(salida || '[]')
    const lista = Array.isArray(crudo) ? crudo : [crudo]
    return {
      impresoras: lista.map((p) => ({
        nombre: p.Name,
        pordefecto: !!p.Default,
        // `WorkOffline` es lo que Windows marca cuando la impresora no responde;
        // sirve para avisar ANTES de cobrar, no después.
        desconectada: !!p.WorkOffline,
        puerto: p.PortName || null,
      })).filter((p) => p.nombre),
    }
  } catch (e) {
    return { impresoras: [], error: e.message }
  }
}

// Mandar los bytes crudos. `base64` es el mismo formato que ya usan el plugin de
// Android y la impresión por red: así `printService.js` no tiene que saber por dónde
// va a salir el ticket.
const SCRIPT_IMPRIMIR = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class PidooRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr bytes, int count, out int written);

  public static int Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("No se pudo abrir la impresora (codigo " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "Ticket Pidoo";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di))
        throw new Exception("El trabajo no entro en la cola (codigo " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(h))
          throw new Exception("StartPagePrinter fallo (codigo " + Marshal.GetLastWin32Error() + ")");
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        int escritos = 0;
        try {
          Marshal.Copy(bytes, 0, p, bytes.Length);
          if (!WritePrinter(h, p, bytes.Length, out escritos))
            throw new Exception("No se pudieron escribir los bytes (codigo " + Marshal.GetLastWin32Error() + ")");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
        return escritos;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$bytes = [IO.File]::ReadAllBytes($env:PIDOO_FICHERO)
$n = [PidooRaw]::Send($env:PIDOO_IMPRESORA, $bytes)
Write-Output $n
`

async function enviarBytesUsb(nombreImpresora, base64, msTope = 20000) {
  if (process.platform !== 'win32') throw new Error('La impresion por USB solo va en Windows')
  if (!nombreImpresora) throw new Error('No has elegido ninguna impresora')

  let datos
  try {
    datos = Buffer.from(base64, 'base64')
  } catch {
    throw new Error('Datos de impresion invalidos')
  }
  if (!datos.length) throw new Error('No hay nada que imprimir')

  // Los bytes van por FICHERO y no por la linea de comandos: un ticket con logo pasa
  // de los 32.000 caracteres que aguanta un argumento en Windows, y ahi se cortaria
  // el ticket por la mitad sin decir nada.
  const ruta = path.join(os.tmpdir(), `pidoo-ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`)
  fs.writeFileSync(ruta, datos)
  try {
    const escritos = await correrPowerShell(SCRIPT_IMPRIMIR, {
      PIDOO_IMPRESORA: nombreImpresora,
      PIDOO_FICHERO: ruta,
    }, msTope)
    return { ok: true, bytes: Number(escritos) || datos.length }
  } finally {
    // Se borra siempre: son tickets, y ahi dentro va el nombre y la direccion del
    // cliente. No tienen por que quedarse en el temporal del ordenador del bar.
    try { fs.unlinkSync(ruta) } catch { /* si no se puede, tampoco es grave */ }
  }
}

// ¿Sigue estando esa impresora y la ve Windows? Es el equivalente al "check" de la
// impresion por red: sirve para avisar de que no va a salir el ticket ANTES de cobrar.
async function comprobarUsb(nombreImpresora) {
  if (!nombreImpresora) return { ok: false, error: 'Sin impresora elegida' }
  const { impresoras, error } = await listarImpresoras()
  if (error) return { ok: false, error }
  const encontrada = impresoras.find((p) => p.nombre === nombreImpresora)
  if (!encontrada) return { ok: false, error: 'Windows ya no ve esa impresora' }
  if (encontrada.desconectada) return { ok: false, error: 'La impresora figura desconectada' }
  return { ok: true }
}

function registrarCanalesUsb(ipcMain) {
  ipcMain.handle('pidoo:print-usb', (_e, { printerName, data }) => enviarBytesUsb(printerName, data))
  ipcMain.handle('pidoo:list-printers', () => listarImpresoras())
  ipcMain.handle('pidoo:check-usb', (_e, { printerName }) => comprobarUsb(printerName))
}

module.exports = { listarImpresoras, enviarBytesUsb, comprobarUsb, registrarCanalesUsb }
