// Prueba del emulador: se conecta al WebView del APK de depuración (adb forward tcp:9222) y revisa, dentro de la
// página publicada, que el puente de Capacitor y los plugins nativos estén ahí. Solo datos sintéticos.
// Uso: node sonda.mjs <modo>   (los modos están en EXPR)
import { readFileSync, existsSync } from "node:fs";

const modo = process.argv[2] || "info";
const PUERTO = process.env.PUERTO_CDP || "9222";
const leer = rel => { const u = new URL(rel, import.meta.url); return existsSync(u) ? readFileSync(u, "utf8") : ""; };

const EXPR = {
  info: () => `(async () => {
    const C = window.Capacitor;
    const r = { url: location.origin + location.pathname, titulo: document.title, capacitor: !!C,
      pantalla: innerWidth + "x" + innerHeight, ua: navigator.userAgent };
    if (C) {
      r.nativo = C.isNativePlatform(); r.plataforma = C.getPlatform();
      r.plugins = (C.PluginHeaders || []).map(h => h.name).sort();
      r.capacitorPlugins = C.Plugins ? Object.keys(C.Plugins).sort() : null;
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
      r.voz = await probar("TextToSpeech", "getSupportedLanguages");
      r.dictado = await probar("SpeechRecognition", "available");
      r.abrirFuera = await probar("AppLauncher", "canOpenUrl", { url: "https://wa.me/" });
    }
    r.funcionesApp = ["handleDetectedCode", "cameraGotCode", "haptic", "csVibrate", "downloadBlob", "fzOpenScan", "stopCamera"]
      .map(f => f + ":" + typeof window[f]);
    r.capaNativaEnLaPagina = typeof window.__wittNativa === "object";
    r.navigatorVibrate = typeof navigator.vibrate; r.navigatorShare = typeof navigator.share;
    r.speechSynthesis = typeof window.speechSynthesis; r.SpeechRecognition = typeof (window.SpeechRecognition || window.webkitSpeechRecognition);
    r.serviceWorker = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    return JSON.stringify(r);
  })()`,

  "escaner-modulo": () => `(async () => {
    const C = window.Capacitor; const out = {}; const t0 = Date.now();
    try { out.antes = await C.nativePromise("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable", {}); } catch (e) { out.antes = String(e.message || e); }
    if (!(out.antes && out.antes.available)) {
      out.progreso = [];
      try { C.addListener("BarcodeScanner", "googleBarcodeScannerModuleInstallProgress", ev => { out.progreso.push(ev); }); } catch (e) {}
      try { await C.nativePromise("BarcodeScanner", "installGoogleBarcodeScannerModule", {}); out.instalar = "pedido"; } catch (e) { out.instalar = String(e.message || e); }
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try { const a = await C.nativePromise("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable", {}); if (a && a.available) { out.despues = a; break; } } catch (_) {}
      }
      out.segundos = Math.round((Date.now() - t0) / 1000);
      out.progreso = out.progreso.slice(-8);
    }
    return JSON.stringify(out);
  })()`,

  // Perfil sintético para saltar "¿Cómo te llamas?" y las intros (solo en el emulador).
  perfil: () => `(() => {
    localStorage.setItem("gw_collab_profile_name", "Demo");
    ["autos", "refacciones", "fisico"].forEach(m => { localStorage.setItem("witt-intro-visto-" + m, "1"); localStorage.setItem("gw_intro_visto_" + m, "1"); });
    setTimeout(() => location.reload(), 100);
    return "perfil Demo; se recarga";
  })()`,

  // La capa nativa todavía no está en la página publicada: aquí se pone a mano (la misma que se agrega con armar_anim).
  capa: () => {
    const js = leer("../prueba/nativa.js"), css = leer("../prueba/nativa.css");
    if (!js) return `JSON.stringify({ error: "no está app-nativa/prueba/nativa.js" })`;
    return `(() => {
      if (!window.__wittNativa) {
        const s = document.createElement("style"); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);
        const j = document.createElement("script"); j.textContent = ${JSON.stringify(js)}; document.head.appendChild(j);
      }
      return JSON.stringify({ capa: window.__wittNativa ? window.__wittNativa.version : null,
        claseHtml: document.documentElement.classList.contains("witt-nativa"), share: typeof navigator.share,
        speechSynthesis: typeof window.speechSynthesis });
    })()`;
  },

  autos: () => `(() => { const c = document.querySelector('.app-card[data-launch="autos"]'); if (c) c.click();
    return JSON.stringify({ tarjeta: !!c }); })()`,

  vibrar: () => `(async () => {
    const z = ms => new Promise(r => setTimeout(r, ms));
    haptic(12); await z(700); csVibrate("ok"); await z(1500); csVibrate("warn"); await z(1800); csVibrate("crit"); await z(2200);
    return JSON.stringify(window.__wittNativa ? window.__wittNativa.log.filter(x => / vib /.test(x)) : "sin capa");
  })()`,

  "boton-escanear": () => `(() => { const b = document.getElementById("fab-scan"); if (b) b.click();
    return JSON.stringify({ fab: !!b }); })()`,

  codigo: () => `(() => { cameraGotCode("PRUEBA0SINTETICA01", "CÓDIGO (escáner del teléfono)");
    const m = document.getElementById("modal-detect");
    return JSON.stringify({ modalDetect: !!(m && m.classList.contains("show")) }); })()`,

  atras: () => `JSON.stringify({ atras: window.__wittNativa ? window.__wittNativa.atras() : "sin capa",
    modales: [...document.querySelectorAll(".modal-bg.show")].map(m => m.id) })`,

  exportar: () => `(() => { downloadBlob(new Blob(["vin,estado\\nPRUEBA0SINTETICA01,demo\\n"], { type: "text/csv" }), "prueba_sintetica.csv");
    return "downloadBlob(prueba_sintetica.csv)"; })()`,

  dictado: () => `(async () => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return JSON.stringify({ hay: false });
    const out = { hay: true, eventos: [] };
    try {
      const r = new R(); r.lang = "es-MX";
      r.onerror = e => out.eventos.push("error:" + (e && e.error)); r.onend = () => out.eventos.push("end");
      r.onstart = () => out.eventos.push("start"); r.onresult = () => out.eventos.push("result");
      r.start(); await new Promise(x => setTimeout(x, 6000)); try { r.abort(); } catch (e) {}
    } catch (e) { out.excepcion = String(e && e.message || e); }
    return JSON.stringify(out);
  })()`,

  estado: () => `JSON.stringify({ nativa: window.__wittNativa ? { estado: window.__wittNativa.estado(), log: window.__wittNativa.log.slice(-40) } : null,
    pantalla: (document.querySelector(".screen.active") || {}).id || null, modales: [...document.querySelectorAll(".modal-bg.show")].map(m => m.id),
    escaner: String(window.__sondaEscaner) })`,

  "escaner-abrir": () => `(() => {
    window.__sondaEscaner = "abierto";
    window.Capacitor.nativePromise("BarcodeScanner", "scan", {})
      .then(r => { window.__sondaEscaner = "resultado: " + JSON.stringify(r); })
      .catch(e => { window.__sondaEscaner = "error: " + String((e && e.message) || e); });
    return "se pidió scan()";
  })()`
};

if (!EXPR[modo]) { console.error("Modo desconocido: " + modo); process.exit(2); }
const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
const pagina = lista.find(t => t.type === "page" && /^https:/.test(t.url)) || lista.find(t => t.type === "page") || lista[0];
if (!pagina) { console.error("No hay páginas en el WebView"); process.exit(1); }
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
const res = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("tiempo agotado")), 240000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
    params: { expression: EXPR[modo](), awaitPromise: true, returnByValue: true } }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(t); resolve(m); } };
  ws.onerror = e => { clearTimeout(t); reject(new Error("WebSocket: " + (e.message || "error"))); };
});
ws.close();
if (res.error || (res.result && res.result.exceptionDetails)) { console.log(JSON.stringify(res, null, 2)); process.exit(1); }
const v = res.result.result.value;
try { console.log(JSON.stringify(JSON.parse(v), null, 2)); } catch (_) { console.log(v); }
