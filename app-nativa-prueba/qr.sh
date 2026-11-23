#!/usr/bin/env bash
# Prueba de las ligas para unirse con la CÁMARA del teléfono (App Link) en el emulador.
# La corre .github/workflows/app-nativa-prueba.yml con prueba = qr. El APK es el de prueba (abre /prueba-nativa/, con
# nativa.js y enlaces.js) firmado con la MISMA llave del APK publicado, para que Android verifique el App Link con
# https://juannvazquez7502-a11y.github.io/.well-known/assetlinks.json. *.supabase.co bloqueado por DNS; solo datos sintéticos.
# Revisa: pm get-app-links = verified; "am start -a VIEW -d <liga>" abre LA APP (no Chrome) y muestra la unión, con la app
# cerrada (arranque en frío), abierta y en segundo plano; recargar no vuelve a unir.
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
  codigoVehiculos:(document.querySelector("#collab-join-code")||{}).value||"", codigoRefacciones:(document.querySelector("#parts-collab-join-code")||{}).value||""})'
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

adb logcat -d -v time Capacitor:V Capacitor/Console:V Capacitor/Plugin:V chromium:I AndroidRuntime:E '*:S' > "$OUT/logcat-app.txt" || true
adb logcat -d -v time | grep -iE "IntentFilter|DomainVerif|AppLink|statement|assetlinks" | tail -200 > "$OUT/logcat-verificacion.txt" || true
adb shell am force-stop "$PKG"
exit 0
