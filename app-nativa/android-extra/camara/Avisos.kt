package mx.grupowitt.inventarios.camara

// Pitido y vibración nativos por color. La intensidad la define el color:
//  verde    = pitido corto y agudo de confirmación + vibración suave y corta
//  amarillo = doble pitido medio + vibración media doble
//  rojo     = tono grave más largo + vibración fuerte y larga
//  neutro   = un "tic" corto y bajito, sin vibración (código leído sin resultado de inventario)
// Los sonidos se generan una sola vez (PCM en memoria, AudioTrack estático): suenan al instante y no usan archivos.

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

class Avisos(private val ctx: Context) {
    private val pistas = HashMap<String, AudioTrack>()
    private var ultimo = 0L
    private var ultimoColor = ""

    private val vibrador: Vibrator? by lazy {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
        } catch (e: Throwable) { null }
    }

    fun dar(color: String, sonido: Boolean = true, vibrar: Boolean = true) {
        // El mismo aviso dos veces en menos de 250 ms suena una sola vez.
        val ahora = SystemClock.elapsedRealtime()
        if (color == ultimoColor && ahora - ultimo < 250) return
        ultimo = ahora; ultimoColor = color
        if (sonido) try { sonar(color) } catch (e: Throwable) { Log.w(TAG, "sonido", e) }
        if (vibrar) try { vibrarColor(color) } catch (e: Throwable) { Log.w(TAG, "vibración", e) }
    }

    private class Tono(val f0: Double, val f1: Double, val ms: Int, val vol: Double, val armonico: Double = 0.0, val pausaMs: Int = 0)

    private fun tonos(color: String): List<Tono> = when (color) {
        "verde" -> listOf(Tono(1760.0, 1760.0, 70, 0.55, pausaMs = 22), Tono(2349.0, 2349.0, 95, 0.55))
        "amarillo" -> listOf(Tono(988.0, 988.0, 115, 0.70, 0.15, pausaMs = 95), Tono(988.0, 988.0, 115, 0.70, 0.15))
        "rojo" -> listOf(Tono(330.0, 247.0, 460, 0.85, 0.35))
        else -> listOf(Tono(1200.0, 1200.0, 45, 0.30))
    }

    private fun pcm(color: String): ShortArray {
        val sr = 44100
        val partes = tonos(color)
        val total = partes.sumOf { (it.ms + it.pausaMs) * sr / 1000 }
        val out = ShortArray(total)
        var i = 0
        for (t in partes) {
            val n = t.ms * sr / 1000
            val ataque = min(n / 4, sr * 6 / 1000)
            val caida = min(n / 2, sr * 30 / 1000)
            var fase = 0.0
            val norm = 1.0 + t.armonico
            for (k in 0 until n) {
                val f = t.f0 + (t.f1 - t.f0) * k / n
                fase += 2.0 * PI * f / sr
                var s = sin(fase) + t.armonico * sin(3.0 * fase)
                s /= norm
                val env = when {
                    k < ataque -> k.toDouble() / ataque
                    k > n - caida -> (n - k).toDouble() / caida
                    else -> 1.0
                }
                out[i++] = (s * env * t.vol * Short.MAX_VALUE).toInt().toShort()
            }
            i += t.pausaMs * sr / 1000
        }
        return out
    }

    private fun pista(color: String): AudioTrack {
        pistas[color]?.let { return it }
        val datos = pcm(color)
        val tr = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(44100)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(datos.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        tr.write(datos, 0, datos.size)
        pistas[color] = tr
        return tr
    }

    private fun sonar(color: String) {
        val tr = pista(color)
        if (tr.playState == AudioTrack.PLAYSTATE_PLAYING) tr.stop()
        tr.reloadStaticData()
        tr.play()
    }

    private fun vibrarColor(color: String) {
        val v = vibrador ?: return
        if (!v.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= 26) {
            val amp = v.hasAmplitudeControl()
            val ef: VibrationEffect = when (color) {
                "verde" -> if (amp) VibrationEffect.createWaveform(longArrayOf(0, 45), intArrayOf(0, 90), -1)
                           else VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE)
                "amarillo" -> if (amp) VibrationEffect.createWaveform(longArrayOf(0, 120, 110, 120), intArrayOf(0, 185, 0, 185), -1)
                              else VibrationEffect.createWaveform(longArrayOf(0, 130, 110, 130), -1)
                "rojo" -> if (amp) VibrationEffect.createWaveform(longArrayOf(0, 560, 90, 260), intArrayOf(0, 255, 0, 255), -1)
                          else VibrationEffect.createWaveform(longArrayOf(0, 620, 90, 280), -1)
                else -> return
            }
            v.vibrate(ef)
        } else {
            val p = when (color) {
                "verde" -> longArrayOf(0, 30)
                "amarillo" -> longArrayOf(0, 130, 110, 130)
                "rojo" -> longArrayOf(0, 620, 90, 280)
                else -> return
            }
            @Suppress("DEPRECATION")
            v.vibrate(p, -1)
        }
    }

    fun liberar() {
        pistas.values.forEach { try { it.release() } catch (_: Throwable) {} }
        pistas.clear()
    }
}
