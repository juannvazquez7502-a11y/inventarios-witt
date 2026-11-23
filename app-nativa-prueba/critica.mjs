// Prueba crítica en el emulador: habla con el WebView del APK de depuración (adb forward tcp:9222).
// Solo datos sintéticos. Uso: node critica.mjs <modo> [argumento]
//   info | estado | perfil | excel | modulo | codigo | centro <selector CSS> (necesita WV_TOP) | eval <expresión>
import { readFileSync } from "node:fs";

const [modo = "info", arg = ""] = process.argv.slice(2);
const PUERTO = process.env.PUERTO_CDP || "9222";

const INFO = `(() => {
  const C = window.Capacitor, q = s => document.querySelector(s);
  let fz = null; try { fz = typeof FZ !== "undefined" ? { sid: FZ.sid || null, view: FZ.view || null } : null; } catch (e) {}
  let sa = null; try { sa = typeof scanActive !== "undefined" ? !!scanActive : null; } catch (e) {}
  return {
    url: location.href, titulo: document.title, capacitor: !!C,
    nativo: !!(C && C.isNativePlatform && C.isNativePlatform()),
    plugins: C && C.Plugins ? Object.keys(C.Plugins).sort() : null,
    capaNativa: window.__wittNativa ? window.__wittNativa.version : null,
    claseNativa: document.documentElement.classList.contains("witt-nativa"),
    estadoNativa: window.__wittNativa ? window.__wittNativa.estado() : null,
    logNativa: window.__wittNativa ? window.__wittNativa.log.slice(-25) : null,
    pantalla: (q(".screen.active") || {}).id || null,
    selector: typeof isLauncherOpen === "function" ? isLauncherOpen() : null,
    bienvenida: !!(q("#welcome") && q("#welcome").classList.contains("show")),
    fisicoAbierto: document.body.classList.contains("fisico-open"), fz,
    modales: [...document.querySelectorAll(".modal-bg.show")].map(m => m.id),
    scanActive: sa, registros: (window.State && State.recordsList) ? State.recordsList.length : null,
    perfil: (() => { try { return !!localStorage.getItem("gw_collab_profile_name"); } catch (e) { return null; } })(),
    sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), enLinea: navigator.onLine,
    vista: innerWidth + "x" + innerHeight + "@" + devicePixelRatio,
    xlsx: typeof XLSX, jsQR: typeof jsQR
  };
})()`;

const EXPR = {
  info: () => `JSON.stringify(${INFO})`,
  estado: () => `JSON.stringify(${INFO})`,
  // Perfil sintético "Demo" (salta la bienvenida) y recarga.
  perfil: () => `(() => { localStorage.setItem("gw_collab_profile_name", "Demo"); setTimeout(() => location.reload(), 100); return "perfil Demo; recarga"; })()`,
  // Carga el inventario sintético (20 unidades, VIN falsos) por el mismo <input type=file> de la app.
  excel: () => {
    const b64 = readFileSync(new URL("./inventario-sintetico.xlsx", import.meta.url)).toString("base64");
    return `(async () => {
      const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const f = new File([u], "Inventario_sintetico.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById("file-input");
      inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 40 && !(window.State && State.recordsList && State.recordsList.length); i++) await new Promise(r => setTimeout(r, 250));
      return JSON.stringify({ registros: window.State && State.recordsList ? State.recordsList.length : null,
        modales: [...document.querySelectorAll(".modal-bg.show")].map(m => m.id) });
    })()`;
  },
  modulo: () => `(async () => { const C = window.Capacitor; const o = {};
    try { o.soportado = await C.Plugins.BarcodeScanner.isSupported(); } catch (e) { o.soportado = String(e.message || e); }
    try { o.modulo = await C.Plugins.BarcodeScanner.isGoogleBarcodeScannerModuleAvailable(); } catch (e) { o.modulo = String(e.message || e); }
    try { o.permiso = await C.Plugins.BarcodeScanner.checkPermissions(); } catch (e) { o.permiso = String(e.message || e); }
    return JSON.stringify(o); })()`,
  // Un VIN del inventario sintético entra por la misma función que usa el escáner nativo.
  codigo: () => `(() => { const v = State.recordsList[0].vin; cameraGotCode(v, "CÓDIGO (escáner del teléfono)");
    return JSON.stringify({ vin: v, modales: [...document.querySelectorAll(".modal-bg.show")].map(m => m.id),
      titulo: (document.getElementById("modal-title") || {}).textContent || null }); })()`,
  // Centro del elemento en píxeles de la pantalla (para adb shell input tap). WV_TOP = borde superior del WebView.
  centro: () => `(() => {
    const top = ${Number(process.env.WV_TOP || 0)}, d = devicePixelRatio;
    const els = [...document.querySelectorAll(${JSON.stringify(arg)})];
    for (const el of els) {
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const h = document.elementFromPoint(cx, cy); if (!h || !(h === el || el.contains(h))) continue;
      return Math.round(cx * d) + " " + Math.round(top + cy * d);
    }
    return "NO visible: " + els.length + " encontrados";
  })()`,
  eval: () => arg
};

if (!EXPR[modo]) { console.error("Modo desconocido: " + modo); process.exit(2); }
let lista;
try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json(); }
catch (e) { console.log(JSON.stringify({ error: "sin CDP: " + e.message })); process.exit(1); }
const pagina = lista.find(t => t.type === "page" && /^https:/.test(t.url)) || lista.find(t => t.type === "page") || lista[0];
if (!pagina) { console.log(JSON.stringify({ error: "No hay páginas en el WebView" })); process.exit(1); }
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
const res = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("tiempo agotado")), 60000);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
    params: { expression: EXPR[modo](), awaitPromise: true, returnByValue: true } }));
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(t); resolve(m); } };
  ws.onerror = e => { clearTimeout(t); reject(new Error("WebSocket: " + (e.message || "error"))); };
}).catch(e => ({ error: String(e.message || e) }));
try { ws.close(); } catch (e) {}
if (res.error || (res.result && res.result.exceptionDetails)) { console.log(JSON.stringify(res)); process.exit(1); }
const v = res.result.result.value;
try { console.log(JSON.stringify(JSON.parse(v), null, 1)); } catch (_) { console.log(v); }
