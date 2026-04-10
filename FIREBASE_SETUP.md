# Configuración de Firebase para Push Notifications

Tu proyecto Firebase ya existe: **pidoo-push** (ID: `797553895667`)

---

## Android — google-services.json

1. Ve a [Firebase Console](https://console.firebase.google.com) → proyecto **pidoo-push**
2. Haz clic en el engranaje ⚙️ → **Configuración del proyecto**
3. En la pestaña **General**, baja hasta "Tus apps"
4. Si no existe la app Android, haz clic en **"Añadir app"** → Android:
   - Package name: `com.pido.restaurante`
   - Nombre (opcional): `PIDO Restaurante`
5. Descarga el archivo **`google-services.json`**
6. Colócalo en: `panel-restaurante/android/app/google-services.json`

---

## iOS — GoogleService-Info.plist

1. En la misma pantalla de Firebase Console → **"Tus apps"**
2. Haz clic en **"Añadir app"** → iOS:
   - Bundle ID: `com.pido.restaurante`
   - Nombre (opcional): `PIDO Restaurante`
3. Descarga el archivo **`GoogleService-Info.plist`**
4. Colócalo en: `panel-restaurante/ios/App/App/GoogleService-Info.plist`
5. Abre Xcode → arrastra el archivo al proyecto dentro del grupo **App**
   - Asegúrate de marcar "Copy items if needed" y el target **App**

---

## APNs (Apple Push Notification service) — requerido para iOS

Para que las notificaciones push funcionen en iPhone necesitas configurar APNs en Firebase:

1. Ve a [Apple Developer Portal](https://developer.apple.com/account) → **Certificates, IDs & Profiles**
2. En **Keys** → crea una nueva key:
   - Nombre: `Pidoo Push Key`
   - Activa: **Apple Push Notifications service (APNs)**
   - Descarga el archivo `.p8` (solo se puede descargar UNA vez)
   - Anota el **Key ID** y tu **Team ID** (aparece arriba a la derecha)
3. En Firebase Console → proyecto **pidoo-push** → ⚙️ → **Cloud Messaging**
4. En la sección "Configuración de la app de Apple" → **Subir clave APN**:
   - Sube el archivo `.p8`
   - Introduce el **Key ID**
   - Introduce el **Team ID**

---

## Verificar que las notificaciones web (VAPID) funcionan

La clave VAPID ya está configurada en el código:
```
BCi6cNn5m6sQtE5c00relAV4Gy91ZaceufC-aqC4DjF0cU6WvX8qlOm1NjOrIEhk_x-y8sf67Z453XJopHlE7WY
```

Si necesitas regenerarla:
1. Firebase Console → ⚙️ → **Cloud Messaging**
2. Sección "Configuración web" → **Generar par de claves**
3. Copia la clave pública y actualiza `VAPID_KEY` en `src/lib/webPush.js`

---

## Despliegue con Docker (web)

Ahora los secrets se pasan como build args, NUNCA van en la imagen:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://rmrbxrabngdmpgpfmjbo.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=tu_anon_key \
  -t pido-panel-restaurante \
  -f Dockerfile.panel-restaurante .
```

En Dokploy, configura estas variables en la sección **Build Args** de la aplicación.
