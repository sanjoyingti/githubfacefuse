package com.facefusion.mobile

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The background-speed hint must cost nothing on screen: no session while the app is
 * visible, and a phone without the API runs exactly as before.
 */
class RunBoostTest {
    @After fun onScreenAgain() { RunBoost.visible = true }

    @Test fun noHintWhileOnScreen() {
        RunBoost.visible = true
        val b = RunBoost.start(intArrayOf(1, 2, 3))
        repeat(50) { b.report(40_000_000L) }
        assertFalse(b.active)
        b.close()
    }

    @Test fun backgroundWithoutTheApiIsHarmless() {
        val b = RunBoost.start(intArrayOf(1))
        b.report(40_000_000L)              // on screen: learns the pace
        RunBoost.visible = false
        repeat(10) { b.report(80_000_000L) }  // no PerformanceHintManager in a unit test
        assertFalse(b.active)
        b.close()
    }
}
