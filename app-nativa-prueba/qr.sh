#!/usr/bin/env bash
# Prueba de las ligas para unirse con la CÁMARA del teléfono (App Link) en el emulador.
# La corre .github/workflows/app-nativa-prueba.yml con prueba = qr. El APK es el de prueba (abre /prueba-nativa/, con
# nativa.js y enlaces.js) firmado con la MISMA llave del APK publicado, para que Android verifique el App Link con
# https://juannvazquez7502-a11y.github.io/.well-known/assetlinks.json. *.supabase.co bloqueado por DNS; solo datos sintéticos.
# Revisa: pm get-app-links = verified; "am start -a VIEW -d <liga>" abre LA APP (no Chrome) y muestra la unión, con la app
# cerrada (arranque en frío), abierta y en segundo plano; recargar no vuelve a unir. Una liga ya usada no vuelve a unir al
# abrir desde Recientes tras salir con Atrás (F) ni al volver después de que Android mató el proceso (G2, G3); una liga
# nueva con el proceso muerto sí une (G4).
set -u
PKG=mx.grupowitt.inventarios
OUT=capturas
H="node app-nativa-prueba/critica.mjs"
SITIO="https://juannvazquez7502-a11y.github.io/inventarios-witt/"
APK=$(ls apks/firmada/*.apk | head -1)
mkdir -p "$OUT/xml"

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
wvtop() {
  local f=/tmp/wv.xml t
  volcar "$f" >/dev/null
  t=$(tr '>' '\n' < "$f" | grep 'class="android.webkit.WebView"' | head -1 | sed -E 's/.*bounds="\[[0-9]+,([0-9]+)\].*/\1/')
  case "$t" in ''|*[!0-9]*) t=0;; esac
  echo "$t"
}
tocar_nativo() {
  local re="$1" f=/tmp/n.xml nodo b
  volcar "$f" >/dev/null
  nodo=$(tr '>' '\n' < "$f" | grep -E "$re" | head -1)
  b=$(echo "$nodo" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' | tr '\n' ' ')
  set -- $b
  if [ $# -eq 4 ]; then adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); echo "toque nativo '$re' en [$1,$2][$3,$4]"; return 0; fi
  echo "no encontré '$re'"; return 1
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
# Estado de la unión en la página (sin datos personales: solo códigos sintéticos).
UNION='JSON.stringify({url:location.href, nativa:window.__wittNativa&&__wittNativa.version, enlaces:window.__wittUnirse&&__wittUnirse.version,
  unirse:window.__wittUnirse&&__wittUnirse.estado(), logUnirse:window.__wittUnirse&&__wittUnirse.log.slice(-6),
  logNativa:window.__wittNativa&&__wittNativa.log.filter(function(x){return /liga|getLaunch|appUrl/.test(x)}).slice(-8),
  bienvenida:document.querySelector("#welcome").classList.contains("show"), selector:isLauncherOpen(),
  fisico:document.body.classList.contains("fisico-open"), joinCodeFisico:(function(){try{return FZ.joinCode||""}catch(e){return null}})(),
  codigoEnPantalla:(document.querySelector(".fz-joincode")||{}).textContent||null,
  modales:[].slice.call(document.querySelectorAll(".modal-bg.show")).map(function(m){return m.id}),
  codigoVehiculos:(document.querySelector("#collab-join-code")||{}).value||"", codigoRefacciones:(document.querySelector("#parts-collab-join-code")||{}).value||"",
  ligasSesion:(function(){try{return sessionStorage.getItem("witt-unirse-ligas")}catch(e){return "err"}})(), paginaMs:Math.round(performance.now())})'
# Abre la liga como lo hace la cámara del teléfono (intent VIEW + BROWSABLE) y dice qué app la recibió.
liga() {
  local n="$1" u="$2"
  echo "am start VIEW $u"
  adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "'$u'" > "$OUT/$n-am-start.txt" 2>&1
  cat "$OUT/$n-am-start.txt"
}
quien() { # quién quedó al frente
  local n="$1" f
  f=$(foco)
  if echo "$f" | grep -q "$PKG/"; then echo "ABRIO LA APP | $f" | tee "$OUT/$n-quien.txt"
  elif echo "$f" | grep -qiE "chrome|browser"; then echo "ABRIO EL NAVEGADOR (MAL) | $f" | tee "$OUT/$n-quien.txt"
  else echo "OTRA COSA | $f" | tee "$OUT/$n-quien.txt"; fi
}
# Deja la app en el selector, sin unión abierta (para que Atrás llegue a exitApp y se vea si la unión vuelve sola).
LIMPIAR='(function(){ var r=[]; try{ if(document.body.classList.contains("fisico-open")){ fzClose(); r.push("fzClose"); } }catch(e){}
  try{ FZ.joinCode=""; }catch(e){}
  [].slice.call(document.querySelectorAll(".modal-bg.show")).forEach(function(m){ m.classList.remove("show"); r.push("cierra " + m.id); });
  ["#collab-join-code","#parts-collab-join-code"].forEach(function(s){ var i=document.querySelector(s); if(i) i.value=""; });
  try{ if(!isLauncherOpen()){ openLauncher(); r.push("openLauncher"); } }catch(e){ r.push("err " + e.message); }
  return JSON.stringify({hecho:r, selector:isLauncherOpen()}); })()'
