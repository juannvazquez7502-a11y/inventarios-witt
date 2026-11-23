/* ===== Puente nativo (app de Android con Capacitor) · 23-nov-2026 =====
   Solo actúa dentro de la app nativa: si no hay window.Capacitor o Capacitor.isNativePlatform() no es true, sale en la primera
   línea y la web (navegador y TWA) queda EXACTAMENTE igual. No cambia el JS de la app: solo envuelve funciones globales y
   escucha clics. Los plugins se usan como Capacitor.Plugins.X (sin bundler); si falta uno, esa parte no hace nada.
   1 Escáner nativo (ML Kit, pantalla completa de Google con linterna y zoom) en lugar de la cámara web. Entrega el código a
     cameraGotCode, la misma función que usa la cámara web, así que el continuo, Refacciones, el físico, REPUVE y los QR para
     unirse siguen igual. Placas y la pieza del Inventario físico (que guarda una foto chica del <video>) siguen con la cámara
     web; la del físico, a pantalla completa (nativa.css). No pide el permiso de cámara antes del escáner de Google (no lo
     necesita) y, si scan() dice que el módulo no está pero sí está, reintenta una vez. En el escaneo continuo espera el
     aviso de la app (con «Deshacer») antes de reabrir, y no reabre solo si la app ignoró el código (mismo código o corto).
   2 Vibración con Haptics: toques ligeros y avisos por significado (éxito, ya registrada, no encontrada o error).
   3 Pantalla encendida mientras se escanea o se cuenta (KeepAwake).
   4 Barra de estado verde Witt y botón atrás de Android.
   5 Exportaciones: guarda el archivo con Filesystem (Documentos/Inventarios Witt) y ofrece Compartir.
   6 navigator.share y voz (TextToSpeech) si el WebView no los trae; dictado SIEMPRE con el plugin SpeechRecognition. */
