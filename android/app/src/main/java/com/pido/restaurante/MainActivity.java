package com.pido.restaurante;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
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

        // Status bar oscura con iconos blancos
        getWindow().setStatusBarColor(0xFF0D0D0D);
        getWindow().setNavigationBarColor(0xFF0D0D0D);
        getWindow().getDecorView().setSystemUiVisibility(0); // iconos claros

        // Mantener pantalla encendida
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Permitir audio sin interacción del usuario (para alarma de pedidos)
        WebView webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        // Fondo oscuro + padding para que el contenido no se meta detrás de la status bar
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(0xFF0D0D0D);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, 0);
            return insets;
        });
    }
}
