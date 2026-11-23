// Ajusta el proyecto android/ que genera "npx cap add android" (lo corre GitHub Actions desde app-nativa/).
// - Permisos: CAMERA (escáner y fotos de evidencia), VIBRATE (alertas), RECORD_AUDIO y MODIFY_AUDIO_SETTINGS
//   (la nota de voz de la app usa el micrófono: getUserMedia({audio:true}); sin ellos esa función se perdería).
//   INTERNET ya viene en la plantilla. Ningún otro.
// - ML Kit: descarga el escáner de Google (pantalla completa) al instalar la app.
// - versionCode = 100 + número de corrida (mayor que el del TWA, para instalarse encima) y versionName de la corrida.
import { readFileSync, writeFileSync } from "node:fs";

const must = (cond, que) => { if (!cond) throw new Error("No encontré: " + que); };
const VC = parseInt(process.env.VERSION_CODE || "", 10);
const VN = process.env.VERSION_NAME || "";
must(Number.isInteger(VC) && VC > 100, "VERSION_CODE (> 100)");
must(/^[0-9][0-9A-Za-z.\-]*$/.test(VN), "VERSION_NAME válido");

const MAN = "android/app/src/main/AndroidManifest.xml";
let man = readFileSync(MAN, "utf8");
must(man.includes("android.permission.INTERNET"), "permiso INTERNET en la plantilla");
const permisos = ["CAMERA", "VIBRATE", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]
  .filter(p => !man.includes("android.permission." + p))
  .map(p => `    <uses-permission android:name="android.permission.${p}" />`);
const extras = [
  ...permisos,
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
  '    <uses-feature android:name="android.hardware.microphone" android:required="false" />'
].join("\n");
const iCierre = man.lastIndexOf("</manifest>");
must(iCierre > 0, "</manifest>");
man = man.slice(0, iCierre) + extras + "\n" + man.slice(iCierre);

must(man.includes("<application"), "<application");
if (!man.includes("com.google.mlkit.vision.DEPENDENCIES")) {
  man = man.replace(/(<application[^>]*>)/, `$1\n        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />`);
}
writeFileSync(MAN, man, "utf8");

// Barras del sistema: con targetSdk 35, Android 15 dibuja la app detrás de las barras (borde a borde) y no deja pintar la
// barra de estado (salía blanca con íconos blancos) ni acomoda la pantalla al teclado. La app pide salir de ese modo
// (windowOptOutEdgeToEdgeEnforcement): así la barra de estado toma el verde de la app (StatusBar.setBackgroundColor), el
// teclado empuja la página como en Chrome y Capacitor no agrega márgenes (adjustMarginsForEdgeToEdge = "auto").
const ST = "android/app/src/main/res/values/styles.xml";
let st = readFileSync(ST, "utf8");
if (!/xmlns:tools=/.test(st)) st = st.replace(/<resources(\s|>)/, '<resources xmlns:tools="http://schemas.android.com/tools"$1');
const BARRAS = [
  '        <item name="android:windowOptOutEdgeToEdgeEnforcement" tools:targetApi="35">true</item>',
  '        <item name="android:statusBarColor">#00574a</item>',
  '        <item name="android:navigationBarColor">#0f1111</item>',
  '        <item name="android:windowLightStatusBar">false</item>'
].join("\n");
let estilos = 0;
st = st.replace(/(<style\s+name="AppTheme\.NoActionBar(?:Launch)?"[^>]*>)([\s\S]*?)(\s*<\/style>)/g, (m, a, b, c) => {
  estilos++;
  return b.includes("windowOptOutEdgeToEdgeEnforcement") ? m : a + b + "\n" + BARRAS + c;
});
must(estilos === 2, "los estilos AppTheme.NoActionBar y AppTheme.NoActionBarLaunch en styles.xml");
// Fondo de la ventana de la app (no el de la pantalla de arranque, que es el splash verde): oscuro, igual que el del
// WebView (backgroundColor en capacitor.config.json). Al volver del escáner de Google, mientras el WebView repinta, se ve
// este fondo en lugar del blanco #fafafa que deslumbraba.
writeFileSync("android/app/src/main/res/values/witt_fondo.xml",
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="witt_fondo">#0f1111</color>\n</resources>\n', "utf8");
let fondo = 0;
st = st.replace(/(<style\s+name="AppTheme\.NoActionBar"[^>]*>)([\s\S]*?)(\s*<\/style>)/, (m, a, b, c) => {
  fondo++;
  return /android:windowBackground/.test(b) ? a + b.replace(/(<item name="android:windowBackground">)[^<]*(<\/item>)/, "$1@color/witt_fondo$2") + c
    : a + b + '\n        <item name="android:windowBackground">@color/witt_fondo</item>' + c;
});
must(fondo === 1, "el estilo AppTheme.NoActionBar para el fondo de la ventana");
writeFileSync(ST, st, "utf8");

const GR = "android/app/build.gradle";
let gr = readFileSync(GR, "utf8");
must(/versionCode\s+\d+/.test(gr), "versionCode en build.gradle");
must(/versionName\s+"[^"]*"/.test(gr), "versionName en build.gradle");
gr = gr.replace(/versionCode\s+\d+/, "versionCode " + VC).replace(/versionName\s+"[^"]*"/, `versionName "${VN}"`);
writeFileSync(GR, gr, "utf8");

const VAR = "android/variables.gradle";
const vars = readFileSync(VAR, "utf8");
const sdk = k => (vars.match(new RegExp(k + "\\s*=\\s*(\\d+)")) || [])[1];
console.log(JSON.stringify({
  versionCode: VC, versionName: VN, permisosAgregados: permisos.length, estilosBarras: estilos, fondoVentana: fondo,
  minSdk: sdk("minSdkVersion"), compileSdk: sdk("compileSdkVersion"), targetSdk: sdk("targetSdkVersion")
}));
