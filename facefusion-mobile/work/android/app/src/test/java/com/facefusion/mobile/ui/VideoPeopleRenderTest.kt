package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
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
class VideoPeopleRenderTest {
    @get:Rule val rule = createComposeRule()

    @Test fun everyonePersonChooseRemoveAndKeep() {
        val bmp = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        var people by mutableStateOf(listOf(
            VideoPersonRow(bmp, 0, 40, null),
            VideoPersonRow(bmp, 61_000, 12, null),
            VideoPersonRow(bmp, 300_500, 25, null)))
        var unknownKeep by mutableStateOf(true)
        var found = false
        var joined: Pair<Int, Int>? = null
        rule.setContent {
            androidx.compose.foundation.layout.Column(
                androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                VideoPeoplePanel(
                    isVideo = true, scanning = null, scanned = true, people = people,
                    sourceThumbs = listOf(bmp, bmp), unknownKeep = unknownKeep, enabled = true,
                    onFind = { found = true }, onCancelScan = {},
                    onChoose = { i, c -> people = people.mapIndexed { k, p ->
                        if (k == i) VideoPersonRow(p.thumb, p.firstMs, p.seen, c) else p } },
                    onRemove = { i -> people = people.filterIndexed { k, _ -> k != i } },
                    onUnknownKeep = { unknownKeep = it },
                    onJoin = { from, into -> joined = from to into },
                )
            }
        }
        rule.onNode(hasText("3 people in this video", substring = true)).assertExists()
        rule.onNode(hasText("First seen 5:00 · seen 25 times")).performScrollTo().assertExists()
        rule.onNode(hasText("First seen 1:01", substring = true)).assertExists()
        // person 1 gets source 2, person 2 keeps their face, person 3 is removed
        rule.onNodeWithTag("vpeople_join_2").performScrollTo().performClick()
        rule.onNodeWithTag("vpeople_join_2_0").performClick()
        rule.waitForIdle()
        assertEquals(2 to 0, joined)
        rule.onNodeWithTag("vpeople_choose_0_1").performScrollTo().performClick()
        rule.onNodeWithTag("vpeople_keep_1").performScrollTo().performClick()
        rule.onNodeWithTag("vpeople_remove_2").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(1, -1), people.map { it.choice })
        rule.onNode(hasText("2 people in this video", substring = true)).assertExists()
        rule.onNodeWithTag("vpeople_unknown_keep").performScrollTo().performClick()
        rule.onNodeWithTag("vpeople_find").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(false, unknownKeep); assertEquals(true, found)
        rule.onNode(hasText("Scan the video again")).assertExists()
        println("VPEOPLE choices=${people.map { it.choice }} unknownKeep=$unknownKeep")
    }

    @Test fun partOfVideoAndTrimNote() {
        var on by mutableStateOf(false)
        var range by mutableStateOf(0f..0f)
        var whole = false
        rule.setContent {
            androidx.compose.foundation.layout.Column(
                androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                VideoPeoplePanel(
                    isVideo = true, scanning = null, scanned = false, people = emptyList(),
                    sourceThumbs = emptyList(), unknownKeep = true, enabled = true,
                    onFind = {}, onCancelScan = {}, onChoose = { _, _ -> }, onRemove = {},
                    onUnknownKeep = {}, durationMs = 7_200_000L,
                    rangeOn = on, rangeMs = range,
                    onRangeOn = { on = it; if (it) range = 1_800_000f..2_700_000f },
                    onRange = { range = it },
                    trimNote = "The swap covers only 0:10 to 1:00:00 (the trim above).",
                    onWholeVideo = { whole = true },
                )
            }
        }
        rule.onNode(hasText("Find everyone in the video")).assertExists()
        rule.onNodeWithTag("vpeople_range_on").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNode(hasText("From 30:00 to 45:00")).assertExists()
        rule.onNode(hasText("Find everyone in this part")).assertExists()
        rule.onNode(hasText("from the beginning of the video to the end", substring = true)).assertExists()
        rule.onNodeWithTag("vpeople_whole_video").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(true, whole)
    }

    @Test fun scanningShowsProgress() {
        rule.setContent {
            VideoPeoplePanel(
                timeLeft = "About 3 min left",
                isVideo = true, scanning = 0.42f, scanned = false, people = emptyList(),
                sourceThumbs = emptyList(), unknownKeep = true, enabled = true,
                onFind = {}, onCancelScan = {}, onChoose = { _, _ -> }, onRemove = {},
                onUnknownKeep = {},
            )
        }
        rule.onNode(hasText("Looking through the whole video… 42%")).assertExists()
        rule.onNodeWithTag("vpeople_cancel").assertExists()
        rule.onNode(hasText("About 3 min left")).assertExists()
        assertEquals("1:01:05", clockOf(3_665_000)); assertEquals("0:07", clockOf(7_900))
    }
}
