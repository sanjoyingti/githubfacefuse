package com.facefusion.mobile

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue

/**
 * Extra photos of the SAME person for one source face.
 *
 * A source face is still one slot -- one chip, one index, one assignment -- but it may hold
 * up to [MAX] photos (front, left, right, up, down). Natively the slot's identity is the re-normalised mean of the
 * photos' embeddings (`ffpipe::Pipeline::addSourcePhoto`), which steadies the likeness
 * across head turns and lighting at no cost per frame: the mean is taken once, when the
 * sources are registered.
 *
 * Every photo goes through the content check with the rest of the source list (the
 * callers add their bitmaps to the list they screen), and a photo of a different person
 * is refused natively and never averaged in.
 */
object SourcePhotos {
    /** Photos per source face, the main photo included. Mirrors kMaxSourcePhotos. */
    const val MAX = 5

    /** One extra photo, decoded and converted for the pipeline. [tag] is its Uri. */
    class Extra(val tag: Any, val bgr: ByteArray, val width: Int, val height: Int)

    /** Outcome of the last registration of an extra photo, by its tag. */
    const val USED = 1
    const val NO_FACE = -1
    const val OTHER_PERSON = -2

    /**
     * What happened to each extra photo the last time it was registered: [USED],
     * [NO_FACE] or [OTHER_PERSON]. Read by the photos panel; absent means not tried yet.
     */
    val verdicts = mutableStateMapOf<Any, Int>()

    /**
     * Opens the photos panel for a source face; set by MainActivity. Read by the Swap
     * screen DIRECTLY, not passed down as a parameter: on a phone the parameter route left
     * the button hidden although the compiled code passed a value, so the screen now asks
     * here as well and shows the controls whenever either says yes.
     */
    var opener by androidx.compose.runtime.mutableStateOf<((Int) -> Unit)?>(null)

    /** Photos per source face (main photo included), in source order; set by MainActivity. */
    var counts by androidx.compose.runtime.mutableStateOf<List<Int>>(emptyList())

    /**
     * Which source face's photos panel is open, or -1. The Swap screen SETS it when the
     * button is tapped and MainActivity draws the panel from it -- plain shared state, no
     * callback that could be missing, so the button never depends on one.
     */
    var openFor by androidx.compose.runtime.mutableStateOf(-1)

    /**
     * Add [extras] to native slot [slotIndex], which must have just been registered with
     * setSource/addSource. A photo that is refused is skipped, never fatal: the slot then
     * swaps exactly as it would with fewer photos, and the panel says why.
     */
    fun register(slotIndex: Int, extras: List<Extra>) {
        for (e in extras) {
            check(e.tag, e.bgr, e.width, e.height)
            val r = NativePipe.addSourcePhoto(slotIndex, e.bgr, e.width, e.height)
            verdicts[e.tag] = when {
                r > 0 -> USED
                r == OTHER_PERSON -> OTHER_PERSON
                else -> NO_FACE
            }
        }
    }

    // ------------------------------------------------------------- photo quality check

    /** Which way the face in a photo points, as seen in the photo. */
    enum class Angle { FRONT, LEFT, RIGHT, UP, DOWN }

    /** Problems a photo can have, worst first. */
    enum class Warn { NO_FACE, MANY_FACES, SMALL, BLURRY, DARK, BRIGHT, TURNED, SAME_ANGLE }

    class Check(val angle: Angle?, val warnings: List<Warn>)

    /** The last check of each photo, by its tag (the photo's Uri). Read by the panels. */
    val checks = mutableStateMapOf<Any, Check>()

    fun angleOf(yaw: Float, pitch: Float): Angle? {
        if (yaw.isNaN() || pitch.isNaN()) return null
        val ay = kotlin.math.abs(yaw); val ap = kotlin.math.abs(pitch)
        return when {
            ay < 15f && ap < 15f -> Angle.FRONT
            ay >= ap -> if (yaw > 0) Angle.RIGHT else Angle.LEFT
            else -> if (pitch > 0) Angle.DOWN else Angle.UP
        }
    }

    /**
     * Judge one photo from [NativePipe.scanFaces]' answer. Pure, so it is unit-tested.
     * Face under 120 px, Laplacian variance under 20 (measured: a sharp face is 150-300,
     * a 2 px blur ~23), mean grey under 55 or over 215, head turned past 45 degrees.
     */
    fun assess(scan: FloatArray): Check {
        val s = NativePipe.SCAN_STRIDE
        val n = scan.size / s
        if (n == 0) return Check(null, listOf(Warn.NO_FACE))
        var best = 0; var bestArea = -1f
        for (i in 0 until n) {
            val a = (scan[i * s + 2] - scan[i * s]) * (scan[i * s + 3] - scan[i * s + 1])
            if (a > bestArea) { bestArea = a; best = i }
        }
        val o = best * s
        val side = minOf(scan[o + 2] - scan[o], scan[o + 3] - scan[o + 1])
        val yaw = scan[o + 5]; val pitch = scan[o + 6]
        val w = mutableListOf<Warn>()
        // Another face at least half as big as the main one: which person is meant?
        for (i in 0 until n) if (i != best) {
            val a = (scan[i * s + 2] - scan[i * s]) * (scan[i * s + 3] - scan[i * s + 1])
            if (a >= bestArea * 0.5f) { w += Warn.MANY_FACES; break }
        }
        if (side < 120f) w += Warn.SMALL
        if (scan[o + 7] < 20f) w += Warn.BLURRY
        if (scan[o + 8] < 55f) w += Warn.DARK
        if (scan[o + 8] > 215f) w += Warn.BRIGHT
        if (!yaw.isNaN() && kotlin.math.abs(yaw) > 45f) w += Warn.TURNED
        return Check(angleOf(yaw, pitch), w)
    }

    /** Check a slot's MAIN photo; the slot tag is its Uri, or (Uri, extras). */
    fun checkMain(slotTag: Any, bgr: ByteArray, w: Int, h: Int) =
        check((slotTag as? Pair<*, *>)?.first ?: slotTag, bgr, w, h)

    /** Check one photo with the loaded pipeline; does nothing without one. */
    fun check(tag: Any, bgr: ByteArray, w: Int, h: Int) {
        val r = runCatching { NativePipe.scanFaces(bgr, w, h) }.getOrNull() ?: return
        // Empty is "no face" only when the pipeline is there to look.
        if (r.isEmpty() && NativePipe.lastError().contains("not initialised")) return
        checks[tag] = assess(r)
    }

    /**
     * The warnings to show for each of one face's photos (main first), adding SAME_ANGLE
     * to a photo whose angle an earlier photo already covers.
     */
    fun warningsFor(tags: List<Any>): List<Check?> {
        val seen = mutableSetOf<Angle>()
        return tags.map { t ->
            val c = checks[t] ?: return@map null
            val a = c.angle
            if (a != null && !seen.add(a)) Check(a, c.warnings + Warn.SAME_ANGLE) else c
        }
    }
}
