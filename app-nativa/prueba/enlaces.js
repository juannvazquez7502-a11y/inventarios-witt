/* ===== Ligas para unirse con QR · 23-nov-2026 =====
   Capa para la web y la app nativa. No cambia el JS de la app: solo envuelve qrSvg y parseJoinQR (funciones globales).
   1 El QR para unirse (Vehículos, Refacciones e Inventario físico) ahora lleva una LIGA:
       https://juannvazquez7502-a11y.github.io/inventarios-witt/?unirse=<AUTOS|REFACCIONES|FISICO>-<CÓDIGO>
     Así lo lee la cámara normal del teléfono (abre la app o la página) y también el escáner de la app.
     Solo letras, números, "-", "/", "?" y "=": ningún ":" raro. El código grande de abajo no cambia.
   2 parseJoinQR acepta la liga (?unirse= o #unirse=) Y el formato viejo INVENTARIO-UNIRSE:TIPO:CÓDIGO (los QR viejos siguen).
     La liga solo cuenta si es del sitio de la app (o de la misma página): otra dirección no se toma como unión.
   3 Al abrir la página con ?unirse=…: quita el parámetro (recargar no vuelve a unir), espera a que la app esté lista
     (si sale la bienvenida «¿cómo te llamas?» o la intro, espera a que se cierren), sale del selector si hace falta y
     llama openJoinFromQR, igual que al escanear. Si ya estás en esa sesión, la app avisa como siempre.
   La app nativa (nativa.js) entrega aquí las ligas que abre Android (cámara del teléfono → App Link) con desdeUrl(). */
