# Panel Restaurante - Documentacion Completa

## Resumen
App de gestion para restaurantes de la plataforma PIDOO. Funciona como **APP nativa** (Capacitor Android) para pedidos en tiempo real + impresora termica, y como **web** (partner.pidoo.es) para gestion completa del negocio.

**Stack:** React 19.2 + Vite 8 + Capacitor 8 (Android/iOS) + Supabase 2.100
**Theme:** Dark mode, color primario #B91C1C, tipografia DM Sans
**App ID Android:** com.pido.restaurante · versionCode 9 · versionName 1.7
**Puerto impresora:** TCP 9100 (ESC/POS 80mm)
**Web:** https://partner.pidoo.es (Dokploy auto-deploy)
**Supabase proyecto:** `rmrbxrabngdmpgpfmjbo`

**Canal único:** todos los pedidos son canal `pido`. No existe canal "pidogo".

---

## Arquitectura APP vs WEB

La misma base de codigo sirve dos experiencias distintas usando `Capacitor.isNativePlatform()`:

| | APP Nativa (Android) | Web (partner.pidoo.es) |
|---|---|---|
| **Nav** | Pedidos, Carta (disponibilidad), Config (impresora) | Historial, Carta, Promos, Ajustes |
| **Pedidos en vivo** | Si (realtime + alarma + push) | No |
| **Impresora termica** | Si (TCP nativo) | No |
| **Disponibilidad productos** | Si (toggle rapido) | No (se gestiona en Carta completa) |
| **Header extras** | Boton "Panel web" (abre Browser) | Botones Soporte + Metricas |
| **PedidoAlertProvider** | Envuelve la app | No se renderiza |

**Constante clave:** `const isNative = Capacitor.isNativePlatform()` en App.jsx

---

## Estructura de archivos

```
panel-restaurante/
├── src/
│   ├── App.jsx              # Router + isNative split + ErrorBoundary + ConfirmModal + ToastNotification + OAuth
│   ├── main.jsx             # Entry point
│   ├── index.css            # Variables CSS globales (--c-primary, --c-surface, etc)
│   ├── App.css              # Animaciones (fadeIn, spin, pulse, slideUp)
│   ├── pages/
│   │   ├── PedidosEnVivo.jsx       # Pedidos en tiempo real — lista compacta + detalle full-screen (solo APP)
│   │   ├── DisponibilidadProductos.jsx  # Toggle disponibilidad productos (solo APP)
│   │   ├── ConfigImpresora.jsx     # Config impresora + toggle abierto/cerrado + logout (solo APP)
│   │   ├── Historial.jsx           # Historial de pedidos (filtro fechas + busqueda + exportar CSV)
│   │   ├── Carta.jsx               # Gestion de menu/productos/extras/tamanos
│   │   ├── Promociones.jsx         # Crear/editar promociones
│   │   ├── Ajustes.jsx             # Config restaurante + horario + ubicacion + categorias
│   │   ├── Metricas.jsx            # Dashboard analitico (con pantalla error + retry)
│   │   ├── Soporte.jsx             # Chat soporte en tiempo real (con error envio visible)
│   │   ├── Login.jsx               # Auth email/password + OAuth Google
│   │   ├── Activacion.jsx          # Pantalla bienvenida primer acceso (establecimientos.activado=false)
│   │   └── CompletarRegistro.jsx   # Onboarding nuevo restaurante (legacy)
│   ├── context/
│   │   ├── RestContext.jsx         # Auth + datos restaurante
│   │   └── PedidoAlertContext.jsx  # Alarma sonora + notificaciones (default seguro para web)
│   └── lib/
│       ├── supabase.js        # Cliente Supabase (anon key + URL)
│       ├── escpos.js          # Generador de comandos ESC/POS para tickets
│       ├── printService.js    # Servicio impresion (TCP nativo + web fallback)
│       ├── horario.js         # Utilidades de horario (dias, abierto/cerrado)
│       ├── webPush.js         # Push notifications (FCM)
│       ├── pushNotifications.js  # Capacitor push registration
│       ├── alarm.js           # Alarma sonora para nuevos pedidos
│       └── upload.js          # Subida imagenes a Supabase Storage (valida tipo image/* y maximo 5 MB)
├── android/                   # Proyecto Android nativo (Capacitor)
│   └── app/
│       ├── build.gradle       # minifyEnabled true, versionCode 9, versionName 1.7
│       └── src/main/java/com/pido/restaurante/
│           ├── MainActivity.java
│           └── ThermalPrinterPlugin.java  # Plugin nativo TCP socket
├── capacitor.config.json
├── vite.config.js
├── nginx.conf                 # Produccion: HSTS, X-Frame, gzip, cache, SPA routing
├── Dockerfile                 # Multi-stage build (node + nginx)
└── package.json
```

