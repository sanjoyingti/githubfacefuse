package com.facefusion.mobile

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executors

/**
 * "Continue hangs and the app closes": the swap waited for the preview's models with a
 * BLOCKING wait on the main thread. [PipeGuard.await] must leave its thread free.
 */
class PipeGuardTest {
    @Test fun awaitDoesNotBlockItsThread() = runBlocking {
        // One thread, like the main thread.
        val main = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        assertTrue(PipeGuard.acquire("preview"))          // the preview is loading models
        var ticks = 0
        var got = false
        val t0 = System.currentTimeMillis()
        withContext(main) {
            // Other work on the same thread while the swap waits: the screen keeps drawing.
            val ui = launch { repeat(20) { ticks++; delay(20) } }
            // The preview lets go after 300 ms, from another thread.
            Thread { Thread.sleep(300); PipeGuard.release() }.start()
            got = PipeGuard.await("swap", 5000)
            ui.join()
        }
        val waited = System.currentTimeMillis() - t0
        println("PIPEGUARD got=$got waited=${waited}ms uiTicksDuringWait=$ticks")
        assertTrue(got)
        assertEquals(20, ticks)
        assertTrue(waited in 250..3000)
        PipeGuard.release()
        // And a wait that times out says so.
        assertTrue(PipeGuard.acquire("preview"))
        assertFalse(withContext(main) { PipeGuard.await("swap", 200) })
        PipeGuard.release()
        main.close()
    }
}

class EatingPresetTest {
    @Test fun eatingScenesSetsUpTheMouth() {
        val p = SwapOptions().eatingPreset()
        assertTrue(p.lipsFollow); assertTrue(p.lipsAuto); assertTrue(p.lipstickMatch)
        assertEquals(1.0f, p.lipstickStrength, 0f)
        assertTrue(p.occlusionMask); assertTrue(p.keepMouth); assertFalse(p.keepLips)
        // As fast as Strongest likeness: no every-frame detection, Smart speed stays on.
        assertEquals(SwapOptions().likenessPreset().trackPeriod, p.trackPeriod)
        assertTrue(p.smartSpeed)
        assertTrue(p.temporalSmooth); assertTrue(p.sideGuard); assertTrue(p.mouthFocus)
        assertFalse(p.lightMatch)
        assertTrue(p.weight >= 0.75f)
        // Applying it twice changes nothing (the button greys out once applied).
        assertEquals(p, p.eatingPreset())
    }
}

class LikenessPresetTest {
    @Test fun strongestLikenessKeepsTheSourcesFace() {
        val p = SwapOptions().likenessPreset()
        // The parser only keeps hair; the mouth stays the source's with eating handled.
        assertTrue(p.hairOnlyParser); assertFalse(p.regionMask); assertFalse(p.keepLips)
        assertTrue(p.lipsAuto); assertTrue(p.lipstickMatch); assertTrue(p.occlusionMask)
        assertTrue(p.mouthFocus); assertTrue(p.autoWeight)
        assertTrue(p.temporalSmooth); assertTrue(p.sideGuard)
        // The lips follow the filmed mouth, in exactly the source's lip colour.
        assertTrue(p.lipsFollow); assertEquals(1.0f, p.lipstickStrength, 0f)
        assertFalse(p.lightMatch)                 // measured to cost likeness
        assertTrue(p.weight >= 0.75f)
        // New options are all off by default: speed and results as before.
        val d = SwapOptions()
        assertFalse(d.autoWeight || d.hairOnlyParser || d.lightMatch || d.lipsAuto ||
                    d.lipstickMatch || d.mouthFocus || d.bestQualityOutput || d.lipsFollow)
    }
}