(function(){
  "use strict";
  var W = window, D = document, C = W.Capacitor;
  try{ if(!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform())) return; }catch(e){ return; }

  var VERSION = "nativa 1.1 · 23-nov-2026";
  var ETIQUETA = "CÓDIGO (escáner del teléfono)";
  var FORMATOS = ["QR_CODE", "CODE_128", "CODE_39", "DATA_MATRIX", "PDF_417", "AZTEC", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "ITF", "CODABAR"];
  var VERDE = "#00574a";
  var ls = function(k){ try{ return W.localStorage.getItem(k); }catch(e){ return null; } };
  // fisicoNativo: el escaneo de piezas del Inventario físico usa el escáner nativo (se pierde la foto chica de cada escaneo).
  // Por defecto NO: se queda la cámara web a pantalla completa para conservar la foto. Se cambia con
  // localStorage "witt-nativa-fisico" = "nativo".
  // esperaMaxMs: en el escaneo continuo, lo más que se espera al aviso de la app (#cs-toast) antes de reabrir el escáner.
  // revisarMs: tiempo límite para revisar si el escáner de Google está listo. tardaMs: si su pantalla no sale en ese tiempo,
  // el aviso «Abriendo…» ofrece usar la cámara de la app.
  var CFG = { fisicoNativo: ls("witt-nativa-fisico") === "nativo", esperaMaxMs: 6000, revisarMs: 4000, tardaMs: 9000, salirEnSelector: true };
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
    // Servicios de Google ocupados (pasó en el emulador): la revisión del módulo puede no contestar nunca. Con tiempo límite,
    // el botón no se queda muerto: se usa la cámara de la app y la próxima vez se vuelve a revisar.
    var conTiempo = function(pr, ms){
      return new Promise(function(res, rej){
        var t = setTimeout(function(){ var e = new Error("tiempo agotado"); e.tiempo = true; rej(e); }, ms);
        pr.then(function(v){ clearTimeout(t); res(v); }, function(e){ clearTimeout(t); rej(e); });
      });
    };
    var mlkitListo = function(){
      if(!BS()) return Promise.resolve(false);
      var paso1 = E.soportado !== undefined ? Promise.resolve(E.soportado)
        : conTiempo(llamar("BarcodeScanner", "isSupported"), CFG.revisarMs).then(function(r){ return (E.soportado = !!(r && r.supported)); },
            function(e){ if(e && e.tiempo){ anota("isSupported: tiempo agotado"); return false; } return (E.soportado = false); });
      return paso1.then(function(sop){
        if(!sop) return false;
        if(E.modulo) return true;
        return conTiempo(llamar("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable"), CFG.revisarMs).then(function(r){
          E.modulo = !!(r && r.available); if(!E.modulo) instalarModulo(); return E.modulo;
        }, function(e){
          if(e && e.tiempo){ anota("modulo: tiempo agotado"); return false; }
          return (E.modulo = true);   // sin ese método (otra versión): se intenta scan() directo
        });
      });
    };
    // El escáner de Google NO necesita el permiso de cámara y no se pide antes de abrirlo: el diálogo de Android pausa y
    // reanuda la app justo antes de scan() y ahí fallaba la primera apertura. La cámara web (placas, físico, respaldo)
    // lo pide sola cuando se usa (el WebView de Capacitor pide el permiso de Android en getUserMedia).
    // Aviso "Abriendo el escáner…" mientras la pantalla de Google tarda en salir (se quita al pausar la app o al volver).
    var abriendo = null, tAbriendo = 0, tTarda = 0;
    var avisoAbriendo = function(txt, conBoton){
      try{
        clearTimeout(tAbriendo); if(!txt) clearTimeout(tTarda);
        if(!txt){ if(abriendo) abriendo.classList.remove("show", "con-boton"); return; }
        if(!abriendo){
          abriendo = D.createElement("div"); abriendo.className = "wn-abriendo"; abriendo.setAttribute("role", "status"); abriendo.setAttribute("aria-live", "polite");
          abriendo.innerHTML = '<i aria-hidden="true"></i><span></span><button type="button">Usar la cámara de la app</button>'; D.body.appendChild(abriendo);
          abriendo.querySelector("button").addEventListener("click", function(){ if(E.abandonar) E.abandonar(); });
        }
        abriendo.querySelector("span").textContent = txt;
        abriendo.classList.toggle("con-boton", !!conBoton);
        if(conBoton){ abriendo.classList.add("show"); return; }
        tAbriendo = setTimeout(function(){ if(E.abierto) abriendo.classList.add("show"); }, 350);   // si abre rápido, ni se ve
      }catch(e){}
    };
    E.avisoAbriendo = avisoAbriendo;
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
    /* Escaneo continuo con el escáner de Google. La pantalla de Google tapa la página, así que NO se vuelve a abrir de golpe:
       - si se registró una unidad, se espera a que se oculte su aviso (#cs-toast, con «Deshacer», 4.5 s) y luego se reabre;
         una barra abajo deja «Escanear ya» o «Detener»; si se toca «Deshacer», ya no se reabre solo;
       - si salió un aviso sin registrar (ya registrada, baja), igual: se reabre cuando se oculta el aviso (3 s);
       - si no pasó nada (el mismo código otra vez o un código corto: la app lo ignora en silencio), NO se reabre: la barra
         dice qué pasó y espera un toque. Así no hay un abrir-cerrar en bucle mientras el teléfono apunta al mismo código. */
    var vCs = function(){ try{ return typeof csState !== "undefined" ? csState : null; }catch(e){ return null; } };   // eslint-disable-line no-undef
    var csToastVisible = function(){ var t = $id("cs-toast"); return !!(t && !t.hidden); };
    var seguir = null, tSeguir = 0;
    var ocultarSeguir = function(){ clearInterval(tSeguir); tSeguir = 0; try{ if(seguir) seguir.classList.remove("show"); }catch(e){} };
    var barraSeguir = function(txt, conDetener){
      if(!seguir){
        seguir = D.createElement("div"); seguir.className = "wn-seguir"; seguir.setAttribute("role", "status"); seguir.setAttribute("aria-live", "polite");
        seguir.innerHTML = '<span class="wn-seguir-txt"></span><div class="wn-seguir-btns"><button type="button" class="wn-detener">Detener</button><button type="button" class="wn-ya">Escanear</button></div>';
        D.body.appendChild(seguir);
        seguir.querySelector(".wn-ya").addEventListener("click", function(){ ocultarSeguir(); escanear(); });
        seguir.querySelector(".wn-detener").addEventListener("click", function(){ ocultarSeguir(); anota("continuo detenido"); });
      }
      seguir.querySelector(".wn-seguir-txt").textContent = txt;
      seguir.querySelector(".wn-detener").hidden = !conDetener;
      seguir.querySelector(".wn-ya").textContent = conDetener ? "Escanear ya" : "Seguir escaneando";
      seguir.classList.add("show");
    };
    E.seguirVisible = function(){ return !!(seguir && seguir.classList.contains("show")); };
    E.ocultarSeguir = ocultarSeguir;
    // Tras un aviso: espera a que se oculte y reabre (máximo CFG.esperaMaxMs). Si se deshizo, se queda esperando un toque.
    var seguirTrasAviso = function(n0){
      var t0 = Date.now();
      barraSeguir("Siguiente lectura en un momento…", true);
      clearInterval(tSeguir);
      tSeguir = setInterval(function(){
        try{
          if(!puedeSeguirContinuo()){ ocultarSeguir(); return; }
          var cs = vCs();
          if(cs && cs.round.length < n0){ clearInterval(tSeguir); tSeguir = 0; barraSeguir("Registro deshecho.", false); return; }
          if(!csToastVisible() || Date.now() - t0 > CFG.esperaMaxMs){ ocultarSeguir(); escanear(); }
        }catch(e){ ocultarSeguir(); }
      }, 200);
    };
    var seguirManual = function(code){
      var corto = String(code || "").replace(/[^0-9A-Za-z]/g, "").length < 4;
      try{ E.vibrar && E.vibrar("toque2"); }catch(e){}
      barraSeguir(corto ? "Ese código no es de una unidad. Apunta al VIN o a la etiqueta." : "Es el mismo código que acabas de leer. Apunta a otra unidad.", false);
      clearInterval(tSeguir);
      tSeguir = setInterval(function(){ if(!puedeSeguirContinuo()) ocultarSeguir(); }, 500);
    };
    var esNoDisponible = function(e){ return /not available|unavailable|no disponible/i.test(String((e && (e.message || e.code)) || e || "")); };
    var pausa = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    // scan() con UN reintento si dice que el módulo de Google no está, pero al revisarlo sí está (pasó tras una pausa de la app).
    var abrirScan = function(reintento){
      return llamar("BarcodeScanner", "scan", { formats:FORMATOS, autoZoom:true }).catch(function(e){
        if(reintento || esCancelacion(e) || !esNoDisponible(e)) throw e;
        anota("scan no disponible: reviso el modulo");
        // Disponible: reintenta enseguida. Si la revisión misma falla (servicios de Google todavía arrancando, pasó en el
        // emulador: "ModuleInstall.API is not available"), espera un poco y reintenta una vez. Si dice que no está, cámara web.
        var reintentar = function(ms, por){
          anota(por + ": reintento");
          avisoAbriendo("Abriendo el escáner…");
          return pausa(ms).then(function(){ return abrirScan(true); });
        };
        return conTiempo(llamar("BarcodeScanner", "isGoogleBarcodeScannerModuleAvailable"), CFG.revisarMs).then(function(r){
          if(!(r && r.available)) throw e;
          return reintentar(600, "modulo disponible");
        }, function(x){ if(x && x.tiempo) throw e; return reintentar(1500, "revision fallo"); });
      });
    };
    // Cada apertura lleva un número. Si la pantalla de Google tarda (no pausa la app en CFG.tardaMs), el aviso ofrece la
    // cámara de la app; esa apertura queda «abandonada»: si luego llega un código se entrega igual, si se cancela no pasa nada.
    E.intento = 0; E.abandonado = 0; E.pausoEn = 0;
    E.abandonar = function(){
      var n = E.intento; if(!E.abierto || E.abandonado === n) return;
      E.abandonado = n; E.abierto = false; avisoAbriendo(null); anota("escaner tarda: camara de la app");
      usarCamaraWeb("tarda");
    };
    var escanear = function(){
      if(E.abierto) return Promise.resolve();
      ocultarSeguir();
      var n = ++E.intento;
      var actual = function(){ return n === E.intento && E.abandonado !== n; };
      E.abierto = true; despiertaRevisar();
      anota("abre escaner");
      avisoAbriendo("Abriendo el escáner…");
      return mlkitListo().then(function(ok){
        if(!actual()) return;
        if(!ok){ E.abierto = false; avisoAbriendo(null); usarCamaraWeb("sin-mlkit"); return; }
        var t0 = Date.now();
        tTarda = setTimeout(function(){
          if(actual() && E.abierto && E.pausoEn < t0) avisoAbriendo("El escáner del teléfono está tardando…", true);
        }, CFG.tardaMs);
        return abrirScan(false).then(function(r){
          clearTimeout(tTarda);
          var bc = r && r.barcodes && r.barcodes[0];
          var code = bc ? (bc.rawValue != null && bc.rawValue !== "" ? bc.rawValue : bc.displayValue) : null;
          if(!actual()){ if(code) { anota("leido tarde " + String(code).slice(0, 40)); entregar(String(code)); } return; }
          E.abierto = false; avisoAbriendo(null);
          if(code == null || code === ""){ cancelar(); return; }
          anota("leido " + String(code).slice(0, 40));
          var cs = vCs(), n0 = cs ? cs.round.length : 0, tt0 = cs ? cs.toastTimer : null;
          var cerro = entregar(String(code));
          if(cerro) return;
          // Continuo: la app lo manejó sin cerrar el lector (registró, avisó o lo ignoró).
          var cs1 = vCs(), crecio = !!(cs1 && cs1.round.length > n0), aviso1 = !!(cs1 && cs1.toastTimer !== tt0 && csToastVisible());
          anota("continuo " + (crecio ? "registro" : aviso1 ? "aviso" : "sin cambio"));
          if(!puedeSeguirContinuo()) return;
          if(crecio || aviso1) seguirTrasAviso(cs1 ? cs1.round.length : 0); else seguirManual(code);
        }, function(e){
          clearTimeout(tTarda);
          if(!actual()){ anota("escaner abandonado: " + (e && e.message)); return; }
          E.abierto = false; avisoAbriendo(null);
          if(esCancelacion(e)){ cancelar(); return; }
          anota("scan fallo: " + (e && e.message)); E.modulo = false; E.soportado = undefined;
          usarCamaraWeb("error");
        });
      }).catch(function(e){ anota("escanear err " + e); }).then(function(){
        if(n === E.intento){ if(E.abandonado !== n) avisoAbriendo(null); E.abierto = false; }
        despiertaRevisar();
      });
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
    // Con la pantalla de Google al frente, el atrás lo recibe ella; si llega aquí es que todavía no sale: se deja de esperar.
    if(E.abierto){ E.abandonado = E.intento; E.abierto = false; try{ E.avisoAbriendo(null); }catch(e){} anota("atras: deja de esperar el escaner"); return "escaner-espera"; }
    try{ if(E.seguirVisible && E.seguirVisible()){ E.ocultarSeguir(); return "continuo-detenido"; } }catch(e){}
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
        if(E.abierto){ E.pausoEn = Date.now(); try{ E.avisoAbriendo && E.avisoAbriendo(null); }catch(e){} return; }   // la pantalla de Google también pausa la app: solo se quita «Abriendo…»
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

  /* ======================= 6. Voz (si el WebView no la trae) y dictado (siempre con el plugin) ======================= */
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
    /* Dictado: en la app SIEMPRE con el plugin (el reconocedor de Android), aunque el WebView traiga webkitSpeechRecognition:
       en el WebView ese objeto existe pero no se comprobó que funcione (en el emulador no dio ni onstart ni onerror).
       interimResults → partialResults: lo que se va oyendo llega por el listener "partialResults" y se muestra en el HUD como
       hoy; se termina con "listeningState: stopped", con stop() o con el resultado final de start(). */
    if(P("SpeechRecognition")){
      var escucharSR = function(ev, cb){
        try{ var p = P("SpeechRecognition"); if(!p || typeof p.addListener !== "function") return Promise.resolve(null);
          return Promise.resolve(p.addListener(ev, cb)).catch(function(){ return null; }); }catch(e){ return Promise.resolve(null); }
      };
      var quitarSR = function(hs){ hs.forEach(function(h){ try{ Promise.resolve(h).then(function(x){ try{ x && x.remove && x.remove(); }catch(e){} }); }catch(e){} }); };
      var codigoSR = function(e){
        var m = String((e && (e.message || e.code)) || e || "");
        return /permission|denied|not allowed/i.test(m) ? "not-allowed" : /network/i.test(m) ? "network" : /match|speech|timeout/i.test(m) ? "no-speech" : "audio-capture";
      };
      var Rec = function(){ this.lang = "es-MX"; this.interimResults = false; this.maxAlternatives = 5; this.continuous = false;
        this.onstart = this.onresult = this.onerror = this.onend = null; this._vivo = false; this._abortado = false; };
      Rec.prototype.addEventListener = function(t, f){ if(typeof f === "function" && /^(start|result|error|end)$/.test(t) && !this["on" + t]) this["on" + t] = f; };
      Rec.prototype.removeEventListener = function(t, f){ if(this["on" + t] === f) this["on" + t] = null; };
      Rec.prototype.start = function(){
        var self = this;
        if(self._vivo){ var ex; try{ ex = new DOMException("Ya está escuchando", "InvalidStateError"); }catch(x){ ex = new Error("Ya está escuchando"); } throw ex; }
        self._vivo = true; self._abortado = false; self._parando = false; self._ultimo = null;
        var parcial = !!self.interimResults, max = Math.max(1, self.maxAlternatives || 1), hs = [], tFin = 0, tMax = 0;
        var cerrar = function(){ if(!self._vivo) return; self._vivo = false; clearTimeout(tFin); clearTimeout(tMax); quitarSR(hs); anota("dictado fin");
          try{ self.onend && self.onend({ type:"end" }); }catch(e){} };
        var error = function(c){ if(!self._vivo) return; anota("dictado error " + c); try{ self.onerror && self.onerror({ type:"error", error:c }); }catch(e){} cerrar(); };
        var emitir = function(ms, fin){
          ms = (ms || []).map(String).filter(function(s){ return s.trim(); }); if(!ms.length) return false;
          var alt = ms.slice(0, max).map(function(s){ return { transcript:s, confidence:fin ? 0.9 : 0.5 }; });
          alt.isFinal = !!fin; alt.item = function(i){ return this[i]; };
          var lista = [alt]; lista.item = function(i){ return this[i]; };
          try{ self.onresult && self.onresult({ type:"result", resultIndex:0, results:lista }); }catch(e){}
          return true;
        };
        var terminar = function(){
          if(!self._vivo) return;
          if(self._abortado){ try{ self.onerror && self.onerror({ type:"error", error:"aborted" }); }catch(e){} return cerrar(); }
          if(self._ultimo && emitir(self._ultimo, true)) return cerrar();
          error("no-speech");
        };
        var finEn = function(ms){ clearTimeout(tFin); tFin = setTimeout(terminar, ms); };
        self._terminar = terminar; self._finEn = finEn;
        tMax = setTimeout(function(){ callado(llamar("SpeechRecognition", "stop")); finEn(1200); }, 25000);   // por si el reconocedor no avisa nunca
        llamar("SpeechRecognition", "requestPermissions").catch(function(){ return null; }).then(function(r){
          if(!self._vivo) return;
          var p = r && (r.speechRecognition || r.microphone);
          if(p === "denied") return error("not-allowed");
          if(parcial){
            hs.push(escucharSR("partialResults", function(d){
              if(!self._vivo) return; var ms = d && d.matches;
              if(ms && ms.length){ self._ultimo = ms; emitir(ms, false); if(self._parando) finEn(350); }
            }));
            hs.push(escucharSR("listeningState", function(d){ if(self._vivo && d && d.status === "stopped") finEn(900); }));
          }
          return Promise.all(hs).then(function(){
            if(!self._vivo) return;
            anota("dictado inicia" + (parcial ? " (parcial)" : ""));
            try{ self.onstart && self.onstart({ type:"start" }); }catch(e){}
            return llamar("SpeechRecognition", "start", { language:self.lang || "es-MX", maxResults:max, partialResults:parcial, popup:false }).then(function(res){
              var ms = res && res.matches;
              if(ms && ms.length){ self._ultimo = ms; return terminar(); }
              if(!parcial) return error("no-speech");
              // Parcial: start() puede volver antes de que se hable; lo demás llega por los listeners.
            }, function(e){ if(!self._vivo) return; if(self._ultimo || self._abortado) return terminar(); error(codigoSR(e)); });
          });
        });
      };
      Rec.prototype.stop = function(){ if(!this._vivo) return; this._parando = true; callado(llamar("SpeechRecognition", "stop")); if(this._finEn) this._finEn(1200); };
      Rec.prototype.abort = function(){ if(!this._vivo) return; this._abortado = true; callado(llamar("SpeechRecognition", "stop")); if(this._terminar) this._terminar(); };
      ["SpeechRecognition", "webkitSpeechRecognition"].forEach(function(n){
        try{ Object.defineProperty(W, n, { value:Rec, configurable:true, writable:true }); }catch(e){ try{ W[n] = Rec; }catch(x){} }
      });
    }
  }catch(e){}

  try{
    W.__wittNativa = { version:VERSION, config:CFG, log:E.log,
      estado:function(){ return { abierto:E.abierto, despierta:E.despierta, modulo:E.modulo, soportado:E.soportado, fisicoNativo:CFG.fisicoNativo }; },
      escanear:function(){ return E.escanear && E.escanear(); }, atras:function(){ return E.atras(); }, despierta:function(){ despiertaRevisar(true); } };
  }catch(e){}
})();
