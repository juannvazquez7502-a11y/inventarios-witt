package mx.grupowitt.inventarios.camara

// Lectura de PLACAS de México y de VIN (17 caracteres) con el texto que reconoce ML Kit.
// El OCR casi nunca acierta en un solo cuadro, así que cada cuadro VOTA y se entrega lo más votado:
//  - VIN con dígito verificador correcto: vale 3 por cuadro (con 2 cuadros iguales se entrega).
//  - VIN sin dígito verificador correcto: vale 1 (hacen falta 5 cuadros).
//  - Placa con formato conocido: 2 (3 si trae guiones como en la placa: ABC-123-D); hacen falta 6 puntos y 3 de ventaja.
//  - Otra placa posible (6 o 7 caracteres, letras y números): 1.
//  - Si en 5 s no hay ganador claro, se entrega el más votado si ya lleva 4 puntos.
// La web compara después contra las placas del inventario (rankPlates/finishPlate, igual que con la cámara web).

data class Candidato(val texto: String, val tipo: String, val peso: Int)

object Placas {
    private const val VALIDOS_VIN = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
    private val PESOS_VIN = intArrayOf(8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
    private val NO_ALFANUM = Regex("[^A-Z0-9]")
    private val ESPACIOS = Regex("\\s+")
    private val CON_GUIONES = Regex("^[A-Z0-9]{2,3}[- ][A-Z0-9]{2,4}([- ][A-Z0-9]{1,2})?$")
    // Formatos de placas de México (sin guiones): particular actual ABC-123-D, anteriores ABC-12-34, 123-ABC, A12-ABC,
    // de otros estados y de carga (AB-1234, AB-123-C, 12-ABC-34, A-1234-B).
    private val PATRONES = listOf(
        Regex("^[A-Z]{3}[0-9]{3}[A-Z]$"),
        Regex("^[A-Z]{3}[0-9]{4}$"),
        Regex("^[0-9]{3}[A-Z]{3}$"),
        Regex("^[A-Z][0-9]{2}[A-Z]{3}$"),
        Regex("^[A-Z]{2}[0-9]{4,5}$"),
        Regex("^[A-Z]{2}[0-9]{3}[A-Z]{1,2}$"),
        Regex("^[0-9]{2}[A-Z]{3}[0-9]{2}$"),
        Regex("^[A-Z][0-9]{4}[A-Z]{1,2}$"),
        Regex("^[A-Z]{3}[0-9]{2}[A-Z]$")
    )

    private fun valorVin(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        'A', 'J' -> 1
        'B', 'K', 'S' -> 2
        'C', 'L', 'T' -> 3
        'D', 'M', 'U' -> 4
        'E', 'N', 'V' -> 5
        'F', 'W' -> 6
        'G', 'P', 'X' -> 7
        'H', 'Y' -> 8
        'R', 'Z' -> 9
        else -> -1
    }

    fun digitoVin(v: String): Boolean {
        if (v.length != 17) return false
        var s = 0
        for (i in 0 until 17) {
            val x = valorVin(v[i]); if (x < 0) return false
            s += x * PESOS_VIN[i]
        }
        val r = s % 11
        val esperado = if (r == 10) 'X' else ('0' + r)
        return v[8] == esperado
    }

    // En un VIN no existen I, O ni Q: el OCR las confunde con 1 y 0.
    private fun arreglarVin(s: String): String = buildString(s.length) {
        for (c in s) append(when (c) { 'O', 'Q' -> '0'; 'I' -> '1'; else -> c })
    }

    private fun poner(m: LinkedHashMap<String, Candidato>, c: Candidato) {
        val a = m[c.texto]
        if (a == null || a.peso < c.peso) m[c.texto] = c
    }

    fun candidatos(lineas: List<String>): List<Candidato> {
        val out = LinkedHashMap<String, Candidato>()
        for (l0 in lineas) {
            val l = l0.uppercase().trim()
            if (l.isEmpty()) continue
            val junta = l.replace(NO_ALFANUM, "")
            val trozos = (l.split(ESPACIOS).map { it.replace(NO_ALFANUM, "") } + junta).filter { it.isNotEmpty() }.distinct()
            for (t in trozos) {
                if (t.length in 17..19) {
                    for (ini in 0..(t.length - 17)) {
                        val v = arreglarVin(t.substring(ini, ini + 17))
                        if (v.all { VALIDOS_VIN.indexOf(it) >= 0 } && v.count { it.isDigit() } >= 5 && v.count { it.isLetter() } >= 2) {
                            poner(out, Candidato(v, "vin", if (digitoVin(v)) 3 else 1))
                        }
                    }
                }
            }
            val guiones = CON_GUIONES.matches(l)
            for (t in trozos) {
                if (t.length !in 5..8) continue
                val letras = t.count { it.isLetter() }
                val digitos = t.count { it.isDigit() }
                if (letras < 1 || digitos < 2) continue
                val conocido = PATRONES.any { it.matches(t) }
                if (!conocido && t.length !in 6..7) continue
                val peso = (if (conocido) 2 else 1) + (if (guiones && t == junta) 1 else 0)
                poner(out, Candidato(t, "placa", peso))
            }
        }
        return out.values.toList()
    }
}

class Votacion {
    private val votos = HashMap<String, Int>()
    private val tipos = HashMap<String, String>()
    private var inicio = 0L

    fun reiniciar() { votos.clear(); tipos.clear(); inicio = 0L }

    fun agregar(c: List<Candidato>, ahora: Long): Candidato? {
        if (inicio == 0L) inicio = ahora
        for (x in c) {
            votos[x.texto] = (votos[x.texto] ?: 0) + x.peso
            tipos[x.texto] = x.tipo
        }
        val orden = votos.entries.sortedByDescending { it.value }
        val m = orden.firstOrNull() ?: return null
        val segundo = orden.getOrNull(1)?.value ?: 0
        val tipo = tipos[m.key] ?: "placa"
        val listo = if (tipo == "vin") m.value >= 5 && m.value - segundo >= 2 else m.value >= 6 && m.value - segundo >= 3
        val tarde = ahora - inicio > 5000 && m.value >= 4 && m.value > segundo
        return if (listo || tarde) Candidato(m.key, tipo, m.value) else null
    }

    fun mejor(): Pair<String, Int>? = votos.maxByOrNull { it.value }?.let { it.key to it.value }

    fun top(n: Int): List<String> = votos.entries.sortedByDescending { it.value }.take(n).map { it.key }
}