# Registro del sistema de la app (inicio, fin, procesos muertos, fallas), sin datos personales.
sistema() {
  adb logcat -d -v time -b main,system,crash | tr -d '\r' \
    | grep -iE "mx\.grupowitt|WittLiga|FATAL|AndroidRuntime|lowmemorykiller|lmkd|Force finishing|has died|Killing [0-9]+:mx" | tail -120 > "$OUT/$1.txt"
  echo "--- $1"; tail -40 "$OUT/$1.txt"
}
# Atrás real (adb) hasta que la app sale con exitApp (finish de MainActivity). Guarda el intent base de la tarea en Recientes.
salir_con_atras() {
  local n="$1" i
  if ! foco | grep -q "$PKG/"; then echo "$n: la app no está al frente antes de Atrás (no se prueba exitApp)" | tee "$OUT/$n-tras-atras.txt"; return 1; fi
  for i in 1 2 3 4; do
    adb shell input keyevent 4; sleep 3
    foco | grep -q "$PKG/" || break
  done
  { echo "Atrás x$i | $(foco)"; echo "MainActivity viva:"; adb shell dumpsys activity activities | tr -d '\r' | grep -E "ActivityRecord\{[^}]*$PKG/\.MainActivity" | head -3; } > "$OUT/$n-tras-atras.txt"
  echo "--- $n tras Atrás"; cat "$OUT/$n-tras-atras.txt"
  sistema "$n-registro-salir"
  adb shell dumpsys activity recents | tr -d '\r' | grep -A12 "$PKG" | grep -E "Recent #|intent=|baseIntent|realActivity" | head -8 > "$OUT/$n-recientes-intent.txt"
  echo "--- $n intent base en Recientes"; cat "$OUT/$n-recientes-intent.txt"
}
# Abre Recientes y toca la tarjeta de la app (la más reciente queda al centro). Si no queda al frente, prueba la miniatura.
recientes_volver() {
  local n="$1" W H
  adb shell input keyevent KEYCODE_APP_SWITCH; sleep 4
  foto "$n-recientes"
  set -- $(adb shell wm size | tr -d '\r' | grep -oE '[0-9]+x[0-9]+' | tail -1 | tr 'x' ' ')
  W=${1:-1080}; H=${2:-2400}
  adb shell input tap $(( W / 2 )) $(( H / 2 )); echo "toque a la tarjeta en Recientes ($(( W / 2 )),$(( H / 2 )))"
  sleep 4
  if ! foco | grep -q "$PKG/"; then
    adb shell input keyevent KEYCODE_APP_SWITCH; sleep 4
    tocar_nativo 'id/snapshot' || true; sleep 4
  fi
  echo "$n: volvió desde Recientes | $(foco)" | tee "$OUT/$n-recientes-volver.txt"
}
# Android mata el proceso de la app en segundo plano (como cuando le falta memoria). La tarea sigue en Recientes.
matar_en_fondo() {
  local n="$1" antes despues
  antes=$(adb shell pidof "$PKG" | tr -d '\r')
  adb shell am kill "$PKG"; sleep 3
  despues=$(adb shell pidof "$PKG" | tr -d '\r')
  if [ -n "$despues" ]; then adb shell am kill-all; sleep 3; despues=$(adb shell pidof "$PKG" | tr -d '\r'); fi
  echo "$n: proceso antes=$antes después=${despues:-ninguno}" | tee "$OUT/$n-proceso.txt"
}
# Veredicto: en la página nueva no debe aparecer el código viejo ni ninguna unión abierta o pendiente.
evaluar_sin_union() {
  local n="$1" c="$2"
  node -e '
    const [f, c, n] = process.argv.slice(1);
    let j; try { j = JSON.parse(require("fs").readFileSync(f, "utf8")); } catch (e) { console.log(n + ": SIN DATOS (no se pudo leer la página)"); process.exit(0); }
    const s = JSON.stringify(j), mal = [];
    if (s.includes(c)) mal.push("aparece " + c);
    if (j.fisico) mal.push("físico abierto");
    if ((j.modales || []).some(m => /collab/.test(m))) mal.push("ventana de unirse abierta");
    if (j.unirse && j.unirse.pendiente) mal.push("unión pendiente");
    console.log(n + ": " + (mal.length ? "MAL, " + mal.join(", ") : "BIEN, no volvió a unir (" + c + ")") + " | página nueva hace " + j.paginaMs + " ms");
  ' "$OUT/cdp-$n-union.json" "$c" "$n" | tee "$OUT/$n-veredicto.txt"
}

