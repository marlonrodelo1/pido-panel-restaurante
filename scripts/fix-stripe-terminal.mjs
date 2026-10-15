// fix-stripe-terminal.mjs — postinstall. Arreglos en el código del plugin
// @capacitor-community/stripe-terminal 8.2.1 (Android) para el cobro con Tap to Pay. El plugin es
// de terceros y vive en node_modules: este script corrige su código en cada instalación.
// Idempotente (marca PIDOO-PATCH). Si el plugin cambia de versión y el texto original ya no está,
// lo AVISA a gritos: hay que revisar si la versión nueva ya lo arregla antes de compilar.
//
// 1) token-compartido (9-oct-2026). Terminal.init() solo corre UNA vez por proceso y el SDK se
//    queda con el TokenProvider de ese momento, pero el plugin crea un TokenProvider (y, al reabrir
//    la app, una instancia de plugin entera) nuevo cada vez. Pasaba en dos casos con la app viva por
//    debajo (el servicio de ubicación mantiene el proceso):
//      a) la WebView se recarga (desde la 307, al cambiar el móvil de modo claro a oscuro);
//      b) el socio cierra la app deslizándola en «recientes» y la vuelve a abrir (Activity, Bridge
//         y plugin nuevos en el mismo proceso).
//    El SDK pedía el token al provider viejo: o el aviso iba a un plugin muerto (b, ni se pedía el
//    token) o el token lo recibía el provider nuevo (a). El SDK esperaba 60 s y discoverReaders se
//    quedaba colgado -> «Este móvil no puede cobrar». Le pasó a Concep Food el 9-oct toda la noche.
//    Ahora la petición pendiente y el aviso al JS son del PROCESO: el token llega siempre a la
//    petición que el SDK está esperando y el aviso siempre al plugin vivo. Al re-inicializar, si
//    había una petición sin contestar, se le vuelve a pedir al JS nuevo.
// 2) discover-rechaza. Si discoverReaders FALLA (NFC apagado, opciones de desarrollador, móvil no
//    apto, SDK no soportado…) el plugin solo lo apuntaba en Logcat y la promesa no se resolvía
//    nunca. Ahora rechaza con el código de Stripe (TerminalErrorCode, p. ej. TAP_TO_PAY_NFC_DISABLED)
//    y la app dice exactamente qué falla. Además ya no revienta si la lista de lectores llega vacía.
// 3) initialize() devuelve { yaIniciado }: la app lo apunta y se sabe si fue un arranque en frío.
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = 'node_modules/@capacitor-community/stripe-terminal/android/src/main/java/com/getcapacitor/community/stripe/terminal'

