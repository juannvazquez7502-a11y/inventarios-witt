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
# Espera el aviso de color que la página manda a la cámara (hasta 25 s: en el emulador ML Kit tarda 1-5 s por cuadro).
ESPERA_JS='for(let i=0;i<170;i++){const a=((__wittNativa.estado().camara||{}).avisos)||[];const u=a[a.length-1];if(u&&u.t>=t0)return u.color+" | "+u.titulo+(u.cerrar?" | cierra la cámara":"")+" | "+((Date.now()-t0)/1000).toFixed(1)+" s";await new Promise(r=>setTimeout(r,150));}'
leer() { # lee una imagen sintética con el plugin (mismo ML Kit y mismo camino que un cuadro de la cámara) y espera el color
  $H eval "(async()=>{const t0=Date.now();let p='';try{await Capacitor.Plugins.WittCamara.probar({imagen:'$1'});}catch(e){p=' (probar: '+(e.code||'')+' '+e.message+')';}${ESPERA_JS}return 'sin aviso'+p;})()" 2>&1 | tail -1 | sed "s/^/$1 -> /"
}
esperar_aviso() { $H eval "(async()=>{const t0=Date.now()-$1*1000;${ESPERA_JS}return 'sin aviso';})()" 2>&1 | tail -1; }
estado_plugin() { $H eval 'Capacitor.Plugins.WittCamara.estado().then(r=>JSON.stringify(r))' 2>&1 | tail -c 900; echo; }
permiso() { # el diálogo de Android para la cámara, si sale
  sleep 2
  if tocar_nativo 'permission_allow_foreground_only_button|permission_allow_button|While using the app|Mientras la app'; then anotar "Permiso de cámara: diálogo de Android aceptado"; sleep 3; fi
}
fps_surface() { # fps de la vista previa (capa SurfaceView en SurfaceFlinger) en ~2 s de muestras
  local capa n
  adb shell dumpsys SurfaceFlinger --list | tr -d '\r' | grep -E "SurfaceView" | grep -v "^Background" | sed -E 's/^RequestedLayerState\{//; s/ parentId=.*$//; s/\}$//' | grep -v "^Background" > "$OUT/medidas/capas-surfaceview.txt" || true
  : > "$OUT/medidas/$1-surfaceflinger.txt"
  while IFS= read -r capa; do
    [ -z "$capa" ] && continue
    adb shell "dumpsys SurfaceFlinger --latency '$capa'" | tr -d '\r' > /tmp/lat.txt; cp /tmp/lat.txt "$OUT/medidas/$1-latency-$(echo "$capa" | tr -c 'A-Za-z0-9' _ | tail -c 24).txt"
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
anotar "D. $(leer verde.png)"; sleep 0.3; rapida 04-verde-disponible
sleep 0.9; rapida 04b-verde-respira
anotar "D. pantalla: $(adb shell dumpsys window | grep -m1 mCurrentFocus | tr -d '\r')"

paso "E. Amarillo: la misma unidad otra vez (ya encontrada; el continuo ignora el mismo código 6 s)"
sleep 7
anotar "E. $(leer verde.png)"; sleep 0.3; rapida 05-amarillo-ya-encontrada
sleep 3

paso "F. Verde con Code 128 (unidad 2) y Deshacer desde la cámara (toque real)"
anotar "F. $(leer barras.png)"; sleep 0.3; rapida 06-verde-code128
tocar_nativo 'text="Deshacer"' && sleep 2
foto 07-deshacer
anotar "F. Tras Deshacer: registros $($H eval 'String(document.querySelectorAll("#history-list .hist-item").length)+" en historial; ronda "+(typeof csState!=="undefined"?csState.round.length:"?")' 2>&1 | tail -1)"

paso "G. Rojo: VIN que no está en el inventario (la cámara se cierra y la app abre su ventana)"
sleep 3
anotar "G. $(leer rojo.png)"; sleep 0.3; rapida 08-rojo-fuera-de-inventario
sleep 4; foto 09-ventana-de-la-app; cdp 09-info info
anotar "G. Tras el rojo -> cámara visible: $(camara_visible 09-ventana-de-la-app); ventanas: $($H eval 'JSON.stringify([...document.querySelectorAll(".modal-bg.show")].map(m=>m.id))' 2>&1 | tail -1)"

paso "H. Atrás cierra la ventana y la cámara vuelve sola (en Continuo)"
adb shell input keyevent 4; sleep 5; foto 10-vuelve-a-la-camara
anotar "H. Vuelve a la cámara: $(camara_visible 10-vuelve-a-la-camara); modo: $($H eval '__wittNativa.estado().camara.modo' 2>&1 | tail -1)"

paso "I. Medidas: fps de la cámara, de la vista previa (SurfaceFlinger) y de la respiración (gfxinfo)"
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
sleep 1.5; rapida 11b-sin-aviso
for f in reposo respiracion; do
  anotar "I. gfxinfo $f: $(grep -E 'Total frames rendered|Janky frames:|50th percentile|90th percentile|99th percentile|50th gpu percentile' "$OUT/medidas/gfxinfo-$f.txt" | head -6 | tr -s ' ' | tr '\n' ';')"
done
anotar "I. SurfaceFlinger reposo: $(tr '\n' ';' < "$OUT/medidas/reposo-surfaceflinger.txt")"
anotar "I. SurfaceFlinger respirando: $(tr '\n' ';' < "$OUT/medidas/respirando-surfaceflinger.txt")"
anotar "I. Plugin: $(tr -d '\n ' < "$OUT/medidas/plugin-estado-2.json")"
adb logcat -d -s WittCamara:I | grep -E "fps camara|rangos de fps|cámara abierta" | tail -8 | tee "$OUT/medidas/logcat-fps.txt"

paso "J. Placa (toque real en Modo Placa; OCR con ML Kit empaquetado y votación de varios cuadros)"
tocar_nativo 'content-desc="Modo Placa"'; sleep 2
foto 12-modo-placa
anotar "J. modo: $($H eval '__wittNativa.estado().camara.modo' 2>&1 | tail -1)"
probar placa.png; sleep 3; probar placa.png
anotar "J. $(esperar_aviso 4)"; sleep 0.3; rapida 13-placa-leida
sleep 4; foto 14-placa-resultado; cdp 14-info info
anotar "J. ventanas: $($H eval 'JSON.stringify([...document.querySelectorAll(".modal-bg.show")].map(m=>m.id))' 2>&1 | tail -1)"
adb logcat -d -s WittCamara:I | grep -E " placa " | tail -3 | tee -a "$RES"

paso "K. Atrás cierra la ventana (vuelve la cámara) y la X cierra la cámara"
adb shell input keyevent 4; sleep 5
foto 15a-vuelve
tocar_nativo 'content-desc="Cerrar la cámara"'; sleep 3; foto 15-cerrada-con-x; cdp 15-info info
anotar "K. Tras la X -> cámara visible: $(camara_visible 15-cerrada-con-x); pantalla: $($H eval '(document.querySelector(".screen.active")||{}).id' 2>&1 | tail -1)"

paso "L. Botón verde y Escribir a mano (toque real en Escribir)"
tocar '#fab-scan'; sleep 5; foto 16-boton-verde-otra-vez
anotar "L. Botón verde -> cámara visible: $(camara_visible 16-boton-verde-otra-vez)"
tocar_nativo 'content-desc="Escribir"'; sleep 4; foto 17-escribir-a-mano
anotar "L. Escribir -> foco: $($H eval 'document.activeElement&&document.activeElement.id' 2>&1 | tail -1) | teclado: $(adb shell dumpsys input_method | grep -m1 -oE 'mInputShown=(true|false)')"
js '(()=>{try{document.activeElement.blur()}catch(e){}return "sin foco"})()'; sleep 1.5

paso "M. Ubicación desde la cámara (toque real en el chip)"
tocar '#fab-scan'; sleep 5
tocar_nativo 'content-desc="Ubicación'; sleep 3; foto 18-ubicacion
anotar "M. Ubicación -> ventanas: $($H eval 'JSON.stringify([...document.querySelectorAll(".modal-bg.show")].map(m=>m.id))' 2>&1 | tail -1)"
adb shell input keyevent 4; sleep 5; foto 19-tras-ubicacion
anotar "M. Tras cerrar la lista -> cámara visible: $(camara_visible 19-tras-ubicacion)"

paso "N. Modo Normal: color y la ventana de la unidad"
if [ "$(camara_visible 19-tras-ubicacion)" != si ]; then tocar '#fab-scan'; sleep 5; fi
tocar_nativo 'content-desc="Modo Normal"'; sleep 2
anotar "N. $(leer barras.png)"; sleep 0.3; rapida 20-normal-color
sleep 4; foto 21-normal-ventana-unidad
anotar "N. ventanas: $($H eval 'JSON.stringify([...document.querySelectorAll(".modal-bg.show")].map(m=>m.id))' 2>&1 | tail -1)"
adb shell input keyevent 4; sleep 5
tocar_nativo 'content-desc="Cerrar la cámara"'; sleep 3

paso "O. Leer placa (toque real) abre la cámara en modo Placa"
# "Leer placa" está en la pantalla Escanear de la página, que ya no se abre sola: se muestra un momento sin la cámara Witt.
js '(()=>{__wittNativa.config.camaraWitt=false;document.querySelector(".nav:not(.fz-nav) button[data-screen=\"scan\"]").click();return "pantalla Escanear"})()'
sleep 2
js '(()=>{__wittNativa.config.camaraWitt=true;return "witt"})()'
tocar '#btn-plate'; sleep 5; foto 22-leer-placa
anotar "O. Leer placa -> cámara visible: $(camara_visible 22-leer-placa); modo: $($H eval '__wittNativa.estado().camara.modo' 2>&1 | tail -1)"
tocar_nativo 'content-desc="Cerrar la cámara"'; sleep 2

paso "P. Registro"
cdp 99-info info
adb logcat -d -v time -s WittCamara:V AndroidRuntime:E > "$OUT/logcat-camara.txt" || true
adb logcat -d -v time Capacitor:V Capacitor/Console:V Capacitor/Plugin:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-app.txt" || true
adb logcat -d -v time | grep -iE "camera|mlkit|barcode|vision" | tail -400 > "$OUT/logcat-camerax.txt" || true
grep -E "FATAL" -A3 "$OUT/logcat-camara.txt" | grep -A3 "$PKG" | head -8 | tee -a "$RES"
echo; echo "===== RESULTADOS ====="; cat "$RES"
adb shell am force-stop "$PKG"
exit 0
