// Prueba del emulador: se conecta al WebView del APK de depuración (adb forward tcp:9222) y revisa, dentro de la
// página publicada, que el puente de Capacitor y los plugins nativos estén ahí. No toca datos de la app.
// Uso: node sonda.mjs info | escaner-modulo | escaner-abrir | escaner-estado
const modo = process.argv[2] || "info";
const PUERTO = process.env.PUERTO_CDP || "9222";

const EXPR = {
  info: `(async () => {
    const C = window.Capacitor;
    const r = { url: location.origin + location.pathname, titulo: document.title, capacitor: !!C,
      pantalla: innerWidth + "x" + innerHeight, ua: navigator.userAgent };
    if (C) {
      r.nativo = C.isNativePlatform(); r.plataforma = C.getPlatform();
      r.plugins = (C.PluginHeaders || []).map(h => h.name).sort();
      r.hayCapacitorPlugins = !!C.Plugins && Object.keys(C.Plugins).length;
      const probar = async (p, m, o) => { try { return { ok: true, r: await C.nativePromise(p, m, o || {}) }; }
        catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
      r.app = await probar("App", "getInfo");
      r.vibrar = await probar("Haptics", "vibrate", { duration: 80 });
      r.impacto = await probar("Haptics", "impact", { style: "HEAVY" });
      r.escanerSoportado = await probar("BarcodeScanner", "isSupported");
      r.moduloGoogle = await probar("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable");
      r.permisoCamara = await probar("BarcodeScanner", "checkPermissions");
      r.pantallaEncendida = await probar("KeepAwake", "isSupported");
      r.barraEstado = await probar("StatusBar", "getInfo");
      r.archivos = await probar("Filesystem", "checkPermissions");
      r.compartir = await probar("Share", "canShare");
    }
    r.funcionesApp = ["handleDetectedCode", "cameraGotCode", "haptic", "csVibrate", "downloadBlob", "fzOpenScan", "stopCamera"]
      .map(f => f + ":" + typeof window[f]);
    r.capaNativaEnLaPagina = [...document.scripts].some(s => /isNativePlatform/.test(s.textContent || ""));
    r.navigatorVibrate = typeof navigator.vibrate; r.navigatorShare = typeof navigator.share;
    r.speechSynthesis = typeof window.speechSynthesis; r.SpeechRecognition = typeof (window.SpeechRecognition || window.webkitSpeechRecognition);
    r.serviceWorker = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    return JSON.stringify(r);
  })()`,
  "escaner-modulo": `(async () => {
    const C = window.Capacitor; const out = {};
    try { out.antes = await C.nativePromise("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable", {}); } catch (e) { out.antes = String(e.message || e); }
    if (!(out.antes && out.antes.available)) {
      try { await C.nativePromise("BarcodeScanner", "installGoogleBarcodeScannerModule", {}); out.instalar = "pedido"; } catch (e) { out.instalar = String(e.message || e); }
      for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try { const a = await C.nativePromise("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable", {}); if (a && a.available) { out.despues = a; out.segundos = (i + 1) * 2; break; } } catch (_) {}
      }
    }
    return JSON.stringify(out);
  })()`,
  "escaner-abrir": `(() => {
    window.__sondaEscaner = "abierto";
    window.Capacitor.nativePromise("BarcodeScanner", "scan", {})
      .then(r => { window.__sondaEscaner = "resultado: " + JSON.stringify(r); })
      .catch(e => { window.__sondaEscaner = "error: " + String((e && e.message) || e); });
    return "se pidió scan()";
  })()`,
  "escaner-estado": `String(window.__sondaEscaner)`
};

if (!EXPR[modo]) { console.error("Modo desconocido: " + modo); process.exit(2); }
const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
const pagina = lista.find(t => t.type === "page" && /^https:/.test(t.url)) || lista.find(t => t.type === "page") || lista[0];
if (!pagina) { console.error("No hay páginas en el WebView"); process.exit(1); }
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
const res = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("tiempo agotado")), 150000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
    params: { expression: EXPR[modo], awaitPromise: true, returnByValue: true } }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(t); resolve(m); } };
  ws.onerror = e => { clearTimeout(t); reject(new Error("WebSocket: " + (e.message || "error"))); };
});
ws.close();
if (res.error || (res.result && res.result.exceptionDetails)) { console.log(JSON.stringify(res, null, 2)); process.exit(1); }
const v = res.result.result.value;
try { console.log(JSON.stringify(JSON.parse(v), null, 2)); } catch (_) { console.log(v); }
