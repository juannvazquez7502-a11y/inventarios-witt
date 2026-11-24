package mx.grupowitt.inventarios.camara

// Análisis de cada cuadro en un hilo aparte (nunca en el hilo de la pantalla): códigos con ML Kit barcode-scanning
// EMPAQUETADO y, en modo placa, texto con ML Kit text-recognition EMPAQUETADO. Solo se analiza el cuadro más reciente
// (STRATEGY_KEEP_ONLY_LATEST), así la vista previa nunca espera al análisis.

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor
import kotlin.math.max

class Resultado(
    val tipo: String,                 // "codigo" o "texto"
    val texto: String = "",
    val formato: String = "",
    val lineas: List<String> = emptyList(),
    val foto: String? = null,         // JPEG chico (data URL) para la foto de la pieza del Inventario físico
    val deFoto: Boolean = false       // vino del botón Foto (alta resolución), no de la vista previa
)

class Analizador(private val ex: Executor, private val salida: (Resultado) -> Unit) : ImageAnalysis.Analyzer {
    @Volatile var modo = "normal"
    @Volatile var activo = true
    @Volatile var conFoto = false
    @Volatile var fps = 0f
    @Volatile var msPorCuadro = 0f

    private val codigos: BarcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93,
                Barcode.FORMAT_DATA_MATRIX, Barcode.FORMAT_PDF417, Barcode.FORMAT_AZTEC, Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_ITF, Barcode.FORMAT_CODABAR
            )
            .build()
    )
    private var lectorTexto: TextRecognizer? = null
    private fun textos(): TextRecognizer = lectorTexto ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { lectorTexto = it }

    private var cuadros = 0
    private var t0 = 0L
    private var sumaMs = 0L

    private fun contar(ms: Long) {
        val ahora = SystemClock.elapsedRealtime()
        if (t0 == 0L) t0 = ahora
        cuadros++; sumaMs += ms
        if (ahora - t0 >= 2000) {
            fps = cuadros * 1000f / (ahora - t0)
            msPorCuadro = if (cuadros > 0) sumaMs.toFloat() / cuadros else 0f
            cuadros = 0; sumaMs = 0; t0 = ahora
        }
    }

    @androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
    override fun analyze(img: ImageProxy) {
        val media = img.image
        if (!activo || media == null) { img.close(); return }
        val inicio = SystemClock.elapsedRealtime()
        val rot = img.imageInfo.rotationDegrees
        val w = if (rot % 180 == 0) img.width else img.height
        val h = if (rot % 180 == 0) img.height else img.width
        val entrada = try { InputImage.fromMediaImage(media, rot) } catch (e: Throwable) { img.close(); return }
        if (modo == "placa") {
            textos().process(entrada).addOnCompleteListener(ex) { t ->
                try {
                    if (t.isSuccessful && activo && modo == "placa") {
                        val ls = lineasDe(t.result)
                        if (ls.isNotEmpty()) salida(Resultado("texto", lineas = ls))
                    }
                } catch (e: Throwable) { Log.w(TAG, "texto", e) } finally { contar(SystemClock.elapsedRealtime() - inicio); img.close() }
            }
        } else {
            codigos.process(entrada).addOnCompleteListener(ex) { t ->
                try {
                    if (t.isSuccessful && activo && modo != "placa") {
                        val b = elegir(t.result, w, h)
                        val txt = b?.let { it.rawValue ?: it.displayValue }
                        if (b != null && !txt.isNullOrEmpty()) {
                            val foto = if (conFoto) fotoChica(img, rot) else null
                            salida(Resultado("codigo", txt, formato(b.format), foto = foto))
                        }
                    }
                } catch (e: Throwable) { Log.w(TAG, "códigos", e) } finally { contar(SystemClock.elapsedRealtime() - inicio); img.close() }
            }
        }
    }

    // Imagen fija (botón Foto o imagen de prueba). forzar = aunque el análisis esté en pausa.
    fun analizarBitmap(bmp: Bitmap, placa: Boolean, deFoto: Boolean, forzar: Boolean, alTerminar: ((Boolean) -> Unit)? = null) {
        val entrada = InputImage.fromBitmap(bmp, 0)
        if (placa) {
            textos().process(entrada).addOnCompleteListener(ex) { t ->
                var ok = false
                try {
                    if (t.isSuccessful && (forzar || activo)) {
                        val ls = lineasDe(t.result)
                        if (ls.isNotEmpty()) { ok = true; salida(Resultado("texto", lineas = ls, deFoto = deFoto)) }
                    }
                } catch (e: Throwable) { Log.w(TAG, "texto imagen", e) }
                alTerminar?.invoke(ok)
            }
        } else {
            codigos.process(entrada).addOnCompleteListener(ex) { t ->
                var ok = false
                try {
                    if (t.isSuccessful && (forzar || activo)) {
                        val b = elegir(t.result, bmp.width, bmp.height)
                        val txt = b?.let { it.rawValue ?: it.displayValue }
                        if (b != null && !txt.isNullOrEmpty()) {
                            ok = true
                            salida(Resultado("codigo", txt, formato(b.format), foto = if (conFoto) fotoDeBitmap(bmp, 0) else null, deFoto = deFoto))
                        }
                    }
                } catch (e: Throwable) { Log.w(TAG, "códigos imagen", e) }
                alTerminar?.invoke(ok)
            }
        }
    }

    private fun lineasDe(t: Text): List<String> {
        val out = ArrayList<String>()
        for (b in t.textBlocks) for (l in b.lines) { val s = l.text.trim(); if (s.isNotEmpty()) out.add(s) }
        return out
    }

    // Si hay varios códigos en el cuadro, el más cercano al centro (donde está la mira).
    private fun elegir(lista: List<Barcode>, w: Int, h: Int): Barcode? {
        val cx = w / 2f; val cy = h * 0.42f
        return lista.filter { !(it.rawValue ?: it.displayValue).isNullOrEmpty() }.minByOrNull { b ->
            val r = b.boundingBox
            if (r == null) Float.MAX_VALUE else { val dx = r.exactCenterX() - cx; val dy = r.exactCenterY() - cy; dx * dx + dy * dy }
        }
    }

    private fun fotoChica(img: ImageProxy, rot: Int): String? = try { fotoDeBitmap(img.toBitmap(), rot) } catch (e: Throwable) { null }

    private fun fotoDeBitmap(b: Bitmap, rot: Int): String? = try {
        val ancho = if (rot % 180 == 0) b.width else b.height
        val s = 320f / max(1, ancho)
        val m = Matrix(); m.postRotate(rot.toFloat()); m.postScale(s, s)
        val r = Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
        val o = ByteArrayOutputStream()
        r.compress(Bitmap.CompressFormat.JPEG, 55, o)
        "data:image/jpeg;base64," + Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP)
    } catch (e: Throwable) { null }

    fun cerrar() {
        try { codigos.close() } catch (_: Throwable) {}
        try { lectorTexto?.close() } catch (_: Throwable) {}
    }

    companion object {
        fun formato(f: Int): String = when (f) {
            Barcode.FORMAT_QR_CODE -> "QR_CODE"
            Barcode.FORMAT_CODE_128 -> "CODE_128"
            Barcode.FORMAT_CODE_39 -> "CODE_39"
            Barcode.FORMAT_CODE_93 -> "CODE_93"
            Barcode.FORMAT_DATA_MATRIX -> "DATA_MATRIX"
            Barcode.FORMAT_PDF417 -> "PDF_417"
            Barcode.FORMAT_AZTEC -> "AZTEC"
            Barcode.FORMAT_EAN_13 -> "EAN_13"
            Barcode.FORMAT_EAN_8 -> "EAN_8"
            Barcode.FORMAT_UPC_A -> "UPC_A"
            Barcode.FORMAT_UPC_E -> "UPC_E"
            Barcode.FORMAT_ITF -> "ITF"
            Barcode.FORMAT_CODABAR -> "CODABAR"
            else -> "OTRO"
        }
    }
}

// Modo de prueba: SOLO existe si el APK trae assets/witt-prueba (lo agrega ajustar-android.mjs con WITT_CAMARA_PRUEBA=1,
// únicamente en el flujo de prueba del emulador). El APK publicado no lo trae y probar() contesta que no.
object Prueba {
    const val CARPETA = "witt-prueba"

    fun hayAssets(ctx: Context): Boolean = try { (ctx.assets.list(CARPETA) ?: emptyArray()).isNotEmpty() } catch (e: Exception) { false }

    fun cargar(ctx: Context, nombre: String): Bitmap? {
        if (nombre.isEmpty() || nombre.contains("/") || nombre.contains("..")) return null
        return try { ctx.assets.open("$CARPETA/$nombre").use { BitmapFactory.decodeStream(it) } } catch (e: Exception) { null }
    }
}
