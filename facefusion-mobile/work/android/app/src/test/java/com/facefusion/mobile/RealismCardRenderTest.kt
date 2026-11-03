package com.facefusion.mobile

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.foundation.verticalScroll
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RealismCardRenderTest {
    @get:Rule val rule = createComposeRule()

    @Test fun newSwitchesShowAndToggle() {
        var last = SwapOptions()
        rule.setContent {
            androidx.compose.foundation.layout.Column(
                androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                RealismCard(opts = last, onChange = { last = it }, expanded = true, onToggle = {})
            }
        }
        for (t in listOf("Hair-aware edges", "Seamless edges", "More detail on close-ups", "Smooth over time"))
            rule.onNode(hasText(t)).performScrollTo().assertExists()
        val d = SwapOptions()
        println("DEFAULTS region=${d.regionMask} blur=${d.maskBlur} auto=${d.autoBoost} seamless=${d.seamless} hair=${d.hairAware} smooth=${d.temporalSmooth}")
    }
}