const PARCHES = [
  {
    fichero: `${BASE}/TokenProvider.kt`,
    marca: 'PIDOO-PATCH(token-compartido)',
    cambios: [
      {
        de: `    private var pendingCallback: ArrayList<ConnectionTokenCallback> = ArrayList()

    fun setConnectionToken(call: PluginCall) {
        val token = call.getString("token", "")
        if (pendingCallback.isNotEmpty()) {
            val pending = pendingCallback.removeAt(0)
            if (token == "") {`,
        a: `    // PIDOO-PATCH(token-compartido): ver scripts/fix-stripe-terminal.mjs. Estado del PROCESO,
    // no de la instancia: el SDK guarda el provider del primer initialize() y el plugin se recrea.
    companion object {
        // La petición de token que el SDK espera AHORA. Pide de una en una y a los 60 s da por
        // perdida la anterior: guardar solo la última evita darle el token a una caducada.
        @Volatile
        private var pendiente: ConnectionTokenCallback? = null
        @Volatile
        private var pendienteAt: Long = 0L

        // El aviso al JS va siempre al plugin VIVO (WebView recargada o app reabierta).
        @Volatile
        private var notificadorVivo: BiConsumer<String, JSObject>? = null
    }

    init {
        notificadorVivo = notifyListenersFunction
    }

    // Tras re-inicializar en el mismo proceso: si el SDK seguía esperando un token que pidió a un
    // JS que ya no existe, se le pide al JS nuevo.
    // A los 60 s el SDK ya la ha dado por perdida: más vieja que 55 s no se re-pide.
    fun reemitirPendiente() {
        if (pendiente == null) return
        if (System.currentTimeMillis() - pendienteAt < 55_000L) {
            this.notifyListeners(TerminalEnumEvent.RequestedConnectionToken.webEventName, JSObject())
        } else {
            synchronized(TokenProvider::class.java) { pendiente = null }
        }
    }

    fun setConnectionToken(call: PluginCall) {
        val token = call.getString("token", "")
        val pending = synchronized(TokenProvider::class.java) {
            val p = pendiente
            pendiente = null
            p
        }
        if (pending != null) {
            if (token == "") {`,
      },
      {
        de: `        if (this.tokenProviderEndpoint == "") {
            pendingCallback.add(callback)`,
        a: `        if (this.tokenProviderEndpoint == "") {
            synchronized(TokenProvider::class.java) {
                pendiente = callback
                pendienteAt = System.currentTimeMillis()
            }`,
      },
      {
        de: `    protected fun notifyListeners(eventName: String?, data: JSObject?) {
        notifyListenersFunction.accept(eventName!!, data!!)
    }`,
        a: `    protected fun notifyListeners(eventName: String?, data: JSObject?) {
        (notificadorVivo ?: notifyListenersFunction).accept(eventName!!, data!!)
    }`,
      },
    ],
  },
  {
    fichero: `${BASE}/StripeTerminal.kt`,
    marca: 'PIDOO-PATCH(discover-rechaza)',
    cambios: [
      {
        de: `    fun initialize(call: PluginCall) {
        this.isTest = call.getBoolean("isTest", true)
`,
        a: `    fun initialize(call: PluginCall) {
        this.isTest = call.getBoolean("isTest", true)
        // PIDOO-PATCH(token-compartido): ¿ya estaba el SDK iniciado en este proceso?
        val yaIniciado = isInitialized()
`,
      },
      {
        de: `                notifyListeners(TerminalEnumEvent.Loaded.webEventName, emptyObject)
                call.resolve()
            }`,
        a: `                notifyListeners(TerminalEnumEvent.Loaded.webEventName, emptyObject)
                call.resolve(JSObject().put("yaIniciado", yaIniciado))
            }`,
      },
      {
        de: `        if (!isInitialized()) {
            init(
                contextSupplier.get().applicationContext,
                logLevel,
                this.tokenProvider!!,
                listener,
                null // OfflineListener - not used in this implementation
            )
        }`,
        a: `        if (!isInitialized()) {
            init(
                contextSupplier.get().applicationContext,
                logLevel,
                this.tokenProvider!!,
                listener,
                null // OfflineListener - not used in this implementation
            )
        } else {
            // PIDOO-PATCH(token-compartido): petición de token sin contestar -> al JS nuevo.
            this.tokenProvider!!.reemitirPendiente()
        }`,
      },
      {
        de: `        val token = DiscoveryToken()
        discoveryToken = token
        discoveryCancelable = Terminal.getInstance()`,
        a: `        val token = DiscoveryToken()
        discoveryToken = token
        // PIDOO-PATCH(discover-rechaza): la llamada se contesta UNA vez; si el descubrimiento falla
        // antes de encontrar lector, se rechaza con el código de Stripe en vez de colgarse.
        val respondida = java.util.concurrent.atomic.AtomicBoolean(false)
        discoveryCancelable = Terminal.getInstance()`,
      },
      {
        de: `                    override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                        Log.d(logTag, readers[0].serialNumber.toString())`,
        a: `                    override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                        if (readers.isEmpty()) return
                        Log.d(logTag, readers[0].serialNumber.toString())`,
      },
      {
        de: `                        call.resolve(JSObject().put("readers", readersJSObject))
                    }
                },`,
        a: `                        respondida.set(true)
                        call.resolve(JSObject().put("readers", readersJSObject))
                    }
                },`,
      },
      {
        de: `                        Log.d(logTag, "Finished discovering readers")
                    }`,
        a: `                        Log.d(logTag, "Finished discovering readers")
                        if (respondida.compareAndSet(false, true)) {
                            call.resolve(JSObject().put("readers", JSArray()))
                        }
                    }`,
      },
      {
        de: `                        Log.d(logTag, e.localizedMessage)
                    }
                }
            )
    }`,
        a: `                        Log.d(logTag, e.localizedMessage)
                        if (respondida.compareAndSet(false, true)) {
                            call.reject(e.errorMessage, e.errorCode.name, e)
                        }
                    }
                }
            )
    }`,
      },
    ],
  },
  // 4) permisos (15-oct-2026, SOLO en el panel del restaurante: lector WisePad 3 por Bluetooth).
  //    a) El alias 'location' pedía ACCESS_FINE_LOCATION a secas. Con targetSdk 31+ Android IGNORA
  //       esa petición si no va junto a ACCESS_COARSE_LOCATION, y el permiso no se concedía nunca.
  //       (La app del socio no lo notaba: la ubicación ya la había pedido el plugin de GPS.)
  //    b) Si el permiso se denegaba, el callback lo volvía a pedir EN BUCLE. Ahora rechaza con un
  //       mensaje que la app traduce («permiso de ubicación / Bluetooth»).
  {
    fichero: `${BASE}/StripeTerminalPlugin.kt`,
    marca: 'PIDOO-PATCH(permisos)',
    cambios: [
      {
        de: `        strings = [Manifest.permission.ACCESS_FINE_LOCATION]`,
        a: `        // PIDOO-PATCH(permisos): FINE sin COARSE no lo concede Android 12+ (ver fix-stripe-terminal.mjs).
        strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]`,
      },
      {
        de: `            this._initialize(call)
        } else {
            requestPermissionForAlias("location", call, "locationPermsCallback")
        }`,
        a: `            this._initialize(call)
        } else {
            call.reject("location permission denied", "PERMISSION_DENIED")
        }`,
      },
      {
        de: `        } else {
            requestPermissionForAlias("bluetooth_old", call, "bluetoothOldPermsCallback")
        }
    }`,
        a: `        } else {
            call.reject("bluetooth permission denied", "PERMISSION_DENIED")
        }
    }`,
      },
      {
        de: `        } else {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback")
        }
    }`,
        a: `        } else {
            call.reject("bluetooth permission denied", "PERMISSION_DENIED")
        }
    }`,
      },
    ],
  },
]

let fallos = 0
for (const p of PARCHES) {
  let s
  try {
    s = readFileSync(p.fichero, 'utf8')
  } catch (_) {
    continue // plugin no instalado (p. ej. instalación parcial): nada que hacer
  }
  if (s.includes(p.marca)) continue
  const crlf = s.includes('\r\n')
  if (crlf) s = s.replace(/\r\n/g, '\n')
  let ok = true
  for (const c of p.cambios) {
    if (!s.includes(c.de)) {
      ok = false
      console.error(`[fix-stripe-terminal] ⚠️  NO ENCONTRADO en ${p.fichero}:\n${c.de.split('\n')[0]}…`)
      break
    }
    s = s.replace(c.de, c.a)
  }
  if (!ok) { fallos++; continue }
  if (crlf) s = s.replace(/\n/g, '\r\n')
  writeFileSync(p.fichero, s)
  console.log(`[fix-stripe-terminal] ${p.marca} aplicado en ${p.fichero}`)
}
if (fallos) {
  console.error('[fix-stripe-terminal] ⚠️  Hay arreglos SIN aplicar: revisar antes de compilar Android (cobro con tarjeta).')
  process.exitCode = 1
}
