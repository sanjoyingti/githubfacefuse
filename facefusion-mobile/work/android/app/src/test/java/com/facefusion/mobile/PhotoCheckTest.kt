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
        fun seen(e: FloatArray, yaw: Float, sharp: Float, side: Float = 200f, seed: Int = 0) =
            VideoFacePicker.Seen(0L, side, 0.9f, yaw, 0f, sharp, 120f,
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
}
