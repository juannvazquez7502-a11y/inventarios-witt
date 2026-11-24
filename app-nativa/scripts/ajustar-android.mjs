// Ajusta el proyecto android/ que genera "npx cap add android" (lo corre GitHub Actions desde app-nativa/).
// - Permisos: CAMERA (escáner y fotos de evidencia), VIBRATE (alertas), RECORD_AUDIO y MODIFY_AUDIO_SETTINGS
//   (la nota de voz de la app usa el micrófono: getUserMedia({audio:true}); sin ellos esa función se perdería).
//   INTERNET ya viene en la plantilla. Ningún otro.
// - ML Kit: descarga el escáner de Google (pantalla completa) al instalar la app.
// - versionCode = 100 + número de corrida (mayor que el del TWA, para instalarse encima) y versionName de la corrida.
// - App Link verificado (autoVerify) para la página de la app: la cámara del teléfono abre la app con la liga para unirse.
// - MainActivity descarta la liga de arranque cuando Android recrea la Activity con el mismo intent (Recientes, proceso muerto).
// - Cámara Witt (v2.2): plugin local en Kotlin (android-extra/camara) con CameraX y ML Kit empaquetado; MainActivity lo
//   registra. WITT_CAMARA=0 lo quita. WITT_CAMARA_PRUEBA=1 (solo el flujo de prueba) agrega las imágenes de prueba.
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

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
// App Link (23-nov-2026): la CÁMARA del teléfono lee el QR para unirse (liga https://…github.io/inventarios-witt/?unirse=…)
// y Android abre esta app directo, sin preguntar y sin Chrome. android:autoVerify="true": Android lo verifica con
// https://juannvazquez7502-a11y.github.io/.well-known/assetlinks.json (paquete y huella de la llave del APK).
// Solo la página de la app (/inventarios-witt/ e index.html), no las películas, los MP4 ni otras rutas del sitio.
// La liga llega a la página por el plugin App ("appUrlOpen" o getLaunchUrl) y la capa enlaces.js abre la unión.
const HOST_APP = "juannvazquez7502-a11y.github.io";
if (!man.includes('android:host="' + HOST_APP + '"')) {
  const iMain = man.search(/<activity\b[^>]*android:name="\.MainActivity"/);
  must(iMain >= 0, "<activity .MainActivity>");
  const iLanzador = man.indexOf("android.intent.category.LAUNCHER", iMain);
  must(iLanzador > iMain, "intent-filter LAUNCHER de MainActivity");
  const iFinFiltro = man.indexOf("</intent-filter>", iLanzador);
  const iFinAct = man.indexOf("</activity>", iMain);
  must(iFinFiltro > 0 && iFinFiltro < iFinAct, "cierre del intent-filter LAUNCHER");
  const FILTRO = [
    "",
    '            <intent-filter android:autoVerify="true">',
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    '                <data android:scheme="https" />',
    '                <data android:host="' + HOST_APP + '" />',
    '                <data android:path="/inventarios-witt/" />',
    '                <data android:path="/inventarios-witt" />',
    '                <data android:path="/inventarios-witt/index.html" />',
    "            </intent-filter>"
  ].join("\n");
  const corte = iFinFiltro + "</intent-filter>".length;
  man = man.slice(0, corte) + "\n" + FILTRO + man.slice(corte);
}
must(/android:launchMode="singleTask"/.test(man), 'android:launchMode="singleTask" en MainActivity (la liga con la app abierta llega por appUrlOpen)');
writeFileSync(MAN, man, "utf8");

