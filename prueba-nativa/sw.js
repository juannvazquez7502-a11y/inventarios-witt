// Sistema de Inventarios · permite abrir la app aunque no haya señal.
// Súbelo en la MISMA carpeta que el archivo de la app, con el nombre "sw.js".
// No guarda nada del inventario (eso ya lo guarda la app en el teléfono): solo la
// página de la app y las herramientas (Excel, PDF, lector de códigos) para abrirlas sin internet.
const CACHE = "inventario-app-v5";
const LIB_HOSTS = /(^|\.)(cdn\.jsdelivr\.net|cdn\.sheetjs\.com|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", ()=> self.skipWaiting());
self.addEventListener("activate", (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=> k.startsWith("inventario-app-") && k !== CACHE).map(k=> caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if(req.method !== "GET") return;
  let url;
  try{ url = new URL(req.url); }catch(_){ return; }
  // Nunca se guarda lo de la nube (Supabase): registros, fotos y firmas van siempre en vivo.
  if(/supabase\.(co|in)$/.test(url.hostname) || url.pathname.includes("/rest/v1/") || url.pathname.includes("/storage/v1/") || url.pathname.includes("/realtime/")) return;

  // La página de la app: primero internet (para recibir actualizaciones); sin señal, la copia guardada.
  if(req.mode === "navigate"){
    e.respondWith((async ()=>{
      try{
        // "no-cache": siempre le pregunta al servidor si hay versión nueva (si no cambió, la respuesta es mínima).
        let res;
        try{ res = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" }); }
        catch(err){ if(!navigator.onLine) throw err; res = await fetch(req); }
        if(res && res.ok){ const c = await caches.open(CACHE); c.put(req, res.clone()); c.put("__app__", res.clone()); }
        return res;
      }catch(_){
        const c = await caches.open(CACHE);
        return (await c.match(req, { ignoreSearch: true })) || (await c.match("__app__")) || new Response("Sin señal y la app todavía no se había guardado en este teléfono. Ábrela una vez con internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // Herramientas (Excel, PDF, ZIP, lector de códigos, letras): de la copia guardada, y si no, de internet.
  if(LIB_HOSTS.test(url.hostname)){
    e.respondWith((async ()=>{
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if(hit) return hit;
      const res = await fetch(req);
      if(res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    })());
  }
});
