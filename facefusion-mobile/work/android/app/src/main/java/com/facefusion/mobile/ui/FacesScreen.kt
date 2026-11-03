package com.facefusion.mobile.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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

/** One source face as the Faces tab shows it: its photos (main first) and whether it is in use. */
class FaceCard(val photos: List<SourcePhotoTile>, val active: Boolean)

/**
 * The FACES tab: every source face with its photos of the same person, on a screen of its
 * own. Add a person, add up to [max] photos to each, remove a photo, pick which face the
 * swap uses. Assigning faces to people in the video stays on the Swap tab, which shows
 * the video.
 */
@Composable
fun FacesScreen(
    faces: List<FaceCard>,
    max: Int,
    enabled: Boolean,
    onAddPerson: () -> Unit,
    onAddPhoto: (face: Int) -> Unit,
    onRemovePhoto: (face: Int, extra: Int) -> Unit,
    onUseFace: (face: Int) -> Unit,
    onRemoveFace: (face: Int) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.faces_tab_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.faces_tab_explain),
             style = MaterialTheme.typography.bodyMedium,
             color = MaterialTheme.colorScheme.onSurfaceVariant)

        faces.forEachIndexed { i, face ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.live_source_label, i + 1),
                             style = MaterialTheme.typography.titleMedium,
                             modifier = Modifier.weight(1f))
                        Text(stringResource(R.string.photos_count, face.photos.size, max),
                             style = MaterialTheme.typography.bodySmall,
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (slot in 0 until max) {
                            val p = face.photos.getOrNull(slot)
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(
                                    Modifier.fillMaxWidth().aspectRatio(1f)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(MaterialTheme.colorScheme.surfaceVariant)
                                        .then(if (slot == 0 && face.active)
                                                  Modifier.border(3.dp, FfRed, RoundedCornerShape(12.dp))
                                              else Modifier),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (p != null) {
                                        Image(p.thumb.asImageBitmap(), contentDescription = null,
                                              modifier = Modifier.fillMaxSize(),
                                              contentScale = ContentScale.Crop)
                                        if (!p.main) IconButton(
                                            { onRemovePhoto(i, slot - 1) },
                                            enabled = enabled,
                                            modifier = Modifier.align(Alignment.TopEnd).padding(2.dp)
                                                .size(30.dp).clip(CircleShape)
                                                .background(Color.Black.copy(alpha = 0.55f)),
                                        ) {
                                            Icon(Icons.Default.Close,
                                                 stringResource(R.string.photos_remove),
                                                 tint = Color.White, modifier = Modifier.size(16.dp))
                                        }
                                    } else IconButton({ onAddPhoto(i) }, enabled = enabled) {
                                        Icon(Icons.Default.Add,
                                             stringResource(R.string.photos_add, max))
                                    }
                                }
                                Text(
                                    if (p == null) "" else stringResource(when {
                                        p.main -> R.string.photos_main
                                        p.verdict == 1 -> R.string.photos_used
                                        p.verdict == -2 -> R.string.photos_other_person
                                        p.verdict == -1 -> R.string.photos_no_face
                                        else -> R.string.photos_pending
                                    }),
                                    fontSize = 11.sp, maxLines = 2,
                                    color = if (p?.verdict == -1 || p?.verdict == -2)
                                                MaterialTheme.colorScheme.error
                                            else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton({ onAddPhoto(i) },
                                       enabled = enabled && face.photos.size < max,
                                       modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Add, contentDescription = null, Modifier.size(18.dp))
                            Text(stringResource(R.string.faces_tab_add_photo),
                                 Modifier.padding(start = 4.dp))
                        }
                        if (face.active)
                            Text(stringResource(R.string.faces_tab_in_use),
                                 color = FfRed, style = MaterialTheme.typography.labelLarge)
                        else TextButton({ onUseFace(i) }, enabled = enabled) {
                            Text(stringResource(R.string.faces_tab_use))
                        }
                        TextButton({ onRemoveFace(i) }, enabled = enabled) {
                            Text(stringResource(R.string.faces_tab_remove),
                                 color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        Button(onAddPerson, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Add, contentDescription = null, Modifier.size(18.dp))
            Text(stringResource(R.string.faces_tab_add_person), Modifier.padding(start = 6.dp))
        }
        Text(stringResource(R.string.faces_tab_tips),
             style = MaterialTheme.typography.bodySmall,
             color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
