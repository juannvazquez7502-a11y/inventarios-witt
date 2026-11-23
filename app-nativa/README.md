# App nativa de Android (Capacitor)

Es la misma app web, pero dentro de una app de Android real. Así puede usar el escáner de Google a pantalla completa, la vibración del teléfono y mantener la pantalla encendida.

- **De dónde carga:** abre la página publicada en GitHub Pages (`server.url`), así que se actualiza sola, igual que hoy.
  - Si no hay internet y el teléfono todavía no tiene la app guardada, abre `www/inventarios-witt/sin-conexion.html`. Es una copia del `index.html` publicado al momento de armar el APK, con las librerías incluidas.
  - Esa copia está en el mismo dominio que la página publicada, así que ve los mismos datos guardados en el teléfono.
- **Qué se activa en la app nativa:** solo lo que la página hace cuando existe `Capacitor.isNativePlatform()`, en la capa `nativa.js`. En el navegador y en el TWA todo sigue igual.
  - El puente de Capacitor pone los plugins en `Capacitor.Plugins.X` aunque la página no cargue `@capacitor/core` (así los usa `nativa.js`).
  - Nombres de los plugins: `App`, `AppLauncher`, `Haptics`, `StatusBar`, `SplashScreen`, `BarcodeScanner`, `KeepAwake`, `Filesystem`, `Share`, `TextToSpeech` y `SpeechRecognition`.
    - `TextToSpeech`: el WebView de Android no trae `speechSynthesis` (avisos con voz).
    - `SpeechRecognition`: el dictado usa SIEMPRE el reconocedor de Android, aunque el WebView traiga `webkitSpeechRecognition` (en el emulador ese no respondía). Lo que se va oyendo llega con `partialResults`.
    - `AppLauncher`: abre WhatsApp (wa.me) y REPUVE fuera de la app.
- **Sin internet:** si la app ya se abrió con red, el service worker de la página (`sw.js`) da la copia guardada; si todavía no la guardó, pide `sin-conexion.html` junto a su `scope` y Capacitor la sirve desde el APK (`server.errorPath`). Para eso el `sw.js` publicado debe traer ese respaldo.
- **Fondo:** el WebView y la ventana tienen fondo oscuro `#0f1111` (`backgroundColor` y `witt_fondo` en `ajustar-android.mjs`), para que al volver del escáner de Google no se vea un blanco mientras la página se repinta.
- **Barras del sistema:** la app sale del modo "borde a borde" de Android 15 (`windowOptOutEdgeToEdgeEnforcement`, en `scripts/ajustar-android.mjs`). Así la barra de estado toma el verde de la app y el teclado empuja la página, como en Chrome.
- **`prueba/`:** copia de `nativa.js` y `nativa.css` que solo usa la prueba del emulador (`scripts/sonda.mjs` la pone a mano en la página). La app real usa la capa que va dentro del `index.html` publicado.
- **Paquete:** `mx.grupowitt.inventarios`, firmado con la misma llave que el APK TWA, con `versionCode = 100 + corrida`. Se instala encima del TWA como actualización.
  - Los datos que el TWA guardó en Chrome no pasan a la app nueva. Antes de actualizar hay que subir los pendientes.
- **Permisos:**
  - CAMERA, para el escáner y las fotos.
  - VIBRATE.
  - RECORD_AUDIO y MODIFY_AUDIO_SETTINGS, para la nota de voz.
  - INTERNET.

## Cómo armarla
En Actions, corre **App nativa (Capacitor)** (`.github/workflows/app-nativa.yml`). El flujo:
1. Arma el APK firmado y lo sube como artifact y como Release `app-nativa-v<versión>-<corrida>` (pre-release, para no reemplazar al APK TWA como "Latest").
2. Si se marca **emulador**, lo prueba en un emulador con Android 15 y Play Store, y sube las capturas en el artifact `capturas-emulador`.
   - En esa prueba, `*.supabase.co` está bloqueado por DNS.

**Seguridad del flujo:** el token de GitHub es de solo lectura en los trabajos que corren npm, Gradle y el emulador (`persist-credentials: false`); solo el trabajo `publicar` puede escribir y no corre código del proyecto. Las dependencias se instalan con `npm ci` desde `package-lock.json` y la acción del emulador está fijada por SHA. La contraseña de la llave va a `apksigner` por variable de entorno.

Para cambiar una dependencia: edita `package.json`, corre `npm install --ignore-scripts` y sube el `package-lock.json` nuevo.

El proyecto `android/` no se guarda en el repositorio. Se genera en cada corrida con `npx cap add android` y `scripts/ajustar-android.mjs`.
