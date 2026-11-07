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
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facefusion.mobile.R

/**
 * One source face as the Faces tab shows it: its photos (main first), whether it is in
 * use, and whether the person is in Saved people.
 */
class FaceCard(val photos: List<SourcePhotoTile>, val active: Boolean, val saved: Boolean = false)

/**
 * The FACES tab: every source face with up to [max] photos of the same person (front,
 * left, right, up, down), on a screen of its own. Add a photo, or let the app pick the
 * best ones out of a video; remove a photo; save the person for later; pick which face
 * the swap uses. Each photo says which way the face points and what is wrong with it,
 * if anything. Assigning faces to people in the video stays on the Swap tab.
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
    onFromVideo: ((face: Int) -> Unit)? = null,
    onAddPersonFromVideo: (() -> Unit)? = null,
    onSavePerson: ((face: Int) -> Unit)? = null,
    onOpenSaved: (() -> Unit)? = null,
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
                    // Empty slots name the angles still missing, in the order worth adding.
                    val missing = missingAngles(face.photos.map { it.check?.angle })
                    for (row in 0 until (max + 2) / 3) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            for (col in 0 until 3) {
                                val slot = row * 3 + col
                                Column(Modifier.weight(1f),
                                       horizontalAlignment = Alignment.CenterHorizontally) {
                                    if (slot < max) PhotoSlot(
                                        p = face.photos.getOrNull(slot),
                                        hint = missing.getOrNull(slot - face.photos.size),
                                        highlight = slot == 0 && face.active,
                                        enabled = enabled,
                                        onAdd = { onAddPhoto(i) },
                                        onRemove = { onRemovePhoto(i, slot - 1) },
                                        max = max,
                                    )
                                }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton({ onAddPhoto(i) },
                                       enabled = enabled && face.photos.size < max,
                                       modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Add, contentDescription = null, Modifier.size(18.dp))
                            Text(stringResource(R.string.faces_tab_add_photo),
                                 Modifier.padding(start = 4.dp), maxLines = 1)
                        }
                        if (onFromVideo != null)
                            OutlinedButton({ onFromVideo(i) },
                                           enabled = enabled && face.photos.size < max,
                                           modifier = Modifier.weight(1f)) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null,
                                     Modifier.size(18.dp))
                                Text(stringResource(R.string.faces_from_video),
                                     Modifier.padding(start = 4.dp), maxLines = 1)
                            }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        if (face.active)
                            Text(stringResource(R.string.faces_tab_in_use),
                                 color = FfRed, style = MaterialTheme.typography.labelLarge,
                                 modifier = Modifier.padding(horizontal = 8.dp))
                        else TextButton({ onUseFace(i) }, enabled = enabled) {
                            Text(stringResource(R.string.faces_tab_use))
                        }
                        if (onSavePerson != null)
                            TextButton({ onSavePerson(i) }, enabled = enabled) {
                                Text(stringResource(if (face.saved) R.string.faces_update_saved
                                                    else R.string.faces_save_person))
                            }
                        Box(Modifier.weight(1f))
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
        if (onAddPersonFromVideo != null)
            OutlinedButton(onAddPersonFromVideo, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.PlayArrow, contentDescription = null, Modifier.size(18.dp))
                Text(stringResource(R.string.faces_person_from_video), Modifier.padding(start = 6.dp))
            }
        if (onOpenSaved != null)
            TextButton(onOpenSaved, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.faces_saved_people))
            }
        Text(stringResource(R.string.faces_tab_tips),
             style = MaterialTheme.typography.bodySmall,
             color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PhotoSlot(
    p: SourcePhotoTile?,
    hint: com.facefusion.mobile.SourcePhotos.Angle?,
    highlight: Boolean,
    enabled: Boolean,
    onAdd: () -> Unit,
    onRemove: () -> Unit,
    max: Int,
) {
    Box(
        Modifier.fillMaxWidth().aspectRatio(1f)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .then(if (highlight) Modifier.border(3.dp, FfRed, RoundedCornerShape(12.dp))
                  else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (p != null) {
            Image(p.thumb.asImageBitmap(), contentDescription = null,
                  modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (!p.main) IconButton(
                onRemove,
                enabled = enabled,
                modifier = Modifier.align(Alignment.TopEnd).padding(2.dp)
                    .size(30.dp).clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.55f)),
            ) {
                Icon(Icons.Default.Close, stringResource(R.string.photos_remove),
                     tint = Color.White, modifier = Modifier.size(16.dp))
            }
        } else IconButton(onAdd, enabled = enabled) {
            Icon(Icons.Default.Add, stringResource(R.string.photos_add, max))
        }
    }
    val (text, warn) = if (p != null) photoNote(p)
                       else (hint?.let { angleName(it) } ?: "") to false
    Text(
        text,
        fontSize = 11.sp, maxLines = 2, textAlign = TextAlign.Center,
        color = if (warn) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp),
    )
}
