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
            bestP ?: when {
                people.size < maxPeople -> Person().also { people += it }
                else -> {
                    // FULL (a long film): a passer-by seen only once makes room, so a
                    // real person who comes in late is never turned away.
                    val k = people.indexOfFirst { it.count <= 1 }
                    if (k < 0) return
                    people[k].best.values.forEach { it.crop?.recycle() }
                    Person().also { people[k] = it }
                }
            }
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

    /** Where to look next, decided by [nextLook]. Pure; unit-tested. */
    enum class Next { JUMP, DECODE }

    /**
     * After a look at [lookUs]: JUMP to the key frame at [nextSyncUs] when it is close
     * enough (skipping every frame in between without decoding it), else keep DECODING
     * frame by frame so a long gap between key frames is still looked at every [stepUs].
     */
    fun nextLook(lookUs: Long, nextSyncUs: Long, stepUs: Long, maxGapUs: Long): Next =
        if (nextSyncUs > lookUs && nextSyncUs - lookUs <= maxOf(stepUs, maxGapUs)) Next.JUMP
        else Next.DECODE

    /**
     * Go through the video at [uri]. [target] limits it to one person (a face already in
     * the list); null finds everyone. Needs a loaded pipeline. Blocking: call off the main
     * thread.
     *
     * QUICK: frames between two looks are not decoded when a key frame is near (phone
     * videos have one every 1-2 s, so most of the clip is skipped outright); only a clip
     * with key frames far apart is decoded frame by frame. A long clip is split into
     * [parts] pieces decoded side by side (the phone has several hardware decoders); the
     * looks themselves take turns on the one pipeline.
     */
    fun scan(
        ctx: Context, uri: Uri, target: FloatArray?,
        onProgress: (Float) -> Unit, cancelled: () -> Boolean,
        maxLooks: Int = 240, cropMax: Int = 1024, maxPeople: Int = MAX_PEOPLE,
        parts: Int = 1, minStepUs: Long = 500_000L, maxGapUs: Long = 0L,
    ): List<Person> {
        val info = probe(ctx, uri) ?: return emptyList()
        val durUs = info.durUs
        // About two a second; a long clip is spread over at most [maxLooks] looks.
        // maxLooks <= 0: no cap -- one look every [minStepUs] whatever the length.
        val stepUs = if (maxLooks <= 0) minStepUs
                     else maxOf(minStepUs, if (durUs > 0) durUs / maxLooks else minStepUs)
        // Pieces of at least 20 s: below that a second decoder costs more than it saves.
        val n = if (durUs <= 0) 1 else parts.coerceIn(1, maxOf(1, (durUs / 20_000_000L).toInt()))
        val done = FloatArray(n)
        val report = { k: Int, f: Float ->
            synchronized(done) { done[k] = f; onProgress(done.sum() / n) }
        }
        val results = arrayOfNulls<MutableList<Person>>(n)
        val failed = BooleanArray(n)
        val run = { k: Int ->
            val from = if (n == 1) 0L else durUs * k / n
            val to = if (n == 1 || k == n - 1) Long.MAX_VALUE else durUs * (k + 1) / n
            val ppl = mutableListOf<Person>()
            try {
                scanPart(ctx, uri, info, from, to, stepUs, maxGapUs, target, ppl, cropMax, maxPeople,
                         { f -> report(k, f) }, cancelled)
            } catch (t: Throwable) {
                android.util.Log.w("VideoFacePicker", "part $k: $t")
                failed[k] = true
            }
            results[k] = ppl
        }
        if (n == 1) run(0)
        else {
            val threads = (1 until n).map { k -> Thread({ run(k) }, "vscan-$k").apply { start() } }
            run(0)
            threads.forEach { it.join() }
            // A piece whose decoder could not start (too many at once) is done again alone.
            for (k in 0 until n) if (failed[k] && !cancelled()) {
                results[k]?.forEach { p -> p.best.values.forEach { it.crop?.recycle() } }
                failed[k] = false; run(k)
            }
        }
        val people = mutableListOf<Person>()
        for (r in results) r?.let { people += it }
        if (n > 1) {
            if (target != null) {
                // One person, found in several pieces: one entry, as with a single piece.
                while (people.size > 1) {
                    val b = people.removeAt(people.size - 1)
                    val a = people[0]
                    for (i in 0 until 512) a.sum[i] += b.sum[i]
                    a.count += b.count; a.firstUs = minOf(a.firstUs, b.firstUs)
                    for ((ang, sb) in b.best) {
                        val sa = a.best[ang]
                        if (sa == null || sb.quality > sa.quality) { sa?.crop?.recycle(); a.best[ang] = sb }
                        else sb.crop?.recycle()
                    }
                }
            } else joinParts(people)
        }
        onProgress(1f)
        return people
    }

    /** People found in different pieces who are the same person become one (as in [add]). */
    private fun joinParts(people: MutableList<Person>) {
        var joined = true
        while (joined) {
            joined = false
            loop@ for (a in people.indices) for (b in a + 1 until people.size) {
                if (cos(people[a].meanNorm(), people[b].meanNorm()) < SAME_PERSON) continue
                val pa = people[a]; val pb = people[b]
                for (i in 0 until 512) pa.sum[i] += pb.sum[i]
                pa.count += pb.count; pa.firstUs = minOf(pa.firstUs, pb.firstUs)
                for ((ang, sb) in pb.best) {
                    val sa = pa.best[ang]
                    if (sa == null || sb.quality > sa.quality) { sa?.crop?.recycle(); pa.best[ang] = sb }
                    else sb.crop?.recycle()
                }
                people.removeAt(b); joined = true; break@loop
            }
        }
    }

    /** What the scan needs to know about the video track. */
    class Probe(val track: Int, val format: MediaFormat, val w: Int, val h: Int,
                val rotation: Int, val durUs: Long)

    private fun probe(ctx: Context, uri: Uri): Probe? {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(ctx, uri, null)
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") != true) continue
                val rotation = if (f.containsKey(MediaFormat.KEY_ROTATION))
                    f.getInteger(MediaFormat.KEY_ROTATION) else runCatching {
                        val r = android.media.MediaMetadataRetriever()
                        r.setDataSource(ctx, uri)
                        val d = r.extractMetadata(
                            android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                            ?.toIntOrNull() ?: 0
                        r.release(); d
                    }.getOrDefault(0)
                val durUs = if (f.containsKey(MediaFormat.KEY_DURATION))
                    f.getLong(MediaFormat.KEY_DURATION) else 0L
                return Probe(i, f, f.getInteger(MediaFormat.KEY_WIDTH),
                             f.getInteger(MediaFormat.KEY_HEIGHT), rotation, durUs)
            }
            return null
        } finally {
            runCatching { extractor.release() }
        }
    }

    /** One piece [fromUs, toUs) of the video, with its own extractor and decoder. */
    private fun scanPart(
        ctx: Context, uri: Uri, info: Probe, fromUs: Long, toUs: Long, stepUs: Long,
        maxGapUs: Long, target: FloatArray?, people: MutableList<Person>, cropMax: Int, maxPeople: Int,
        onProgress: (Float) -> Unit, cancelled: () -> Boolean,
    ) {
        val extractor = MediaExtractor()
        // A second reader, only to ask "where is the next key frame" -- the decoding
        // reader's position is never disturbed by the question.
        val syncs = MediaExtractor()
        var decoder: MediaCodec? = null
        try {
            extractor.setDataSource(ctx, uri, null)
            extractor.selectTrack(info.track)
            syncs.setDataSource(ctx, uri, null)
            syncs.selectTrack(info.track)
            val w = info.w; val h = info.h; val rotation = info.rotation
            val upW = if (rotation % 180 != 0) h else w
            val upH = if (rotation % 180 != 0) w else h
            val scale = minOf(1f, 1920f / maxOf(upW, upH))
            val outW = ((upW * scale).toInt() and 1.inv()).coerceAtLeast(2)
            val outH = ((upH * scale).toInt() and 1.inv()).coerceAtLeast(2)
            val vf = MediaFormat(info.format)
            vf.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            // Not playback: ask the decoder to run as fast as it can.
            runCatching {
                vf.setInteger(MediaFormat.KEY_PRIORITY, 1)
                vf.setInteger(MediaFormat.KEY_OPERATING_RATE, Short.MAX_VALUE.toInt())
            }
            val dec = MediaCodec.createDecoderByType(vf.getString(MediaFormat.KEY_MIME)!!)
            decoder = dec
            try { dec.configure(vf, null, null, 0) }
            catch (e: Exception) {
                // Some decoders refuse the speed hints; configure plainly instead.
                vf.removeKey(MediaFormat.KEY_OPERATING_RATE); vf.removeKey(MediaFormat.KEY_PRIORITY)
                dec.configure(vf, null, null, 0)
            }
            dec.start()
            if (fromUs > 0) extractor.seekTo(fromUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val span = (if (toUs == Long.MAX_VALUE) info.durUs else toUs) - fromUs
            val bufInfo = MediaCodec.BufferInfo()
            var nextUs = fromUs     // the next look is at or after this time
            var inEos = false
            var outEos = false
            var jumpTo = -1L
            while (!outEos && !cancelled()) {
                if (!inEos) {
                    val ix = dec.dequeueInputBuffer(10_000)
                    if (ix >= 0) {
                        if (jumpTo >= 0) {
                            // Skip ahead to the key frame of the next look. Only forward:
                            // a reader already there (or past it) just carries on.
                            if (jumpTo > extractor.sampleTime && extractor.sampleTime >= 0) {
                                extractor.seekTo(jumpTo, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                                // Frames shown before the key frame may lean on skipped
                                // ones: the next look is the key frame itself or later.
                                nextUs = maxOf(nextUs, extractor.sampleTime)
                            }
                            jumpTo = -1L
                        }
                        val n = extractor.readSampleData(dec.getInputBuffer(ix)!!, 0)
                        val t = extractor.sampleTime
                        if (n < 0 || (toUs != Long.MAX_VALUE && t >= toUs)) {
                            dec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inEos = true
                        } else {
                            dec.queueInputBuffer(ix, 0, n, t, 0)
                            extractor.advance()
                        }
                    }
                }
                val ox = dec.dequeueOutputBuffer(bufInfo, 10_000)
                if (ox >= 0) {
                    val pts = bufInfo.presentationTimeUs
                    if (bufInfo.size > 0 && pts >= nextUs && pts < toUs) {
                        nextUs = pts + stepUs
                        val bgr = dec.getOutputImage(ox)?.let { img ->
                            try {
                                NativePipe.imageToUprightBgr(img, w, h, rotation, outW, outH)
                            } finally { img.close() }
                        }
                        if (bgr != null) look(people, bgr, outW, outH, pts, target, cropMax, maxPeople)
                        if (span > 0) onProgress(((pts - fromUs).toFloat() / span).coerceIn(0f, 1f))
                        // A key frame close to the next look: jump straight to it.
                        if (!inEos) {
                            syncs.seekTo(nextUs, MediaExtractor.SEEK_TO_NEXT_SYNC)
                            val s = syncs.sampleTime
                            if (s >= 0 && nextLook(pts, s, stepUs, maxGapUs) == Next.JUMP &&
                                s > extractor.sampleTime) jumpTo = s
                        }
                    }
                    if (bufInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outEos = true
                    dec.releaseOutputBuffer(ox, false)
                }
            }
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { extractor.release() }
            runCatching { syncs.release() }
        }
        onProgress(1f)
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