---

## App.jsx — Exports globales

Ademas de ser el router principal, App.jsx exporta dos funciones de modulo:

- **`confirmar(mensaje)`** — Dialog confirm/cancel que devuelve `Promise<boolean>`. Usado en Carta, Promociones para confirmaciones destructivas.
- **`toast(msg, type)`** — Notificacion toast no bloqueante (tipo `'error'` o `'success'`). Auto-dismiss 3s. Reemplaza todos los `alert()` nativos.

---

## Paginas - Detalle

### PedidosEnVivo.jsx (solo APP nativa)
Lista compacta de pedidos con 4 secciones por estado + vista detalle full-screen al tocar.

**Secciones:**
- **Nuevos** (rojo) — pedidos recien llegados, timer countdown
- **En preparacion** (amarillo) — pedidos aceptados
- **Listos** (verde) — esperando recogida del repartidor (Shipday)
- **En camino** (azul) — repartidor en ruta

**Vista lista:** `LineaPedido` = codigo + badge estado + nombre cliente + timer (nuevos) + total
**Vista detalle:** `DetallePedido` = header con volver + info cliente + pago + productos con extras/tamanos + acciones por estado

**Acciones por estado:**
- Nuevo: aceptar (selector tiempo 15/20/30/45 min) o rechazar (con motivos: `MOTIVOS_RECHAZO`)
- En preparacion: marcar listo, reimprimir ticket
- Listo: marcar recogido (Shipday se encarga de asignar repartidor)
- En camino: marcar entregado
- Cancelar: disponible en todos los estados activos (con `MOTIVOS_CANCELACION`)

**Funciones clave:**
- `fetchPedidos()` — carga con join de usuario
- `aceptarPedido(pedido, minutos)` — acepta pedido → dispara `create-shipday-order` → notifica → imprime
- `rechazarPedido(id, motivo)` — rechaza con motivo
- `cancelarPedidoActivo(pedido, motivoId)` — cancela pedido activo con motivo
- `reimprimir(pedido)` — reimprime ticket via impresora termica

**Shipday:** al aceptar un pedido se llama la Edge Function `create-shipday-order` que crea la orden en Shipday. Shipday asigna repartidor automaticamente (auto-dispatch). El webhook `shipday-webhook` actualiza `pedidos.shipday_status` conforme avanza la entrega.

### DisponibilidadProductos.jsx (solo APP nativa)
Toggle rapido de disponibilidad de productos.
- Consulta tabla `productos` + `categorias` (ambas filtradas por `establecimiento_id`)
- Stats: disponibles (verde) + no disponibles (rojo)
- Agrupados por categoria del restaurante
- Toggle switch por producto con `supabase.update({ disponible: !current })`

**IMPORTANTE:** Usa tabla `categorias` (del restaurante), NO `categorias_generales` (globales de la plataforma).

### ConfigImpresora.jsx (solo APP nativa)
Extraida de Ajustes.jsx. Contiene:
- Toggle abierto/cerrado del restaurante (`updateRestaurante({ activo })`)
- Escaneo de red, conexion por IP, test de impresion, desconexion
- Selector tickets: "Comanda + Cliente" (2) o "Solo comanda" (1)
- Boton logout