adb wait-for-device
{ adb shell getprop ro.build.version.release; adb shell getprop ro.product.model; adb shell wm size;
  adb shell dumpsys package com.google.android.gms | grep -m1 versionName; adb shell dumpsys webviewupdate | grep -m2 -iE "Current WebView package|versionName"; } > "$OUT/dispositivo.txt" 2>&1
cat "$OUT/dispositivo.txt"
adb shell settings put global verifier_verify_adb_installs 0 || true
adb shell settings put global package_verifier_enable 0 || true
adb shell input keyevent 82 || true

# ---------------------------------------------------------------- A. Instalar y verificar el App Link
paso "A. Instalar el APK de prueba firmado y verificar el App Link"
adb install -r "$APK" | tee "$OUT/A-instalar.txt"
adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName" | head -2 | tee -a "$OUT/A-instalar.txt"
for i in $(seq 1 24); do
  adb shell pm get-app-links "$PKG" | tr -d '\r' > "$OUT/A-get-app-links.txt"
  grep -q "juannvazquez7502-a11y.github.io: verified" "$OUT/A-get-app-links.txt" && break
  [ $((i % 4)) -eq 1 ] && adb shell pm verify-app-links --re-verify "$PKG" || true
  sleep 10
done
echo "--- pm get-app-links $PKG (intento $i)"; cat "$OUT/A-get-app-links.txt"
adb shell pm get-app-links --user cur "$PKG" | tr -d '\r' > "$OUT/A-get-app-links-usuario.txt" 2>&1 || true
cat "$OUT/A-get-app-links-usuario.txt"
adb shell pm resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "${SITIO}?unirse=FISICO-DEMO42" | tr -d '\r' | tee "$OUT/A-resuelve-liga.txt"
adb shell pm resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "${SITIO}pelicula-vehiculos.html" | tr -d '\r' | tee "$OUT/A-resuelve-otra-ruta.txt"

# ---------------------------------------------------------------- B. Primera vez: liga con la app recién instalada (pide el nombre)
paso "B. Arranque en frío, primera vez (bienvenida) con ?unirse=FISICO-DEMO41"
adb logcat -c
liga B "${SITIO}?unirse=FISICO-DEMO41"
sleep 20; sin_anr; foto B1-primera-vez-bienvenida; quien B1
conectar; cdp B1-union eval "$UNION"
if tocar "#welcome-name"; then sleep 1; adb shell input text "Demo"; sleep 1; tocar "#welcome-go"; fi
sleep 5; foto B2-tras-nombre-union-fisico; cdp B2-union eval "$UNION"

# ---------------------------------------------------------------- C. App cerrada (arranque en frío) con la liga del físico
paso "C. App cerrada: am start ?unirse=FISICO-DEMO42"
adb shell am force-stop "$PKG"; sleep 2
liga C "${SITIO}?unirse=FISICO-DEMO42"
sleep 3; quien C0
sleep 15; sin_anr; foto C1-frio-union-fisico; quien C1
conectar; cdp C1-union eval "$UNION"

paso "C2. Recargar la página no vuelve a unir"
$H eval '(function(){ try{ fzClose(); FZ.joinCode = ""; }catch(e){} location.reload(); return "recarga"; })()' || true
sleep 12; conectar; foto C2-tras-recargar; cdp C2-union eval "$UNION"

# ---------------------------------------------------------------- D. App abierta (al frente)
paso "D. App abierta: am start ?unirse=FISICO-DEMO42 y ?unirse=AUTOS-DEMO43"
liga D1 "${SITIO}?unirse=FISICO-DEMO42"
sleep 6; foto D1-abierta-union-fisico; quien D1; cdp D1-union eval "$UNION"
$H eval '(function(){ try{ fzClose(); FZ.joinCode = ""; }catch(e){} return "ok"; })()' >/dev/null 2>&1 || true
liga D2 "${SITIO}?unirse=AUTOS-DEMO43"
sleep 6; foto D2-abierta-union-vehiculos; quien D2; cdp D2-union eval "$UNION"
adb shell input keyevent 4; sleep 2

