// Genera el proyecto Android (TWA) que abre la versión web publicada en GitHub Pages.
// Lo corre GitHub Actions (.github/workflows/apk.yml). La app de Android es solo una "ventana" de Chrome
// a pantalla completa: todo lo demás (datos, cambios, nube) es la misma versión web.
const path = require('path');
const { TwaManifest, TwaGenerator, ConsoleLog } = require('@bubblewrap/core');

const HOST = 'juannvazquez7502-a11y.github.io';
const BASE = `https://${HOST}/inventarios-witt/`;

(async () => {
  const log = new ConsoleLog('apk');
  const twa = await TwaManifest.fromWebManifest(BASE + 'manifest.json');
  twa.packageId = 'mx.grupowitt.inventarios';
  twa.host = HOST;
  twa.startUrl = '/inventarios-witt/';
  twa.name = 'Inventarios Grupo Witt';
  twa.launcherName = 'Inventarios';
  const Color = require('color'); // bubblewrap guarda los colores como objetos Color
  const verde = Color('#00574a');
  twa.themeColor = verde;
  twa.themeColorDark = verde;
  twa.navigationColor = verde;
  twa.navigationColorDark = verde;
  twa.navigationDividerColor = verde;
  twa.navigationDividerColorDark = verde;
  twa.backgroundColor = verde;
  twa.display = 'standalone';
  twa.orientation = 'default';
  twa.enableNotifications = false;
  twa.fallbackType = 'customtabs';
  twa.appVersionName = process.env.APP_VERSION_NAME || '1.0.0';
  twa.appVersionCode = parseInt(process.env.APP_VERSION_CODE || '1', 10);
  twa.minSdkVersion = 24; // androidbrowserhelper 2.7 pide Android 7 o más
  twa.signingKey ={ path: path.resolve('android.keystore'), alias: 'android' };
  twa.webManifestUrl = new URL(BASE + 'manifest.json');
  const dir = path.resolve('twa');
  await new TwaGenerator().createTwaProject(dir, twa, log);
  await twa.saveToFile(path.join(dir, 'twa-manifest.json'));
  console.log('Proyecto Android generado en', dir);
})().catch(e => { console.error(e); process.exit(1); });
