package mx.grupowitt.inventarios.camara

// Cámara Witt (v2.2, 23-nov-2026): plugin local de Capacitor para la app de Inventarios Grupo Witt.
// Pantalla completa con CameraX (vista previa nativa, hasta 60 fps si la cámara lo permite), ML Kit EMPAQUETADO para
// códigos (no depende de que Google Play descargue nada) y para leer placas y VIN, y los ajustes dentro de la cámara.
// La web (nativa.js) recibe los eventos "codigo", "placa", "accion" y "cerrada", decide qué pasó con la unidad y
// contesta con feedback({color}) para que la cámara respire en verde, amarillo o rojo con su pitido y su vibración.
// Lo registra MainActivity (ajustar-android.mjs) con registerPlugin(WittCamaraPlugin.class).

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import android.view.inputmethod.InputMethodManager
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

const val TAG = "WittCamara"
const val VERSION_CAMARA = "camara 1.0 · 23-nov-2026"

@CapacitorPlugin(
    name = "WittCamara",
    permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])]
)
class WittCamaraPlugin : Plugin() {
    private var vista: VistaCamara? = null
    private var avisos: Avisos? = null

    override fun load() {
        avisos = Avisos(context.applicationContext)
    }

    private fun av(): Avisos = avisos ?: Avisos(context.applicationContext).also { avisos = it }

    private fun emitir(evento: String, datos: JSObject) {
        try { notifyListeners(evento, datos) } catch (e: Throwable) { Log.w(TAG, "emitir $evento", e) }
    }

    @PluginMethod
    fun disponible(call: PluginCall) {
        val r = JSObject()
        r.put("camara", context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))
        r.put("permiso", getPermissionState("camera").toString())
        r.put("prueba", Prueba.hayAssets(context))
        r.put("version", VERSION_CAMARA)
        call.resolve(r)
    }

    @PluginMethod
    fun abrir(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "permisoCamara")
            return
        }
        abrirYa(call)
    }

    @PermissionCallback
    private fun permisoCamara(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) abrirYa(call)
        else call.reject("Sin permiso de cámara", "permiso")
    }

    private fun abrirYa(call: PluginCall) {
        val op = Opciones.de(call)
        val act = activity
        act.runOnUiThread {
            try {
                val v = vista ?: VistaCamara(act, bridge.webView, av()) { ev, datos -> emitir(ev, datos) }.also { vista = it }
                v.abrir(op) { error ->
                    if (error == null) call.resolve(v.estado()) else call.reject(error, "camara")
                }
            } catch (e: Throwable) {
                Log.e(TAG, "abrir", e)
                call.reject("No se pudo abrir la cámara: " + (e.message ?: e.javaClass.simpleName), "camara")
            }
        }
    }

    @PluginMethod
    fun cerrar(call: PluginCall) {
        val tras = (call.getInt("tras", 0) ?: 0).toLong()
        activity.runOnUiThread {
            vista?.cerrar("web", tras)
            call.resolve()
        }
    }

    @PluginMethod
    fun feedback(call: PluginCall) {
        val f = Feedback.de(call)
        activity.runOnUiThread {
            val v = vista
            if (v != null && v.abierta) v.feedback(f)
            else if (f.sonido || f.vibrar) av().dar(f.color, f.sonido, f.vibrar)
            call.resolve()
        }
    }

    // Solo pitido y vibración por color (sirve con la cámara cerrada: búsqueda, ventana de la unidad).
    @PluginMethod
    fun aviso(call: PluginCall) {
        val color = call.getString("color", "verde") ?: "verde"
        av().dar(color, call.getBoolean("sonido", true) ?: true, call.getBoolean("vibrar", true) ?: true)
        call.resolve()
    }

    @PluginMethod
    fun actualizar(call: PluginCall) {
        val ubicacion = call.getString("ubicacion")
        val voz = call.getBoolean("voz")
        val contador = call.getInt("contador")
        val modo = call.getString("modo")
        activity.runOnUiThread {
            vista?.actualizar(ubicacion, voz, contador, modo)
            call.resolve()
        }
    }

    @PluginMethod
    fun reanudar(call: PluginCall) {
        activity.runOnUiThread {
            vista?.reanudar()
            call.resolve()
        }
    }

    // "Escribir a mano": tras cerrar la cámara, la página enfoca el buscador y aquí se abre el teclado del teléfono
    // (el focus() de JavaScript sin un toque no lo abre en el WebView).
    @PluginMethod
    fun teclado(call: PluginCall) {
        activity.runOnUiThread {
            try {
                val w = bridge.webView
                w.requestFocus()
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(w, InputMethodManager.SHOW_IMPLICIT)
            } catch (e: Throwable) { Log.w(TAG, "teclado", e) }
            call.resolve()
        }
    }

    @PluginMethod
    fun estado(call: PluginCall) {
        activity.runOnUiThread {
            val v = vista
            call.resolve(v?.estado() ?: JSObject().put("abierta", false).put("version", VERSION_CAMARA))
        }
    }

    // Solo en el APK de prueba (assets/witt-prueba): analiza una imagen fija como si fuera un cuadro de la cámara.
    @PluginMethod
    fun probar(call: PluginCall) {
        val imagen = call.getString("imagen", "") ?: ""
        activity.runOnUiThread {
            val v = vista
            if (v == null || !v.abierta) { call.reject("La cámara no está abierta", "cerrada"); return@runOnUiThread }
            if (!Prueba.hayAssets(context)) { call.reject("Este APK no trae imágenes de prueba", "sin-prueba"); return@runOnUiThread }
            val ok = v.probar(imagen)
            if (ok) call.resolve(JSObject().put("imagen", imagen)) else call.reject("No encontré la imagen $imagen", "sin-imagen")
        }
    }

    override fun handleOnDestroy() {
        try { vista?.destruir() } catch (_: Throwable) {}
        vista = null
        super.handleOnDestroy()
    }
}

