package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import com.facefusion.mobile.SourcePhotos
import com.facefusion.mobile.SwapOptions
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SwapScreenRenderTest {
    @get:Rule val rule = createComposeRule()

    @Test fun photosButtonShows() {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        SourcePhotos.opener = null
        SourcePhotos.openFor = -1
        rule.setContent {
            SwapScreen(
                sourceThumb = bmp,
                sourceThumbs = listOf(bmp),
                hasSource = true,
                hasTarget = false,
                imageTarget = false,
                durationMs = 0L,
                trimStartMs = 0f,
                trimEndMs = 0f,
                onTrimChange = { _, _, _ -> },
                targetAspect = 0f,
                inputFps = 0,
                targetW = 0,
                targetH = 0,
                fmt = { it.toString() },
                preview = PreviewUi(),
                run = RunUi(),
                status = "",
                statusIsError = false,
                log = "",
                opts = SwapOptions(),
                onOptsChange = { _ -> },
                hasEnhancer = false,
                hasLipSyncer = false,
                onRequestModel = { _, _ -> },
                showFaceBoxes = false,
                batch = emptyList(),
                onRemoveFromBatch = { _ -> },
                onAddToBatch = { },
                onLivePlay = { },
                onOpenBatchOutput = { _ -> },
                outputAutoSaved = false,
                batchAutoSave = false,
                onBatchAutoSave = { _ -> },
                openCard = "",
                onToggleCard = { _ -> },
                hasOutput = false,
                outputFile = null,
                outputPartial = false,
                onSaveFrame = { _ -> },
                saved = false,
                savedPath = null,
                onPickSource = { },
                onPickTarget = { },
                hasVoice = false,
                voiceName = null,
                voiceDurationMs = 0L,
                voiceTrimStartMs = 0f,
                voiceTrimEndMs = 0f,
                onVoiceTrimChange = { _, _ -> },
                voicePosMs = 0f,
                voicePlaying = false,
                onVoicePlayPause = { },
                onVoiceSeek = { _ -> },
                onPickVoice = { },
                onClearVoice = { },
                recordingVoice = false,
                onToggleRecordVoice = { },
                onSavePreviewFrame = { },
                onClearSource = { },
                onCaptureSource = { },
                onCapturePhoto = { },
                onCaptureVideo = { },
                onClearTarget = { },
                onDeleteOutput = { },
                onSwap = { },
                onCancel = { },
                modelsMissing = false,
                onDownload = { },
                onShareLog = { },
                onSave = { },
                onShare = { },
                modifier = Modifier,


            )
        }
        for (d in listOf("Saved faces", "Photos of this person", "Keep this face", "Take a source photo", "Remove source face", "Source 1"))
            println("BOUNDS " + d + " = " + rule.onNode(androidx.compose.ui.test.hasContentDescription(d), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
        println("BOUNDS button = " + rule.onNode(androidx.compose.ui.test.hasText("More photos", substring = true), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
        rule.onNode(androidx.compose.ui.test.hasContentDescription("Photos of this person"), useUnmergedTree = true).performClick()
        println("OPENFOR after tap = " + SourcePhotos.openFor)
        println("BOUNDS target = " + rule.onNode(androidx.compose.ui.test.hasContentDescription("Take a photo"), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot)
    }

    @Test fun testButtonAndEstimateShow() {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        var tested = 0
        rule.setContent {
            SwapScreen(
                sourceThumb = bmp,
                sourceThumbs = listOf(bmp),
                hasSource = true,
                hasTarget = true,
                imageTarget = false,
                durationMs = 20_000L,
                trimStartMs = 0f,
                trimEndMs = 20_000f,
                onTrimChange = { _, _, _ -> },
                targetAspect = 0f,
                inputFps = 0,
                targetW = 0,
                targetH = 0,
                fmt = { it.toString() },
                preview = PreviewUi(),
                run = RunUi(),
                status = "",
                statusIsError = false,
                log = "",
                opts = SwapOptions(),
                onOptsChange = { _ -> },
                hasEnhancer = false,
                hasLipSyncer = false,
                onRequestModel = { _, _ -> },
                showFaceBoxes = false,
                batch = emptyList(),
                onRemoveFromBatch = { _ -> },
                onAddToBatch = { },
                onLivePlay = { },
                onOpenBatchOutput = { _ -> },
                outputAutoSaved = false,
                batchAutoSave = false,
                onBatchAutoSave = { _ -> },
                openCard = "",
                onToggleCard = { _ -> },
                hasOutput = false,
                outputFile = null,
                outputPartial = false,
                onSaveFrame = { _ -> },
                saved = false,
                savedPath = null,
                onPickSource = { },
                onPickTarget = { },
                hasVoice = false,
                voiceName = null,
                voiceDurationMs = 0L,
                voiceTrimStartMs = 0f,
                voiceTrimEndMs = 0f,
                onVoiceTrimChange = { _, _ -> },
                voicePosMs = 0f,
                voicePlaying = false,
                onVoicePlayPause = { },
                onVoiceSeek = { _ -> },
                onPickVoice = { },
                onClearVoice = { },
                recordingVoice = false,
                onToggleRecordVoice = { },
                onSavePreviewFrame = { },
                onClearSource = { },
                onCaptureSource = { },
                onCapturePhoto = { },
                onCaptureVideo = { },
                onClearTarget = { },
                onDeleteOutput = { },
                onSwap = { },
                onTest3s = { tested++ },
                estimate = "About 2 min · phone gets warm",
                onCancel = { },
                modelsMissing = false,
                onDownload = { },
                onShareLog = { },
                onSave = { },
                onShare = { },
                modifier = Modifier,


            )
        }
        rule.onNode(androidx.compose.ui.test.hasText("About 2 min", substring = true)).performScrollTo().assertExists()
        rule.onNode(androidx.compose.ui.test.hasText("Test 3 seconds")).performScrollTo().performClick()
        println("TEST3S tapped=$tested")
        org.junit.Assert.assertEquals(1, tested)
    }

    @Test fun resumeButtonsWork() {
        val bmp = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        var resumed = 0; var part = 0; var discarded = 0; var fresh = 0
        rule.setContent {
            SwapScreen(
                sourceThumb = bmp,
                sourceThumbs = listOf(bmp),
                hasSource = true,
                hasTarget = true,
                imageTarget = false,
                durationMs = 20_000L,
                trimStartMs = 0f,
                trimEndMs = 20_000f,
                onTrimChange = { _, _, _ -> },
                targetAspect = 0f,
                inputFps = 0,
                targetW = 0,
                targetH = 0,
                fmt = { it.toString() },
                preview = PreviewUi(),
                run = RunUi(),
                status = "",
                statusIsError = false,
                log = "",
                opts = SwapOptions(),
                onOptsChange = { _ -> },
                hasEnhancer = false,
                hasLipSyncer = false,
                onRequestModel = { _, _ -> },
                showFaceBoxes = false,
                batch = emptyList(),
                onRemoveFromBatch = { _ -> },
                onAddToBatch = { },
                onLivePlay = { },
                onOpenBatchOutput = { _ -> },
                outputAutoSaved = false,
                batchAutoSave = false,
                onBatchAutoSave = { _ -> },
                openCard = "",
                onToggleCard = { _ -> },
                hasOutput = false,
                outputFile = null,
                outputPartial = false,
                onSaveFrame = { _ -> },
                saved = false,
                savedPath = null,
                onPickSource = { },
                onPickTarget = { },
                hasVoice = false,
                voiceName = null,
                voiceDurationMs = 0L,
                voiceTrimStartMs = 0f,
                voiceTrimEndMs = 0f,
                onVoiceTrimChange = { _, _ -> },
                voicePosMs = 0f,
                voicePlaying = false,
                onVoicePlayPause = { },
                onVoiceSeek = { _ -> },
                onPickVoice = { },
                onClearVoice = { },
                recordingVoice = false,
                onToggleRecordVoice = { },
                onSavePreviewFrame = { },
                onClearSource = { },
                onCaptureSource = { },
                onCapturePhoto = { },
                onCaptureVideo = { },
                onClearTarget = { },
                onDeleteOutput = { },
                onSwap = { },
                resumeLabel = "Continue unfinished swap: clip (0:06.0 of 0:10.3 done)",
                onResume = { resumed++ },
                onSaveDonePart = { part++ },
                onDiscardResume = { discarded++ },
                onNewProject = { fresh++ },
                estimate = "About 2 min · phone gets warm",
                onCancel = { },
                modelsMissing = false,
                onDownload = { },
                onShareLog = { },
                onSave = { },
                onShare = { },
                modifier = Modifier,


            )
        }
        rule.onNode(androidx.compose.ui.test.hasText("Continue unfinished swap", substring = true)).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.onNode(androidx.compose.ui.test.hasText("Save the part that is done")).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.onNode(androidx.compose.ui.test.hasText("Discard unfinished swap")).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.onNode(androidx.compose.ui.test.hasText("New project")).performScrollTo().performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        println("RESUME resumed=$resumed part=$part discarded=$discarded fresh=$fresh")
        org.junit.Assert.assertEquals(listOf(1, 1, 1, 1), listOf(resumed, part, discarded, fresh))
    }
}