### Carta.jsx
Gestion completa del menu del restaurante.

**Estructura jerarquica:**
- Categorias (del restaurante) → Productos → Extras Groups → Extras individuales + Tamanos

**Funcionalidades:**
- CRUD completo de productos con imagen (Supabase Storage)
- Toggle disponibilidad por producto
- Gestion de grupos de extras (tipo SINGLE o MULTIPLE con max_selecciones)
- Tamanos con precios individuales
- Busqueda y filtro por categoria
- Modal de edicion con validacion

### Ajustes.jsx
Configuracion del restaurante (solo web).

**Secciones:**
1. **Estado:** toggle abierto/cerrado (inmediato, sin guardar)
2. **Datos:** nombre, tipo, descripcion, direccion, email, telefono, logo, banner
3. **Ubicacion:** GPS automatico + geocoding, radio cobertura (1-30 km)
4. **Horario:** JSONB por dia, turnos multiples, copiar a todos los dias
5. **Categorias:** Seleccion de hasta 3 categorias generales con emojis

### Historial.jsx
Historial de pedidos con filtros avanzados y exportacion.

**Filtros:**
- **Rango de fechas** (Desde/Hasta): inputs `type="date"`, default ultimos 30 dias
- **Busqueda por codigo**: input con debounce 500ms, busca con `.ilike('codigo', '%texto%')`
- **Estado**: todos, entregado, cancelado, fallido (pills)

**Exportar CSV:**
- Boton "Exportar CSV" en header (deshabilitado si no hay pedidos)
- Query completa sin paginacion con los mismos filtros activos
- BOM UTF-8 para compatibilidad Excel con caracteres espanoles
- Columnas: Codigo, Estado, Metodo Pago, Subtotal, Envio, Total, Fecha
- Nombre archivo: `historial_DESDE_HASTA.csv`

**Otros:**
- Paginacion: 50 por pagina + "Cargar mas"
- Query reutilizable via `buildQuery()` (compartida entre fetch y export)
- Mensaje vacio dinamico segun busqueda o rango de fechas

### Metricas.jsx
Dashboard analitico.
- Periodos: hoy, semana, mes
- Stats: pedidos, ventas (tarjeta/efectivo), ticket medio, tiempo medio, cancelados
- Resenas recientes con valoracion
- Pantalla de error con boton "Reintentar" si falla la carga

### Promociones.jsx
Gestion de promociones.
- Tipos: `descuento_porcentaje`, `descuento_fijo`, `producto_gratis`, `2x1`
- Campos: titulo, descripcion, valor, minimo_compra, producto_id, fecha_fin, activa
- Auto-genera titulo segun tipo/valor/producto

### Soporte.jsx
Chat de soporte en tiempo real.
- Mensajes tipo `soporte` en tabla `mensajes`
- Suscripcion realtime INSERT
- Error visible si falla el envio (restaura texto al input)
- **Rate limiting:** throttle 2s entre mensajes + maximo 30 mensajes/min (contador en `useRef`, reset con `setTimeout`)
- Boton enviar deshabilitado durante el envio y cuando el input esta vacio

### Activacion.jsx
Pantalla de bienvenida para restaurantes en primer acceso.

**Cuándo se muestra:** cuando `establecimientos.activado === false`.

**Flujo:**
1. Muestra el nombre del negocio + preview de logo/banner
2. Permite completar: teléfono de contacto y descripción del negocio
3. Botón "Activar mi negocio" → `UPDATE establecimientos SET activado=true` + rellena descripcion/telefono
4. `App.jsx` deja de mostrar esta pantalla automáticamente (el contexto actualiza `restaurante.activado`)

**Nota:** El check en App.jsx usa `restaurante.activado === false` (strict), no `!restaurante.activado`, para que restaurantes pre-existentes (activado=null) sigan funcionando sin interrupciones.

