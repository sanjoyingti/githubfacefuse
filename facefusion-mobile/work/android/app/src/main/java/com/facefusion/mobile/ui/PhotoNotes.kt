package com.facefusion.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.facefusion.mobile.R
import com.facefusion.mobile.SourcePhotos.Angle
import com.facefusion.mobile.SourcePhotos.Warn

@Composable
fun angleName(a: Angle): String = stringResource(when (a) {
    Angle.FRONT -> R.string.angle_front
    Angle.LEFT -> R.string.angle_left
    Angle.RIGHT -> R.string.angle_right
    Angle.UP -> R.string.angle_up
    Angle.DOWN -> R.string.angle_down
})

@Composable
fun warnText(w: Warn): String = stringResource(when (w) {
    Warn.NO_FACE -> R.string.warn_no_face
    Warn.MANY_FACES -> R.string.warn_many_faces
    Warn.SMALL -> R.string.warn_small
    Warn.BLURRY -> R.string.warn_blurry
    Warn.DARK -> R.string.warn_dark
    Warn.BRIGHT -> R.string.warn_bright
    Warn.TURNED -> R.string.warn_turned
    Warn.SAME_ANGLE -> R.string.warn_same_angle
})

/** What to print under a photo, and whether it is a warning. */
@Composable
fun photoNote(p: SourcePhotoTile): Pair<String, Boolean> {
    val c = p.check
    val firstWarn = c?.warnings?.firstOrNull()
    if (p.verdict == -2) return stringResource(R.string.photos_other_person) to true
    if (p.verdict == -1 && firstWarn == null) return stringResource(R.string.photos_no_face) to true
    if (firstWarn != null) return warnText(firstWarn) to true
    val base = stringResource(when {
        p.main -> R.string.photos_main
        p.verdict == 1 -> R.string.photos_used
        else -> R.string.photos_pending
    })
    val a = c?.angle
    return (if (a != null) base + " · " + angleName(a) else base) to false
}

/** The angles still missing among [have], in the order worth adding them. */
fun missingAngles(have: Collection<Angle?>): List<Angle> =
    listOf(Angle.FRONT, Angle.LEFT, Angle.RIGHT, Angle.UP, Angle.DOWN).filter { it !in have }
