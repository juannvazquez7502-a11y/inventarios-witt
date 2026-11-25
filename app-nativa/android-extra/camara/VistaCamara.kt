package mx.grupowitt.inventarios.camara

// Pantalla de la cámara (encima de la página, en la misma Activity: la página sigue viva y contesta al instante).
// - CameraX: vista previa nativa (SurfaceView, la dibuja el compositor del sistema, no la página) pidiendo a la cámara
//   un rango de hasta 60 fps si lo tiene; enfoque continuo, toque para enfocar, pellizco y deslizador para el zoom,
//   doble toque para acercar, linterna.
// - Ajustes DENTRO de la cámara: modo Normal / Continuo / Placa, linterna, zoom, avisos con voz, ubicación actual,
//   Escribir a mano, Foto y Dictar, y cerrar.
// - Marco y tarjeta que RESPIRAN en verde, amarillo o rojo (animación nativa de opacidad: no redibuja nada).
// Mientras está abierta, la página se vuelve transparente (alpha 0, sigue "visible" para Android y su JavaScript corre
// igual) para que no gaste GPU dibujándose debajo de la cámara.

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.Base64
import android.util.Log
import android.util.Range
import android.util.Size
import android.util.TypedValue
import android.view.Choreographer
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.PathInterpolator
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.ZoomState
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
private const val ANTIREBOTE_MS = 2500L
private const val ESPERA_MS = 2600L
private val VERDE_WITT = Color.rgb(0, 87, 74)          // #00574a
private val VERDE_WITT_CLARO = Color.rgb(31, 163, 131)
private val C_VERDE = Color.rgb(52, 199, 89)
private val C_AMARILLO = Color.rgb(255, 204, 0)
private val C_ROJO = Color.rgb(255, 59, 48)
private val C_NEUTRO = Color.rgb(225, 230, 230)