// Liga ya usada (23-nov-2026). Si la app arrancó con la liga, el intent base de la tarea es ese VIEW con ?unirse=. Android
// lo vuelve a entregar a una Activity NUEVA (y Capacitor lo da otra vez por getLaunchUrl y "appUrlOpen") cuando:
//  - se sale con Atrás desde el selector (exitApp = finish()) y se vuelve a abrir desde Recientes (FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY);
//  - Android mató el proceso en segundo plano y se vuelve a la app (savedInstanceState != null).
// En esos casos MainActivity cambia el intent por uno MAIN antes de super.onCreate (Bridge lee getIntent().getData() al
// crearse), así la unión vieja no se vuelve a abrir. Una liga NUEVA escaneada con el proceso muerto llega aparte por
// onNewIntent y sí se abre. El arranque normal con la liga (cámara del teléfono) no trae ninguna de las dos marcas.
const dirJava = "android/app/src/main/java";
const actividades = readdirSync(dirJava, { recursive: true }).map(String).filter(f => /(^|[\\/])MainActivity\.java$/.test(f));
must(actividades.length === 1, "un solo MainActivity.java en " + dirJava);
const ACT = dirJava + "/" + actividades[0].replace(/\\/g, "/");
let act = readFileSync(ACT, "utf8");
let actividadLigaVieja = act.includes("witt-liga-vieja");
if (!actividadLigaVieja) {
  const paquete = (act.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
  must(paquete, "package en " + ACT);
  must(/public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/.test(act),
    "MainActivity vacío de la plantilla de Capacitor (" + ACT + "); si ya tiene código, agregar a mano el onCreate de witt-liga-vieja");
  act = [
    "package " + paquete + ";",
    "",
    "import android.content.Intent;",
    "import android.os.Bundle;",
    "import android.util.Log;",
    "import com.getcapacitor.BridgeActivity;",
    "",
    "public class MainActivity extends BridgeActivity {",
    "",
    "    // witt-liga-vieja: una liga para unirse que ya se uso no se vuelve a abrir cuando Android recrea la Activity con el",
    "    // mismo intent (abrir desde Recientes tras salir con Atras, o volver despues de que Android mato el proceso).",    "    @Override",
    "    protected void onCreate(Bundle savedInstanceState) {",
    "        Intent i = getIntent();",
    "        if (i != null && Intent.ACTION_VIEW.equals(i.getAction())) {",
    "            boolean historial = (i.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;",
    "            if (historial || savedInstanceState != null) {",
    "                Log.i(\"WittLiga\", \"liga vieja descartada: \" + (historial ? \"desde Recientes\" : \"Activity restaurada\"));",
    "                Intent principal = new Intent(Intent.ACTION_MAIN);",
    "                principal.addCategory(Intent.CATEGORY_LAUNCHER);",
    "                principal.setClass(this, MainActivity.class);",
    "                setIntent(principal);",
    "            }",
    "        }",
    "        super.onCreate(savedInstanceState);",
    "    }",
    "}",
    ""
  ].join("\n");
  writeFileSync(ACT, act, "utf8");
  actividadLigaVieja = true;
}

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

// Cámara Witt (23-nov-2026, v2.2). Cámara propia a pantalla completa, más rápida que el escáner de Google:
// - fuentes Kotlin de android-extra/camara junto a MainActivity (paquete mx.grupowitt.inventarios.camara);
// - Kotlin en el módulo app (la plantilla de Capacitor es solo Java) con jvmTarget 21, igual que Java en Capacitor 7;
// - CameraX 1.4.2 y ML Kit EMPAQUETADO (barcode-scanning 17.3.0 y text-recognition 16.0.1: los modelos van dentro del
//   APK, no se descargan de Google Play);
// - MainActivity registra el plugin antes de super.onCreate (registerPlugin).
const CAMARA = process.env.WITT_CAMARA !== "0";
const CAMARA_PRUEBA = process.env.WITT_CAMARA_PRUEBA === "1";
const KOTLIN = "2.0.21", CAMERAX = "1.4.2";
const camara = { activa: CAMARA, fuentes: 0, prueba: 0 };
if (CAMARA) {
  const EXTRA = "android-extra/camara";
  must(existsSync(EXTRA), EXTRA + " (fuentes de la cámara Witt)");
  const dirCam = dirname(ACT) + "/camara";
  mkdirSync(dirCam, { recursive: true });
  for (const f of readdirSync(EXTRA).filter(f => f.endsWith(".kt"))) { copyFileSync(EXTRA + "/" + f, dirCam + "/" + f); camara.fuentes++; }
  must(camara.fuentes >= 5, "las 5 fuentes .kt de la cámara Witt");

  let ma = readFileSync(ACT, "utf8");
  if (!ma.includes("WittCamaraPlugin")) {
    must(ma.includes("super.onCreate(savedInstanceState);"), "super.onCreate en MainActivity");
    ma = ma.replace("super.onCreate(savedInstanceState);",
      "registerPlugin(mx.grupowitt.inventarios.camara.WittCamaraPlugin.class);   // witt-camara\n        super.onCreate(savedInstanceState);");
    writeFileSync(ACT, ma, "utf8");
  }

  const RAIZ = "android/build.gradle";
  let raiz = readFileSync(RAIZ, "utf8");
  if (!raiz.includes("kotlin-gradle-plugin")) {
    must(/classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"]/.test(raiz), "classpath del Android Gradle Plugin en android/build.gradle");
    raiz = raiz.replace(/(classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"])/,
      `$1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN}'`);
    writeFileSync(RAIZ, raiz, "utf8");
  }

  if (!gr.includes("kotlin-android")) {
    must(/apply plugin:\s*['"]com\.android\.application['"]/.test(gr), "apply plugin com.android.application");
    gr = gr.replace(/(apply plugin:\s*['"]com\.android\.application['"])/, "$1\napply plugin: 'kotlin-android'");
    must(/\nandroid\s*\{/.test(gr), "bloque android { } en app/build.gradle");
    gr = gr.replace(/\nandroid\s*\{/, "\nandroid {\n    kotlinOptions { jvmTarget = '21' }   // witt-camara");
    must(/\ndependencies\s*\{/.test(gr), "bloque dependencies { } en app/build.gradle");
    gr = gr.replace(/\ndependencies\s*\{/, [
      "\ndependencies {",
      "    // witt-camara: CameraX y ML Kit empaquetado (códigos y texto para placas)",
      `    implementation "androidx.camera:camera-core:${CAMERAX}"`,
      `    implementation "androidx.camera:camera-camera2:${CAMERAX}"`,
      `    implementation "androidx.camera:camera-lifecycle:${CAMERAX}"`,
      `    implementation "androidx.camera:camera-view:${CAMERAX}"`,
      '    implementation "com.google.mlkit:barcode-scanning:17.3.0"',
      '    implementation "com.google.mlkit:text-recognition:16.0.1"'
    ].join("\n"));
  }

  // Si Java y Kotlin no compilan para la misma versión, avisa en lugar de detener la compilación.
  const GP = "android/gradle.properties";
  let gp = existsSync(GP) ? readFileSync(GP, "utf8") : "";
  if (!gp.includes("kotlin.jvm.target.validation.mode")) writeFileSync(GP, gp.replace(/\s*$/, "\n") + "kotlin.jvm.target.validation.mode=warning\n", "utf8");

  // Solo en el APK de prueba del emulador: imágenes sintéticas para probar la lectura sin cámara real (probar()).
  if (CAMARA_PRUEBA) {
    const ORIGEN = "../app-nativa-prueba/camara";
    must(existsSync(ORIGEN), ORIGEN + " (imágenes de prueba)");
    const DEST = "android/app/src/main/assets/witt-prueba";
    mkdirSync(DEST, { recursive: true });
    for (const f of readdirSync(ORIGEN).filter(f => /\.(png|jpe?g)$/i.test(f))) { copyFileSync(ORIGEN + "/" + f, DEST + "/" + f); camara.prueba++; }
  }
}
writeFileSync(GR, gr, "utf8");

const VAR = "android/variables.gradle";
const vars = readFileSync(VAR, "utf8");
const sdk = k => (vars.match(new RegExp(k + "\\s*=\\s*(\\d+)")) || [])[1];
console.log(JSON.stringify({
  versionCode: VC, versionName: VN, permisosAgregados: permisos.length, estilosBarras: estilos, fondoVentana: fondo,
  appLink: man.includes('android:autoVerify="true"') && man.includes('android:host="' + HOST_APP + '"'), ligaVieja: actividadLigaVieja, camara,
  minSdk: sdk("minSdkVersion"), compileSdk: sdk("compileSdkVersion"), targetSdk: sdk("targetSdkVersion")
}));
