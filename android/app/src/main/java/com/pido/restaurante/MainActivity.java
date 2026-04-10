package com.pido.restaurante;

import android.app.NotificationChannel;
import android.app.NotificationManager;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "pedidos", "Pedidos", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notificaciones de nuevos pedidos");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{300, 100, 300, 100, 300});
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
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
