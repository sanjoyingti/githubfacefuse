package com.facefusion.mobile

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.facefusion.mobile.SourcePhotos.Angle

/**
 * PICK PHOTOS FROM A VIDEO: go through a clip about twice a second, find the faces, group
 * them by person, and keep for each person the best picture at each angle (front, left,
 * right, up, down). Best = sharp, large, well lit, confidently detected.
 *
 * Works with the loaded pipeline's detector and recogniser ([NativePipe.scanFaces]); the
 * frames are only looked at, never swapped. Every picture taken from here becomes a
 * source photo, so it goes through the content check with every other source photo before
 * anything is swapped with it.
 *
 * Memory: frames are decoded one at a time at 1920 px at most, and only the current best
 * crop per person and angle is kept (a few hundred KB each).
 */
object VideoFacePicker {

    /** One face seen in the video. [crop] is filled only while it is a best pick. */
    class Seen(
        val timeUs: Long,
        val side: Float,
        val det: Float,
        val yaw: Float,
        val pitch: Float,
        val sharp: Float,
        val bright: Float,
        val emb: FloatArray,
    ) {
        var crop: Bitmap? = null
        val angle: Angle? get() = SourcePhotos.angleOf(yaw, pitch)

        /** Higher is better. Sharpness and size saturate; bad light and low scores cut. */
        val quality: Float get() {
            val s = (sharp / 150f).coerceIn(0f, 1f)
            val z = (side / 300f).coerceIn(0f, 1f)
            val light = if (bright in 55f..215f) 1f else 0.5f
            return (0.2f + s) * (0.2f + z) * det * light
        }
    }

    /** One person found in the video. */
    class Person {
        val sum = FloatArray(512)
        var count = 0
        /** When the person was first seen, in microseconds from the start. */
        var firstUs = Long.MAX_VALUE
        val best = LinkedHashMap<Angle, Seen>()

        fun meanNorm(): FloatArray = normalised(sum)

        /** The person's picture for the list: the front view if there is one. */
        val thumb: Bitmap? get() = (best[Angle.FRONT] ?: best.values.maxByOrNull { it.quality })?.crop

        /**
         * Who this is, for per-person assignment: the person's average face, then the
         * best picture at each angle (so a turned head still matches).
         */
        fun identities(): List<FloatArray> =
            listOf(meanNorm()) + best.values.map { normalised(it.emb) }
    }

    const val SAME_PERSON = 0.45f        // grouping faces of one clip into people
    const val MATCH_SOURCE = 0.40f       // "this is the face I already have" (native needs 0.30)
    const val MAX_PEOPLE = 12
    const val MIN_SIDE = 64f             // smaller faces are not worth a source photo

    fun cos(a: FloatArray, b: FloatArray): Float {
        var d = 0f
        for (i in 0 until minOf(a.size, b.size)) d += a[i] * b[i]
        return d
    }

    fun normalised(v: FloatArray): FloatArray {
        var n = 0.0
        for (x in v) n += x.toDouble() * x
        val inv = if (n > 0) (1.0 / Math.sqrt(n)).toFloat() else 0f
        return FloatArray(v.size) { v[it] * inv }
    }

    /**
     * Put [s] into [people]: with [target], only a face that matches it counts, into one
     * person; without, into the person it matches best or a new one. [makeCrop] is called
     * only when [s] becomes the best picture at its angle. Pure apart from [makeCrop], so
     * it is unit-tested.
     */
    fun add(people: MutableList<Person>, s: Seen, target: FloatArray?,
            maxPeople: Int = MAX_PEOPLE, makeCrop: () -> Bitmap?) {
        if (s.side < MIN_SIDE) return
        val angle = s.angle ?: return
        val p: Person = if (target != null) {
            if (cos(s.emb, target) < MATCH_SOURCE) return
            people.firstOrNull() ?: Person().also { people += it }
        } else {
            var bestP: Person? = null; var bestC = SAME_PERSON
            for (q in people) {
                val c = cos(s.emb, q.meanNorm())
                if (c >= bestC) { bestC = c; bestP = q }
            }
            bestP ?: (if (people.size < maxPeople) Person().also { people += it } else return)
        }
        for (i in 0 until 512) p.sum[i] += s.emb[i]
        p.count++
        if (s.timeUs < p.firstUs) p.firstUs = s.timeUs
        val old = p.best[angle]
        if (old == null || s.quality > old.quality) {
            val crop = makeCrop() ?: return
            old?.crop?.recycle()
            s.crop = crop
            p.best[angle] = s
        }
    }