(function(){
  "use strict";
  var W = window, D = document;
  if(W.__wittUnirse) return;

  var VERSION = "enlaces 1.0 · 23-nov-2026";
  var BASE = "https://juannvazquez7502-a11y.github.io/inventarios-witt/";
  var HOST = "juannvazquez7502-a11y.github.io", RUTA = "/inventarios-witt";
  var KIND = { AUTOS:"autos", REFACCIONES:"parts", FISICO:"fisico" };
  var NOMBRE = { autos:"AUTOS", parts:"REFACCIONES", fisico:"FISICO" };
  var VIEJO = /^INVENTARIO-UNIRSE:(AUTOS|REFACCIONES|FISICO):([A-Z0-9-]{4,20})$/i;
  var VALOR = /^(AUTOS|REFACCIONES|FISICO)[-:._~ ]([A-Z0-9-]{4,20})$/i;   // el "-" es el de siempre; los otros, por si un lector los cambia
  var CLAVE_PEND = "witt-unirse-pendiente";
  var log = [];
  function anota(x){ try{ log.push(Date.now() + " " + x); if(log.length > 40) log.shift(); }catch(e){} }
  var ss = {
    get:function(k){ try{ return W.sessionStorage.getItem(k); }catch(e){ return null; } },
    set:function(k, v){ try{ W.sessionStorage.setItem(k, v); }catch(e){} },
    del:function(k){ try{ W.sessionStorage.removeItem(k); }catch(e){} }
  };

  function liga(tipo, codigo){ return BASE + "?unirse=" + String(tipo).toUpperCase() + "-" + String(codigo).toUpperCase(); }
  function deValor(v){
    var m = String(v == null ? "" : v).trim().match(VALOR);
    return m ? { kind:KIND[m[1].toUpperCase()], code:m[2].toUpperCase() } : null;
  }
  // Valor de "unirse" en una URL (?unirse= o #unirse=). Si no hay, null.
  function valorEnUrl(u){
    var v = null;
    try{ v = u.searchParams.get("unirse"); }catch(e){}
    if(!v && /unirse=/i.test(u.hash || "")){ try{ v = new URLSearchParams(String(u.hash).replace(/^#/, "")).get("unirse"); }catch(e){} }
    return v;
  }
  function delSitio(u){
    var h = String(u.hostname || "").toLowerCase();
    if(h === HOST) return String(u.pathname || "").toLowerCase().indexOf(RUTA) === 0;
    try{ return u.host === location.host && /^https?:$/.test(location.protocol); }catch(e){ return false; }
  }
  // Una liga escaneada (texto completo, sin espacios) → { kind, code } o null.
  function deLiga(texto){
    var s = String(texto == null ? "" : texto).trim();
    if(!s || /\s/.test(s) || !/unirse/i.test(s)) return null;
    if(!/^https?:\/\//i.test(s)){
      if(s.toLowerCase().indexOf(HOST + "/") !== 0) return null;   // algunos lectores quitan el "https://"
      s = "https://" + s;
    }
    var u; try{ u = new URL(s); }catch(e){ return null; }
    if(!/^https?:$/.test(u.protocol) || !delSitio(u)) return null;
    return deValor(valorEnUrl(u));
  }

  /* ---------- 1. El QR lleva la liga ---------- */
  try{
    var qr0 = W.qrSvg;
    if(typeof qr0 === "function"){
      W.qrSvg = function(text){
        var a = Array.prototype.slice.call(arguments);
        try{ var m = String(text == null ? "" : text).trim().match(VIEJO); if(m) a[0] = liga(m[1], m[2]); }catch(e){}
        return qr0.apply(this, a);
      };
    }
  }catch(e){}
  // Texto de la ventana del QR: ya se puede escanear con la cámara del teléfono.
  function textoVentana(){
    try{
      var p = D.querySelector("#modal-join-qr .jq-code + .hint, #modal-join-qr p.hint:not(#jq-sub)");
      if(p && !p.dataset.wittLiga){
        p.dataset.wittLiga = "1";
        p.innerHTML = "Tu compañero lo escanea con la <b>cámara del teléfono</b> o desde la app en <b>Escanear</b>. Se abre «Unirse» con el código puesto.";
      }
    }catch(e){}
  }

  /* ---------- 2. parseJoinQR: liga nueva y formato viejo ---------- */
  try{
    var pj0 = W.parseJoinQR;
    if(typeof pj0 === "function"){
      W.parseJoinQR = function(text){
        var r = null;
        try{ r = pj0.apply(this, arguments); }catch(e){ r = null; }
        if(r) return r;
        try{ return deLiga(text); }catch(e){ return null; }
      };
    }
  }catch(e){}

  /* ---------- 3. Abrir la unión que trae la liga ---------- */
  var pendiente = null, ultima = { k:"", t:0 }, tRevisa = 0, desde = 0;
  function clave(i){ return i.kind + ":" + i.code; }
  function quitarDeLaUrl(){
    try{
      var u = new URL(location.href), cambio = false;
      if(u.searchParams.has("unirse")){ u.searchParams.delete("unirse"); cambio = true; }
      if(/unirse=/i.test(u.hash || "")){
        var hp = new URLSearchParams(String(u.hash).replace(/^#/, "")); hp.delete("unirse");
        var hs = hp.toString(); u.hash = hs ? "#" + hs : ""; cambio = true;
      }
      if(cambio) history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }catch(e){}
  }
  function modoFirma(){ try{ return (typeof RS_TOKEN !== "undefined" && !!RS_TOKEN) || D.body.classList.contains("rs-mode"); }catch(e){ return false; } }   // eslint-disable-line no-undef
  function introAbierta(){
    try{ var api = W.__wittIntroAPI; if(api && api.estado && api.estado().abierta) return true; }catch(e){}
    return !!D.getElementById("intro-film");
  }
  function lista(){
    if(D.readyState === "loading" || !D.body) return false;
    if(!desde || Date.now() - desde < 600) return false;           // deja que la app ponga la bienvenida o el selector
    if(typeof W.openJoinFromQR !== "function") return false;
    var w = D.getElementById("welcome"); if(w && w.classList.contains("show")) return false;   // primero su nombre
    if(introAbierta()) return false;
    return true;
  }
  // Vehículos y Refacciones: si está el selector de apps (o el Inventario físico), se sale para ver la ventana de unirse.
  function prepararPantalla(info){
    if(info.kind === "fisico") return;   // el físico se abre encima del selector, como desde su tarjeta
    try{ if(D.body.classList.contains("fisico-open") && typeof W.fzClose === "function") W.fzClose(); }catch(e){}
    try{
      var L = D.getElementById("app-launcher");
      if(!(L && L.classList.contains("show"))) return;
      if(typeof W.applyAppMode === "function") W.applyAppMode(info.kind === "parts" ? "refacciones" : "autos");
      L.classList.remove("show", "leaving"); D.body.classList.remove("launcher-open");
      try{ if(typeof W.animateScreenIn === "function") W.animateScreenIn(); }catch(e){}
    }catch(e){}
  }
  function ejecutar(){
    var info = pendiente; if(!info) return;
    pendiente = null; ss.del(CLAVE_PEND); clearInterval(tRevisa); tRevisa = 0;
    if(modoFirma()){ anota("modo firma: no se une"); return; }
    ultima = { k:clave(info), t:Date.now() };
    anota("abre " + clave(info) + " (" + info.origen + ")");
    try{ prepararPantalla(info); }catch(e){}
    try{ W.openJoinFromQR({ kind:info.kind, code:info.code }); }catch(e){ anota("openJoinFromQR err " + e); }
  }
  function revisar(){ try{ if(pendiente && lista()) ejecutar(); }catch(e){} }
  // Pide una unión. Devuelve "pendiente", "repetida" o "no".
  function abrir(info, origen){
    if(!info || !KIND[NOMBRE[info.kind]] || !/^[A-Z0-9-]{4,20}$/.test(String(info.code || ""))) return "no";
    var k = clave(info);
    if((pendiente && clave(pendiente) === k) || (ultima.k === k && Date.now() - ultima.t < 8000)){ anota("repetida " + k); return "repetida"; }
    pendiente = { kind:info.kind, code:info.code, origen:origen || "?" };
    ss.set(CLAVE_PEND, JSON.stringify({ kind:info.kind, code:info.code, t:Date.now() }));   // sobrevive a una recarga mientras espera
    anota("pendiente " + k + " (" + pendiente.origen + ")");
    clearInterval(tRevisa); tRevisa = setInterval(revisar, 250);
    setTimeout(revisar, 0);
    return "pendiente";
  }
  function desdeUrl(url, origen){
    var info = null;
    try{
      var u = new URL(String(url || ""), location.href);
      if(/^https?:$/.test(u.protocol) && delSitio(u)) info = deValor(valorEnUrl(u));
    }catch(e){}
    if(!info){ anota("url sin unión (" + (origen || "?") + ")"); return "no"; }
    return abrir(info, origen || "url");
  }

  // Arranque: la página se abrió con ?unirse= (o #unirse=), o quedó una pendiente antes de recargar.
  // El parámetro se quita de inmediato (aunque la app tarde): así recargar no vuelve a unir.
  var infoInicial = null;
  try{ infoInicial = deValor(valorEnUrl(new URL(location.href))); }catch(e){}
  try{ if(infoInicial) quitarDeLaUrl(); }catch(e){}
  function arrancar(){
    desde = Date.now();
    textoVentana();
    var info = infoInicial, origen = "pagina";
    if(!info){
      try{
        var p = JSON.parse(ss.get(CLAVE_PEND) || "null");
        if(p && Date.now() - p.t < 15 * 60 * 1000){ info = deValor(NOMBRE[p.kind] + "-" + p.code); origen = "pendiente"; }
        else ss.del(CLAVE_PEND);
      }catch(e){ ss.del(CLAVE_PEND); }
    }
    if(info) abrir(info, origen);
  }
  try{
    var go = function(){ setTimeout(arrancar, 0); };
    if(D.readyState === "loading") D.addEventListener("DOMContentLoaded", go); else go();
  }catch(e){}

  try{
    W.__wittUnirse = { version:VERSION, log:log, liga:liga, leer:function(t){ return deLiga(t); }, desdeUrl:desdeUrl,
      abrir:function(i, o){ return abrir(i, o); },
      estado:function(){ return { pendiente:pendiente ? clave(pendiente) : null, ultima:ultima.k || null }; } };
  }catch(e){}
})();
