/* ===== Puente nativo (app de Android con Capacitor) · 23-nov-2026 =====
   Solo actúa dentro de la app nativa: si no hay window.Capacitor o Capacitor.isNativePlatform() no es true, sale en la primera
   línea y la web (navegador y TWA) queda EXACTAMENTE igual. No cambia el JS de la app: solo envuelve funciones globales y
   escucha clics. Los plugins se usan como Capacitor.Plugins.X (sin bundler); si falta uno, esa parte no hace nada.
   1 Escáner nativo (ML Kit, pantalla completa de Google con linterna y zoom) en lugar de la cámara web. Entrega el código a
     cameraGotCode, la misma función que usa la cámara web, así que el continuo, Refacciones, el físico, REPUVE y los QR para
     unirse siguen igual. Placas y la pieza del Inventario físico (que guarda una foto chica del <video>) siguen con la cámara
     web; la del físico, a pantalla completa (nativa.css).
   2 Vibración con Haptics: toques ligeros y avisos por significado (éxito, ya registrada, no encontrada o error).
   3 Pantalla encendida mientras se escanea o se cuenta (KeepAwake).
   4 Barra de estado verde Witt y botón atrás de Android.
   5 Exportaciones: guarda el archivo con Filesystem (Documentos/Inventarios Witt) y ofrece Compartir.
   6 navigator.share, voz (TextToSpeech) y dictado (SpeechRecognition) si el WebView no los trae y el plugin existe. */
