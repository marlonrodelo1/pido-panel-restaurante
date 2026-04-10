package com.pido.restaurante;

import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.content.Context;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "ThermalPrinter")
public class ThermalPrinterPlugin extends Plugin {

    private static final String TAG = "ThermalPrinter";

    @PluginMethod
    public void print(PluginCall call) {
        String ip = call.getString("ip");
        Integer port = call.getInt("port", 9100);
        String data = call.getString("data");

        if (ip == null || ip.isEmpty()) {
            call.reject("IP de impresora no configurada");
            return;
        }
        if (data == null || data.isEmpty()) {
            call.reject("No hay datos para imprimir");
            return;
        }

        new Thread(() -> {
            Socket socket = null;
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip, port), 5000);
                socket.setSoTimeout(5000);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                Log.i(TAG, "Impresion enviada a " + ip + ":" + port + " (" + bytes.length + " bytes)");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error al imprimir: " + e.getMessage());
                call.reject("Error de impresion: " + e.getMessage());
            } finally {
                try { if (socket != null) socket.close(); } catch (Exception ignored) {}
            }
        }).start();
    }

    @PluginMethod
    public void checkConnection(PluginCall call) {
        String ip = call.getString("ip");
        Integer port = call.getInt("port", 9100);

        if (ip == null || ip.isEmpty()) {
            call.reject("IP no proporcionada");
            return;
        }

        new Thread(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(ip, port), 3000);
                Log.i(TAG, "Conexion OK: " + ip + ":" + port);
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo conectar: " + e.getMessage());
            } finally {
                try { if (socket != null) socket.close(); } catch (Exception ignored) {}
            }
        }).start();
    }

    /**
     * Scan the local network for devices with port 9100 open (thermal printers)
     * Scans all 254 IPs in the same subnet concurrently
     */
    @PluginMethod
    public void scanNetwork(PluginCall call) {
        Integer port = call.getInt("port", 9100);

        new Thread(() -> {
            try {
                String subnet = getLocalSubnet();
                if (subnet == null) {
                    call.reject("No se pudo detectar la red local");
                    return;
                }

                Log.i(TAG, "Escaneando red: " + subnet + ".* puerto " + port);

                List<JSObject> foundPrinters = Collections.synchronizedList(new ArrayList<>());
                AtomicInteger scanned = new AtomicInteger(0);

                // Use thread pool to scan 254 IPs concurrently
                ExecutorService executor = Executors.newFixedThreadPool(50);

                for (int i = 1; i <= 254; i++) {
                    final String ip = subnet + "." + i;
                    executor.submit(() -> {
                        Socket socket = null;
                        try {
                            socket = new Socket();
                            socket.connect(new InetSocketAddress(ip, port), 800); // 800ms timeout per IP
                            // Connection successful = printer found
                            JSObject printer = new JSObject();
                            printer.put("ip", ip);
                            printer.put("port", port);

                            // Try to get hostname
                            try {
                                InetAddress addr = InetAddress.getByName(ip);
                                String hostname = addr.getCanonicalHostName();
                                if (!hostname.equals(ip)) {
                                    printer.put("hostname", hostname);
                                }
                            } catch (Exception ignored) {}

                            foundPrinters.add(printer);
                            Log.i(TAG, "Impresora encontrada: " + ip);
                        } catch (Exception ignored) {
                            // Connection refused or timeout = no printer at this IP
                        } finally {
                            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                            scanned.incrementAndGet();
                        }
                    });
                }

                executor.shutdown();
                executor.awaitTermination(15, TimeUnit.SECONDS);

                JSObject result = new JSObject();
                JSArray printers = new JSArray();
                for (JSObject p : foundPrinters) {
                    printers.put(p);
                }
                result.put("printers", printers);
                result.put("subnet", subnet);
                result.put("scanned", scanned.get());

                Log.i(TAG, "Escaneo completado: " + foundPrinters.size() + " impresoras encontradas");
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Error al escanear: " + e.getMessage());
                call.reject("Error al escanear la red: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Get the local subnet (e.g., "192.168.1")
     */
    private String getLocalSubnet() {
        try {
            // Try via NetworkInterface (more reliable)
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface ni : interfaces) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                List<InetAddress> addresses = Collections.list(ni.getInetAddresses());
                for (InetAddress addr : addresses) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."))) {
                            int lastDot = ip.lastIndexOf('.');
                            return ip.substring(0, lastDot);
                        }
                    }
                }
            }

            // Fallback: try WifiManager
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                WifiInfo wifiInfo = wifiManager.getConnectionInfo();
                int ipInt = wifiInfo.getIpAddress();
                if (ipInt != 0) {
                    String ip = String.format("%d.%d.%d",
                        (ipInt & 0xff), (ipInt >> 8 & 0xff), (ipInt >> 16 & 0xff));
                    return ip;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error obteniendo subnet: " + e.getMessage());
        }
        return null;
    }
}
