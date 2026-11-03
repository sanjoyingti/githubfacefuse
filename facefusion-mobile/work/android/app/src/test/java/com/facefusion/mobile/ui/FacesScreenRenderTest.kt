package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FacesScreenRenderTest {
    @get:Rule val rule = createComposeRule()

    @Test fun addPhotoAndRemoveWork() {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        var added = -1; var removed = -1 to -1; var used = -1
        rule.setContent {
            FacesScreen(
                faces = listOf(
                    FaceCard(listOf(SourcePhotoTile(bmp, true, null), SourcePhotoTile(bmp, false, 1)), active = true),
                    FaceCard(listOf(SourcePhotoTile(bmp, true, null)), active = false),
                ),
                max = 3, enabled = true,
                onAddPerson = {}, onAddPhoto = { added = it },
                onRemovePhoto = { f, k -> removed = f to k }, onUseFace = { used = it }, onRemoveFace = {},
            )
        }
        rule.onAllNodes(hasText("Add photo"))[1].performScrollTo().performClick()
        rule.onAllNodes(androidx.compose.ui.test.hasContentDescription("Remove this photo"))[0].performScrollTo().performClick()
        rule.onNode(hasText("Use")).performScrollTo().performClick()
        println("FACES added=$added removed=$removed used=$used")
        assertEquals(1, added); assertEquals(0 to 0, removed); assertEquals(1, used)
        rule.onNode(hasText("1 of 3", substring = true)).assertExists()
        rule.onNode(hasText("2 of 3", substring = true)).assertExists()
        rule.onNode(hasText("Add a new person")).assertExists()
    }
}
