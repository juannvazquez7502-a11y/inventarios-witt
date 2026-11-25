package mx.grupowitt.inventarios.camara

// Piezas de dibujo de la cámara: íconos (trazos de 24x24, sin emojis), el marco que respira y la mira.
// Todo se dibuja una vez; la respiración solo anima la transparencia de la vista (la hace el RenderThread, no redibuja).

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import androidx.core.graphics.PathParser
import kotlin.math.min

object Trazos {
    const val CERRAR = "M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z"
    const val LINTERNA = "M7,2v11h3v9l7,-12h-4l4,-8z"
    const val LINTERNA_NO = "M3.27,3L2,4.27l5,5V13h3v9l3.58,-6.14L17.73,20 19,18.73 3.27,3zM17,10h-4l4,-8H7v2.18l8.46,8.46L17,10z"
    const val TECLADO = "M20,5H4c-1.1,0 -1.99,0.9 -1.99,2L2,17c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V7c0,-1.1 -0.9,-2 -2,-2zM11,8h2v2h-2V8zM11,11h2v2h-2v-2zM8,8h2v2H8V8zM8,11h2v2H8v-2zM7,13H5v-2h2v2zM7,10H5V8h2v2zM16,17H8v-2h8v2zM16,13h-2v-2h2v2zM16,10h-2V8h2v2zM19,13h-2v-2h2v2zM19,10h-2V8h2v2z"
    const val FOTO = "M9,2L7.17,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2h-3.17L15,2H9zM12,17c-2.76,0 -5,-2.24 -5,-5s2.24,-5 5,-5 5,2.24 5,5 -2.24,5 -5,5zM12,8.8c-1.77,0 -3.2,1.43 -3.2,3.2s1.43,3.2 3.2,3.2 3.2,-1.43 3.2,-3.2 -1.43,-3.2 -3.2,-3.2z"
    const val UBICACION = "M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13c0,-3.87 -3.13,-7 -7,-7zM12,11.5c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5 2.5,1.12 2.5,2.5 -1.12,2.5 -2.5,2.5z"
    const val MICROFONO = "M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11H5c0,3.41 2.72,6.23 6,6.72V21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z"
    const val VOZ = "M3,9v6h4l5,5V4L7,9H3zM16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v8.05c1.48,-0.73 2.5,-2.25 2.5,-4.02zM14,3.23v2.06c2.89,0.86 5,3.54 5,6.71s-2.11,5.85 -5,6.71v2.06c4.01,-0.91 7,-4.49 7,-8.77s-2.99,-7.86 -7,-8.77z"
    const val VOZ_NO = "M16.5,12c0,-1.77 -1.02,-3.29 -2.5,-4.03v2.21l2.45,2.45c0.03,-0.2 0.05,-0.41 0.05,-0.63zM19,12c0,0.94 -0.2,1.82 -0.54,2.64l1.51,1.51C20.63,14.91 21,13.5 21,12c0,-4.28 -2.99,-7.86 -7,-8.77v2.06c2.89,0.86 5,3.54 5,6.71zM4.27,3L3,4.27 7.73,9H3v6h4l5,5v-6.73l4.25,4.25c-0.67,0.52 -1.42,0.93 -2.25,1.18v2.06c1.38,-0.31 2.63,-0.95 3.69,-1.81L19.73,21 21,19.73l-9,-9L4.27,3zM12,4L9.91,6.09 12,8.18V4z"
    const val DESHACER = "M12.5,8c-2.65,0 -5.05,0.99 -6.9,2.6L2,7v9h9l-3.62,-3.62c1.39,-1.16 3.16,-1.88 5.12,-1.88 3.54,0 6.55,2.31 7.6,5.5l2.37,-0.78C21.08,11.03 17.15,8 12.5,8z"

    fun ruta(d: String): Path? = try { PathParser.createPathFromPathData(d) } catch (e: Throwable) { null }
}

// Ícono de 24x24 escalado al 58 % de la vista. Si el trazo no se pudiera leer, dibuja una letra.
@SuppressLint("ViewConstructor")
class Icono(ctx: Context, datos: String, private val letra: String = "") : View(ctx) {
    private var ruta: Path? = Trazos.ruta(datos)
    private val pintura = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    private val texto = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true }
    var escala = 0.58f

    var tinte: Int
        get() = pintura.color
        set(v) { pintura.color = v; texto.color = v; invalidate() }

    fun cambiar(datos: String) { ruta = Trazos.ruta(datos); invalidate() }

    override fun onDraw(c: Canvas) {
        val lado = min(width, height).toFloat()
        val p = ruta
        if (p == null) {
            texto.textSize = lado * 0.45f
            c.drawText(letra, width / 2f, height / 2f + texto.textSize / 3f, texto)
            return
        }
        val s = lado * escala / 24f
        c.save()
        c.translate((width - 24f * s) / 2f, (height - 24f * s) / 2f)
        c.scale(s, s)
        c.drawPath(p, pintura)
        c.restore()
    }
}