### Login.jsx / CompletarRegistro.jsx
- Auth email/password + OAuth Google (via Capacitor Browser en Android)
- Onboarding: formulario nombre, tipo, direccion, telefono + geocoding
- **Rate limiting:** boton bloqueado 5s tras cada intento fallido; tras 5 fallos consecutivos, bloqueo de 60s con contador visible
- **Password minimo:** 8 caracteres + 1 mayuscula + 1 numero (regex `/^(?=.*[A-Z])(?=.*\d).{8,}$/`)
- Contador de intentos en `useRef` (no resetea en rerenders)

---

## Sistema de Impresion Termica

### Flujo:
1. **Config** (ConfigImpresora.jsx): Escanear red → conectar por IP → elegir 1 o 2 tickets
2. **Recepcion** (PedidosEnVivo.jsx): Pedido nuevo via realtime con datos cliente
3. **Aceptacion**: `imprimirPedido()` se ejecuta automaticamente
4. **Generacion** (escpos.js): Bytes ESC/POS para comanda cocina + ticket cliente
5. **Envio** (printService.js): TCP socket nativo (Capacitor) al puerto 9100

### Comanda Cocina (ticket 1):
- Codigo grande, fecha, tiempo prep
- Cliente: nombre, telefono, direccion + QR Google Maps
- Lista productos con extras
- Notas del cliente
- Metodo de pago

### Ticket Cliente (ticket 2):
- Datos restaurante, datos pedido/cliente
- QR Google Maps para delivery
- Productos con precios, subtotal, descuento, envio, total
- Tiempo estimado

### Plugin nativo Android (ThermalPrinterPlugin.java):
- `print({ ip, port, data })` — bytes base64 via TCP socket
- `scanNetwork({ port })` — escanea subnet buscando puerto 9100
- `checkConnection({ ip, port })` — verifica conectividad

---

## Contextos

### RestContext.jsx
- `restaurante` — objeto completo del establecimiento
- `user` — usuario autenticado (id, email)
- `login(email, password)`, `logout()`
- `updateRestaurante(cambios)`, `refetch()`
- **Verificacion de rol estricta:** Al cargar `fetchRestaurante()`, si el usuario existe en `usuarios` con un rol distinto de `'restaurante'`, se hace signOut inmediato y se muestra error. No hay ventana de gracia ni asignacion automatica de rol.
- `authError` / `setAuthError` — error de autenticacion mostrado en Login.jsx

### PedidoAlertContext.jsx
- `pedidosNuevos` — array de pedidos sin aceptar
- `fetchNuevos()` — recarga manual
- Suscripcion realtime INSERT/UPDATE en `pedidos`
- `startAlarm()` / `stopAlarm()` — control alarma sonora
- **Default seguro:** `createContext({ pedidosNuevos: [], fetchNuevos: () => {} })` para que funcione en web sin provider

---

## Base de datos (tablas principales)

- `establecimientos` — datos restaurante. Campos clave:
  - `activo` — abierto/cerrado para pedidos (toggle en ConfigImpresora/Ajustes)
  - `activado` — onboarding completado por el dueño (`false` = primer acceso, `true` = activo)
- `pedidos` — pedidos con estado, usuario_id, establecimiento_id, total, motivo_cancelacion, shipday_status, shipday_order_id
- `pedido_items` — items de cada pedido (producto, cantidad, precio, extras)
- `usuarios` — clientes (nombre, apellido, telefono, direccion, coordenadas)
- `productos` — menu del restaurante (nombre, precio, disponible, imagen_url, categoria_id)
- `categorias` — categorias del restaurante (nombre, orden, activa, establecimiento_id)
- `categorias_generales` — categorias globales de la plataforma (nivel 2 y 3)
- `establecimiento_categorias` — relacion N:M restaurante-categorias generales
- `grupos_extras` / `extras_opciones` — modificadores de productos
- `producto_tamanos` — tamanos por producto con precios
- `promociones` — promos activas del restaurante
- `mensajes` — chat soporte
- `resenas` — valoraciones de clientes

### Politicas RLS relevantes:
- `usuarios_select`: cada usuario lee sus datos + superadmin
- `restaurantes_ven_clientes`: restaurantes leen datos de clientes que les hicieron pedidos
- `pedidos_select_all`: cualquier usuario autenticado puede leer pedidos