@SuppressLint("ClickableViewAccessibility", "SetTextI18n")
class VistaCamara(
    private val act: AppCompatActivity,
    private val web: View,
    private val avisos: Avisos,
    private val emitir: (String, JSObject) -> Unit
) {
    private val ctx: Context = act
    private val principal = Handler(Looper.getMainLooper())
    private val densidad = act.resources.displayMetrics.density
    private fun dp(v: Float): Float = v * densidad
    private fun dpi(v: Float): Int = (v * densidad).roundToInt()

    var abierta = false
        private set
    private var cerrando = false
    private var sesion = 0
    private var op: Opciones? = null
    private var modo = "normal"
    private var voz: Boolean? = null
    private var linterna = false
    private var contadorN = 0
    private var tomando = false

    // vistas
    private var construida = false
    private lateinit var raiz: FrameLayout
    private lateinit var previa: PreviewView
    private lateinit var mira: Mira
    private lateinit var marco: MarcoRespira
    private lateinit var destelloV: View
    private lateinit var anillo: View
    private lateinit var arriba: LinearLayout
    private lateinit var titulo: TextView
    private lateinit var chipUbicacion: LinearLayout
    private lateinit var textoUbicacion: TextView
    private lateinit var btnCerrar: FrameLayout
    private lateinit var btnVoz: FrameLayout
    private lateinit var btnLinterna: FrameLayout
    private lateinit var pista: TextView
    private lateinit var abajo: LinearLayout
    private lateinit var tarjeta: FrameLayout
    private lateinit var tarjetaFondo: GradientDrawable
    private lateinit var tarjetaBrillo: View
    private lateinit var tarjetaBrilloFondo: GradientDrawable
    private lateinit var tarjetaPunto: GradientDrawable
    private lateinit var tarjetaTitulo: TextView
    private lateinit var tarjetaDetalle: TextView
    private lateinit var tarjetaDeshacer: TextView
    private lateinit var contador: TextView
    private lateinit var filaZoom: LinearLayout
    private lateinit var zoomTexto: TextView
    private lateinit var zoomBarra: SeekBar
    private lateinit var segmento: LinearLayout
    private val botonesModo = LinkedHashMap<String, TextView>()
    private lateinit var filaAcciones: LinearLayout
    private val botonesAccion = LinkedHashMap<String, View>()

    // cámara
    private var proveedor: ProcessCameraProvider? = null
    private var camara: Camera? = null
    private var preview: Preview? = null
    private var analisis: ImageAnalysis? = null
    private var captura: ImageCapture? = null
    private var ejecutor: ExecutorService? = null
    private var analizador: Analizador? = null
    private var rango: Range<Int>? = null
    private val cuadrosCamara = AtomicInteger(0)
    private var fpsCamara = 0f
    private var tMedir = 0L
    // Cuadros de la pantalla (vsync del hilo principal) mientras la cámara está abierta: si baja de ~60, algo traba el hilo.
    private var cuadrosUi = 0
    private var fpsUi = 0f
    private val vsync = object : Choreographer.FrameCallback {
        override fun doFrame(t: Long) { cuadrosUi++; if (abierta) Choreographer.getInstance().postFrameCallback(this) }
    }

    // lectura
    private var esperando = false
    private var ultimoCodigo = ""
    private var ultimoT = 0L
    private val votacion = Votacion()
    private var animMarco: Animator? = null
    private var animBrillo: Animator? = null
    private var atras: OnBackPressedCallback? = null

    private val finEspera = Runnable { if (abierta && !cerrando) reanudar() }
    private val ocultarTarjeta = Runnable { ocultarAviso(false) }
    private val restaurarPista = Runnable { pintarPista() }
    private val medir = object : Runnable {
        override fun run() {
            if (!abierta) return
            val ahora = SystemClock.elapsedRealtime()
            val n = cuadrosCamara.getAndSet(0)
            val nUi = cuadrosUi; cuadrosUi = 0
            if (tMedir > 0) { fpsCamara = n * 1000f / max(1L, ahora - tMedir); fpsUi = nUi * 1000f / max(1L, ahora - tMedir) }
            tMedir = ahora
            Log.i(TAG, String.format(Locale.US, "fps camara=%.1f pantalla=%.1f analisis=%.1f ms/cuadro=%.0f rango=%s modo=%s",
                fpsCamara, fpsUi, analizador?.fps ?: 0f, analizador?.msPorCuadro ?: 0f, rangoTexto(), modo))
            principal.postDelayed(this, 2000)
        }
    }

    // ------------------------------------------------------------------ abrir y cerrar

    fun abrir(o: Opciones, listo: (String?) -> Unit) {
        construir()
        if (abierta && !cerrando) { aplicar(o); reanudar(); listo(null); return }
        if (abierta) cerrar("reabrir", 0)
        sesion++
        aplicar(o)
        cerrando = false; esperando = false; ultimoCodigo = ""; ultimoT = 0L; tomando = false
        votacion.reiniciar()
        ocultarAviso(true)
        val decor = act.window.decorView as ViewGroup
        raiz.animate().cancel()
        (raiz.parent as? ViewGroup)?.removeView(raiz)
        decor.addView(raiz, ViewGroup.LayoutParams(MATCH, MATCH))
        margenes()
        raiz.alpha = 0f
        raiz.animate().setStartDelay(0).alpha(1f).setDuration(150).start()
        if (o.ocultarWeb) web.alpha = 0f
        ocultarTeclado()
        act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        atras?.remove()
        val cb = object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { cerrar("atras", 0) } }
        act.onBackPressedDispatcher.addCallback(act, cb)
        atras = cb
        abierta = true
        tMedir = 0L
        Choreographer.getInstance().removeFrameCallback(vsync)
        Choreographer.getInstance().postFrameCallback(vsync)
        iniciarCamara(listo)
    }

    fun cerrar(motivo: String, tras: Long) {
        if (!abierta) return
        if (tras > 0) {
            cerrando = true
            analizador?.activo = false
            val s = sesion
            principal.postDelayed({ if (s == sesion) cerrar(motivo, 0) }, tras)
            return
        }
        abierta = false; cerrando = false; esperando = false; sesion++
        principal.removeCallbacks(finEspera); principal.removeCallbacks(ocultarTarjeta)
        principal.removeCallbacks(medir); principal.removeCallbacks(restaurarPista)
        Choreographer.getInstance().removeFrameCallback(vsync)
        analizador?.activo = false
        if (linterna) {
            try { camara?.cameraControl?.enableTorch(false) } catch (_: Throwable) {}
            linterna = false; pintarLinterna()
        }
        desenlazar()
        atras?.remove(); atras = null
        act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.alpha = 1f
        animMarco?.cancel(); animBrillo?.cancel()
        val r = raiz
        r.animate().setStartDelay(0).alpha(0f).setDuration(130).withEndAction {
            if (!abierta) (r.parent as? ViewGroup)?.removeView(r)
        }.start()
        Log.i(TAG, "cerrada: $motivo")
        emitir("cerrada", JSObject().put("motivo", motivo))
    }

    fun destruir() {
        try { cerrar("destruir", 0) } catch (_: Throwable) {}
        try { analizador?.cerrar() } catch (_: Throwable) {}
        analizador = null
        try { ejecutor?.shutdown() } catch (_: Throwable) {}
        ejecutor = null
    }

    private fun iniciarCamara(listo: (String?) -> Unit) {
        val s = sesion
        val fut = ProcessCameraProvider.getInstance(ctx)
        fut.addListener({
            if (s != sesion || !abierta) { listo("La cámara se cerró antes de abrir"); return@addListener }
            try {
                val p = fut.get()
                proveedor = p
                enlazar(p)
                principal.removeCallbacks(medir)
                principal.postDelayed(medir, 2000)
                listo(null)
            } catch (e: Throwable) {
                Log.e(TAG, "no abrió la cámara", e)
                cerrar("error", 0)
                listo("No se pudo abrir la cámara: " + (e.message ?: e.javaClass.simpleName))
            }
        }, ContextCompat.getMainExecutor(ctx))
    }

    @androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
    private fun enlazar(p: ProcessCameraProvider) {
        val sel = CameraSelector.DEFAULT_BACK_CAMERA
        if (!p.hasCamera(sel)) throw IllegalStateException("Este teléfono no tiene cámara trasera")
        val info = try { sel.filter(p.availableCameraInfos).firstOrNull() } catch (e: Throwable) { null }
        val elegido = info?.let { elegirRango(it) }
        val ex = ejecutor ?: Executors.newSingleThreadExecutor().also { ejecutor = it }
        val an = analizador ?: Analizador(ex) { r -> principal.post { recibir(r) } }.also { analizador = it }
        an.modo = modo; an.conFoto = op?.conFoto == true; an.activo = true
        desenlazar()
        var error: Throwable? = null
        val intentos = if (elegido != null) listOf(elegido, null) else listOf<Range<Int>?>(null)
        for (r in intentos) {
            try {
                val pb = Preview.Builder().setResolutionSelector(
                    ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY).build()
                )
                val ext = Camera2Interop.Extender(pb)
                if (r != null) ext.setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, r)
                ext.setSessionCaptureCallback(object : CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(sesionCam: CameraCaptureSession, peticion: CaptureRequest, res: TotalCaptureResult) {
                        cuadrosCamara.incrementAndGet()
                    }
                })
                val pv = pb.build()
                pv.setSurfaceProvider(previa.surfaceProvider)
                val ia = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                            .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                    .build()
                ia.setAnalyzer(ex, an)
                camara = p.bindToLifecycle(act, sel, pv, ia)
                preview = pv; analisis = ia; rango = r
                error = null
                break
            } catch (e: Throwable) {
                error = e
                Log.w(TAG, "enlazar (rango=${r ?: "auto"})", e)
                try { p.unbindAll() } catch (_: Throwable) {}
            }
        }
        error?.let { throw it }
        val cam = camara ?: throw IllegalStateException("sin cámara")
        cam.cameraInfo.zoomState.removeObservers(act)
        cam.cameraInfo.zoomState.observe(act) { z -> mostrarZoom(z) }
        cam.cameraInfo.cameraState.removeObservers(act)
        cam.cameraInfo.cameraState.observe(act) { st ->
            st.error?.let { Log.w(TAG, "estado de la cámara: error ${it.code}"); pistaTemporal("La cámara tuvo un problema (código ${it.code})") }
        }
        btnLinterna.visibility = if (cam.cameraInfo.hasFlashUnit()) View.VISIBLE else View.GONE
        if (op?.modos?.contains("placa") == true) {
            val s = sesion
            principal.postDelayed({ if (s == sesion) analizador?.precalentarTexto() }, if (modo == "placa") 0L else 1500L)
        }
        Log.i(TAG, "cámara abierta: rango=${rangoTexto()} modo=$modo")
    }

    // Rango de fps: el que llegue a 60 (preferido el que baja hasta ~30 para tener luz en lugares oscuros).
    @androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
    private fun elegirRango(info: CameraInfo): Range<Int>? {
        val rs = try {
            Camera2CameraInfo.from(info).getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        } catch (e: Throwable) { null } ?: return null
        Log.i(TAG, "rangos de fps de la cámara: " + rs.joinToString { "[${it.lower},${it.upper}]" })
        return rs.filter { it.upper >= 60 }.minWithOrNull(compareBy<Range<Int>>({ abs(it.lower - 30) }, { it.upper }))
    }

    private fun rangoTexto(): String = rango?.let { "${it.lower}-${it.upper}" } ?: "auto"

    private fun desenlazar() {
        val p = proveedor
        try { camara?.cameraInfo?.zoomState?.removeObservers(act) } catch (_: Throwable) {}
        try { camara?.cameraInfo?.cameraState?.removeObservers(act) } catch (_: Throwable) {}
        try { analisis?.clearAnalyzer() } catch (_: Throwable) {}
        if (p != null) {
            val casos = listOfNotNull(preview, analisis, captura)
            if (casos.isNotEmpty()) try { p.unbind(*casos.toTypedArray()) } catch (e: Throwable) { Log.w(TAG, "unbind", e) }
        }
        preview = null; analisis = null; captura = null; camara = null
    }

    // ------------------------------------------------------------------ lecturas

    private fun recibir(r: Resultado) {
        if (!abierta || cerrando) return
        if (r.tipo == "codigo") codigo(r) else texto(r)
    }

    private fun codigo(r: Resultado) {
        if (!r.deFoto) {
            if (modo == "placa" || esperando) return
            val ahora = SystemClock.elapsedRealtime()
            // Anti-rebote: el mismo código no se repite en 2.5 s (mientras siga a la vista, no se repite).
            if (r.texto == ultimoCodigo && ahora - ultimoT < ANTIREBOTE_MS) { ultimoT = ahora; return }
            ultimoCodigo = r.texto; ultimoT = ahora
        }
        mira.pulso()
        esperar()
        val o = JSObject()
        o.put("texto", r.texto)
        o.put("formato", r.formato)
        o.put("modo", if (r.deFoto) "foto" else modo)
        if (r.foto != null) o.put("foto", r.foto)
        Log.i(TAG, "codigo ${r.formato} modo=$modo ${r.texto.take(40)}")
        emitir("codigo", o)
    }

    private fun texto(r: Resultado) {
        if (modo != "placa") return
        if (esperando && !r.deFoto) return
        val cands = Placas.candidatos(r.lineas)
        val dec: Candidato? = if (r.deFoto) cands.maxByOrNull { it.peso } else votacion.agregar(cands, SystemClock.elapsedRealtime())
        if (dec == null) {
            votacion.mejor()?.let { (t, v) -> pista.text = "Leyendo: $t ($v)" }
            return
        }
        mira.pulso()
        esperar()
        val lista = if (r.deFoto) cands.sortedByDescending { it.peso }.map { it.texto }.take(5) else votacion.top(5)
        val o = JSObject()
        o.put("texto", dec.texto)
        o.put("tipo", dec.tipo)
        o.put("votos", dec.peso)
        o.put("candidatos", JSArray(lista))
        Log.i(TAG, "placa ${dec.tipo} ${dec.texto} votos=${dec.peso}")
        pista.text = "Leído: ${dec.texto}"
        emitir("placa", o)
    }

    private fun esperar() {
        esperando = true
        analizador?.activo = false
        principal.removeCallbacks(finEspera)
        principal.postDelayed(finEspera, ESPERA_MS)
    }

    fun reanudar() {
        principal.removeCallbacks(finEspera)
        esperando = false
        if (!abierta || cerrando) return
        if (modo == "placa") votacion.reiniciar()
        analizador?.activo = true
    }

    // Solo APK de prueba: analiza una imagen de assets/witt-prueba como si fuera un cuadro de la cámara.
    fun probar(nombre: String): Boolean {
        val bmp = Prueba.cargar(ctx, nombre) ?: return false
        val an = analizador ?: return false
        an.analizarBitmap(bmp, modo == "placa", deFoto = false, forzar = false)
        return true
    }

    // ------------------------------------------------------------------ aviso de la web (respiración por color)

    fun feedback(f: Feedback) {
        principal.removeCallbacks(finEspera)
        f.contador?.let { mostrarContador(it) }
        if (f.color != "neutro" || f.titulo.isNotEmpty()) mostrarAviso(f)
        else ocultarAviso(false)   // neutro sin texto: quita el aviso anterior (también uno que respiraba sin parar)
        if (f.sonido || f.vibrar) avisos.dar(f.color, f.sonido, f.vibrar)
        Log.i(TAG, "feedback color=${f.color} cerrar=${f.cerrar} titulo=${f.titulo}")
        if (f.cerrar) { cerrar("web", max(0L, f.cerrarEn)); return }
        val s = sesion
        principal.postDelayed({ if (s == sesion) reanudar() }, if (modo == "continuo") 300L else 0L)
    }

    fun actualizar(ubicacion: String?, v: Boolean?, n: Int?, m: String?) {
        if (!construida) return
        if (ubicacion != null) pintarUbicacion(ubicacion)
        if (v != null) { voz = v; pintarVoz() }
        if (n != null) mostrarContador(n)
        if (m != null) cambiarModo(m, false)
    }

    private fun colorDe(c: String): Int = when (c) {
        "verde" -> C_VERDE; "amarillo" -> C_AMARILLO; "rojo" -> C_ROJO; else -> C_NEUTRO
    }

    private fun mostrarAviso(f: Feedback) {
        val c = colorDe(f.color)
        marco.color = c
        tarjetaFondo.setStroke(dpi(2f), c)
        tarjetaBrilloFondo.setColor(c)
        tarjetaPunto.setColor(c)
        tarjetaTitulo.text = f.titulo.ifEmpty {
            when (f.color) { "verde" -> "Listo"; "amarillo" -> "Revisa esta unidad"; "rojo" -> "No está en el inventario"; else -> "Leído" }
        }
        tarjetaDetalle.text = f.detalle
        tarjetaDetalle.visibility = if (f.detalle.isEmpty()) View.GONE else View.VISIBLE
        tarjetaDeshacer.visibility = if (f.deshacer) View.VISIBLE else View.GONE
        principal.removeCallbacks(ocultarTarjeta)
        tarjeta.visibility = View.VISIBLE
        tarjeta.animate().cancel()
        if (tarjeta.alpha < 0.99f) {
            tarjeta.alpha = 0f; tarjeta.translationY = dp(14f)
            tarjeta.animate().setStartDelay(0).alpha(1f).translationY(0f).setDuration(170).setInterpolator(DecelerateInterpolator()).start()
        }
        respirar(f)
        if (!f.mantener) {
            val dur = when (f.color) { "verde" -> 1700L; "amarillo" -> 2800L; "rojo" -> 3400L; else -> 1300L } + (if (f.deshacer) 3800L else 0L)
            principal.postDelayed(ocultarTarjeta, dur)
        }
    }

    // Pulso suave de brillo: el marco y el brillo de la tarjeta suben y bajan de opacidad (verde 1 vez, amarillo 2,
    // rojo 3; "mantener" = sigue respirando hasta el siguiente aviso).
    private fun respirar(f: Feedback) {
        animMarco?.cancel(); animBrillo?.cancel()
        val ciclos = when (f.color) { "verde" -> 1; "amarillo" -> 2; "rojo" -> 3; else -> 1 }
        val medio = if (f.color == "rojo") 380L else 480L
        val curva = PathInterpolator(0.4f, 0f, 0.2f, 1f)
        val repetir = if (f.mantener) ValueAnimator.INFINITE else ciclos * 2 - 1
        marco.visibility = if (f.color == "neutro") View.INVISIBLE else View.VISIBLE
        val a = ObjectAnimator.ofFloat(marco, View.ALPHA, 0.2f, 1f).apply {
            duration = medio; interpolator = curva
            repeatMode = ValueAnimator.REVERSE; repeatCount = repetir
            addListener(object : AnimatorListenerAdapter() {
                private var cancelada = false
                override fun onAnimationCancel(animation: Animator) { cancelada = true }
                override fun onAnimationEnd(animation: Animator) {
                    if (!cancelada) marco.animate().setStartDelay(0).alpha(0f).setDuration(420).start()
                }
            })
        }
        val b = ObjectAnimator.ofFloat(tarjetaBrillo, View.ALPHA, 0.06f, 0.36f).apply {
            duration = medio; interpolator = curva
            repeatMode = ValueAnimator.REVERSE; repeatCount = repetir
            addListener(object : AnimatorListenerAdapter() {
                private var cancelada = false
                override fun onAnimationCancel(animation: Animator) { cancelada = true }
                override fun onAnimationEnd(animation: Animator) {
                    if (!cancelada) tarjetaBrillo.animate().setStartDelay(0).alpha(0.1f).setDuration(420).start()
                }
            })
        }
        marco.animate().cancel(); tarjetaBrillo.animate().cancel()
        a.start(); b.start()
        animMarco = a; animBrillo = b
    }

    private fun ocultarAviso(inmediato: Boolean) {
        if (!construida) return
        principal.removeCallbacks(ocultarTarjeta)
        animMarco?.cancel(); animBrillo?.cancel()
        if (inmediato) {
            tarjeta.animate().cancel(); tarjeta.alpha = 0f; tarjeta.visibility = View.GONE
            marco.animate().cancel(); marco.alpha = 0f
            return
        }
        tarjeta.animate().setStartDelay(0).alpha(0f).translationY(dp(8f)).setDuration(220).withEndAction {
            if (tarjeta.alpha < 0.01f) tarjeta.visibility = View.GONE
        }.start()
        marco.animate().setStartDelay(0).alpha(0f).setDuration(300).start()
    }

    private fun mostrarContador(n: Int) {
        contadorN = n
        if (!construida) return
        contador.text = "Llevas $n registrada${if (n == 1) "" else "s"} en esta ronda"
        contador.visibility = if (modo == "continuo" && n > 0) View.VISIBLE else View.GONE
    }

    // ------------------------------------------------------------------ ajustes

    private fun cambiarModo(m: String, avisarWeb: Boolean) {
        val o = op
        if (m == modo || (o != null && !o.modos.contains(m))) return
        modo = m
        analizador?.modo = m
        votacion.reiniciar(); ultimoCodigo = ""
        if (esperando) reanudar()
        pintarModo()
        mostrarContador(contadorN)
        if (avisarWeb) emitirAccion("modo", m)
    }

    private fun alternarLinterna() {
        val cam = camara ?: return
        linterna = !linterna
        try { cam.cameraControl.enableTorch(linterna) } catch (_: Throwable) { linterna = false }
        pintarLinterna()
    }

    private fun alternarVoz() {
        val v = !(voz ?: true)
        voz = v
        pintarVoz()
        emitirAccion("voz", v)
    }

    private fun enfocar(x: Float, y: Float) {
        val cam = camara ?: return
        try {
            val p = previa.meteringPointFactory.createPoint(x, y)
            val a = FocusMeteringAction.Builder(p, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(3, TimeUnit.SECONDS).build()
            cam.cameraControl.startFocusAndMetering(a)
        } catch (_: Throwable) {}
        val lado = dp(72f)
        anillo.animate().cancel()
        anillo.x = x - lado / 2f; anillo.y = y - lado / 2f
        anillo.alpha = 1f; anillo.scaleX = 1.35f; anillo.scaleY = 1.35f
        anillo.animate().setStartDelay(0).scaleX(1f).scaleY(1f).setDuration(200).withEndAction {
            anillo.animate().setStartDelay(450).alpha(0f).setDuration(250).start()
        }.start()
    }

    private fun zoomDoble() {
        val cam = camara ?: return
        val z = cam.cameraInfo.zoomState.value
        val objetivo = if (z != null && z.zoomRatio > 1.4f) 1f else min(2.5f, z?.maxZoomRatio ?: 2.5f)
        try { cam.cameraControl.setZoomRatio(objetivo) } catch (_: Throwable) {}
    }

    private fun mostrarZoom(z: ZoomState) {
        zoomTexto.text = String.format(Locale.US, "%.1f×", z.zoomRatio)
        if (!zoomBarra.isPressed) zoomBarra.progress = (z.linearZoom * 100f).roundToInt()
        filaZoom.visibility = if (z.maxZoomRatio > 1.05f) View.VISIBLE else View.GONE
    }

    private fun emitirAccion(tipo: String, valor: Any?) {
        val o = JSObject().put("tipo", tipo)
        when (valor) {
            is Boolean -> o.put("valor", valor)
            is String -> o.put("valor", valor)
            is Int -> o.put("valor", valor)
        }
        emitir("accion", o)
    }

    private fun accionYCerrar(tipo: String) {
        emitirAccion(tipo, null)
        cerrar(tipo, 0)
    }

    // Foto: toma una foto en alta resolución y busca el código ahí (sirve para hologramas y códigos chicos). Si no
    // encuentra nada, la manda a la página para que la revise con sus propios lectores ("Escanear desde foto").
    private fun tomarFoto() {
        val p = proveedor ?: return
        if (camara == null || tomando) return
        tomando = true
        val s = sesion
        pistaTemporal("Tomando la foto…")
        try {
            val ic = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setResolutionStrategy(ResolutionStrategy(Size(2560, 1920), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                        .build()
                )
                .build()
            var sinAnalisis = false
            try {
                p.bindToLifecycle(act, CameraSelector.DEFAULT_BACK_CAMERA, ic)
            } catch (e: Throwable) {
                analisis?.let { p.unbind(it) }
                sinAnalisis = true
                p.bindToLifecycle(act, CameraSelector.DEFAULT_BACK_CAMERA, ic)
            }
            captura = ic
            val quitarAnalisis = sinAnalisis
            ic.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val rot = image.imageInfo.rotationDegrees
                    val bmp = try { girar(image.toBitmap(), rot, 2400) } catch (e: Throwable) { null } finally { image.close() }
                    terminarFoto(ic, quitarAnalisis)
                    if (s != sesion || !abierta) { tomando = false; return }
                    destello()
                    val an = analizador
                    if (bmp == null || an == null) { tomando = false; pistaTemporal("No se pudo tomar la foto"); return }
                    an.analizarBitmap(bmp, modo == "placa", deFoto = true, forzar = true) { ok ->
                        principal.post {
                            tomando = false
                            if (!ok && s == sesion && abierta) enviarFotoAWeb(bmp)
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.w(TAG, "foto", exception)
                    terminarFoto(ic, quitarAnalisis)
                    tomando = false
                    pistaTemporal("No se pudo tomar la foto")
                }
            })
        } catch (e: Throwable) {
            Log.w(TAG, "foto", e)
            tomando = false
            pistaTemporal("No se pudo tomar la foto")
        }
    }

    private fun terminarFoto(ic: ImageCapture, reenlazarAnalisis: Boolean) {
        val p = proveedor ?: return
        try { p.unbind(ic) } catch (_: Throwable) {}
        if (captura === ic) captura = null
        if (reenlazarAnalisis && abierta) {
            analisis?.let { ia -> try { p.bindToLifecycle(act, CameraSelector.DEFAULT_BACK_CAMERA, ia) } catch (e: Throwable) { Log.w(TAG, "reenlazar", e) } }
        }
    }

    private fun girar(b: Bitmap, rot: Int, maxLado: Int): Bitmap {
        val s = min(1f, maxLado.toFloat() / max(b.width, b.height))
        if (rot == 0 && s >= 1f) return b
        val m = Matrix(); m.postRotate(rot.toFloat()); m.postScale(s, s)
        return Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
    }

    private fun enviarFotoAWeb(bmp: Bitmap) {
        val s = sesion
        val ex = ejecutor ?: return
        pistaTemporal("No vi un código: la app revisa la foto…")
        ex.execute {
            val dato = try {
                val o = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 85, o)
                "data:image/jpeg;base64," + Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP)
            } catch (e: Throwable) { null }
            principal.post {
                if (s != sesion || !abierta) return@post
                if (dato == null) { pistaTemporal("No se pudo leer la foto"); return@post }
                emitir("accion", JSObject().put("tipo", "foto").put("foto", dato))
                cerrar("foto", 0)
            }
        }
    }

    private fun destello() {
        destelloV.animate().cancel()
        destelloV.alpha = 0.6f
        destelloV.animate().setStartDelay(0).alpha(0f).setDuration(240).start()
    }

    private fun ocultarTeclado() {
        try {
            val imm = ctx.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.hideSoftInputFromWindow(web.windowToken, 0)
            web.clearFocus()
        } catch (_: Throwable) {}
    }

    // ------------------------------------------------------------------ pintar

    private fun aplicar(o: Opciones) {
        op = o
        titulo.text = o.titulo
        val ub = o.ubicacion
        if (ub == null) chipUbicacion.visibility = View.GONE else { chipUbicacion.visibility = View.VISIBLE; pintarUbicacion(ub) }
        voz = o.voz
        pintarVoz()
        for ((k, b) in botonesModo) b.visibility = if (o.modos.contains(k)) View.VISIBLE else View.GONE
        segmento.visibility = if (o.modos.size > 1) View.VISIBLE else View.GONE
        for ((k, b) in botonesAccion) b.visibility = if (o.acciones.contains(k)) View.VISIBLE else View.GONE
        filaAcciones.visibility = if (o.acciones.any { botonesAccion.containsKey(it) }) View.VISIBLE else View.GONE
        modo = o.modo
        analizador?.modo = modo
        analizador?.conFoto = o.conFoto
        pintarModo()
        mostrarContador(o.contador)
        pintarLinterna()
    }

    private fun pintarUbicacion(ub: String) {
        textoUbicacion.text = if (ub.isEmpty()) "Elegir ubicación" else ub
        chipUbicacion.contentDescription = "Ubicación: " + (if (ub.isEmpty()) "sin elegir" else ub) + ". Toca para cambiarla"
    }

    private fun pintarModo() {
        for ((k, b) in botonesModo) {
            val sel = k == modo
            b.background = if (sel) redondo(VERDE_WITT, 20f, Color.argb(150, 31, 163, 131)) else null
            b.setTextColor(if (sel) Color.WHITE else Color.argb(205, 255, 255, 255))
            b.isSelected = sel
        }
        mira.placa = modo == "placa"
        pintarPista()
    }

    private fun pintarPista() {
        if (!construida) return
        pista.text = when (modo) {
            "placa" -> "Pon la placa o el VIN dentro del recuadro"
            "continuo" -> "Escaneo continuo: cada unidad se registra sola"
            else -> op?.pista?.takeIf { it.isNotEmpty() } ?: "Apunta al código de barras o al QR"
        }
    }

    private fun pistaTemporal(t: String) {
        if (!construida) return
        principal.removeCallbacks(restaurarPista)
        pista.text = t
        principal.postDelayed(restaurarPista, 2400)
    }

    private fun pintarLinterna() {
        if (!construida) return
        (btnLinterna.tag as? Icono)?.cambiar(if (linterna) Trazos.LINTERNA else Trazos.LINTERNA_NO)
        fondoBoton(btnLinterna, linterna)
        btnLinterna.contentDescription = if (linterna) "Apagar la linterna" else "Prender la linterna"
    }

    private fun pintarVoz() {
        if (!construida) return
        val v = voz
        btnVoz.visibility = if (v == null) View.GONE else View.VISIBLE
        if (v == null) return
        (btnVoz.tag as? Icono)?.cambiar(if (v) Trazos.VOZ else Trazos.VOZ_NO)
        fondoBoton(btnVoz, v)
        btnVoz.contentDescription = if (v) "Avisos con voz: sí" else "Avisos con voz: no"
    }

    private fun redondo(color: Int, radio: Float, borde: Int): GradientDrawable = GradientDrawable().apply {
        cornerRadius = dp(radio); setColor(color)
        if (borde != 0) setStroke(dpi(1f), borde)
    }

    private fun fondoBoton(v: View, activo: Boolean) {
        val base = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(if (activo) VERDE_WITT else Color.argb(95, 0, 0, 0))
            if (activo) setStroke(dpi(1f), VERDE_WITT_CLARO)
        }
        v.background = RippleDrawable(ColorStateList.valueOf(Color.argb(80, 255, 255, 255)), base, null)
    }

    private fun texto(sp: Float, color: Int, negrita: Boolean): TextView = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        if (negrita) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setShadowLayer(dp(3f), 0f, dp(1f), Color.argb(120, 0, 0, 0))
    }

    private fun boton(datos: String, desc: String, accion: () -> Unit): FrameLayout {
        val f = FrameLayout(ctx)
        fondoBoton(f, false)
        f.contentDescription = desc
        f.isClickable = true
        f.isFocusable = true
        f.setOnClickListener { accion() }
        val ic = Icono(ctx, datos)
        f.addView(ic, FrameLayout.LayoutParams(MATCH, MATCH))
        f.tag = ic
        return f
    }

    private fun botonAccion(clave: String, datos: String, nombre: String, accion: () -> Unit): LinearLayout {
        val l = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dpi(12f), dpi(8f), dpi(12f), dpi(6f))
            minimumWidth = dpi(84f)
            background = RippleDrawable(ColorStateList.valueOf(Color.argb(70, 255, 255, 255)), redondo(Color.argb(70, 255, 255, 255), 18f, 0), null)
            isClickable = true; isFocusable = true
            contentDescription = nombre
            setOnClickListener { accion() }
        }
        val ic = Icono(ctx, datos).apply { escala = 0.92f }
        l.addView(ic, LinearLayout.LayoutParams(dpi(26f), dpi(26f)))
        // WRAP_CONTENT: con el MATCH_PARENT por defecto el texto tomaba el ancho del ícono y se cortaba ("Escr", "Dict").
        l.addView(texto(12.5f, Color.WHITE, true).apply { text = nombre; gravity = Gravity.CENTER; maxLines = 1; setPadding(0, dpi(3f), 0, 0) },
            LinearLayout.LayoutParams(WRAP, WRAP))
        botonesAccion[clave] = l
        return l
    }

    private fun margenes() {
        val ins = ViewCompat.getRootWindowInsets(act.window.decorView)
        val b = ins?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val arr = b?.top ?: 0; val izq = b?.left ?: 0; val der = b?.right ?: 0; val aba = b?.bottom ?: 0
        (arriba.layoutParams as? FrameLayout.LayoutParams)?.let { it.setMargins(dpi(12f) + izq, dpi(8f) + arr, dpi(12f) + der, 0); arriba.layoutParams = it }
        abajo.setPadding(dpi(14f) + izq, dpi(30f), dpi(14f) + der, dpi(14f) + aba)
    }

    private fun construir() {
        if (construida) return
        raiz = FrameLayout(ctx).apply {
            setBackgroundColor(Color.BLACK)
            isClickable = true; isFocusable = true
            contentDescription = "Cámara Witt"
        }
        previa = PreviewView(ctx).apply {
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        raiz.addView(previa, FrameLayout.LayoutParams(MATCH, MATCH))
        mira = Mira(ctx)
        raiz.addView(mira, FrameLayout.LayoutParams(MATCH, MATCH))
        // Capa de GPU propia: la respiración solo cambia la opacidad de esa capa (el RenderThread la compone, no se
        // vuelve a dibujar el marco en cada cuadro).
        marco = MarcoRespira(ctx).apply { alpha = 0f; setLayerType(View.LAYER_TYPE_HARDWARE, null) }
        raiz.addView(marco, FrameLayout.LayoutParams(MATCH, MATCH))
        destelloV = View(ctx).apply { setBackgroundColor(Color.WHITE); alpha = 0f }
        raiz.addView(destelloV, FrameLayout.LayoutParams(MATCH, MATCH))
        anillo = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dpi(2f), Color.WHITE) }
            alpha = 0f
        }
        raiz.addView(anillo, FrameLayout.LayoutParams(dpi(72f), dpi(72f)))

        // ---- arriba: cerrar, módulo y ubicación, voz, linterna
        arriba = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val barra = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = redondo(Color.argb(190, 14, 18, 18), 28f, Color.argb(120, 0, 87, 74))
            setPadding(dpi(6f), dpi(6f), dpi(6f), dpi(6f))
        }
        btnCerrar = boton(Trazos.CERRAR, "Cerrar la cámara") { cerrar("usuario", 0) }
        barra.addView(btnCerrar, LinearLayout.LayoutParams(dpi(44f), dpi(44f)))
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dpi(10f), 0, dpi(6f), 0) }
        titulo = texto(16f, Color.WHITE, true).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        col.addView(titulo)
        chipUbicacion = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = RippleDrawable(ColorStateList.valueOf(Color.argb(80, 255, 255, 255)), redondo(Color.argb(235, 0, 87, 74), 14f, Color.argb(150, 31, 163, 131)), null)
            setPadding(dpi(6f), dpi(3f), dpi(10f), dpi(3f))
            isClickable = true; isFocusable = true
            setOnClickListener { accionYCerrar("ubicacion") }
        }
        chipUbicacion.addView(Icono(ctx, Trazos.UBICACION, "U").apply { escala = 0.85f }, LinearLayout.LayoutParams(dpi(16f), dpi(16f)))
        textoUbicacion = texto(13f, Color.WHITE, false).apply { setPadding(dpi(4f), 0, 0, 0); maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        chipUbicacion.addView(textoUbicacion)
        col.addView(chipUbicacion, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dpi(3f) })
        barra.addView(col, LinearLayout.LayoutParams(0, WRAP, 1f))
        btnVoz = boton(Trazos.VOZ, "Avisos con voz") { alternarVoz() }
        barra.addView(btnVoz, LinearLayout.LayoutParams(dpi(44f), dpi(44f)).apply { marginEnd = dpi(6f) })
        btnLinterna = boton(Trazos.LINTERNA_NO, "Prender la linterna") { alternarLinterna() }
        barra.addView(btnLinterna, LinearLayout.LayoutParams(dpi(44f), dpi(44f)))
        arriba.addView(barra, LinearLayout.LayoutParams(MATCH, WRAP))
        pista = texto(13.5f, Color.WHITE, false).apply {
            background = redondo(Color.argb(135, 0, 0, 0), 14f, 0)
            setPadding(dpi(12f), dpi(6f), dpi(12f), dpi(6f)); gravity = Gravity.CENTER
        }
        arriba.addView(pista, LinearLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dpi(10f) })
        raiz.addView(arriba, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.TOP))

        // ---- abajo: aviso, contador, zoom, modos y acciones
        abajo = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.TRANSPARENT, Color.argb(150, 0, 0, 0), Color.argb(215, 0, 0, 0)))
        }
        tarjeta = FrameLayout(ctx).apply { visibility = View.GONE; alpha = 0f }
        tarjetaFondo = GradientDrawable().apply { cornerRadius = dp(20f); setColor(Color.argb(238, 16, 20, 20)) }
        tarjeta.background = tarjetaFondo
        tarjetaBrilloFondo = GradientDrawable().apply { cornerRadius = dp(20f); setColor(C_VERDE) }
        tarjetaBrillo = Relleno(ctx).apply { background = tarjetaBrilloFondo; alpha = 0f }
        tarjeta.addView(tarjetaBrillo, FrameLayout.LayoutParams(MATCH, MATCH))
        val fila = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dpi(14f), dpi(12f), dpi(12f), dpi(12f))
        }
        tarjetaPunto = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C_VERDE) }
        fila.addView(View(ctx).apply { background = tarjetaPunto }, LinearLayout.LayoutParams(dpi(14f), dpi(14f)).apply { marginEnd = dpi(12f) })
        val tcol = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        tarjetaTitulo = texto(17f, Color.WHITE, true).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
        tarjetaDetalle = texto(14f, Color.argb(220, 255, 255, 255), false).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
        tcol.addView(tarjetaTitulo); tcol.addView(tarjetaDetalle)
        fila.addView(tcol, LinearLayout.LayoutParams(0, WRAP, 1f))
        tarjetaDeshacer = texto(14f, Color.WHITE, true).apply {
            text = "Deshacer"; gravity = Gravity.CENTER
            background = RippleDrawable(ColorStateList.valueOf(Color.argb(90, 255, 255, 255)), redondo(Color.argb(70, 255, 255, 255), 16f, 0), null)
            setPadding(dpi(14f), dpi(9f), dpi(14f), dpi(9f))
            isClickable = true; isFocusable = true; visibility = View.GONE
            setOnClickListener { visibility = View.GONE; emitirAccion("deshacer", null) }
        }
        fila.addView(tarjetaDeshacer)
        tarjeta.addView(fila, FrameLayout.LayoutParams(MATCH, WRAP))
        abajo.addView(tarjeta, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dpi(12f) })

        contador = texto(13f, Color.argb(235, 255, 255, 255), true).apply { gravity = Gravity.CENTER; visibility = View.GONE }
        abajo.addView(contador, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dpi(8f) })

        filaZoom = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        zoomTexto = texto(13f, Color.WHITE, true).apply { text = "1.0×"; minWidth = dpi(46f); gravity = Gravity.CENTER }
        filaZoom.addView(zoomTexto)
        zoomBarra = SeekBar(ctx).apply {
            max = 100
            contentDescription = "Zoom"
            progressTintList = ColorStateList.valueOf(VERDE_WITT_CLARO)
            thumbTintList = ColorStateList.valueOf(Color.WHITE)
            progressBackgroundTintList = ColorStateList.valueOf(Color.argb(110, 255, 255, 255))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, deUsuario: Boolean) {
                    if (deUsuario) try { camara?.cameraControl?.setLinearZoom(p / 100f) } catch (_: Throwable) {}
                }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
            })
        }
        filaZoom.addView(zoomBarra, LinearLayout.LayoutParams(0, WRAP, 1f))
        abajo.addView(filaZoom, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dpi(10f) })

        segmento = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = redondo(Color.argb(160, 20, 24, 24), 24f, Color.argb(70, 255, 255, 255))
            setPadding(dpi(4f), dpi(4f), dpi(4f), dpi(4f))
        }
        for ((clave, nombre) in listOf("normal" to "Normal", "continuo" to "Continuo", "placa" to "Placa")) {
            val b = texto(15f, Color.WHITE, true).apply {
                text = nombre; gravity = Gravity.CENTER
                contentDescription = "Modo $nombre"
                setPadding(dpi(10f), dpi(11f), dpi(10f), dpi(11f))
                isClickable = true; isFocusable = true
                setOnClickListener { cambiarModo(clave, true) }
            }
            botonesModo[clave] = b
            segmento.addView(b, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        abajo.addView(segmento, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dpi(12f) })

        filaAcciones = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val acciones = listOf(
            botonAccion("escribir", Trazos.TECLADO, "Escribir") { accionYCerrar("escribir") },
            botonAccion("foto", Trazos.FOTO, "Foto") { tomarFoto() },
            botonAccion("dictar", Trazos.MICROFONO, "Dictar") { accionYCerrar("dictar") }
        )
        for (a in acciones) filaAcciones.addView(a, LinearLayout.LayoutParams(WRAP, WRAP).apply { marginStart = dpi(6f); marginEnd = dpi(6f) })
        abajo.addView(filaAcciones, LinearLayout.LayoutParams(MATCH, WRAP))
        raiz.addView(abajo, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))

        // ---- gestos sobre la vista previa: toque = enfocar, doble toque = acercar, pellizco = zoom
        val escala = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val cam = camara ?: return false
                val z = cam.cameraInfo.zoomState.value ?: return false
                val nuevo = (z.zoomRatio * detector.scaleFactor).coerceIn(z.minZoomRatio, z.maxZoomRatio)
                try { cam.cameraControl.setZoomRatio(nuevo) } catch (_: Throwable) {}
                return true
            }
        })
        val toques = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapUp(e: MotionEvent): Boolean { enfocar(e.x, e.y); return true }
            override fun onDoubleTap(e: MotionEvent): Boolean { zoomDoble(); return true }
        })
        previa.setOnTouchListener { _, ev ->
            escala.onTouchEvent(ev)
            if (!escala.isInProgress) toques.onTouchEvent(ev)
            true
        }
        ViewCompat.setOnApplyWindowInsetsListener(raiz) { _, ins -> margenes(); ins }
        construida = true
    }

    // ------------------------------------------------------------------ estado (para la web y la prueba)

    fun estado(): JSObject {
        val o = JSObject()
        o.put("abierta", abierta)
        o.put("modo", modo)
        o.put("version", VERSION_CAMARA)
        o.put("rangoFps", rangoTexto())
        o.put("fpsCamara", fpsCamara.toDouble())
        o.put("fpsPantalla", fpsUi.toDouble())
        o.put("fpsAnalisis", (analizador?.fps ?: 0f).toDouble())
        o.put("msPorCuadro", (analizador?.msPorCuadro ?: 0f).toDouble())
        o.put("linterna", linterna)
        o.put("tieneLinterna", camara?.cameraInfo?.hasFlashUnit() ?: false)
        o.put("zoom", (camara?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f).toDouble())
        o.put("resolucionPrevia", preview?.resolutionInfo?.resolution?.toString() ?: "")
        o.put("resolucionAnalisis", analisis?.resolutionInfo?.resolution?.toString() ?: "")
        o.put("esperando", esperando)
        return o
    }
}
