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
   6 navigator.share y voz (TextToSpeech) si el WebView no los trae; dictado SIEMPRE con el plugin SpeechRecognition.
   7 Ligas para unirse (23-nov-2026): la liga ?unirse= que abre Android (App Link desde la cámara del teléfono) se entrega a
     enlaces.js, con la app abierta ("appUrlOpen") o cerrada (getLaunchUrl al arrancar).
   8 Cámara Witt (v2.2, 23-nov-2026): si el APK trae el plugin nativo WittCamara (CameraX + ML Kit empaquetado), tocar
     Escanear (pestaña, botón verde, Iniciar cámara, Leer placa y los del Inventario físico) abre DIRECTO la cámara a pantalla
     completa con los ajustes dentro (Normal / Continuo / Placa, linterna, zoom, voz, ubicación, Escribir, Foto, Dictar), sin
     pasar por la pantalla «Escáner Multimodal». Cuando la app decide qué pasó con la unidad, la cámara respira en verde
     (disponible, se marca), amarillo (ya encontrada, baja) o rojo (fuera de inventario), con pitido y vibración nativos
     de distinta intensidad. Sin el plugin (APK anterior) o si falla, sigue el escáner de Google y la cámara web. */
(function(){
  "use strict";
  var W = window, D = document, C = W.Capacitor;
  try{ if(!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform())) return; }catch(e){ return; }

  var VERSION = "nativa 2.2 · 23-nov-2026 · cámara Witt";
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
      try{ if(E.silencioso && E.silencioso()) return; }catch(e){}   // la cámara Witt da su propia vibración por color
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
        if(E.camaraClic && E.camaraClic(ev)) return;                                          // cámara Witt (sección 8)
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
      if(E.camara && (E.camara.abierta || E.camara.abriendo)) return true;   // si no, allowSleep le quitaría la pantalla encendida
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

  /* ======================= 7. Ligas para unirse (cámara del teléfono → App Link) ======================= */
  /* La cámara normal del teléfono lee el QR (liga https://…github.io/inventarios-witt/?unirse=TIPO-CÓDIGO) y Android abre
     esta app (App Link verificado con assetlinks.json). Con la app abierta llega por "appUrlOpen"; con la app cerrada, por
     getLaunchUrl() al arrancar. Se entrega a la capa enlaces.js (window.__wittUnirse.desdeUrl), que espera a que la app
     esté lista, quita el parámetro y llama openJoinFromQR, igual que en la web. La liga de arranque se usa una sola vez por
     WebView (sessionStorage): si la página se recarga, no vuelve a unir. Cuando Android crea una Activity nueva con el mismo
     intent (abrir desde Recientes tras salir con Atrás, o volver después de que mató el proceso), sessionStorage empieza
     vacío: de eso se encarga MainActivity (ajustar-android.mjs, "witt-liga-vieja"), que cambia ese intent por MAIN antes de
     que Capacitor lo lea, así getLaunchUrl y "appUrlOpen" ya no traen la liga vieja. */
  try{
    var CLAVE_LIGAS = "witt-unirse-ligas";
    var ligasUsadas = function(){ try{ return JSON.parse(W.sessionStorage.getItem(CLAVE_LIGAS) || "[]") || []; }catch(e){ return []; } };
    var marcarLiga = function(u){ try{ var l = ligasUsadas(); if(l.indexOf(u) < 0){ l.push(u); W.sessionStorage.setItem(CLAVE_LIGAS, JSON.stringify(l.slice(-20))); } }catch(e){} };
    var entregarLiga = function(url, origen){
      url = String(url || ""); if(!/unirse/i.test(url)) return;
      var n = 0;
      (function intenta(){
        var U = W.__wittUnirse;
        if(U && typeof U.desdeUrl === "function"){ var r = "err"; try{ r = U.desdeUrl(url, origen); }catch(e){} anota("liga " + origen + ": " + r); return; }
        if(++n < 60) setTimeout(intenta, 250); else anota("liga " + origen + ": sin enlaces.js");
      })();
    };
    var AL = P("App");
    if(AL){
      if(typeof AL.addListener === "function") callado(Promise.resolve(AL.addListener("appUrlOpen", function(ev){
        try{ var u = String((ev && ev.url) || ""); anota("appUrlOpen " + u.slice(0, 90)); marcarLiga(u); entregarLiga(u, "appUrlOpen"); }catch(e){}
      })));
      if(typeof AL.getLaunchUrl === "function") callado(Promise.resolve(AL.getLaunchUrl()).then(function(r){
        var u = String((r && r.url) || ""); if(!u) return;
        anota("getLaunchUrl " + u.slice(0, 90));
        if(ligasUsadas().indexOf(u) >= 0){ anota("liga de arranque ya usada"); return; }
        marcarLiga(u); entregarLiga(u, "arranque");
      }));
    }
  }catch(e){}

  /* ======================= 8. Cámara Witt (v2.2): cámara nativa propia, directa ======================= */
  /* El plugin WittCamara (app-nativa/android-extra/camara, Kotlin) abre una cámara a pantalla completa ENCIMA de la página,
     en la misma Activity: la página sigue viva, recibe cada lectura al instante y contesta con el color.
     Eventos del plugin: "codigo" {texto, formato, modo, foto?}, "placa" {texto, tipo, candidatos}, "accion" {tipo, valor},
     "cerrada" {motivo}. La página contesta con feedback({color, titulo, detalle, cerrar, deshacer, contador}).
     - Lectura de código → cameraGotCode (la misma función de la cámara web: continuo, Refacciones, físico, REPUVE, QR para
       unirse). Placa → finishPlate / handleDetectedCode(placa, "PLACA (lectura con cámara)").
     - Color: se anota lo que la app decide mientras procesa la lectura (unitAlert, csToast, físico, Refacciones) y gana el
       más serio: rojo (fuera de inventario) > amarillo (ya encontrada, baja, otra ubicación) > verde (disponible).
       Mientras tanto los pitidos y vibraciones de la página se callan: suena y vibra la cámara, con su intensidad.
     - Si la app abre una ventana (unidad encontrada, fuera de inventario, varias unidades…) la cámara muestra el color un
       momento y se cierra; al cerrar la ventana vuelve sola a la cámara (Vehículos), en el mismo modo.
     - Sin el plugin, con localStorage "witt-camara" = "google", o si falla dos veces: escáner de Google y cámara web. */
  try{
    var WC = "WittCamara";
    CFG.camaraWitt = ls("witt-camara") !== "google";
    CFG.volverTrasVentana = ls("witt-camara-volver") !== "0";
    CFG.fueraRegistradaRojo = ls("witt-camara-fuera") !== "amarillo";   // ya registrada como fuera de inventario: rojo
    CFG.avisosNativos = ls("witt-avisos") !== "web";
    // Cuánto se ve el color en la cámara antes de cerrarla cuando la app abre su ventana (modo Normal).
    CFG.cerrarMs = Math.min(4000, Math.max(300, parseInt(ls("witt-camara-cerrar-ms") || "900", 10) || 900));
    var K = { abierta:false, abriendo:false, modo:"normal", ctx:"vehiculos", volver:null, tVolver:0, fallos:0, foto:null,
      silencioHasta:0, ultimoAviso:0, webHasta:0, avisos:[] };
    E.camara = K;
    var camHay = function(){ try{ return !!(typeof C.isPluginAvailable === "function" && C.isPluginAvailable(WC)); }catch(e){ return false; } };
    var camUsable = function(){ return CFG.camaraWitt && camHay() && K.fallos < 2; };
    var PESO = { neutro:0, verde:1, amarillo:2, rojo:3 };
    var R = null;   // lectura en proceso: lo que la app decidió mientras la procesaba
    var sinEmoji = function(s){
      try{ return String(s == null ? "" : s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").replace(/^[\s·]+|[\s·]+$/g, ""); }
      catch(e){ return String(s || ""); }
    };
    var pantallaActual = function(){ var a = D.querySelector(".screen.active"); return a ? a.id : ""; };
    var vCs2 = function(){ try{ return typeof csState !== "undefined" ? csState : null; }catch(e){ return null; } };   // eslint-disable-line no-undef
    var rondaN = function(){ var cs = vCs2(); return cs && cs.round ? cs.round.length : 0; };
    var nota = function(color, titulo, detalle, extra){
      var r = R; if(!r || !r.activo) return false;
      r.notas.push({ c:color, t:sinEmoji(titulo), d:sinEmoji(detalle), x:extra || {} });
      return true;
    };
    E.silencioso = function(){ return !!(R && R.activo) || Date.now() < K.silencioHasta; };
    // Fuera de la cámara (búsqueda, ventana de la unidad): el mismo pitido y vibración nativos por color.
    var avisoNativo = function(color){
      if(!(CFG.avisosNativos && camHay())) return false;
      K.silencioHasta = Date.now() + 450; K.ultimoAviso = Date.now();
      callado(llamar(WC, "aviso", { color:color }));
      return true;
    };
    var detalleLog = function(log){
      try{
        if(!log) return "";
        var p = [];
        if(log.user_name) p.push("por " + log.user_name);
        if(log.timestamp && typeof W.timeAgoTxt === "function") p.push(W.timeAgoTxt(log.timestamp));
        if(log.status === "BAJA" && typeof W.bajaReasonOf === "function") p.push(W.bajaReasonOf(log));
        return p.join(" · ");
      }catch(e){ return ""; }
    };

    /* ---- 8.1 Lo que decide la app → color */
    if(typeof W.unitAlert === "function"){
      var ua0 = W.unitAlert;
      W.unitAlert = function(kind, log){
        try{
          var fuera = !!(log && log.status === "NO_ENCONTRADO");
          var c = kind === "ok" ? "verde" : kind === "bad" ? "rojo" : (fuera && CFG.fueraRegistradaRojo) ? "rojo" : "amarillo";
          var t = kind === "ok" ? "Disponible: se puede marcar" : kind === "bad" ? "No está en el inventario" : kind === "baja" ? "Dada de baja" : fuera ? "Ya registrada fuera de inventario" : "Ya registrada";
          if(!nota(c, t, detalleLog(log) || (R && R.codigo) || "")) avisoNativo(c);
        }catch(e){}
        return ua0.apply(this, arguments);
      };
    }
    if(typeof W.csToast === "function"){
      var ct0 = W.csToast;
      W.csToast = function(kind, rec, detail, created){
        try{
          var c = (kind === "ok" || kind === "crit") ? "verde" : "amarillo";
          var serie = rec ? String(rec.serie || rec.vin || "").slice(-8) : "";
          var t = (kind === "ok" ? "Registrada" : kind === "crit" ? "Registrada · crítica" : kind === "baja" ? "Dada de baja" : "Ya registrada") + (serie ? " · " + serie : "");
          if(!nota(c, t, detail, { deshacer:!!created })) avisoNativo(c);
        }catch(e){}
        return ct0.apply(this, arguments);
      };
    }
    // Inventario físico (la cámara entrega a fzOnScan por cameraGotCode → handleDetectedCode).
    var notaSi = function(nombre, fnColor){
      var f0 = W[nombre]; if(typeof f0 !== "function") return;
      W[nombre] = function(){
        var r = f0.apply(this, arguments);
        try{ if(R && R.activo){ var x = fnColor(r, arguments); if(x) nota(x[0], x[1], x[2] || ""); } }catch(e){}
        return r;
      };
    };
    notaSi("fzWrongPlace", function(r, a){ return r ? ["amarillo", "Está en otra ubicación", a[0]] : null; });
    notaSi("fzAlreadyCheck", function(r, a){ return r ? ["amarillo", "Pieza ya contada", a[0]] : null; });
    notaSi("fzOpenPart", function(r, a){ return ["verde", "Pieza encontrada", typeof a[0] === "string" ? a[0] : ""]; });
    notaSi("fzOpenExtra", function(r, a){ return ["rojo", "No está en el listado", typeof a[0] === "string" ? a[0] : ""]; });
    // Refacciones: verde = en el catálogo y sin contar; amarillo = ya contada; rojo = no está o es fuera de inventario.
    if(typeof W.handlePartsDetectedCode === "function"){
      var hp0 = W.handlePartsDetectedCode;
      W.handlePartsDetectedCode = function(str){
        if(R && R.activo){
          try{
            var st = vState(), part = typeof W.findPart === "function" ? W.findPart(str) : null, pn = part && part.partNumber;
            var ooi = !!(st && st.partsOOI && st.partsOOI.has && (st.partsOOI.has(pn) || st.partsOOI.has(String(str))));
            if(!part) nota("rojo", "No está en el catálogo", str);
            else if(ooi) nota("rojo", "Fuera de inventario", pn);
            else if(st && st.partFound && st.partFound.has && st.partFound.has(pn)) nota("amarillo", "Pieza ya contada", pn);
            else nota("verde", "Pieza en el catálogo", pn);
          }catch(e){}
        }
        return hp0.apply(this, arguments);
      };
    }
    // Sonidos de la página: callados mientras se procesa una lectura (suena la cámara) y justo después de un aviso nativo.
    // beep() se espera 60 ms: si en ese tiempo llega un aviso de color, ya no suena (no hay doble pitido).
    var SONIDO_COLOR = { playSuccessSound:"verde", playNotFoundSound:"rojo", playErrorSound:"rojo", beep:"neutro", _playTone:"" };
    Object.keys(SONIDO_COLOR).forEach(function(n){
      var f0 = W[n]; if(typeof f0 !== "function") return;
      W[n] = function(){
        if(R && R.activo){ if(SONIDO_COLOR[n]) R.sonidos.push(SONIDO_COLOR[n]); return; }
        if(Date.now() < K.silencioHasta) return;
        if(n === "beep" && CFG.avisosNativos && camHay()){
          var self = this, args = arguments, t0 = Date.now();
          setTimeout(function(){ if(K.ultimoAviso >= t0 || Date.now() < K.silencioHasta) return; try{ f0.apply(self, args); }catch(e){} }, 60);
          return;
        }
        return f0.apply(this, arguments);
      };
    });

    /* ---- 8.2 Entregar una lectura y contestar con el color */
    var entregarNativo = function(fn, codigo){
      var r = R = { activo:true, notas:[], sonidos:[], cerrar:false, codigo:String(codigo || "") };
      try{ fn(); }catch(e){ anota("camara: entrega err " + (e && e.message)); }
      r.activo = false;
      K.silencioHasta = Date.now() + 450;
      setTimeout(function(){ responder(r); }, 30);
    };
    var responder = function(r){
      var m = null;
      r.notas.forEach(function(n){ if(!m || PESO[n.c] > PESO[m.c]) m = n; });
      var color = m ? m.c : "neutro";
      if(!m){ r.sonidos.forEach(function(x){ if(PESO[x] > PESO[color]) color = x; }); }
      var ventana = !!D.querySelector(".modal-bg.show");
      var cerrar = r.cerrar || ventana || !K.abierta;
      var f = {
        color:color,
        titulo: m ? m.t : (color === "verde" ? "Listo" : color === "rojo" ? "Revisa en la app" : (cerrar && r.codigo ? "Leído" : "")),
        detalle: m ? (m.d || r.codigo) : (cerrar || r.sonidos.length ? r.codigo : ""),
        deshacer: !!(m && m.x && m.x.deshacer) && !cerrar,
        contador: rondaN(), cerrar: cerrar, cerrarEn: cerrar ? (color === "neutro" ? 150 : CFG.cerrarMs) : 0,
        sonido: color !== "neutro" || r.sonidos.length > 0, vibrar: color !== "neutro"
      };
      if(cerrar && K.abierta) prepararVolver();
      anota("camara: " + color + (cerrar ? " y cierra" : ""));
      try{ K.avisos.push({ t:Date.now(), codigo:r.codigo.slice(0, 40), color:color, titulo:f.titulo, cerrar:cerrar, deshacer:f.deshacer }); if(K.avisos.length > 12) K.avisos.shift(); }catch(e){}
      callado(llamar(WC, "feedback", f));
    };
    var onCodigo = function(d){
      var txt = String((d && d.texto) || ""); if(!txt) return;
      K.foto = d.foto ? { url:d.foto, t:Date.now() } : null;
      try{ if(typeof W.noteLocActivity === "function") W.noteLocActivity(); }catch(e){}
      anota("camara: codigo " + (d.formato || "") + " " + txt.slice(0, 40));
      entregarNativo(function(){ W.cameraGotCode(txt, ETIQUETA); }, txt);
    };
    var onPlaca = function(d){
      var txt = String((d && d.texto) || "").toUpperCase(); if(!txt) return;
      try{ if(typeof W.noteLocActivity === "function") W.noteLocActivity(); }catch(e){}
      anota("camara: " + (d.tipo || "placa") + " " + txt);
      entregarNativo(function(){
        R.cerrar = true;
        if(d.tipo === "vin" || typeof W.finishPlate !== "function"){ try{ W.stopCamera(); }catch(e){} W.handleDetectedCode(txt, d.tipo === "vin" ? "VIN (lectura con cámara)" : "PLACA (lectura con cámara)"); return; }
        // Igual que la lectura con la cámara web: se compara contra las placas del inventario con tolerancia.
        var cands = [txt].concat(d.candidatos || []).map(function(x){ return String(x).toUpperCase().replace(/[^A-Z0-9]/g, ""); }).filter(Boolean);
        var rk = []; try{ rk = typeof W.rankPlates === "function" ? W.rankPlates(cands) : []; }catch(e){}
        var conocida = !!(rk.length && (rk[0][1] === 0 || (rk[0][1] <= 1.5 && (!rk[1] || rk[1][1] - rk[0][1] >= 0.5))));
        W.finishPlate(conocida ? rk[0][0] : txt, conocida);
      }, txt);
    };

    /* ---- 8.3 Ajustes que regresan a la página */
    var ponerContinuo = function(on){
      var c = $id("cs-toggle"); if(!c || c.checked === on) return;
      c.checked = on; c.dispatchEvent(new Event("change", { bubbles:true }));
    };
    var deshacerUltimo = function(){
      var cs = vCs2(); if(!cs || !cs.round || !cs.round.length) return;
      var ult = cs.round[cs.round.length - 1];
      try{ W.csUndo(ult.logs); }catch(e){ anota("camara: deshacer err " + e); }
      try{ var tt = $id("cs-toast"); if(tt) tt.hidden = true; }catch(e){}
      callado(llamar(WC, "feedback", { color:"neutro", titulo:"Registro deshecho", detalle:String(ult.vin || "").slice(-8), contador:rondaN(), sonido:false, vibrar:false }));
    };
    var irAInicio = function(){
      var st = vState(), parts = st && st.appMode === "refacciones";
      var scr = $id(parts ? "screen-parts" : "screen-home");
      if(scr && !scr.classList.contains("active")){ var h = D.querySelector('.nav:not(.fz-nav) button[data-screen="home"]'); if(h) h.click(); }
      return parts;
    };
    var teclado = function(){ setTimeout(function(){ callado(llamar(WC, "teclado")); }, 220); };
    var escribirAMano = function(){
      try{
        if(W.fzScanning){ var b = $id("fz-scan-type"); if(b && !b.hidden){ b.click(); teclado(); } else if(typeof W.fzCloseScan === "function") W.fzCloseScan(); return; }
        var parts = irAInicio();
        var inp = $id(parts ? "parts-search" : "home-search");
        if(inp){ inp.scrollIntoView({ block:"center" }); inp.focus(); teclado(); }
      }catch(e){}
    };
    var dictar = function(){ try{ irAInicio(); if(typeof W.voiceSearch === "function") W.voiceSearch(); }catch(e){} };
    var fotoAWeb = function(url){
      if(!url) return;
      var st = vState(), parts = st && st.appMode === "refacciones";
      var inp = $id(parts ? "parts-photo-scan-input" : "photo-scan-input"); if(!inp) return;
      fetch(url).then(function(r){ return r.blob(); }).then(function(b){
        var dt = new DataTransfer(); dt.items.add(new File([b], "foto-camara.jpg", { type:"image/jpeg" }));
        inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles:true }));
      }).catch(function(e){ anota("camara: foto err " + e); aviso("No se pudo revisar la foto.", 2600); });
    };
    var onAccion = function(d){
      var t = d && d.tipo; anota("camara: accion " + t);
      if(t === "modo"){ K.modo = d.valor; if(K.ctx === "vehiculos" && (d.valor === "normal" || d.valor === "continuo")) ponerContinuo(d.valor === "continuo"); return; }
      if(t === "voz"){
        var v = $id("voice-alert-toggle");
        if(v){ if(v.checked !== !!d.valor){ v.checked = !!d.valor; v.dispatchEvent(new Event("change", { bubbles:true })); } }
        else { try{ W.localStorage.setItem("gw_voice_alerts", d.valor ? "1" : "0"); }catch(e){} }
        return;
      }
      if(t === "deshacer"){ deshacerUltimo(); return; }
      if(t === "ubicacion"){ prepararVolver(); setTimeout(function(){ var c = $id("scan-loc-chip"); if(c) c.click(); }, 60); return; }
      K.volver = null;
      if(t === "escribir"){ setTimeout(escribirAMano, 60); return; }
      if(t === "dictar"){ setTimeout(dictar, 60); return; }
      if(t === "foto"){ fotoAWeb(d.foto); return; }
    };
    var onCerrada = function(d){
      var m = (d && d.motivo) || "";
      K.abierta = false; K.abriendo = false;
      anota("camara: cerrada (" + m + ")");
      if(m === "usuario" || m === "atras" || m === "error"){
        K.volver = null;
        if(W.fzScanning && typeof W.fzCloseScan === "function"){ try{ W.fzCloseScan(); }catch(e){} }
      }
      despiertaRevisar(true);
      if(K.volver) vigilarVolver();
    };

    /* ---- 8.4 Volver a la cámara al cerrar la ventana (Vehículos) */
    var prepararVolver = function(){
      if(!CFG.volverTrasVentana || K.ctx !== "vehiculos") return;
      K.volver = { modo:K.modo, pantalla:pantallaActual(), desde:Date.now(), hasta:Date.now() + 600000 };
    };
    var hayVentana = function(){
      try{
        if(D.querySelector(".modal-bg.show")) return true;
        if(typeof W.pvIsOpen === "function" && W.pvIsOpen()) return true;
        if(D.body.classList.contains("fisico-open")) return true;
      }catch(e){}
      return false;
    };
    var vigilarVolver = function(){
      clearInterval(K.tVolver);
      K.tVolver = setInterval(function(){
        var v = K.volver;
        if(!v){ clearInterval(K.tVolver); return; }
        if(K.abierta || K.abriendo || D.visibilityState === "hidden") return;       // fuera de la app (foto de evidencia): se espera
        if(Date.now() > v.hasta || pantallaActual() !== v.pantalla || launcherAbierto()){ K.volver = null; clearInterval(K.tVolver); return; }
        if(Date.now() - v.desde < 700 || hayVentana()) return;
        K.volver = null; clearInterval(K.tVolver);
        abrirCamara(v.modo, "volver");
      }, 350);
    };

    /* ---- 8.5 Abrir */
    var contexto = function(){
      if(W.fzScanning){ var fz = vFZ(); return fz && fz.scanMode === "join" ? "fisico-unirse" : "fisico"; }
      var st = vState(); return st && st.appMode === "refacciones" ? "refacciones" : "vehiculos";
    };
    var opciones = function(pedido){
      var ctx = contexto(), st = vState();
      var modos = ctx === "vehiculos" ? ["normal", "continuo", "placa"] : ["normal"];
      var modo = pedido || (ctx === "vehiculos" && typeof W.continuousOn === "function" && W.continuousOn() ? "continuo" : "normal");
      if(modos.indexOf(modo) < 0) modo = "normal";
      var voz = null;
      if(ctx === "vehiculos"){ try{ voz = typeof W.voiceAlertsOn === "function" ? !!W.voiceAlertsOn() : true; }catch(e){ voz = true; } }
      return {
        modo:modo, modos:modos, contexto:ctx,
        titulo:{ vehiculos:"Vehículos", refacciones:"Refacciones", fisico:"Inventario físico", "fisico-unirse":"Entrar al inventario físico" }[ctx],
        pista:{ refacciones:"Apunta al código de la pieza", fisico:"Apunta al QR o al código de la etiqueta", "fisico-unirse":"Apunta al QR que muestra el administrador" }[ctx] || "",
        ubicacion: ctx === "vehiculos" ? String((st && st.myLocation) || "") : null,
        voz:voz, conFoto: ctx === "fisico", contador: ctx === "vehiculos" ? rondaN() : 0,
        acciones: ctx === "vehiculos" ? ["escribir", "foto", "dictar"] : ctx === "refacciones" ? ["escribir", "foto"] : ctx === "fisico" ? ["escribir"] : [],
        ocultarWeb: ls("witt-camara-web") !== "visible"
      };
    };
    var respaldo = function(op){
      anota("camara: respaldo " + op.modo + " · " + op.contexto);
      if(op.modo === "placa" && typeof W.readPlate === "function"){
        K.webHasta = Date.now() + 2500;
        var nb = D.querySelector('.nav:not(.fz-nav) button[data-screen="scan"]'); if(nb) nb.click();
        setTimeout(function(){ try{ W.readPlate(); }catch(e){} }, 120);
        return;
      }
      if(op.contexto === "fisico" || op.contexto === "fisico-unirse"){
        E.pasarWebHasta = Date.now() + 1500; var b = $id("btn-cam-start"); if(b && !b.disabled) b.click(); return;
      }
      if(E.escanear) E.escanear();
    };
    var abrirCamara = function(modo, origen){
      if(K.abierta || K.abriendo) return Promise.resolve(true);
      var op = opciones(modo);
      K.abriendo = true; K.modo = op.modo; K.ctx = op.contexto; K.volver = null; clearInterval(K.tVolver);
      try{ if(typeof W.noteLocActivity === "function") W.noteLocActivity(); }catch(e){}
      try{ if(E.ocultarSeguir) E.ocultarSeguir(); }catch(e){}
      anota("camara: abre " + op.modo + " · " + op.contexto + " (" + origen + ")");
      return llamar(WC, "abrir", op).then(function(){
        K.abriendo = false; K.abierta = true; K.fallos = 0; despiertaRevisar(true); return true;
      }, function(e){
        K.abriendo = false; K.abierta = false;
        var msg = String((e && (e.code || e.message)) || e || "");
        anota("camara: no abrió · " + msg);
        if(/permiso/i.test(msg)){
          aviso("Sin permiso de cámara: actívalo en Ajustes › Apps › Inventarios › Permisos.", 4500);
          if(W.fzScanning && typeof W.fzCloseScan === "function"){ try{ W.fzCloseScan(); }catch(x){} }
          return false;
        }
        K.fallos++;
        respaldo(op);
        return false;
      });
    };
    // Un solo punto para todos los botones de escanear (se llama primero desde el listener de la sección 1).
    E.camaraClic = function(ev){
      try{
        if(!camUsable() || Date.now() < K.webHasta) return false;
        var t = ev.target; if(!t || !t.closest) return false;
        var plate = t.closest("#btn-plate"), fab = t.closest("#fab-scan"), tab = t.closest('.nav:not(.fz-nav) button[data-screen="scan"]'), start = t.closest("#btn-cam-start");
        if(!plate && !fab && !tab && !start) return false;
        if(start && (start.disabled || Date.now() < E.pasarWebHasta || Date.now() < E.webHasta)) return false;   // respaldo y placas con la cámara web
        ev.preventDefault(); ev.stopImmediatePropagation();
        if(plate){
          var st = vState();
          if(!st || !st.recordsList || !st.recordsList.length){ try{ if(typeof W.toastError === "function") W.toastError("Primero carga el inventario."); else aviso("Primero carga el inventario."); }catch(e){} return true; }
          abrirCamara("placa", "leer placa");
          return true;
        }
        if(fab){ try{ E.vibrar && E.vibrar("toque"); }catch(e){} }
        abrirCamara(null, fab ? "boton verde" : tab ? "pestaña" : (W.fzScanning ? "fisico" : "iniciar camara"));
        return true;
      }catch(e){ return false; }
    };
    // Si la app pide apagar la cámara (otro módulo, selector, ventana), se cierra también la nativa.
    if(typeof W.stopCamera === "function"){
      var sc2 = W.stopCamera;
      W.stopCamera = function(){
        if(K.abierta || K.abriendo){
          if(R && R.activo) R.cerrar = true;
          else { anota("camara: stopCamera de la app"); callado(llamar(WC, "cerrar", {})); }
        }
        return sc2.apply(this, arguments);
      };
    }
    // Inventario físico: la foto chica de la pieza sale del cuadro en que la cámara nativa leyó el código.
    if(typeof W.fzGrabFrame === "function"){
      var fg0 = W.fzGrabFrame;
      W.fzGrabFrame = function(){
        var f = K.foto;
        if(f && Date.now() - f.t < 5000){
          K.foto = null;
          try{
            var fz = vFZ(); if(!fz || !fz.sid) return;
            var path = fz.sid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".jpg";
            var shot = { path:path, t:Date.now(), part:null, used:false };
            fz.shot = shot;
            fetch(f.url).then(function(r){ return r.blob(); }).then(function(blob){
              if(!blob) return;
              try{ if(typeof fzPhotoUrls !== "undefined") fzPhotoUrls.set(path, URL.createObjectURL(blob)); }catch(e){}   // eslint-disable-line no-undef
              if(typeof W.fzSb === "function"){
                shot.upload = W.fzSb().then(function(sb){ return sb.storage.from("fisico-fotos").upload(path, blob, { contentType:"image/jpeg", upsert:true }); })
                  .then(function(r){ if(r && r.error) throw r.error; return path; }).catch(function(){ return null; });
              }
            }).catch(function(){});
          }catch(e){}
          return;
        }
        return fg0.apply(this, arguments);
      };
    }

    if(camHay()){
      var pc = P(WC);
      if(pc && pc.addListener){
        callado(Promise.resolve(pc.addListener("codigo", function(d){ try{ onCodigo(d); }catch(e){ anota("camara: codigo err " + e); } })));
        callado(Promise.resolve(pc.addListener("placa", function(d){ try{ onPlaca(d); }catch(e){ anota("camara: placa err " + e); } })));
        callado(Promise.resolve(pc.addListener("accion", function(d){ try{ onAccion(d); }catch(e){ anota("camara: accion err " + e); } })));
        callado(Promise.resolve(pc.addListener("cerrada", function(d){ try{ onCerrada(d); }catch(e){} })));
      }
      callado(llamar(WC, "cerrar", {}));   // si la página se recargó con la cámara abierta, se cierra (nadie la escucharía)
      try{ D.documentElement.classList.add("witt-camara"); }catch(e){}
    }
    E.abrirCamara = abrirCamara;
  }catch(e){ anota("camara: init err " + e); }

  try{
    W.__wittNativa = { version:VERSION, config:CFG, log:E.log,
      estado:function(){ return { abierto:E.abierto, despierta:E.despierta, modulo:E.modulo, soportado:E.soportado, fisicoNativo:CFG.fisicoNativo,
        camara: E.camara ? { abierta:E.camara.abierta, modo:E.camara.modo, contexto:E.camara.ctx, volver:!!E.camara.volver, fallos:E.camara.fallos, avisos:E.camara.avisos,
          plugin: (function(){ try{ return !!C.isPluginAvailable("WittCamara"); }catch(e){ return false; } })() } : null }; },
      escanear:function(){ return E.escanear && E.escanear(); }, atras:function(){ return E.atras(); }, despierta:function(){ despiertaRevisar(true); },
      camara:function(modo){ return E.abrirCamara ? E.abrirCamara(modo || null, "consola") : Promise.resolve(false); } };
  }catch(e){}
})();
