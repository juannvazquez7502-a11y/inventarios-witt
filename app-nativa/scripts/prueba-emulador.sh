#!/usr/bin/env bash
# Prueba en el emulador (la corre .github/workflows/app-nativa.yml dentro de android-emulator-runner).
# Evidencia en capturas/: pantallas a los 10 y 20 s del APK firmado, la copia sin internet, y con el APK de
# depuración la revisión del puente nativo (sonda.mjs) y el escáner de Google a pantalla completa.
# *.supabase.co está bloqueado por DNS en esta prueba: la app no ve datos reales.
set -u
PKG=mx.grupowitt.inventarios
OUT=capturas
mkdir -p "$OUT"
REL=$(ls apks/release/*.apk | head -1)
DBG=$(ls apks/debug/*.apk | head -1)
foto() { adb exec-out screencap -p > "$OUT/$1.png"; echo "captura $1"; }
abrir() { adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }

adb wait-for-device
adb shell getprop ro.build.version.release > "$OUT/android-version.txt"
adb shell input keyevent 82 || true

echo "== APK firmado (release) =="
adb install -r "$REL" | tee "$OUT/instalar-release.txt"
adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName|permission\.(CAMERA|VIBRATE|RECORD_AUDIO|MODIFY_AUDIO|INTERNET)" > "$OUT/paquete.txt" || true
adb logcat -c
abrir
sleep 10; foto 1-abre-10s
sleep 10; foto 2-abre-20s
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" > "$OUT/ventana.txt" || true
adb shell pidof "$PKG" > "$OUT/pid-release.txt" || echo "LA APP NO ESTÁ CORRIENDO" > "$OUT/pid-release.txt"
adb logcat -d -v time Capacitor:V Capacitor/Console:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-release.txt" || true

echo "== Sin internet, primera vez (copia local) =="
adb shell am force-stop "$PKG"
adb shell pm clear "$PKG" >/dev/null
adb shell cmd connectivity airplane-mode enable || true
adb shell svc wifi disable || true
adb shell svc data disable || true
sleep 4
abrir
sleep 15; foto 3-sin-internet-primera-vez
adb shell am force-stop "$PKG"
adb shell cmd connectivity airplane-mode disable || true
adb shell svc wifi enable || true
adb shell svc data enable || true
sleep 8

echo "== APK de depuración: puente nativo y escáner =="
adb uninstall "$PKG" >/dev/null || true
adb install -r "$DBG" | tee "$OUT/instalar-debug.txt"
adb logcat -c
abrir
sleep 20; foto 4-depuracion-20s
PID=$(adb shell pidof "$PKG" | tr -d '\r')
echo "pid $PID"
SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$PID" | head -1)
[ -z "$SOCK" ] && SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_[0-9]*" | head -1)
echo "socket $SOCK"
if [ -n "$SOCK" ]; then
  adb forward tcp:9222 "localabstract:$SOCK"
  node app-nativa/scripts/sonda.mjs info > "$OUT/sonda-info.json" 2>&1; cat "$OUT/sonda-info.json"
  node app-nativa/scripts/sonda.mjs escaner-modulo > "$OUT/sonda-modulo.json" 2>&1; cat "$OUT/sonda-modulo.json"
  node app-nativa/scripts/sonda.mjs escaner-abrir > "$OUT/sonda-escaner.txt" 2>&1
  sleep 10; foto 5-escaner-pantalla-completa
  adb shell input keyevent 4
  sleep 3; foto 6-despues-de-cerrar-escaner
  node app-nativa/scripts/sonda.mjs escaner-estado >> "$OUT/sonda-escaner.txt" 2>&1; cat "$OUT/sonda-escaner.txt"
else
  echo "No se encontró el socket de depuración del WebView" > "$OUT/sonda-info.json"
fi
adb logcat -d -v time Capacitor:V Capacitor/Console:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-debug.txt" || true
adb shell am force-stop "$PKG"
exit 0
