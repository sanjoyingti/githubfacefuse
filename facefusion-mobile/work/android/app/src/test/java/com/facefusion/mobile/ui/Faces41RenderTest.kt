package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.facefusion.mobile.SourcePhotos
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class Faces41RenderTest {
    @get:Rule val rule = createComposeRule()

    @Test fun fivePhotosWarningsVideoAndSave() {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        var fromVideo = -2; var saved = -1; var newFromVideo = false; var openSaved = false
        rule.setContent {
            FacesScreen(
                faces = listOf(FaceCard(listOf(
                    SourcePhotoTile(bmp, true, null, SourcePhotos.Check(SourcePhotos.Angle.FRONT, emptyList())),
                    SourcePhotoTile(bmp, false, 1, SourcePhotos.Check(SourcePhotos.Angle.LEFT,
                        listOf(SourcePhotos.Warn.BLURRY)))), active = true, saved = false)),
                max = SourcePhotos.MAX, enabled = true,
                onAddPerson = {}, onAddPhoto = {}, onRemovePhoto = { _, _ -> },
                onUseFace = {}, onRemoveFace = {},
                onFromVideo = { fromVideo = it }, onAddPersonFromVideo = { newFromVideo = true },
                onSavePerson = { saved = it }, onOpenSaved = { openSaved = true },
            )
        }
        rule.onNode(hasText("2 of 5", substring = true)).assertExists()
        rule.onNode(hasText("Blurry", substring = true)).assertExists()
        rule.onNode(hasText("Main photo", substring = true)).assertExists()
        // empty slots name the missing angles
        rule.onNode(hasText("Turned right")).performScrollTo().assertExists()
        rule.onNode(hasText("Looking up")).performScrollTo().assertExists()
        rule.onNode(hasText("Looking down")).performScrollTo().assertExists()
        rule.onNode(hasText("From a video")).performScrollTo().performClick()
        rule.onNode(hasText("Save person")).performScrollTo().performClick()
        rule.onNode(hasText("Add a person from a video")).performScrollTo().performClick()
        rule.onNode(hasText("Saved people")).performScrollTo().performClick()
        println("FACES41 fromVideo=$fromVideo saved=$saved new=$newFromVideo openSaved=$openSaved")
        assertEquals(0, fromVideo); assertEquals(0, saved)
        assertEquals(true, newFromVideo); assertEquals(true, openSaved)
    }

    @Test fun videoPickReviewTogglesAndAdds() {
        val bmp = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        var checked by androidx.compose.runtime.mutableStateOf(setOf(0, 1, 2))
        var added = false
        rule.setContent {
            VideoPickDialog(
                title = "Photos", progress = null, people = null, onPickPerson = {},
                photos = listOf(FoundPhoto(bmp, "Front"), FoundPhoto(bmp, "Turned left"),
                                FoundPhoto(bmp, "Turned right"), FoundPhoto(bmp, "Looking up")),
                checked = checked,
                onToggle = { k -> checked = if (k in checked) checked - k else checked + k },
                onAdd = { added = true }, message = null, onCancel = {},
            )
        }
        rule.onNode(hasText("Add 3")).assertExists()
        rule.onNodeWithTag("vpick_photo_3").performClick()
        rule.onNode(hasText("Add 4")).performClick()
        println("VPICK checked=$checked added=$added")
        assertEquals(setOf(0, 1, 2, 3), checked); assertEquals(true, added)
    }

    @Test fun videoPickPeopleAndProgress() {
        var picked = -1
        rule.setContent {
            androidx.compose.foundation.layout.Column {
                VideoPickDialog(title = "New", progress = null,
                    people = listOf(FoundPerson(null, 10, "Seen 10 times · 3 angle(s)"),
                                    FoundPerson(null, 4, "Seen 4 times · 1 angle(s)")),
                    onPickPerson = { picked = it }, photos = null, checked = emptySet(),
                    onToggle = {}, onAdd = {}, message = null, onCancel = {})
            }
        }
        rule.onNode(hasText("Person 2")).performClick()
        assertEquals(1, picked)
    }
}
