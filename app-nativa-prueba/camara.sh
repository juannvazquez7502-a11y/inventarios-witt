#!/usr/bin/env bash
# Prueba de la cámara Witt (v2.2) en el emulador (la corre .github/workflows/app-nativa-prueba.yml con prueba = camara).
# La app de prueba abre https://juannvazquez7502-a11y.github.io/inventarios-witt/prueba-nativa/ (la página CON nativa.js).
# Solo datos sintéticos: inventario de 20 unidades con VIN falsos e imágenes sintéticas (assets/witt-prueba, SOLO en este
# APK de prueba). *.supabase.co bloqueado por DNS.
# Toques reales (adb shell input), capturas (screencap), lectura de pantalla (uiautomator) y la página por CDP.
# Como la cámara del emulador no ve un código, la lectura se prueba con WittCamara.probar({imagen}): el plugin analiza la
# imagen con el MISMO ML Kit y entrega el resultado por el MISMO camino que un cuadro de la cámara.
set -u
PKG=mx.grupowitt.inventarios
OUT=capturas
H="node app-nativa-prueba/critica.mjs"
mkdir -p "$OUT/xml" "$OUT/medidas"
DBG=$(ls apks/debug/*.apk | head -1)
RES="$OUT/resultados.txt"; : > "$RES"

paso() { echo; echo "==================== $* ===================="; }
foco() { adb shell dumpsys window | grep -m1 -E "mCurrentFocus" | tr -d '\r'; }
volcar() {
  local f="$1" i
  for i in 1 2 3; do
    if adb shell uiautomator dump /sdcard/u.xml 2>/dev/null | grep -q "dumped"; then adb shell cat /sdcard/u.xml > "$f"; return 0; fi
    sleep 1
  done
  echo "uiautomator dump falló" > "$f"; return 1
}
rapida() { adb exec-out screencap -p > "$OUT/$1.png"; echo "captura rápida $1"; }   # sin uiautomator (para el color, que dura poco)
foto() {
  adb exec-out screencap -p > "$OUT/$1.png"
  volcar "$OUT/xml/$1.xml"
  foco > "$OUT/xml/$1.foco.txt"
  echo "captura $1 | $(cat "$OUT/xml/$1.foco.txt")"
}
cdp() { local n="$1"; shift; $H "$@" > "$OUT/cdp-$n.json" 2>&1; echo "--- cdp $n"; head -c 3000 "$OUT/cdp-$n.json"; echo; }
js() { $H eval "$1" 2>&1 | head -c 1500; echo; }
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
wvtop() {
  local f=/tmp/wv.xml t
  volcar "$f" >/dev/null
  t=$(tr '>' '\n' < "$f" | grep 'class="android.webkit.WebView"' | head -1 | sed -E 's/.*bounds="\[[0-9]+,([0-9]+)\].*/\1/')
  case "$t" in ''|*[!0-9]*) t=0;; esac
  echo "$t"
}
sin_anr() {
  local i
  for i in 1 2 3; do
    foco | grep -q "Not Responding" || return 0
    echo "aviso ANR del sistema: lo cierro"
    tocar_nativo 'aerr_wait|text="Wait"' || adb shell input keyevent 4
    sleep 2
  done
}
tocar() {
  local sel="$1" top xy i
  sin_anr
  for i in 1 2 3 4 5; do top=$(wvtop); [ "$top" != 0 ] && break; sleep 2; done
  xy=$(WV_TOP=$top $H centro "$sel" | tr -d '"')
  echo "tocar '$sel' -> [$xy] (WebView desde y=$top)"
  case "$xy" in [0-9]*' '[0-9]*) adb shell input tap $xy; return 0;; *) return 1;; esac
}
tocar_nativo() { # toca una vista de Android por texto o content-desc (regex)
  local re="$1" f=/tmp/n.xml nodo b
  volcar "$f" >/dev/null
  nodo=$(tr '>' '\n' < "$f" | grep -E "$re" | head -1)
  b=$(echo "$nodo" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' | tr '\n' ' ')
  set -- $b
  if [ $# -eq 4 ]; then adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); echo "toque nativo '$re' en [$1,$2][$3,$4]"; return 0; fi
  echo "no encontré '$re'"; return 1
}
camara_visible() { # ¿la cámara Witt está en pantalla? (sus vistas nativas en uiautomator)
  if grep -q 'content-desc="Cámara Witt"' "$OUT/xml/$1.xml" 2>/dev/null || grep -q 'content-desc="Cerrar la cámara"' "$OUT/xml/$1.xml" 2>/dev/null; then echo si; else echo no; fi
}
anotar() { echo "$*" | tee -a "$RES"; }
probar() { js "Capacitor.Plugins.WittCamara.probar({imagen:'$1'}).then(r=>JSON.stringify(r),e=>'ERROR '+(e.code||'')+' '+e.message)"; }
avisos() { $H eval 'JSON.stringify(((__wittNativa.estado().camara||{}).avisos||[]).slice(-3))' 2>&1 | tail -c 900; echo; }
estado_plugin() { $H eval 'Capacitor.Plugins.WittCamara.estado().then(r=>JSON.stringify(r))' 2>&1 | tail -c 900; echo; }
permiso() { # el diálogo de Android para la cámara, si sale
  sleep 2
  if tocar_nativo 'permission_allow_foreground_only_button|permission_allow_button|While using the app|Mientras la app'; then anotar "Permiso de cámara: diálogo de Android aceptado"; sleep 3; fi
}
fps_surface() { # fps de la vista previa (capa SurfaceView en SurfaceFlinger) en ~2 s de muestras
  local capa n
  adb shell dumpsys SurfaceFlinger --list | tr -d '\r' | grep -E "SurfaceView" > "$OUT/medidas/capas-surfaceview.txt" || true
  : > "$OUT/medidas/$1-surfaceflinger.txt"
  while IFS= read -r capa; do
    [ -z "$capa" ] && continue
    adb shell dumpsys SurfaceFlinger --latency "\"$capa\"" | tr -d '\r' > /tmp/lat.txt
    n=$(awk 'NR>1 && $2>0 && $2<9000000000000000000 {print $2}' /tmp/lat.txt | sort -n | awk 'NR==1{a=$1} {b=$1; n++} END{ if(n>1 && b>a) printf "%d cuadros, %.1f fps", n, (n-1)/((b-a)/1e9); else print "sin cuadros" }')
    echo "$capa -> $n" >> "$OUT/medidas/$1-surfaceflinger.txt"
  done < "$OUT/medidas/capas-surfaceview.txt"
  cat "$OUT/medidas/$1-surfaceflinger.txt"
}

adb wait-for-device
{ adb shell getprop ro.build.version.release; adb shell getprop ro.product.model; adb shell wm size; adb shell wm density;
  adb shell dumpsys webviewupdate | grep -m2 -iE "Current WebView package|versionName"; } > "$OUT/dispositivo.txt" 2>&1
cat "$OUT/dispositivo.txt"
adb shell settings put global verifier_verify_adb_installs 0 || true
adb shell settings put global package_verifier_enable 0 || true
adb shell input keyevent 82 || true

paso "A. Instala y abre la app de prueba"
adb install -r "$DBG" | tee "$OUT/A-instalar.txt"
adb logcat -c
abrir; sleep 20; sin_anr; foto 00-abre
conectar; cdp 00-info info
if tocar "#welcome-name"; then sleep 1; adb shell input text "Demo"; sleep 1; tocar "#welcome-go"; fi
sleep 4
tocar '.app-card[data-launch="autos"]'; sleep 5
cdp 01-excel excel; sleep 3
js '(()=>{document.querySelectorAll(".modal-bg.show").forEach(m=>m.classList.remove("show"));return "ventanas cerradas"})()'
# El color se ve 2.5 s antes de cerrar la cámara para la ventana (solo para poder tomar la captura; en la app es 0.9 s).
js '(()=>{__wittNativa.config.cerrarMs=2500;return JSON.stringify({plugin:Capacitor.isPluginAvailable("WittCamara"),version:__wittNativa.version})})()'
estado_plugin | tee "$OUT/medidas/plugin-antes.json"
foto 01-vehiculos-inventario-sintetico

paso "B. Botón verde (toque real): abre DIRECTO la cámara Witt, sin la pantalla Escáner Multimodal"
tocar '#fab-scan'
permiso
sleep 4; foto 02-boton-verde-camara-directa
anotar "B. Botón verde -> cámara Witt visible: $(camara_visible 02-boton-verde-camara-directa) | foco: $(cat "$OUT/xml/02-boton-verde-camara-directa.foco.txt")"
cdp 02-info info
anotar "B. Pantalla de la página detrás: $(grep -o '"pantalla": *"[^"]*"' "$OUT/cdp-02-info.json" | head -1)"
for d in "Modo Normal" "Modo Continuo" "Modo Placa" "Cerrar la cámara" "Escribir" "Foto" "Dictar" "Zoom" "Ubicación" "Avisos con voz"; do
  if grep -q "content-desc=\"$d" "$OUT/xml/02-boton-verde-camara-directa.xml"; then anotar "   ajuste visible: $d"; else anotar "   ajuste NO visible: $d"; fi
done
estado_plugin | tee "$OUT/medidas/plugin-abierta.json"

paso "C. Modo Continuo (toque real en la barra de la cámara)"
tocar_nativo 'content-desc="Modo Continuo"'; sleep 2
anotar "C. Continuo en la página: $($H eval 'String(document.getElementById("cs-toggle").checked)' 2>&1 | tail -1)"
foto 03-modo-continuo

paso "D. Verde: unidad disponible (QR sintético con el VIN de la unidad 1)"
probar verde.png; sleep 0.5; rapida 04-verde-disponible; sleep 1
anotar "D. avisos: $(avisos)"
sleep 2; foto 04b-verde-tarjeta

paso "E. Amarillo: la misma unidad otra vez (ya encontrada)"
sleep 7
probar verde.png; sleep 0.6; rapida 05-amarillo-ya-encontrada; sleep 1
anotar "E. avisos: $(avisos)"

paso "F. Verde con Code 128 (unidad 2) y Deshacer desde la cámara"
sleep 3
probar barras.png; sleep 0.6; rapida 06-verde-code128; sleep 0.8
tocar_nativo 'text="Deshacer"' && sleep 1.5
foto 07-deshacer
anotar "F. avisos: $(avisos)"

paso "G. Rojo: VIN que no está en el inventario"
sleep 3
probar rojo.png; sleep 0.6; rapida 08-rojo-fuera-de-inventario; sleep 1
anotar "G. avisos: $(avisos)"
sleep 3; foto 09-ventana-de-la-app; cdp 09-info info
anotar "G. Tras el rojo -> cámara visible: $(camara_visible 09-ventana-de-la-app); ventanas: $(grep -o '"modales": *\[[^]]*\]' "$OUT/cdp-09-info.json" | tr -d '\n ')"

paso "H. Atrás cierra la ventana y la cámara vuelve sola"
adb shell input keyevent 4; sleep 4; foto 10-vuelve-a-la-camara
anotar "H. Vuelve a la cámara: $(camara_visible 10-vuelve-a-la-camara)"

paso "I. Medidas: fps de la vista previa y de la respiración"
sleep 2
estado_plugin | tee "$OUT/medidas/plugin-estado-1.json"
adb shell dumpsys gfxinfo "$PKG" reset > /dev/null
fps_surface reposo
sleep 8
estado_plugin | tee "$OUT/medidas/plugin-estado-2.json"
adb shell dumpsys gfxinfo "$PKG" > "$OUT/medidas/gfxinfo-reposo.txt"
adb shell dumpsys gfxinfo "$PKG" reset > /dev/null
js 'Capacitor.Plugins.WittCamara.feedback({color:"amarillo",titulo:"Prueba de respiración",detalle:"marco y tarjeta animados",mantener:true,sonido:false,vibrar:false}).then(()=>"respira")'
sleep 1; rapida 11-respiracion-amarillo
fps_surface respirando
sleep 6
adb shell dumpsys gfxinfo "$PKG" > "$OUT/medidas/gfxinfo-respiracion.txt"
adb shell dumpsys gfxinfo "$PKG" framestats > "$OUT/medidas/gfxinfo-respiracion-framestats.txt"
js 'Capacitor.Plugins.WittCamara.feedback({color:"neutro",titulo:"",sonido:false,vibrar:false}).then(()=>"ok")'
for f in reposo respiracion; do
  anotar "I. gfxinfo $f: $(grep -E 'Total frames rendered|Janky frames|50th percentile|90th percentile|99th percentile' "$OUT/medidas/gfxinfo-$f.txt" | head -5 | tr -s ' ' | tr '\n' ';')"
done
anotar "I. SurfaceFlinger: $(cat "$OUT/medidas/reposo-surfaceflinger.txt" | tr '\n' ';')"
anotar "I. Plugin: $(cat "$OUT/medidas/plugin-estado-2.json")"
adb logcat -d -s WittCamara:I | grep -E "fps camara|rangos de fps|cámara abierta" | tail -8 | tee "$OUT/medidas/logcat-fps.txt"

paso "J. Placa (toque real en Modo Placa; OCR con ML Kit empaquetado y votación)"
tocar_nativo 'content-desc="Modo Placa"'; sleep 1.5
foto 12-modo-placa
probar placa.png; sleep 0.4; probar placa.png; sleep 0.4; probar placa.png; sleep 0.5; rapida 13-placa-leida
sleep 3; foto 14-placa-resultado; cdp 14-info info
anotar "J. avisos: $(avisos)"
adb logcat -d -s WittCamara:I | grep -E "placa" | tail -3 | tee -a "$RES"

paso "K. Atrás cierra la ventana (vuelve la cámara) y luego la X cierra la cámara"
adb shell input keyevent 4; sleep 4
tocar_nativo 'content-desc="Cerrar la cámara"'; sleep 2; foto 15-cerrada-con-x; cdp 15-info info
anotar "K. Tras la X -> cámara visible: $(camara_visible 15-cerrada-con-x)"

paso "L. Pestaña Escanear (toque real) y Escribir a mano"
tocar '.nav:not(.fz-nav) button[data-screen="scan"]'; sleep 4; foto 16-pestana-escanear
anotar "L. Pestaña -> cámara visible: $(camara_visible 16-pestana-escanear)"
tocar_nativo 'content-desc="Escribir"'; sleep 3; foto 17-escribir-a-mano; cdp 17-info info
anotar "L. Escribir -> foco: $($H eval 'document.activeElement&&document.activeElement.id' 2>&1 | tail -1) | teclado: $(adb shell dumpsys input_method | grep -m1 -oE 'mInputShown=(true|false)')"
adb shell input keyevent 4; sleep 1

paso "M. Ubicación desde la cámara"
tocar '#fab-scan'; sleep 4
tocar_nativo 'content-desc="Ubicación'; sleep 3; foto 18-ubicacion; cdp 18-info info
anotar "M. Ubicación -> ventanas: $(grep -o '"modales": *\[[^]]*\]' "$OUT/cdp-18-info.json" | tr -d '\n ')"
adb shell input keyevent 4; sleep 3; foto 19-tras-ubicacion

paso "N. Modo Normal: verde y la ventana de la unidad"
if [ "$(camara_visible 19-tras-ubicacion)" != si ]; then tocar '#fab-scan'; sleep 4; fi
tocar_nativo 'content-desc="Modo Normal"'; sleep 1.5
probar barras.png; sleep 0.6; rapida 20-normal-verde; sleep 3.5; foto 21-normal-ventana-unidad; cdp 21-info info
anotar "N. avisos: $(avisos)"

paso "O. Leer placa (toque real) abre la cámara en modo Placa"
adb shell input keyevent 4; sleep 3
tocar_nativo 'content-desc="Cerrar la cámara"' && sleep 2
# "Leer placa" está en la pantalla Escanear de la página, que ya no se abre sola: se muestra un momento sin la cámara Witt.
js '(()=>{__wittNativa.config.camaraWitt=false;return "web un momento"})()'
tocar '.nav:not(.fz-nav) button[data-screen="scan"]'; sleep 3
js '(()=>{__wittNativa.config.camaraWitt=true;return "witt"})()'
tocar '#btn-plate'; sleep 4; foto 22-leer-placa
anotar "O. Leer placa -> cámara visible: $(camara_visible 22-leer-placa); modo: $($H eval '__wittNativa.estado().camara.modo' 2>&1 | tail -1)"

paso "P. Registro"
cdp 99-info info
adb logcat -d -v time -s WittCamara:V AndroidRuntime:E > "$OUT/logcat-camara.txt" || true
adb logcat -d -v time Capacitor:V Capacitor/Console:V Capacitor/Plugin:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-app.txt" || true
adb logcat -d -v time | grep -iE "camera|mlkit|barcode|vision" | tail -400 > "$OUT/logcat-camerax.txt" || true
grep -E "FATAL|AndroidRuntime" "$OUT/logcat-camara.txt" | head -5 | tee -a "$RES"
echo; echo "===== RESULTADOS ====="; cat "$RES"
adb shell am force-stop "$PKG"
exit 0
