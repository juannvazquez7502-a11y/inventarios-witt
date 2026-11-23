#!/usr/bin/env bash
# Prueba crítica de la app nativa en el emulador (la corre .github/workflows/app-nativa-prueba.yml).
# La app de prueba abre https://juannvazquez7502-a11y.github.io/inventarios-witt/prueba-nativa/ (la página CON nativa.js);
# la publicada (index.html) no se toca. *.supabase.co bloqueado por DNS; solo datos sintéticos.
# Toques reales con adb shell input, capturas con screencap y lectura de pantalla con uiautomator dump.
set -u
PKG=mx.grupowitt.inventarios
OUT=capturas
H="node app-nativa-prueba/critica.mjs"
mkdir -p "$OUT/xml"
DBG=$(ls apks/debug/*.apk | head -1)
REL=$(ls apks/release/*.apk 2>/dev/null | head -1)
TWA=$(ls apks/twa/*.apk 2>/dev/null | head -1)

paso() { echo; echo "==================== $* ===================="; }
foco() { adb shell dumpsys window | grep -m1 -E "mCurrentFocus" | tr -d '\r'; }
volcar() { # uiautomator dump con reintentos (la página tiene animaciones)
  local f="$1" i
  for i in 1 2 3; do
    if adb shell uiautomator dump /sdcard/u.xml 2>/dev/null | grep -q "dumped"; then adb shell cat /sdcard/u.xml > "$f"; return 0; fi
    sleep 1
  done
  echo "uiautomator dump falló" > "$f"; return 1
}
foto() {
  adb exec-out screencap -p > "$OUT/$1.png"
  volcar "$OUT/xml/$1.xml"
  foco > "$OUT/xml/$1.foco.txt"
  echo "captura $1 | $(cat "$OUT/xml/$1.foco.txt")"
}
cdp() { local n="$1"; shift; $H "$@" > "$OUT/cdp-$n.json" 2>&1; echo "--- cdp $n"; cat "$OUT/cdp-$n.json"; }
abrir() { adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
conectar() {
  local i PID SOCK=""
  adb forward --remove-all >/dev/null 2>&1
  for i in $(seq 1 40); do
    PID=$(adb shell pidof "$PKG" | tr -d '\r')
    [ -n "$PID" ] && SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$PID" | head -1)
    [ -n "$SOCK" ] && break
    sleep 1
  done
  if [ -n "$SOCK" ]; then adb forward tcp:9222 "localabstract:$SOCK" >/dev/null; echo "CDP: $SOCK"; else echo "CDP: sin socket"; fi
}
wvtop() { # borde superior del WebView en la pantalla (uiautomator)
  local f=/tmp/wv.xml t
  volcar "$f" >/dev/null
  t=$(tr '>' '\n' < "$f" | grep 'class="android.webkit.WebView"' | head -1 | sed -E 's/.*bounds="\[[0-9]+,([0-9]+)\].*/\1/')
  case "$t" in ''|*[!0-9]*) t=0;; esac
  echo "$t"
}
tocar() { # toca un elemento de la página (selector CSS) con un toque real
  local sel="$1" top xy
  top=$(wvtop); xy=$(WV_TOP=$top $H centro "$sel" | tr -d '"')
  echo "tocar '$sel' -> [$xy] (WebView desde y=$top)"
  case "$xy" in [0-9]*' '[0-9]*) adb shell input tap $xy; return 0;; *) return 1;; esac
}
tocar_nativo() { # toca un botón de Android por resource-id o texto (regex)
  local re="$1" f=/tmp/n.xml nodo b
  volcar "$f" >/dev/null
  nodo=$(tr '>' '\n' < "$f" | grep -E "$re" | head -1)
  b=$(echo "$nodo" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' | tr '\n' ' ')
  set -- $b
  if [ $# -eq 4 ]; then adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); echo "toque nativo '$re' en [$1,$2][$3,$4]"; return 0; fi
  echo "no encontré '$re'"; return 1
}
red() { # red on|off
  if [ "$1" = off ]; then adb shell cmd connectivity airplane-mode enable || true; adb shell svc wifi disable || true; adb shell svc data disable || true
  else adb shell cmd connectivity airplane-mode disable || true; adb shell svc wifi enable || true; adb shell svc data enable || true; fi
  sleep 5
}

adb wait-for-device
{ adb shell getprop ro.build.version.release; adb shell getprop ro.product.model; adb shell wm size; adb shell wm density;
  adb shell dumpsys package com.google.android.gms | grep -m1 versionName; adb shell dumpsys webviewupdate | grep -m2 -iE "Current WebView package|versionName"; } > "$OUT/dispositivo.txt" 2>&1
cat "$OUT/dispositivo.txt"
adb shell settings put global verifier_verify_adb_installs 0 || true
adb shell settings put global package_verifier_enable 0 || true
adb shell input keyevent 82 || true

# ---------------------------------------------------------------- A. Actualización encima del TWA (misma llave)
paso "A. TWA 1.0.1 y encima la nativa firmada 2.0.0"
if [ -n "$TWA" ] && [ -n "$REL" ]; then
  adb install "$TWA" > "$OUT/A-instalar-twa.txt" 2>&1; cat "$OUT/A-instalar-twa.txt"
  adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName" | head -2 >> "$OUT/A-instalar-twa.txt"
  adb install -r "$REL" > "$OUT/A-actualizar-a-nativa.txt" 2>&1; cat "$OUT/A-actualizar-a-nativa.txt"
  adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName" | head -2 >> "$OUT/A-actualizar-a-nativa.txt"
  cat "$OUT/A-actualizar-a-nativa.txt"
  abrir; sleep 20; foto A1-nativa-firmada-pagina-publicada
  adb shell am force-stop "$PKG"
else
  echo "Faltan APK del TWA o de la nativa firmada" | tee "$OUT/A-instalar-twa.txt"
fi
adb uninstall "$PKG" >/dev/null 2>&1 || true

# ---------------------------------------------------------------- B. APK de prueba (abre /prueba-nativa/, con nativa.js)
paso "B. Abre la app de prueba"
adb install -r "$DBG" | tee "$OUT/B-instalar.txt"
adb logcat -c
abrir
sleep 20; foto 01-abre-20s
conectar; cdp 01-info info

paso "B2. Bienvenida: escribe el nombre sintético con el teclado y toca Continuar"
if tocar "#welcome-name"; then sleep 1; adb shell input text "Demo"; sleep 1; tocar "#welcome-go"; fi
sleep 4; foto 02-selector-de-apps; cdp 02-info info

paso "C. Vehículos e inventario sintético"
tocar '.app-card[data-launch="autos"]'; sleep 5; foto 03-vehiculos; cdp 03-info info
cdp 03-excel excel; sleep 3; foto 04-inventario-sintetico-cargado

paso "D. Escanear: pestaña y botón Iniciar cámara (toques reales)"
tocar '.nav:not(.fz-nav) button[data-screen="scan"]' || tocar '#fab-scan'
sleep 3; foto 05-pantalla-escanear; cdp 05-info info
cdp 05-modulo modulo
tocar '#btn-cam-start'; sleep 4; foto 06-tras-iniciar-camara
if tocar_nativo 'permission_allow_foreground_only_button|While using the app|Mientras la app'; then sleep 8; foto 07-tras-permiso; fi
cdp 07-info info
# Si cayó a la cámara web porque faltaba el módulo de Google, espera a que se instale y vuelve a tocar.
if ! grep -q "com.google.android.gms" "$OUT/xml/07-tras-permiso.foco.txt" 2>/dev/null && ! foco | grep -q "com.google.android.gms"; then
  echo "El escáner de Google no se abrió en el primer toque; espero el módulo"
  for i in $(seq 1 45); do
    $H modulo > /tmp/m.json 2>&1; grep -q '"available": *true' /tmp/m.json && break; sleep 4
  done
  cat /tmp/m.json > "$OUT/cdp-07b-modulo.json"; cat /tmp/m.json
  $H eval 'typeof stopCamera==="function"&&stopCamera(),"stop"' >/dev/null 2>&1; sleep 2
  tocar '#btn-cam-start'; sleep 8; foto 07b-segundo-toque
fi
sleep 4; foto 08-mlkit-pantalla-completa

paso "E. Atrás dentro del escáner de Google"
adb shell input keyevent 4; sleep 3; foto 09-atras-cierra-escaner; cdp 09-info info

paso "F. Código sintético y atrás cierra la ventana"
cdp 10-codigo codigo; sleep 3; foto 10-unidad-encontrada
adb shell input keyevent 4; sleep 2; foto 11-atras-cierra-ventana; cdp 11-info info

paso "G. Atrás: Escanear -> Inicio -> selector -> sale"
adb shell input keyevent 4; sleep 2; foto 12-atras-a-inicio; cdp 12-info info
adb shell input keyevent 4; sleep 2; foto 13-atras-a-selector; cdp 13-info info
adb shell input keyevent 4; sleep 3; foto 14-atras-sale-de-la-app
echo "pid tras salir: $(adb shell pidof $PKG | tr -d '\r')" | tee "$OUT/14-pid.txt"

paso "H. Sin red, con la app ya abierta antes (service worker de /prueba-nativa/)"
adb shell am force-stop "$PKG"
red off
abrir; sleep 15; foto 15-sin-red-ya-guardada; conectar; cdp 15-info info
tocar '.app-card[data-launch="autos"]' && sleep 4
tocar '.nav:not(.fz-nav) button[data-screen="scan"]' || tocar '#fab-scan'
sleep 3; tocar '#btn-cam-start'; sleep 8; foto 16-sin-red-escaner; cdp 16-info info
adb shell input keyevent 4; sleep 2

paso "I. Sin red y sin nada guardado (copia local sin-conexion.html)"
adb shell am force-stop "$PKG"
adb shell pm clear "$PKG" >/dev/null
abrir; sleep 15; foto 17-sin-red-primera-vez; conectar; cdp 17-info info
if tocar "#welcome-name"; then sleep 1; adb shell input text "Demo"; sleep 1; tocar "#welcome-go"; fi
sleep 3; tocar '.app-card[data-launch="autos"]'; sleep 4; foto 18-copia-local-vehiculos; cdp 18-info info
adb shell am force-stop "$PKG"
red on

paso "J. De nuevo con red tras abrir la copia local"
abrir; sleep 15; foto 19-con-red-otra-vez; conectar; cdp 19-info info

adb logcat -d -v time Capacitor:V Capacitor/Console:V Capacitor/Plugin:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-app.txt" || true
adb logcat -d -v time | grep -iE "barcode|mlkit|moduleinstall|vision|permission" | tail -300 > "$OUT/logcat-mlkit.txt" || true
adb shell am force-stop "$PKG"
exit 0