// Capa de color de la tarjeta (el brillo que respira). Sin tamaño propio: toma el de la tarjeta (FrameLayout la vuelve a
// medir con su tamaño exacto). Una View normal con MATCH_PARENT dentro de un FrameLayout WRAP_CONTENT se estira a toda
// la pantalla; esta no.
class Relleno(ctx: Context) : View(ctx) {
    override fun onMeasure(w: Int, h: Int) {
        val ancho = if (View.MeasureSpec.getMode(w) == View.MeasureSpec.EXACTLY) View.MeasureSpec.getSize(w) else 0
        val alto = if (View.MeasureSpec.getMode(h) == View.MeasureSpec.EXACTLY) View.MeasureSpec.getSize(h) else 0
        setMeasuredDimension(ancho, alto)
    }
    override fun hasOverlappingRendering(): Boolean = false
}

// Marco que respira en el borde de la pantalla: varios trazos del mismo color con menos opacidad hacia adentro
// (un brillo sin desenfoque, que sí acelera la GPU). La animación solo cambia "alpha" de la vista.
class MarcoRespira(ctx: Context) : View(ctx) {
    private val d = ctx.resources.displayMetrics.density
    private val anchos = floatArrayOf(34f, 22f, 13f, 6f)
    private val opacidades = intArrayOf(26, 46, 90, 255)
    private val pinturas = Array(4) { i -> Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = anchos[i] * d } }
    private val r = RectF()
    var radio = 30f

    var color: Int = Color.rgb(52, 199, 89)
        set(v) { field = v; pintar(); invalidate() }

    init { pintar() }

    private fun pintar() {
        for (i in pinturas.indices) pinturas[i].color = Color.argb(opacidades[i], Color.red(color), Color.green(color), Color.blue(color))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        for (p in pinturas) {
            val m = p.strokeWidth / 2f
            r.set(m, m, w - m, h - m)
            c.drawRoundRect(r, radio * d, radio * d, p)
        }
    }
}

// Mira: cuatro esquinas. En modo placa es un recuadro ancho y bajo, como la placa.
class Mira(ctx: Context) : View(ctx) {
    private val d = ctx.resources.displayMetrics.density
    private val pintura = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 4f * d; strokeCap = Paint.Cap.ROUND; color = Color.argb(235, 255, 255, 255)
    }
    private val sombra = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 7f * d; strokeCap = Paint.Cap.ROUND; color = Color.argb(70, 0, 0, 0)
    }
    private val camino = Path()
    var placa = false
        set(v) { field = v; requestLayout(); invalidate() }

    fun caja(w: Float, h: Float): RectF {
        return if (placa) {
            val bw = w * 0.88f; val bh = min(h * 0.22f, bw * 0.42f)
            RectF((w - bw) / 2f, h * 0.40f - bh / 2f, (w + bw) / 2f, h * 0.40f + bh / 2f)
        } else {
            val l = min(w * 0.70f, h * 0.42f)
            RectF((w - l) / 2f, h * 0.40f - l / 2f, (w + l) / 2f, h * 0.40f + l / 2f)
        }
    }

    override fun onDraw(c: Canvas) {
        val b = caja(width.toFloat(), height.toFloat())
        val e = min(b.width(), b.height()) * 0.22f
        val rr = 14f * d
        camino.reset()
        // arriba-izquierda
        camino.moveTo(b.left, b.top + e); camino.lineTo(b.left, b.top + rr)
        camino.quadTo(b.left, b.top, b.left + rr, b.top); camino.lineTo(b.left + e, b.top)
        // arriba-derecha
        camino.moveTo(b.right - e, b.top); camino.lineTo(b.right - rr, b.top)
        camino.quadTo(b.right, b.top, b.right, b.top + rr); camino.lineTo(b.right, b.top + e)
        // abajo-derecha
        camino.moveTo(b.right, b.bottom - e); camino.lineTo(b.right, b.bottom - rr)
        camino.quadTo(b.right, b.bottom, b.right - rr, b.bottom); camino.lineTo(b.right - e, b.bottom)
        // abajo-izquierda
        camino.moveTo(b.left + e, b.bottom); camino.lineTo(b.left + rr, b.bottom)
        camino.quadTo(b.left, b.bottom, b.left, b.bottom - rr); camino.lineTo(b.left, b.bottom - e)
        c.drawPath(camino, sombra)
        c.drawPath(camino, pintura)
    }

    // Golpecito visual al leer un código.
    fun pulso() {
        animate().cancel()
        pivotX = width / 2f; pivotY = height * 0.40f
        scaleX = 1f; scaleY = 1f
        animate().scaleX(1.06f).scaleY(1.06f).setDuration(90).withEndAction {
            animate().scaleX(1f).scaleY(1f).setDuration(170).start()
        }.start()
    }
}
