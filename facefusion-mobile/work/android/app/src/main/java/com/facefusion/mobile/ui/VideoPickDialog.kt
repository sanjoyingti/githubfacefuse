package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facefusion.mobile.R

/** One person found in the video, for the list. */
class FoundPerson(val thumb: Bitmap?, val seen: Int, val angles: String)

/** One picture offered for adding. */
class FoundPhoto(val crop: Bitmap, val angle: String)

/**
 * Photos from a video, in three steps on one dialog: the scan's progress, then (for a new
 * person) which person, then the pictures it picked, each with a tick to keep or drop it.
 * Exactly one of [progress], [people], [photos] or [message] is shown.
 */
@Composable
fun VideoPickDialog(
    title: String,
    progress: Float?,
    people: List<FoundPerson>?,
    onPickPerson: (Int) -> Unit,
    photos: List<FoundPhoto>?,
    checked: Set<Int>,
    onToggle: (Int) -> Unit,
    onAdd: () -> Unit,
    message: String?,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (progress == null) onCancel() },
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()),
                   verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    progress != null -> {
                        Text(stringResource(R.string.vpick_scanning, (progress * 100).toInt()))
                        LinearProgressIndicator(progress = { progress },
                                                modifier = Modifier.fillMaxWidth())
                        Text(stringResource(R.string.vpick_scanning_hint),
                             style = MaterialTheme.typography.bodySmall,
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    people != null -> {
                        Text(stringResource(R.string.vpick_choose_person),
                             style = MaterialTheme.typography.bodyMedium)
                        people.forEachIndexed { i, p ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { onPickPerson(i) }.padding(8.dp)
                                    .testTag("vpick_person_$i"),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Box(Modifier.size(56.dp).clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surface)) {
                                    p.thumb?.let {
                                        Image(it.asImageBitmap(), null, Modifier.size(56.dp),
                                              contentScale = ContentScale.Crop)
                                    }
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(stringResource(R.string.vpick_person, i + 1),
                                         style = MaterialTheme.typography.titleSmall)
                                    Text(p.angles, fontSize = 12.sp,
                                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                    photos != null -> {
                        Text(stringResource(R.string.vpick_review),
                             style = MaterialTheme.typography.bodyMedium)
                        photos.chunked(3).forEachIndexed { row, chunk ->
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                for (k in 0 until 3) {
                                    val i = row * 3 + k
                                    val ph = chunk.getOrNull(k)
                                    Column(Modifier.weight(1f),
                                           horizontalAlignment = Alignment.CenterHorizontally) {
                                        if (ph != null) {
                                            val on = i in checked
                                            Box(
                                                Modifier.fillMaxWidth().aspectRatio(1f)
                                                    .clip(RoundedCornerShape(12.dp))
                                                    .then(if (on) Modifier.border(3.dp, FfRed,
                                                              RoundedCornerShape(12.dp)) else Modifier)
                                                    .clickable { onToggle(i) }
                                                    .testTag("vpick_photo_$i"),
                                            ) {
                                                Image(ph.crop.asImageBitmap(), null,
                                                      Modifier.fillMaxWidth().aspectRatio(1f),
                                                      contentScale = ContentScale.Crop)
                                                if (on) Icon(Icons.Default.Check, null,
                                                    tint = Color.White,
                                                    modifier = Modifier.align(Alignment.TopEnd)
                                                        .padding(4.dp).size(22.dp)
                                                        .clip(RoundedCornerShape(11.dp))
                                                        .background(FfRed))
                                            }
                                            Text(ph.angle, fontSize = 11.sp,
                                                 modifier = Modifier.padding(top = 4.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                    message != null -> Text(message)
                }
            }
        },
        confirmButton = {
            if (photos != null && progress == null)
                TextButton(onAdd, enabled = checked.isNotEmpty()) {
                    Text(stringResource(R.string.vpick_add, checked.size))
                }
        },
        dismissButton = {
            TextButton(onCancel) {
                Text(stringResource(if (message != null) R.string.photos_done else R.string.vpick_cancel))
            }
        },
    )
}
