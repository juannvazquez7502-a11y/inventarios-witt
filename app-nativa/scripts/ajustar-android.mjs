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
  versionCode: VC, versionName: VN, permisosAgregados: permisos.length,
  minSdk: sdk("minSdkVersion"), compileSdk: sdk("compileSdkVersion"), targetSdk: sdk("targetSdkVersion")
}));