    /**
     * The pictures to offer for [p]: the best at each angle the face does not have yet
     * ([have]), front first, then left, right, up, down; at most [free].
     */
    fun pick(p: Person, have: Set<Angle>, free: Int): List<Seen> {
        val order = listOf(Angle.FRONT, Angle.LEFT, Angle.RIGHT, Angle.UP, Angle.DOWN)
        return order.filter { it !in have }.mapNotNull { p.best[it] }.take(free.coerceAtLeast(0))
    }

    const val MERGE_SAME = 0.40f         // two groups that are really one person (other angle)

    /**
     * Join groups that are the same person seen from different sides: the grouping in
     * [add] is against each group's average, so a person who first shows a profile and
     * later the front can start a second group. Pure; unit-tested.
     */
    fun merge(found: MutableList<Person>) {
        var joined = true
        while (joined) {
            joined = false
            loop@ for (a in found.indices) for (b in a + 1 until found.size) {
                val pa = found[a]; val pb = found[b]
                if (cos(pa.meanNorm(), pb.meanNorm()) < MERGE_SAME) continue
                for (i in 0 until 512) pa.sum[i] += pb.sum[i]
                pa.count += pb.count
                pa.firstUs = minOf(pa.firstUs, pb.firstUs)
                for ((ang, sb) in pb.best) {
                    val sa = pa.best[ang]
                    if (sa == null || sb.quality > sa.quality) { sa?.crop?.recycle(); pa.best[ang] = sb }
                    else sb.crop?.recycle()
                }
                found.removeAt(b)
                joined = true
                break@loop
            }
        }
    }

    /**
     * EVERYONE in the video, for "Assign per person": each person once, in the order they
     * first appear, with small pictures only (the list needs thumbnails, not photos).
     */
    fun everyone(found: MutableList<Person>): List<Person> {
        merge(found)
        return found.filter { it.count >= 2 && it.best.isNotEmpty() }.sortedBy { it.firstUs }
    }

    /** People seen at least twice, most seen first. */
    fun people(found: List<Person>): List<Person> =
        found.filter { it.count >= 2 && it.best.isNotEmpty() }.sortedByDescending { it.count }

