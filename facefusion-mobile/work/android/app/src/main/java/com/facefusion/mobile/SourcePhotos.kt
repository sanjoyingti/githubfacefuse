package com.facefusion.mobile

import androidx.compose.runtime.mutableStateMapOf

/**
 * Extra photos of the SAME person for one source face.
 *
 * A source face is still one slot -- one chip, one index, one assignment -- but it may hold
 * up to [MAX] photos. Natively the slot's identity is the re-normalised mean of the
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
    const val MAX = 3

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
     * Add [extras] to native slot [slotIndex], which must have just been registered with
     * setSource/addSource. A photo that is refused is skipped, never fatal: the slot then
     * swaps exactly as it would with fewer photos, and the panel says why.
     */
    fun register(slotIndex: Int, extras: List<Extra>) {
        for (e in extras) {
            val r = NativePipe.addSourcePhoto(slotIndex, e.bgr, e.width, e.height)
            verdicts[e.tag] = when {
                r > 0 -> USED
                r == OTHER_PERSON -> OTHER_PERSON
                else -> NO_FACE
            }
        }
    }
}