---

## Edge Functions de Supabase

| Funcion | Descripcion |
|---|---|
| `generar_codigo_pedido` | Codigos PD-XXXXX (5 digitos secuenciales globales, verify_jwt=false) |
| `calcular_envio` | Coste de envio basado en distancia Haversine con tarifas configuradas |
| `crear_pago_stripe` | PaymentIntent en Stripe |
| `crear_reembolso_stripe` | Reembolso Stripe para pedidos cancelados |
| `enviar_push` | Push notifications via FCM |
| `create-shipday-order` | Crea orden en Shipday al aceptar pedido. Shipday asigna repartidor automaticamente |
| `shipday-webhook` | Recibe actualizaciones de Shipday → actualiza `pedidos.shipday_status` + timestamps |
| `calcular_comisiones` | Calcula comisiones plataforma al entregar |

---

## Build y Deploy

### Android (APK/AAB):
```bash
npm run build          # Vite build → dist/
npx cap sync android   # Copia dist/ a android/app/src/main/assets/public/
# Abrir Android Studio → Build → Generate Signed Bundle/APK
```
- versionCode actual: 9
- versionName actual: 1.7
- minifyEnabled: true (release)
- Signing: keystore.properties (no en git)

### Web (Dokploy):
- Push a main → auto-deploy via webhook
- Dockerfile multi-stage: node build + nginx serve
- **Secrets:** `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` se configuran como Build Args en Dokploy. Nunca hardcodear credenciales en el Dockerfile.
- URL: https://partner.pidoo.es

### Variables de entorno (.env):
```
VITE_SUPABASE_URL=https://rmrbxrabngdmpgpfmjbo.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

---

## Seguridad

| Area | Medida |
|---|---|
| **Dockerfile** | `ARG` sin valores por defecto → secrets solo en Dokploy, nunca en git |
| **nginx.conf** | Content-Security-Policy completa |
| **upload.js** | Valida `file.type.startsWith('image/')` y `file.size <= 5MB` antes de subir a Storage |
| **Historial.jsx** | Sanitiza el input de busqueda: elimina `%`, `_`, `\` antes de llamar `.ilike()` |
| **Login.jsx** | Rate limiting: 5s tras cada fallo, 60s tras 5 fallos consecutivos |
| **Login.jsx** | Password minimo: 8 chars + 1 mayuscula + 1 numero |
| **Soporte.jsx** | Rate limiting: throttle 2s entre mensajes + maximo 30 mensajes/min |
| **RestContext.jsx** | Verificacion de rol inmediata sin ventana de gracia |

### Patrones de rate limiting en React
Todos los rate limits usan `useRef` para no perder estado en rerenders, `Date.now()` para throttle, y `setTimeout`/`setInterval` para contadores y bloqueos.

```javascript
// Patron throttle simple (Soporte.jsx)
const ultimoEnvio = useRef(0)
if (Date.now() - ultimoEnvio.current < 2000) return
ultimoEnvio.current = Date.now()

// Patron bloqueo con countdown (Login.jsx)
const intentosFallidos = useRef(0)
// Tras N fallos: setLoginBloqueado(true) + setInterval decrementa segundos
```

### Sanitizacion ilike
```javascript
const sanitized = input.trim().replace(/[%_\\]/g, '')
if (sanitized) query = query.ilike('campo', '%' + sanitized + '%')
```

---

## Migraciones SQL activas

```
supabase/migrations/
├── 001_tablas_base.sql              # Todas las tablas + realtime
├── 002_rls_policies.sql             # Politicas RLS
├── 004_pedido_motivo_cancelacion.sql # Motivo cancelacion en pedidos
├── 005_roles_usuarios.sql           # Roles de usuario
├── 007_direcciones_usuario.sql      # Direcciones guardadas
└── 009_activacion_y_exclusividad.sql # activado en establecimientos; comision_reparto/recogida
```
