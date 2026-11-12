package com.facefusion.mobile

import android.graphics.Bitmap
import com.facefusion.mobile.SourcePhotos.Angle
import com.facefusion.mobile.SourcePhotos.Warn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhotoCheckTest {
    private fun face(x1: Float, y1: Float, x2: Float, y2: Float, yaw: Float = 0f, pitch: Float = 0f,
                     sharp: Float = 200f, bright: Float = 120f, emb: FloatArray = FloatArray(512)): FloatArray {
        val f = FloatArray(NativePipe.SCAN_STRIDE)
        f[0] = x1; f[1] = y1; f[2] = x2; f[3] = y2; f[4] = 0.9f; f[5] = yaw; f[6] = pitch
        f[7] = sharp; f[8] = bright
        emb.copyInto(f, 9)
        return f
    }

    @Test fun assessGoodAndBadPhotos() {
        assertEquals(listOf(Warn.NO_FACE), SourcePhotos.assess(FloatArray(0)).warnings)
        val good = SourcePhotos.assess(face(0f, 0f, 300f, 320f))
        assertTrue(good.warnings.isEmpty()); assertEquals(Angle.FRONT, good.angle)
        val bad = SourcePhotos.assess(face(0f, 0f, 80f, 90f, yaw = 50f, sharp = 5f, bright = 30f))
        println("BAD ${bad.warnings} ${bad.angle}")
        assertEquals(listOf(Warn.SMALL, Warn.BLURRY, Warn.DARK, Warn.TURNED), bad.warnings)
        assertEquals(Angle.RIGHT, bad.angle)
        val two = SourcePhotos.assess(face(0f, 0f, 300f, 300f) + face(400f, 0f, 650f, 260f))
        assertTrue(Warn.MANY_FACES in two.warnings)
        assertEquals(Angle.LEFT, SourcePhotos.angleOf(-30f, 5f))
        assertEquals(Angle.UP, SourcePhotos.angleOf(5f, -25f))
        assertEquals(Angle.DOWN, SourcePhotos.angleOf(5f, 25f))
        assertEquals(null, SourcePhotos.angleOf(Float.NaN, 0f))
    }

    @Test fun sameAngleIsFlagged() {
        androidx.compose.runtime.snapshots.Snapshot.withMutableSnapshot {
        SourcePhotos.checks.clear()
        SourcePhotos.checks["a"] = SourcePhotos.Check(Angle.FRONT, emptyList())
        SourcePhotos.checks["b"] = SourcePhotos.Check(Angle.LEFT, emptyList())
        SourcePhotos.checks["c"] = SourcePhotos.Check(Angle.FRONT, emptyList())
        }
        val w = SourcePhotos.warningsFor(listOf("a", "b", "c", "d"))
        assertTrue(w[0]!!.warnings.isEmpty()); assertTrue(w[1]!!.warnings.isEmpty())
        assertEquals(listOf(Warn.SAME_ANGLE), w[2]!!.warnings); assertEquals(null, w[3])
        androidx.compose.runtime.snapshots.Snapshot.withMutableSnapshot { SourcePhotos.checks.clear() }
        androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
    }

    private fun unit(seed: Int, noise: Float = 0f): FloatArray {
        val r = java.util.Random(seed.toLong())
        val v = FloatArray(512) { r.nextGaussian().toFloat() }
        if (noise > 0f) { val q = java.util.Random(seed * 31L + 7); for (i in v.indices) v[i] += noise * q.nextGaussian().toFloat() }
        return VideoFacePicker.normalised(v)
    }

    @Test fun pickerGroupsPeopleAndPicksBestAngles() {
        val bmp = { Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888) }
        val a = unit(1); val b = unit(2)
        val people = mutableListOf<VideoFacePicker.Person>()
        var crops = 0
        var clock = 0L   // each face at its own moment: one person, one face per look
        fun seen(e: FloatArray, yaw: Float, sharp: Float, side: Float = 200f, seed: Int = 0) =
            VideoFacePicker.Seen(1_000_000L * clock++, side, 0.9f, yaw, 0f, sharp, 120f,
                                 VideoFacePicker.normalised(FloatArray(512) { e[it] + 0.3f * (if (seed % 2 == 0) 0.01f else -0.01f) }))
        // person A: front twice (second sharper), left once; person B: front; a tiny face is ignored
        for (s in listOf(seen(a, 0f, 50f), seen(a, 2f, 200f, seed = 1), seen(a, -30f, 120f),
                         seen(b, 0f, 100f), seen(b, 1f, 90f), seen(a, 0f, 300f, side = 30f)))
            VideoFacePicker.add(people, s, null) { crops++; bmp() }
        assertEquals(2, people.size)
        val pa = people.first { it.count == 3 }
        assertEquals(setOf(Angle.FRONT, Angle.LEFT), pa.best.keys)
        assertEquals(200f, pa.best[Angle.FRONT]!!.sharp)
        val picks = VideoFacePicker.pick(pa, emptySet(), 4)
        assertEquals(listOf(Angle.FRONT, Angle.LEFT), picks.map { it.angle })
        assertEquals(listOf(Angle.LEFT), VideoFacePicker.pick(pa, setOf(Angle.FRONT), 4).map { it.angle })
        assertEquals(2, VideoFacePicker.people(people).size)
        // with a target, only the matching person counts
        val only = mutableListOf<VideoFacePicker.Person>()
        for (s in listOf(seen(a, 0f, 100f), seen(b, 0f, 100f), seen(a, 25f, 80f)))
            VideoFacePicker.add(only, s, a) { bmp() }
        assertEquals(1, only.size); assertEquals(2, only[0].count)
        assertEquals(setOf(Angle.FRONT, Angle.RIGHT), only[0].best.keys)
        println("PICKER people=${people.size} crops=$crops target=${only[0].count}")
    }

    @Test fun longFilmLatePersonIsNotTurnedAway() {
        val bmp = { Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888) }
        val found = mutableListOf<VideoFacePicker.Person>()
        fun seen(t: Long, e: FloatArray) = VideoFacePicker.Seen(t, 200f, 0.9f, 0f, 0f, 150f, 120f, e)
        // 4 regulars seen twice each, then passers-by seen once fill the list (max 6)
        for (k in 0 until 4) repeat(3) { VideoFacePicker.add(found, seen(k * 1_000_000L + it * 100_000_000L, unit(100 + k)), null, 6) { bmp() } }
        for (k in 0 until 2) VideoFacePicker.add(found, seen(10_000_000L, unit(200 + k)), null, 6) { bmp() }
        assertEquals(6, found.size)
        // the main actor comes in at 1 h 40 min: a passer-by makes room
        val late = unit(300)
        repeat(3) { VideoFacePicker.add(found, seen(6_000_000_000L + it, late), null, 6) { bmp() } }
        val everyone = VideoFacePicker.everyone(found)
        assertEquals(5, everyone.size)
        assertEquals(6_000_000_000L, everyone.last().firstUs)
        assertEquals(3, everyone.last().count)
    }

    /**
     * Real faces from two clips (dumped by native/test_quality --dump-emb): a dance clip
     * with 3 people and a TikTok clip with 2. One picture per person, at any scan speed,
     * and also as a "film" where both clips play twice (people come back later).
     */
    private fun realFaces(name: String, offsetUs: Long, every: Int): List<VideoFacePicker.Seen> {
        val b = javaClass.classLoader!!.getResourceAsStream("people/$name")!!.readBytes()
        val buf = java.nio.ByteBuffer.wrap(b).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val out = mutableListOf<VideoFacePicker.Seen>()
        while (buf.remaining() >= 544) {
            val frame = buf.int
            val h = FloatArray(7) { buf.float }
            val e = FloatArray(512) { buf.get().toFloat() }
            if (frame % every != 0) continue
            out += VideoFacePicker.Seen(offsetUs + frame * 33_333L,
                minOf(h[2] - h[0], h[3] - h[1]), h[4], h[5], h[6], 150f, 120f,
                VideoFacePicker.normalised(e))
        }
        return out
    }

    private fun groups(vararg clips: List<VideoFacePicker.Seen>): List<Int> {
        val bmp = { Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888) }
        val found = mutableListOf<VideoFacePicker.Person>()
        for (clip in clips)
            for ((_, look) in clip.groupBy { it.timeUs }.toSortedMap())
                for (s in look.sortedByDescending { it.side })
                    VideoFacePicker.add(found, s, null, 120) { bmp() }
        return VideoFacePicker.everyone(found).map { it.count }
    }

    @Test fun onePicturePerPersonOnRealClips() {
        // Faces were taken at 30 (dance) and 10 (TikTok) frames a second; the app looks
        // about once a second. The dance clip's second and third girls look almost alike
        // to the recogniser (0.84), so it is 2 or 3 there; the others must be exact.
        for (every in listOf(2, 5, 10, 15)) {
            val dance = groups(realFaces("dance3.emb", 0, every))
            val tik = groups(realFaces("tiktok2.emb", 0, every))
            val film = groups(realFaces("dance3.emb", 0, every), realFaces("tiktok2.emb", 100_000_000, every),
                              realFaces("dance3.emb", 200_000_000, every), realFaces("tiktok2.emb", 300_000_000, every))
            println("PEOPLE every=$every dance=$dance tiktok=$tik film=$film")
            assertTrue(dance.size in 2..3); assertEquals(2, tik.size)
            // People who come back later are the same entry, never a second one: at most
            // the 5 people there are (a girl seen too little in one clip may count once
            // the clip plays twice).
            assertTrue(film.size in (dance.size + tik.size)..5)
        }
    }

    @Test fun optionalNpuModelsOnlyWhenTheirSettingIsOn() {
        val bundled = listOf("xseg_v79.bin", "bisenet_v79.bin", "peppa_v79.bin", "bisenet34_v79.bin",
                             "gpen512_v79.bin.001", "gpen512_v79.bin.000")
        assertEquals(setOf("xseg_v79.bin", "bisenet_v79.bin", "peppa_v79.bin"),
                     ModelPaths.npuTargets(bundled, emptySet()).keys)
        val all = ModelPaths.npuTargets(bundled, setOf("bisenet34", "gpen512"))
        assertEquals(listOf("gpen512_v79.bin.000", "gpen512_v79.bin.001"), all["gpen512_v79.bin"])
        assertEquals(6 - 1, all.size)
    }

    @Test fun quickScanJumpsOnlyToNearKeyFrames() {
        val J = VideoFacePicker.Next.JUMP; val D = VideoFacePicker.Next.DECODE
        // phone video, key frame every second: skip straight to it
        assertEquals(J, VideoFacePicker.nextLook(0L, 1_000_000L, 1_000_000L, 2_500_000L))
        assertEquals(J, VideoFacePicker.nextLook(0L, 2_000_000L, 1_000_000L, 2_500_000L))
        // key frames 7 s apart: decode in order, so nobody in between is missed
        assertEquals(D, VideoFacePicker.nextLook(0L, 7_000_000L, 1_000_000L, 2_500_000L))
        // photo picker (no extra gap allowed): only when the key frame is the next look
        assertEquals(J, VideoFacePicker.nextLook(0L, 500_000L, 500_000L, 0L))
        assertEquals(D, VideoFacePicker.nextLook(0L, 1_000_000L, 500_000L, 0L))
        // never backwards
        assertEquals(D, VideoFacePicker.nextLook(3_000_000L, 2_000_000L, 1_000_000L, 2_500_000L))
    }

    @Test fun everyoneMergesSidesAndOrdersByFirstSeen() {
        val bmp = { Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888) }
        val a = unit(11); val b = unit(12)
        // a2: the same person as a, but far enough to start a group of its own (other side)
        val u = unit(13); val ua = VideoFacePicker.cos(u, a)
        val orth = VideoFacePicker.normalised(FloatArray(512) { u[it] - ua * a[it] })
        val k = Math.sqrt(1.0 / (0.36 * 0.36) - 1.0).toFloat()   // cos(a, a2) = 0.36
        val a2 = VideoFacePicker.normalised(FloatArray(512) { a[it] + k * orth[it] })
        val cAA2 = VideoFacePicker.cos(a, a2)
        val found = mutableListOf<VideoFacePicker.Person>()
        fun seen(t: Long, e: FloatArray, yaw: Float) =
            VideoFacePicker.Seen(t, 200f, 0.9f, yaw, 0f, 150f, 120f, e)
        for (s in listOf(seen(5_000_000, b, 0f), seen(6_000_000, b, 0f), seen(7_000_000, b, 0f),
                         seen(60_000_000, a2, -35f), seen(61_000_000, a2, -35f), seen(62_000_000, a2, -35f),
                         seen(1_000_000, a, 0f), seen(2_000_000, a, 0f), seen(3_000_000, a, 0f)))
            VideoFacePicker.add(found, s, null, 24) { bmp() }
        assertEquals(3, found.size)
        println("EVERYONE groups before merge=${found.size} cos(a,a2)=$cAA2")
        val everyone = VideoFacePicker.everyone(found)
        assertEquals(3, found.size + 1)          // merged in place: a and a2 became one
        assertEquals(2, everyone.size)
        assertEquals(1_000_000L, everyone[0].firstUs)
        assertTrue(everyone.zipWithNext().all { (x, y) -> x.firstUs <= y.firstUs })
        assertTrue(everyone[0].identities().size >= 2)
    }
}