    /**
     * Go through the video at [uri]. [target] limits it to one person (a face already in
     * the list); null finds everyone. Needs a loaded pipeline. Blocking: call off the main
     * thread.
     */
    fun scan(
        ctx: Context, uri: Uri, target: FloatArray?,
        onProgress: (Float) -> Unit, cancelled: () -> Boolean,
        maxLooks: Int = 240, cropMax: Int = 1024, maxPeople: Int = MAX_PEOPLE,
    ): List<Person> {
        val people = mutableListOf<Person>()
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        try {
            extractor.setDataSource(ctx, uri, null)
            var track = -1
            var fmt: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
                    track = i; fmt = f; break
                }
            }
            val vf = fmt ?: return people
            extractor.selectTrack(track)
            val w = vf.getInteger(MediaFormat.KEY_WIDTH)
            val h = vf.getInteger(MediaFormat.KEY_HEIGHT)
            val rotation = if (vf.containsKey(MediaFormat.KEY_ROTATION))
                vf.getInteger(MediaFormat.KEY_ROTATION) else runCatching {
                    val r = android.media.MediaMetadataRetriever()
                    r.setDataSource(ctx, uri)
                    val d = r.extractMetadata(
                        android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                        ?.toIntOrNull() ?: 0
                    r.release(); d
                }.getOrDefault(0)
            val durUs = if (vf.containsKey(MediaFormat.KEY_DURATION))
                vf.getLong(MediaFormat.KEY_DURATION) else 0L
            // About two a second; a long clip is spread over at most [maxLooks] looks.
            val stepUs = maxOf(500_000L, if (durUs > 0) durUs / maxLooks else 500_000L)
            val upW = if (rotation % 180 != 0) h else w
            val upH = if (rotation % 180 != 0) w else h
            val scale = minOf(1f, 1920f / maxOf(upW, upH))
            val outW = ((upW * scale).toInt() and 1.inv()).coerceAtLeast(2)
            val outH = ((upH * scale).toInt() and 1.inv()).coerceAtLeast(2)

            vf.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            val dec = MediaCodec.createDecoderByType(vf.getString(MediaFormat.KEY_MIME)!!)
            decoder = dec
            dec.configure(vf, null, null, 0)
            dec.start()
            val info = MediaCodec.BufferInfo()
            var nextUs = 0L
            var inEos = false
            var outEos = false
            while (!outEos && !cancelled()) {
                if (!inEos) {
                    val ix = dec.dequeueInputBuffer(10_000)
                    if (ix >= 0) {
                        val n = extractor.readSampleData(dec.getInputBuffer(ix)!!, 0)
                        if (n < 0) {
                            dec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inEos = true
                        } else {
                            dec.queueInputBuffer(ix, 0, n, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val ox = dec.dequeueOutputBuffer(info, 10_000)
                if (ox >= 0) {
                    val pts = info.presentationTimeUs
                    if (info.size > 0 && pts >= nextUs) {
                        nextUs = pts + stepUs
                        val bgr = dec.getOutputImage(ox)?.let { img ->
                            try {
                                NativePipe.imageToUprightBgr(img, w, h, rotation, outW, outH)
                            } finally { img.close() }
                        }
                        if (bgr != null) look(people, bgr, outW, outH, pts, target, cropMax, maxPeople)
                        if (durUs > 0) onProgress((pts.toFloat() / durUs).coerceIn(0f, 1f))
                    }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outEos = true
                    dec.releaseOutputBuffer(ox, false)
                }
            }
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor.release() }
        }
        onProgress(1f)
        return people
    }

    private fun look(people: MutableList<Person>, bgr: ByteArray, w: Int, h: Int, pts: Long,
                     target: FloatArray?, cropMax: Int, maxPeople: Int) {
        val r = NativePipe.scanFaces(bgr, w, h)
        val st = NativePipe.SCAN_STRIDE
        for (i in 0 until r.size / st) {
            val o = i * st
            val x1 = r[o]; val y1 = r[o + 1]; val x2 = r[o + 2]; val y2 = r[o + 3]
            val s = Seen(pts, minOf(x2 - x1, y2 - y1), r[o + 4], r[o + 5], r[o + 6],
                         r[o + 7], r[o + 8], r.copyOfRange(o + 9, o + 9 + 512))
            add(people, s, target, maxPeople) { cropFace(bgr, w, h, x1, y1, x2, y2, cropMax) }
        }
    }

    /**
     * The face with room around it (2.2x the box, like a portrait), at most 1024 px, as a
     * bitmap. Enough for the detector and recogniser to find it again as a source photo.
     */
    fun cropFace(bgr: ByteArray, w: Int, h: Int, x1: Float, y1: Float, x2: Float, y2: Float,
                 maxSide: Int = 1024): Bitmap? {
        val cx = (x1 + x2) / 2f; val cy = (y1 + y2) / 2f
        val half = maxOf(x2 - x1, y2 - y1) * 1.1f
        val l = (cx - half).toInt().coerceIn(0, w - 1)
        val t = (cy - half).toInt().coerceIn(0, h - 1)
        val r = (cx + half).toInt().coerceIn(l + 1, w)
        val b = (cy + half).toInt().coerceIn(t + 1, h)
        val cw = r - l; val ch = b - t
        if (cw < 16 || ch < 16) return null
        val step = maxOf(1, (maxOf(cw, ch) + maxSide - 1) / maxSide)
        val ow = cw / step; val oh = ch / step
        val px = IntArray(ow * oh)
        for (y in 0 until oh) {
            val row = ((t + y * step) * w + l) * 3
            for (x in 0 until ow) {
                val k = row + x * step * 3
                val bb = bgr[k].toInt() and 255
                val gg = bgr[k + 1].toInt() and 255
                val rr = bgr[k + 2].toInt() and 255
                px[y * ow + x] = (0xFF shl 24) or (rr shl 16) or (gg shl 8) or bb
            }
        }
        return Bitmap.createBitmap(px, ow, oh, Bitmap.Config.ARGB_8888)
    }

    /** The main face's identity from its photo, for [scan]'s target. Null if none found. */
    fun identityOf(bgr: ByteArray, w: Int, h: Int): FloatArray? {
        val r = NativePipe.scanFaces(bgr, w, h)
        val st = NativePipe.SCAN_STRIDE
        var best = -1; var area = -1f
        for (i in 0 until r.size / st) {
            val a = (r[i * st + 2] - r[i * st]) * (r[i * st + 3] - r[i * st + 1])
            if (a > area) { area = a; best = i }
        }
        if (best < 0) return null
        return r.copyOfRange(best * st + 9, best * st + 9 + 512)
    }
}