(function(){
  "use strict";
  var W = window, D = document, C = W.Capacitor;
  try{ if(!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform())) return; }catch(e){ return; }

  var VERSION = "nativa 1.0 · 23-nov-2026";
  var ETIQUETA = "CÓDIGO (escáner del teléfono)";
  var FORMATOS = ["QR_CODE", "CODE_128", "CODE_39", "DATA_MATRIX", "PDF_417", "AZTEC", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "ITF", "CODABAR"];
  var VERDE = "#00574a";
  var ls = function(k){ try{ return W.localStorage.getItem(k); }catch(e){ return null; } };
  var lsSet = function(k, v){ try{ W.localStorage.setItem(k, v); }catch(e){} };
  // fisicoNativo: el escaneo de piezas del Inventario físico usa el escáner nativo (se pierde la foto chica de cada escaneo).
  // Por defecto NO: se queda la cámara web a pantalla completa para conservar la foto. Se cambia con
  // localStorage "witt-nativa-fisico" = "nativo".
  var CFG = { fisicoNativo: ls("witt-nativa-fisico") === "nativo", continuoMs: 800, salirEnSelector: true };
  var E = { abierto:false, entregando:false, stopEnEntrega:false, webHasta:0, pasarWebHasta:0, soportado:undefined, modulo:false,
    instalando:false, avisoModulo:false, despierta:null, reanudarFz:false, ultimoVib:{ t:0, n:0 }, log:[] };
  function anota(x){ try{ E.log.push(Date.now() + " " + x); if(E.log.length > 60) E.log.shift(); }catch(e){} }

  function P(n){
    try{
      if(typeof C.isPluginAvailable === "function" && !C.isPluginAvailable(n)) return null;
      return (C.Plugins && C.Plugins[n]) || (typeof C.registerPlugin === "function" ? C.registerPlugin(n) : null) || null;
    }catch(e){ return null; }
  }
  // Llama un método de un plugin sin romper nada si no existe o falla.
  function llamar(plugin, metodo, args){
    try{
      var p = P(plugin); if(!p || typeof p[metodo] !== "function") return Promise.reject(new Error("sin " + plugin + "." + metodo));
      return Promise.resolve(p[metodo](args));
    }catch(e){ return Promise.reject(e); }
  }
  function callado(pr){ try{ pr && pr.catch && pr.catch(function(){}); }catch(e){} return pr; }
  function aviso(msg, ms){ try{ if(typeof W.toast === "function") W.toast(msg, ms); }catch(e){} }
  function $id(id){ return D.getElementById(id); }
  function tieneShow(id){ var e = $id(id); return !!(e && e.classList.contains("show")); }
  // Variables let/const de la app: no están en window pero se leen por nombre desde este script.
  function vScanActive(){ try{ return typeof scanActive !== "undefined" && !!scanActive; }catch(e){ return false; } }  // eslint-disable-line no-undef
  function vFZ(){ try{ return typeof FZ !== "undefined" ? FZ : null; }catch(e){ return null; } }  // eslint-disable-line no-undef
  function vState(){ try{ return typeof State !== "undefined" ? State : null; }catch(e){ return null; } }  // eslint-disable-line no-undef
  function launcherAbierto(){ try{ return typeof W.isLauncherOpen === "function" ? !!W.isLauncherOpen() : !!($id("app-launcher") && $id("app-launcher").classList.contains("show")); }catch(e){ return false; } }

  try{ D.documentElement.classList.add("witt-nativa"); }catch(e){}

  /* ======================= 2. Vibración (Haptics) ======================= */
  try{
    var NIVEL = { toque:1, toque2:2, exito:3, aviso:4, error:5, exitoFuerte:6, avisoFuerte:7, errorLargo:8 };
    var PATRONES = {   // patrones que usa la app hoy → significado
      "20,40,20":"exito", "90,60,90":"exito", "30,60,30":"aviso", "80,50,80":"aviso", "30,50,30":"errorLargo", "70,50,70":"errorLargo",
      "260,90,260":"exitoFuerte", "450,140,450":"avisoFuerte", "300,120,300":"avisoFuerte", "350,110,350,110,350":"errorLargo"
    };
    var pend = null, tPend = 0, ctxFz = false;
    var H = function(m, a){ callado(llamar("Haptics", m, a)); };
    var luego = function(ms, f){ setTimeout(function(){ try{ f(); }catch(e){} }, ms); };
    var ejecutar = function(tipo){
      anota("vib " + tipo);
      switch(tipo){
        case "toque": H("impact", { style:"LIGHT" }); break;
        case "toque2": H("impact", { style:"MEDIUM" }); break;
        case "exito": H("notification", { type:"SUCCESS" }); break;
        case "aviso": H("notification", { type:"WARNING" }); break;
        case "error": H("notification", { type:"ERROR" }); break;
        case "exitoFuerte": H("notification", { type:"SUCCESS" }); luego(170, function(){ H("vibrate", { duration:220 }); }); break;
        case "avisoFuerte": H("notification", { type:"WARNING" }); luego(200, function(){ H("vibrate", { duration:320 }); }); luego(640, function(){ H("vibrate", { duration:320 }); }); break;
        case "errorLargo": H("notification", { type:"ERROR" }); luego(200, function(){ H("vibrate", { duration:650 }); }); break;
      }
    };
    // Junta lo que se pide en ~35 ms (sonido + vibración de un mismo aviso) y da solo el más fuerte;
    // uno igual o más débil justo después (menos de 320 ms) no se repite.
    var vibrar = function(tipo){
      if(!NIVEL[tipo]) return;
      if(!pend || NIVEL[tipo] > NIVEL[pend]) pend = tipo;
      if(tPend) return;
      tPend = setTimeout(function(){
        tPend = 0; var t = pend; pend = null; if(!t) return;
        var u = E.ultimoVib, ahora = Date.now();
        if(ahora - u.t < 320 && NIVEL[t] <= u.n) return;
        E.ultimoVib = { t:ahora, n:NIVEL[t] }; ejecutar(t);
      }, 35);
    };
    var significado = function(p){
      if(Array.isArray(p)){
        var on = p.filter(function(_, i){ return i % 2 === 0; }).map(Number);
        if(!on.length || on.every(function(x){ return !x; })) return null;
        return PATRONES[p.join(",")] || (Math.max.apply(null, on) >= 250 ? "avisoFuerte" : "aviso");
      }
      var ms = Number(p); if(!isFinite(ms) || ms <= 0) return null;
      if(ctxFz && ms === 15) return "exitoFuerte";   // fzOnScan: pieza encontrada al escanear
      if(ms <= 12) return "toque";
      if(ms < 30) return "toque2";
      return "error";                                // haptic(30) y haptic(40): nombre corto, clave mala, falta cantidad
    };
    var vibrateNativo = function(p){ try{ var s = significado(p); if(s) vibrar(s); }catch(e){} return true; };
    try{ Object.defineProperty(W.navigator, "vibrate", { value:vibrateNativo, configurable:true, writable:true }); }catch(e){ try{ W.navigator.vibrate = vibrateNativo; }catch(x){} }
    if(typeof W.haptic === "function") W.haptic = function(ms){ if(ms === undefined) ms = 8; vibrateNativo(ms); };
    // fzOnScan: haptic(15) = pieza encontrada (éxito), [30,50,30] = no está en el listado.
    if(typeof W.fzOnScan === "function"){ var fzOn0 = W.fzOnScan; W.fzOnScan = function(){ ctxFz = true; try{ return fzOn0.apply(this, arguments); } finally{ ctxFz = false; } }; }
    // Sonidos que hoy no vibran: ahora también vibran (toastError usa playErrorSound).
    [["playSuccessSound", "exito"], ["playNotFoundSound", "errorLargo"], ["playErrorSound", "error"], ["beep", "toque"]].forEach(function(x){
      var f0 = W[x[0]]; if(typeof f0 !== "function") return;
      W[x[0]] = function(){ try{ vibrar(x[1]); }catch(e){} return f0.apply(this, arguments); };
    });
    E.vibrar = vibrar;
  }catch(e){}

  /* ======================= 1. Escáner nativo a pantalla completa ======================= */
  try{
    var BS = function(){ return P("BarcodeScanner"); };
    var esCancelacion = function(e){ var m = String((e && (e.message || e.code || e.errorMessage)) || e || ""); return /cancel/i.test(m); };
    var usarWebParaFisico = function(){
      if(CFG.fisicoNativo) return false;
      var fz = vFZ();
      return !!(W.fzScanning && fz && fz.scanMode !== "join" && fz.sid);   // pieza en una sesión: la app toma una foto chica del <video>
    };
    var instalarModulo = function(){
      if(E.instalando) return; E.instalando = true; anota("instala modulo");
      try{
        var b = BS();
        if(b && b.addListener) callado(Promise.resolve(b.addListener("googleBarcodeScannerModuleInstallProgress", function(ev){
          try{
            var st = ev && ev.state;
            if(st === 4 || st === "COMPLETED"){ E.modulo = true; E.instalando = false; aviso("El escáner del teléfono ya está listo.", 2600); }
            else if(st === 3 || st === 5 || st === "FAILED" || st === "CANCELED"){ E.instalando = false; }
          }catch(x){}
        })));
      }catch(e){}
      llamar("BarcodeScanner", "installGoogleBarcodeScannerModule").catch(function(){ E.instalando = false; });
    };
    var mlkitListo = function(){
      if(!BS()) return Promise.resolve(false);
      var paso1 = E.soportado !== undefined ? Promise.resolve(E.soportado)
        : llamar("BarcodeScanner", "isSupported").then(function(r){ return (E.soportado = !!(r && r.supported)); }, function(){ return (E.soportado = false); });
      return paso1.then(function(sop){
        if(!sop) return false;
        if(E.modulo) return true;
        return llamar("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable").then(function(r){
          E.modulo = !!(r && r.available); if(!E.modulo) instalarModulo(); return E.modulo;
        }, function(){ return (E.modulo = true); });   // sin ese método (otra versión): se intenta scan() directo
      });
    };
    // El escáner de Google no necesita el permiso de cámara, pero la cámara web (placas, físico, respaldo) sí: se pide una vez.
    var permisoUnaVez = function(){
      if(ls("witt-nativa-permiso-camara")) return Promise.resolve();
      lsSet("witt-nativa-permiso-camara", "1");
      return llamar("BarcodeScanner", "checkPermissions").then(function(r){
        if(r && r.camera !== "granted" && r.camera !== "limited") return llamar("BarcodeScanner", "requestPermissions");
      }).catch(function(){});
    };
    var usarCamaraWeb = function(porque){
      anota("camara web: " + porque);
      if(porque === "sin-mlkit" && E.instalando && !E.avisoModulo){ E.avisoModulo = true; aviso("Preparando el escáner del teléfono; mientras, se usa la cámara de la app.", 3200); }
      E.pasarWebHasta = Date.now() + 1500;
      var b = $id("btn-cam-start"); if(b && !b.disabled) b.click();
    };
    var cancelar = function(){
      anota("cancelado");
      if(W.fzScanning && typeof W.fzCloseScan === "function"){ try{ W.fzCloseScan(); }catch(e){} }   // si no, se queda donde estaba
    };
    // Entrega a la misma función de la cámara web. Devuelve true si la app cerró el lector (abrió una ventana o terminó).
    var entregar = function(code){
      var gc = W.cameraGotCode; if(typeof gc !== "function") return true;
      E.entregando = true; E.stopEnEntrega = false;
      try{ gc(code, ETIQUETA); }catch(e){ anota("entregar err " + e); E.stopEnEntrega = true; }
      finally{ E.entregando = false; }
      return E.stopEnEntrega;
    };
    var puedeSeguirContinuo = function(){
      try{
        var st = vState();
        if(typeof W.continuousOn !== "function" || !W.continuousOn()) return false;
        if(!st || st.appMode === "refacciones" || W.fzScanning) return false;
        var s = $id("screen-scan"); if(!s || !s.classList.contains("active") || launcherAbierto()) return false;
        if(D.visibilityState === "hidden" || D.querySelector(".modal-bg.show")) return false;
        return true;
      }catch(e){ return false; }
    };
    var escanear = function(){
      if(E.abierto) return Promise.resolve();
      E.abierto = true; despiertaRevisar();
      anota("abre escaner");
      return mlkitListo().then(function(ok){
        if(!ok){ E.abierto = false; usarCamaraWeb("sin-mlkit"); return; }
        return permisoUnaVez().then(function(){ return llamar("BarcodeScanner", "scan", { formats:FORMATOS, autoZoom:true }); }).then(function(r){
          E.abierto = false;
          var bc = r && r.barcodes && r.barcodes[0];
          var code = bc ? (bc.rawValue != null && bc.rawValue !== "" ? bc.rawValue : bc.displayValue) : null;
          if(code == null || code === ""){ cancelar(); return; }
          anota("leido " + String(code).slice(0, 40));
          var cerro = entregar(String(code));
          if(!cerro) setTimeout(function(){ if(puedeSeguirContinuo()) escanear(); }, CFG.continuoMs);   // continuo: vuelve a abrir
        }, function(e){
          E.abierto = false;
          if(esCancelacion(e)){ cancelar(); return; }
          anota("scan fallo: " + (e && e.message)); E.modulo = false; E.soportado = undefined;
          usarCamaraWeb("error");
        });
      }).catch(function(e){ E.abierto = false; anota("escanear err " + e); }).then(function(){ E.abierto = false; despiertaRevisar(); });
    };
    E.escanear = escanear;

    // Un solo punto: el clic en #btn-cam-start (lo usan el botón, #fab-scan, fzOpenScan y readPlate).
    D.addEventListener("click", function(ev){
      try{
        var t = ev.target; if(!t || !t.closest) return;
        if(t.closest("#btn-plate, #pp-retry")){ E.webHasta = Date.now() + 1500; return; }   // placas: el OCR lee el <video> web
        if(!t.closest("#btn-cam-start")) return;
        if(Date.now() < E.pasarWebHasta){ E.pasarWebHasta = 0; return; }                      // respaldo: cámara web
        if(Date.now() < E.webHasta) return;
        if(usarWebParaFisico()) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        escanear();
      }catch(e){}
    }, true);
    if(typeof W.readPlate === "function"){ var rp0 = W.readPlate; W.readPlate = function(){ E.webHasta = Date.now() + 1500; return rp0.apply(this, arguments); }; }
    // Saber si la app cerró el lector mientras se entregaba el código (así se sabe si el continuo lo "registró solo").
    if(typeof W.stopCamera === "function"){ var sc0 = W.stopCamera; W.stopCamera = function(){ if(E.entregando) E.stopEnEntrega = true; return sc0.apply(this, arguments); }; }
  }catch(e){}

  /* ======================= 3. Pantalla encendida ======================= */
  function despiertaDebe(){
    try{
      if(E.abierto || vScanActive()) return true;
      if(D.visibilityState === "hidden") return false;
      var s = $id("screen-scan"); if(s && s.classList.contains("active") && !launcherAbierto()) return true;
      var fz = vFZ();
      if(D.body && D.body.classList.contains("fisico-open") && fz && fz.sid) return true;
      if(tieneShow("modal-fz-scan") || tieneShow("modal-fz-guide")) return true;
      var st = vState(), sp = $id("screen-parts");
      if(sp && sp.classList.contains("active") && !launcherAbierto() && st && st.partsCloud && st.partsCloud.sessionId) return true;
    }catch(e){}
    return false;
  }
  function despiertaRevisar(forzar){
    try{
      var q = despiertaDebe();
      if(q === E.despierta && !forzar) return;
      E.despierta = q; anota(q ? "keepAwake" : "allowSleep");
      callado(llamar("KeepAwake", q ? "keepAwake" : "allowSleep"));
    }catch(e){}
  }
  E.despiertaRevisar = despiertaRevisar;
  try{ setInterval(despiertaRevisar, 1500); setTimeout(despiertaRevisar, 300); }catch(e){}

  /* ======================= 4. Barra de estado y botón atrás ======================= */
  try{
    callado(llamar("StatusBar", "setOverlaysWebView", { overlay:false }));
    callado(llamar("StatusBar", "setBackgroundColor", { color:VERDE }));
    callado(llamar("StatusBar", "setStyle", { style:"DARK" }));   // DARK = íconos claros sobre fondo oscuro
  }catch(e){}

  // Cada ventana del físico se cierra con su propio botón, para que limpie su estado (FZ.card, FZ.where, FZ.again, FZ.guide…).
  var CIERRES = { "modal-fz-part":"#fz-part-close", "modal-fz-where":"#fz-w-cancel", "modal-fz-again":"#fz-a-cancel", "modal-fz-guide":"#fz-g-exit",
    "modal-fz-locs":"#fz-locs-close", "modal-fz-photo":"#fz-photo-close", "modal-fz-extra":"#fz-x-cancel" };
  function modalArriba(){
    var ms = Array.prototype.slice.call(D.querySelectorAll(".modal-bg.show")); if(!ms.length) return null;
    var mejor = null, zMejor = -Infinity;
    ms.forEach(function(m){ var z = parseInt(W.getComputedStyle(m).zIndex, 10); if(!isFinite(z)) z = 0; if(z >= zMejor){ zMejor = z; mejor = m; } });
    return mejor;
  }
  function atras(){
    anota("atras");
    if(E.abierto) return "escaner";
    try{ var api = W.__wittIntroAPI; if(api && api.estado && api.estado().abierta){ api.cerrar("saltar"); return "intro"; } }catch(e){}
    try{ if(typeof W.pvIsOpen === "function" && W.pvIsOpen() && typeof W.pvClose === "function"){ W.pvClose(); return "fotos"; } }catch(e){}
    var m = modalArriba();
    if(m){
      if(m.id === "modal-fz-scan" && typeof W.fzCloseScan === "function"){ W.fzCloseScan(); return "fz-scan"; }   // apaga la cámara y fzScanning
      if(m.id === "modal-fz-ask"){ var no = $id("fz-ask-no"), si = $id("fz-ask-yes"); if(no && !no.hidden) no.click(); else if(si) si.click(); return "fz-ask"; }
      var sel = CIERRES[m.id], b = sel && D.querySelector(sel);
      if(b){ b.click(); return m.id; }
      m.classList.remove("show"); return "modal:" + (m.id || "");
    }
    try{
      if(D.body.classList.contains("fisico-open")){
        var fz = vFZ();
        if(fz && fz.sid && fz.view && fz.view !== "contar" && typeof W.fzRender === "function"){ fz.view = "contar"; W.fzRender(false, true); return "fisico-contar"; }
        if(typeof W.fzClose === "function"){ W.fzClose(); return "fisico-cerrar"; }
      }
    }catch(e){}
    if(launcherAbierto()){
      if(CFG.salirEnSelector){ callado(llamar("App", "exitApp")); return "salir"; }
      return "nada";
    }
    // Igual que el "atrás" de la app: fuera del inicio del módulo va al inicio; en el inicio, al selector de apps.
    try{
      var st = vState();
      var act = D.querySelector(".screen.active"), home = D.querySelector('.nav button[data-screen="home"]');
      var inicio = st && st.appMode === "refacciones" ? "screen-parts" : "screen-home";
      if(!(act && act.id === inicio && W.scrollY < 40) && home){ home.click(); W.scrollTo(0, 0); return "inicio"; }
      if(typeof W.openLauncher === "function"){ W.openLauncher(); return "selector"; }
    }catch(e){}
    return "nada";
  }
  E.atras = atras;
  try{
    var A = P("App");
    if(A && A.addListener){
      callado(Promise.resolve(A.addListener("backButton", function(){ try{ atras(); }catch(e){} })));
      callado(Promise.resolve(A.addListener("pause", function(){
        anota("pause");
        if(E.abierto) return;   // la pantalla de Google también pausa la app: no se toca nada
        try{ if(vScanActive()){ E.reanudarFz = !!W.fzScanning; W.stopCamera(); } }catch(e){}
        try{ E.despierta = false; callado(llamar("KeepAwake", "allowSleep")); }catch(e){}
      })));
      callado(Promise.resolve(A.addListener("resume", function(){
        anota("resume");
        var r = E.reanudarFz; E.reanudarFz = false;
        if(r) setTimeout(function(){   // el físico con la cámara web: se vuelve a prender si el escáner sigue abierto
          try{ if(W.fzScanning && tieneShow("modal-fz-scan") && !vScanActive()){ E.pasarWebHasta = Date.now() + 1500; var b = $id("btn-cam-start"); if(b && !b.disabled) b.click(); } }catch(e){}
        }, 700);
        despiertaRevisar(true);
      })));
    }
  }catch(e){}

  /* ======================= 5. Exportaciones (Excel, ZIP, CSV, PDF) ======================= */
  try{
    var blobs = new Map();
    var cou0 = URL.createObjectURL, rou0 = URL.revokeObjectURL;
    URL.createObjectURL = function(o){ var u = cou0.apply(URL, arguments); try{ if(o instanceof Blob) blobs.set(u, o); }catch(e){} return u; };
    URL.revokeObjectURL = function(u){ setTimeout(function(){ blobs.delete(u); }, 90000); return rou0.apply(URL, arguments); };   // la app a veces revoca justo después del clic

    var candidato = function(a){ var h = a && a.getAttribute && (a.getAttribute("href") || ""); return /^(blob:|data:|https?:)/i.test(h); };
    var limpiarNombre = function(n){ n = String(n || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim(); return n || ("archivo_" + Date.now()); };
    var leerB64 = function(blob){ return new Promise(function(res, rej){ var r = new FileReader(); r.onload = function(){ var s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); }; r.onerror = function(){ rej(r.error); }; r.readAsDataURL(blob); }); };
    var TROZO = 3 * 1024 * 1024;   // múltiplo de 3: cada trozo se codifica completo; los ZIP con fotos no pasan de golpe por el puente
    var escribir = function(path, dir, blob){
      var i = 0, uri = null;
      var paso = function(){
        var parte = blob.slice(i, i + TROZO);
        return leerB64(parte).then(function(b64){
          var pr = i === 0 ? llamar("Filesystem", "writeFile", { path:path, data:b64, directory:dir, recursive:true })
                           : llamar("Filesystem", "appendFile", { path:path, data:b64, directory:dir });
          return pr.then(function(r){ if(r && r.uri) uri = r.uri; i += TROZO; return i < blob.size ? paso() : null; });
        });
      };
      return paso().then(function(){
        if(uri) return uri;
        return llamar("Filesystem", "getUri", { path:path, directory:dir }).then(function(r){ return r && r.uri; }, function(){ return null; });
      });
    };
    var guardarBlob = function(blob, nombre){
      nombre = limpiarNombre(nombre);
      anota("guardar " + nombre + " " + blob.size);
      return escribir("Inventarios Witt/" + nombre, "DOCUMENTS", blob).then(function(uri){ return { uri:uri, donde:"Documentos › Inventarios Witt", nombre:nombre }; },
        function(){ return escribir(nombre, "CACHE", blob).then(function(uri){ return { uri:uri, donde:null, nombre:nombre }; }); });
    };
    var compartir = function(info){
      var o = { title:info.nombre, dialogTitle:"Compartir " + info.nombre };
      if(info.uri) o.files = [info.uri];
      return llamar("Share", "share", o).catch(function(e){ if(!/cancel/i.test(String(e && e.message))) aviso("No se pudo compartir el archivo.", 2600); });
    };
    var tarjeta = null, tTarjeta = 0;
    var mostrarArchivo = function(info){
      try{
        if(!tarjeta){
          tarjeta = D.createElement("div"); tarjeta.className = "wn-archivo"; tarjeta.setAttribute("role", "status");
          tarjeta.innerHTML = '<div class="wn-archivo-txt"><b></b><span></span></div><div class="wn-archivo-btns"><button type="button" class="wn-compartir">Compartir</button><button type="button" class="wn-listo">Listo</button></div>';
          D.body.appendChild(tarjeta);
          tarjeta.querySelector(".wn-listo").addEventListener("click", function(){ tarjeta.classList.remove("show"); });
          tarjeta.querySelector(".wn-compartir").addEventListener("click", function(){ var i = tarjeta.__info; tarjeta.classList.remove("show"); if(i) compartir(i); });
        }
        tarjeta.__info = info;
        tarjeta.querySelector("b").textContent = info.nombre;
        tarjeta.querySelector("span").textContent = info.donde ? "Guardado en " + info.donde : "Listo para compartir (no se pudo guardar en Documentos)";
        tarjeta.classList.add("show");
        clearTimeout(tTarjeta); tTarjeta = setTimeout(function(){ tarjeta.classList.remove("show"); }, 9000);
      }catch(e){}
    };
    var obtenerBlob = function(href){
      if(/^blob:/i.test(href) && blobs.has(href)) return Promise.resolve(blobs.get(href));
      return fetch(href).then(function(r){ if(!r.ok && r.status) throw new Error("http " + r.status); return r.blob(); });
    };
    var abrirFuera = function(url){
      return llamar("AppLauncher", "openUrl", { url:url }).catch(function(){ return llamar("Browser", "open", { url:url }); });
    };
    var guardarDesdeAncla = function(a){
      var href = a.getAttribute("href") || "", nombre = a.getAttribute("download") || (href.split("/").pop() || "").split("?")[0];
      obtenerBlob(href).then(function(b){ return guardarBlob(b, nombre); }).then(mostrarArchivo, function(e){
        anota("guardar fallo " + e);
        if(/^https?:/i.test(href)) callado(abrirFuera(href)); else aviso("No se pudo guardar el archivo en el teléfono.", 3000);
      });
    };
    E.guardarBlob = guardarBlob; E.blobs = blobs;
    // <a download> dentro de la página (downloadBlob, XLSX.writeFile, visor de fotos): en burbuja, después del "ticket" de anim.js.
    D.addEventListener("click", function(ev){
      try{
        var t = ev.target, a = t && t.closest && t.closest("a[download]");
        if(!a || ev.defaultPrevented || !candidato(a)) return;
        ev.preventDefault(); guardarDesdeAncla(a);
      }catch(e){}
    }, false);
    // <a download> que no está en la página (jsPDF/FileSaver hace dispatchEvent(click) sobre un ancla suelta).
    var AP = HTMLAnchorElement.prototype, click0 = AP.click, disp0 = EventTarget.prototype.dispatchEvent;
    var suelta = function(a){ return !a.isConnected && a.hasAttribute("download") && candidato(a); };
    AP.click = function(){ if(suelta(this)){ guardarDesdeAncla(this); return; } return click0.apply(this, arguments); };
    Object.defineProperty(AP, "dispatchEvent", { configurable:true, writable:true, value:function(ev){
      if(ev && ev.type === "click" && suelta(this)){ guardarDesdeAncla(this); return false; }
      return disp0.apply(this, arguments);
    } });

    /* navigator.share con el panel de Android (el WebView no lo trae). */
    if(P("Share") && !W.navigator.share){
      var share = function(data){
        data = data || {};
        var files = Array.prototype.slice.call(data.files || []);
        var subir = Promise.all(files.map(function(f){ return guardarBlob(f, f.name || "archivo").then(function(i){ return i.uri; }); }));
        return subir.then(function(uris){
          var o = { dialogTitle:data.title || "Compartir" };
          if(data.title) o.title = data.title; if(data.text) o.text = data.text; if(data.url) o.url = data.url;
          uris = uris.filter(Boolean); if(uris.length) o.files = uris;
          return llamar("Share", "share", o);
        }).then(function(){}, function(e){
          var m = String(e && e.message || e);
          var err; try{ err = new DOMException(m, /cancel/i.test(m) ? "AbortError" : "NotAllowedError"); }catch(x){ err = new Error(m); err.name = /cancel/i.test(m) ? "AbortError" : "NotAllowedError"; }
          throw err;
        });
      };
      try{ Object.defineProperty(W.navigator, "share", { value:share, configurable:true, writable:true }); }catch(e){}
      try{ Object.defineProperty(W.navigator, "canShare", { value:function(){ return true; }, configurable:true, writable:true }); }catch(e){}
    }
    /* window.open a otro sitio (wa.me, REPUVE): lo abre el teléfono (WhatsApp, navegador). */
    if(P("AppLauncher") || P("Browser")){
      var open0 = W.open;
      W.open = function(url){
        try{
          var u = new URL(String(url || ""), location.href);
          if(/^https?:$/.test(u.protocol) && u.origin !== location.origin){
            callado(abrirFuera(u.href));
            return { closed:false, opener:null, close:function(){}, focus:function(){}, blur:function(){} };
          }
        }catch(e){}
        return open0.apply(W, arguments);
      };
    }
  }catch(e){}

  /* ======================= 6. Voz y dictado (solo si el WebView no los trae) ======================= */
  try{
    if(P("TextToSpeech") && !W.speechSynthesis){
      var habla = { speaking:false, pending:false, paused:false, onvoiceschanged:null,
        getVoices:function(){ return []; }, addEventListener:function(){}, removeEventListener:function(){},
        cancel:function(){ habla.speaking = false; callado(llamar("TextToSpeech", "stop")); },
        pause:function(){}, resume:function(){},
        speak:function(u){
          if(!u) return; habla.speaking = true;
          llamar("TextToSpeech", "speak", { text:String(u.text || ""), lang:u.lang || "es-MX", rate:u.rate || 1, pitch:u.pitch || 1, volume:u.volume == null ? 1 : u.volume, category:"ambient" })
            .then(function(){ habla.speaking = false; try{ u.onend && u.onend({}); }catch(e){} }, function(e){ habla.speaking = false; try{ u.onerror && u.onerror({ error:String(e) }); }catch(x){} });
        } };
      try{ Object.defineProperty(W, "speechSynthesis", { value:habla, configurable:true, writable:true }); }catch(e){}
      if(typeof W.SpeechSynthesisUtterance !== "function") W.SpeechSynthesisUtterance = function(t){ this.text = t || ""; this.lang = "es-MX"; this.rate = 1; this.pitch = 1; this.volume = 1; };
    }
    if(P("SpeechRecognition") && !W.SpeechRecognition && !W.webkitSpeechRecognition){
      var Rec = function(){ this.lang = "es-MX"; this.interimResults = false; this.maxAlternatives = 5; this.continuous = false; this._vivo = false; this._abortado = false; };
      Rec.prototype.start = function(){
        var self = this; if(self._vivo) throw new Error("ya escucha"); self._vivo = true; self._abortado = false;
        var fin = function(){ if(!self._vivo) return; self._vivo = false; try{ self.onend && self.onend({}); }catch(e){} };
        var err = function(c){ try{ self.onerror && self.onerror({ error:c }); }catch(e){} fin(); };
        llamar("SpeechRecognition", "requestPermissions").catch(function(){}).then(function(r){
          var p = r && (r.speechRecognition || r.microphone);
          if(p === "denied") return err("not-allowed");
          return llamar("SpeechRecognition", "start", { language:self.lang || "es-MX", maxResults:self.maxAlternatives || 5, partialResults:false, popup:false })
            .then(function(res){
              if(self._abortado) return fin();
              var ms = (res && res.matches) || [];
              if(!ms.length) return err("no-speech");
              var alt = ms.map(function(m){ return { transcript:String(m), confidence:1 }; }); alt.isFinal = true;
              try{ self.onresult && self.onresult({ resultIndex:0, results:[alt] }); }catch(e){}
              fin();
            }, function(e){ var m = String(e && e.message || e); err(self._abortado ? "aborted" : /permission|denied/i.test(m) ? "not-allowed" : /network/i.test(m) ? "network" : /match|speech/i.test(m) ? "no-speech" : "audio-capture"); });
        });
      };
      Rec.prototype.stop = function(){ callado(llamar("SpeechRecognition", "stop")); };
      Rec.prototype.abort = function(){ this._abortado = true; callado(llamar("SpeechRecognition", "stop")); };
      W.SpeechRecognition = W.webkitSpeechRecognition = Rec;
    }
  }catch(e){}

  try{
    W.__wittNativa = { version:VERSION, config:CFG, log:E.log,
      estado:function(){ return { abierto:E.abierto, despierta:E.despierta, modulo:E.modulo, soportado:E.soportado, fisicoNativo:CFG.fisicoNativo }; },
      escanear:function(){ return E.escanear && E.escanear(); }, atras:function(){ return E.atras(); }, despierta:function(){ despiertaRevisar(true); } };
  }catch(e){}
})();