# ---------------------------------------------------------------- E. App en segundo plano
paso "E. App en segundo plano (Inicio del teléfono): am start ?unirse=REFACCIONES-DEMO44"
adb shell input keyevent 3; sleep 3
liga E "${SITIO}?unirse=REFACCIONES-DEMO44"
sleep 8; foto E1-segundo-plano-union-refacciones; quien E1; cdp E1-union eval "$UNION"

# ---------------------------------------------------------------- F. Liga ya usada: Atrás hasta salir (exitApp) y abrir desde Recientes
# El intent base de la tarea es el VIEW con ?unirse=. Al abrir desde Recientes, Android crea una Activity y un WebView
# nuevos con ese intent (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) y sessionStorage empieza vacío: MainActivity debe descartarlo.
paso "F. Liga en frío (FISICO-REL051), Atrás hasta salir y abrir desde Recientes: NO debe volver a unir"
adb shell am force-stop "$PKG"; sleep 2
liga F "${SITIO}?unirse=FISICO-REL051"
sleep 18; sin_anr; foto F1-frio-union-REL051; quien F1
if ! grep -q "ABRIO LA APP" "$OUT/F1-quien.txt"; then
  echo "F1: la app no quedó al frente; guardo el registro del sistema y repito la liga una vez"
  sistema F1-registro-sistema
  adb shell am force-stop "$PKG"; sleep 3
  liga F-reintento "${SITIO}?unirse=FISICO-REL051"
  sleep 20; sin_anr; foto F1b-frio-union-REL051; quien F1
fi
conectar; cdp F1-union eval "$UNION"
cdp F1-limpiar eval "$LIMPIAR"
sleep 2; foto F2-selector-antes-de-salir; quien F2
salir_con_atras F
recientes_volver F3
sleep 15; sin_anr; foto F3-desde-recientes; quien F3
conectar; cdp F3-union eval "$UNION"
evaluar_sin_union F3 REL051

# ---------------------------------------------------------------- G. Proceso muerto en segundo plano
paso "G. Liga en frío (AUTOS-REL052), Inicio, Android mata el proceso y se vuelve desde Recientes: NO debe volver a unir"
adb shell am force-stop "$PKG"; sleep 2
liga G "${SITIO}?unirse=AUTOS-REL052"
sleep 18; sin_anr; foto G1-frio-union-REL052; quien G1
conectar; cdp G1-union eval "$UNION"
cdp G1-limpiar eval "$LIMPIAR"
adb shell input keyevent 3; sleep 4
matar_en_fondo G2
recientes_volver G2
sleep 15; sin_anr; foto G2-proceso-muerto-desde-recientes; quien G2
conectar; cdp G2-union eval "$UNION"
evaluar_sin_union G2 REL052

paso "G3. Otra vez proceso muerto, ahora se vuelve con el ícono de la app: NO debe volver a unir"
adb shell input keyevent 3; sleep 4
matar_en_fondo G3
abrir
sleep 15; sin_anr; foto G3-proceso-muerto-desde-icono; quien G3
conectar; cdp G3-union eval "$UNION"
evaluar_sin_union G3 REL052

paso "G4. Proceso muerto y llega una liga NUEVA (REFACCIONES-REL053): SÍ debe unir con REL053"
adb shell input keyevent 3; sleep 4
matar_en_fondo G4
liga G4 "${SITIO}?unirse=REFACCIONES-REL053"
sleep 18; sin_anr; foto G4-proceso-muerto-liga-nueva; quien G4
conectar; cdp G4-union eval "$UNION"
if grep -q '"codigoRefacciones": "REL053"' "$OUT/cdp-G4-union.json"; then echo "G4: BIEN, la liga nueva abrió la unión con REL053" | tee "$OUT/G4-veredicto.txt"
else echo "G4: MAL, la liga nueva no abrió la unión con REL053" | tee "$OUT/G4-veredicto.txt"; fi

sistema logcat-sistema
adb logcat -d -v time WittLiga:V '*:S' > "$OUT/logcat-wittliga.txt" || true
echo "--- logcat WittLiga"; cat "$OUT/logcat-wittliga.txt"
cat "$OUT"/*-veredicto.txt > "$OUT/veredictos.txt" 2>/dev/null || true
echo "--- veredictos"; cat "$OUT/veredictos.txt"

adb logcat -d -v time Capacitor:V Capacitor/Console:V Capacitor/Plugin:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-app.txt" || true
adb logcat -d -v time | grep -iE "IntentFilter|DomainVerif|AppLink|statement|assetlinks" | tail -200 > "$OUT/logcat-verificacion.txt" || true
adb shell am force-stop "$PKG"
exit 0
