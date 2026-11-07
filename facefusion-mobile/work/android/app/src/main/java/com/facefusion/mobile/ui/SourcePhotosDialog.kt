package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facefusion.mobile.R

/** One photo in the panel: its picture and what the pipeline made of it. */
class SourcePhotoTile(
    val thumb: Bitmap,
    /** Main photo of the face: it is removed with the face itself, not here. */
    val main: Boolean,
    /** 1 used, -1 no face, -2 a different person, null not tried yet. */
    val verdict: Int?,
    /** The photo check's answer (angle, warnings), null until checked. */
    val check: com.facefusion.mobile.SourcePhotos.Check? = null,
)

/**
 * The photos of ONE source face: the main photo and up to [max] - 1 more of the same
 * person, combined into one likeness. Opens over the Swap screen from the source pane or
 * by tapping the selected face again; Done returns to the same screen.
 */
@Composable
fun SourcePhotosDialog(
    faceLabel: String,
    photos: List<SourcePhotoTile>,
    max: Int,
    onAdd: () -> Unit,
    onRemove: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(faceLabel, Modifier.weight(1f))
                Text(stringResource(R.string.photos_count, photos.size, max),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()),
                   verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.photos_explain),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (row in 0 until (max + 2) / 3) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (col in 0 until 3) {
                        val slot = row * 3 + col
                        val p = if (slot < max) photos.getOrNull(slot) else null
                        Column(Modifier.weight(1f),
                               horizontalAlignment = Alignment.CenterHorizontally) {
                            if (slot < max) Box(
                                Modifier.fillMaxWidth().aspectRatio(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (p != null) {
                                    Image(p.thumb.asImageBitmap(), contentDescription = null,
                                          modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                                          contentScale = ContentScale.Crop)
                                    if (!p.main) IconButton(
                                        { onRemove(slot - 1) },
                                        Modifier.align(Alignment.TopEnd).padding(2.dp).size(30.dp)
                                            .clip(CircleShape)
                                            .background(Color.Black.copy(alpha = 0.55f)),
                                    ) {
                                        Icon(Icons.Default.Close,
                                             stringResource(R.string.photos_remove),
                                             tint = Color.White, modifier = Modifier.size(16.dp))
                                    }
                                }
                            }
                            if (p != null) {
                                val (text, warn) = photoNote(p)
                                Text(text, fontSize = 11.sp, maxLines = 2,
                                     color = if (warn) MaterialTheme.colorScheme.error
                                             else MaterialTheme.colorScheme.onSurfaceVariant,
                                     modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
                OutlinedButton(onAdd, enabled = photos.size < max,
                               modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Add, contentDescription = null, Modifier.size(18.dp))
                    Text(stringResource(R.string.photos_add, max),
                         Modifier.padding(start = 6.dp))
                }
                Text(stringResource(R.string.photos_tips),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.photos_done)) } },
    )
}
