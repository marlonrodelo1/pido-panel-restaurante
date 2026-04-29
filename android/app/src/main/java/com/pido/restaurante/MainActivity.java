package com.pido.restaurante;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins
        registerPlugin(ThermalPrinterPlugin.class);

        super.onCreate(savedInstanceState);

        // Crear canal de notificaciones para pedidos (Android 8+)
        // IMPORTANTE: las propiedades del canal son inmutables tras crearlo.
        // Si el canal "pedidos" se creó antes sin sonido, hay que borrarlo
        // y recrearlo con sonido. Por eso usamos un id versionado: cuando
        // queramos cambiar propiedades, basta con bumpear el sufijo y borrar
        // el canal viejo. Backend (enviar_push) sigue mandando channel_id
        // "pedidos" pero también respaldamos creando ambos por compatibilidad.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                // Borrar canal viejo sin sonido (si existe) para forzar recreación
                // con sonido. Solo se borra si realmente no tiene sonido — los
                // canales que ya tengan sonido configurado se respetan.
                NotificationChannel existing = manager.getNotificationChannel("pedidos");
                if (existing != null && existing.getSound() == null) {
                    manager.deleteNotificationChannel("pedidos");
                }

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build();

                NotificationChannel channel = new NotificationChannel(
                    "pedidos", "Pedidos", NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Notificaciones de nuevos pedidos");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{300, 100, 300, 100, 300});
                channel.setSound(soundUri, audioAttributes);
                channel.enableLights(true);
                channel.setLightColor(0xFFFF6B2C);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    channel.setAllowBubbles(true);
                }
                manager.createNotificationChannel(channel);
            }
        }

        // === Status bar / navigation bar LIGHT ===
        // Force window background to match web app (#FAFAF7) so that during
        // splash → web load there is no black flash on devices in dark system mode.
        getWindow().setBackgroundDrawable(new ColorDrawable(0xFFFAFAF7));
        getWindow().setStatusBarColor(0xFFFAFAF7);
        getWindow().setNavigationBarColor(0xFFFAFAF7);

        // Iconos OSCUROS sobre fondo claro (status bar + nav bar).
        // Sin esto, en modo oscuro del sistema los iconos serían blancos
        // sobre fondo blanco → invisibles. Este es el bug que reportaba Marlon.
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        // Mantener pantalla encendida
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Permitir audio sin interacción del usuario (para alarma de pedidos)
        WebView webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // WebView con fondo blanco para evitar parpadeo negro en arranque
        webView.setBackgroundColor(Color.WHITE);

        // Fondo claro + padding para que el contenido no se meta detrás de la status bar
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(0xFFFAFAF7);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, 0);
            return insets;
        });
    }
}