class Opciones(
    val modo: String,
    val modos: List<String>,
    val titulo: String,
    val pista: String,
    val ubicacion: String?,
    val voz: Boolean?,
    val conFoto: Boolean,
    val acciones: List<String>,
    val contador: Int,
    val ocultarWeb: Boolean
) {
    companion object {
        private fun lista(call: PluginCall, k: String, def: List<String>): List<String> = try {
            val a = call.getArray(k)
            if (a == null) def else (0 until a.length()).map { a.getString(it) }
        } catch (e: Exception) { def }

        fun de(call: PluginCall): Opciones {
            val modos = lista(call, "modos", listOf("normal", "continuo", "placa")).filter { it == "normal" || it == "continuo" || it == "placa" }
            val m = call.getString("modo", "normal") ?: "normal"
            return Opciones(
                modo = if (modos.contains(m)) m else (modos.firstOrNull() ?: "normal"),
                modos = if (modos.isEmpty()) listOf("normal") else modos,
                titulo = call.getString("titulo", "Escanear") ?: "Escanear",
                pista = call.getString("pista", "") ?: "",
                ubicacion = if (call.data.has("ubicacion") && !call.data.isNull("ubicacion")) (call.getString("ubicacion") ?: "") else null,
                voz = call.getBoolean("voz"),
                conFoto = call.getBoolean("conFoto", false) ?: false,
                acciones = lista(call, "acciones", listOf("escribir", "foto")),
                contador = call.getInt("contador", 0) ?: 0,
                ocultarWeb = call.getBoolean("ocultarWeb", true) ?: true
            )
        }
    }
}

class Feedback(
    val color: String,
    val titulo: String,
    val detalle: String,
    val mantener: Boolean,
    val cerrar: Boolean,
    val cerrarEn: Long,
    val deshacer: Boolean,
    val contador: Int?,
    val sonido: Boolean,
    val vibrar: Boolean
) {
    companion object {
        fun de(call: PluginCall): Feedback {
            val c = (call.getString("color", "neutro") ?: "neutro").lowercase()
            val color = if (c == "verde" || c == "amarillo" || c == "rojo") c else "neutro"
            return Feedback(
                color = color,
                titulo = call.getString("titulo", "") ?: "",
                detalle = call.getString("detalle", "") ?: "",
                mantener = call.getBoolean("mantener", false) ?: false,
                cerrar = call.getBoolean("cerrar", false) ?: false,
                cerrarEn = (call.getInt("cerrarEn", 0) ?: 0).toLong(),
                deshacer = call.getBoolean("deshacer", false) ?: false,
                contador = call.getInt("contador"),
                sonido = call.getBoolean("sonido", color != "neutro") ?: (color != "neutro"),
                vibrar = call.getBoolean("vibrar", color != "neutro") ?: (color != "neutro")
            )
        }
    }
}
