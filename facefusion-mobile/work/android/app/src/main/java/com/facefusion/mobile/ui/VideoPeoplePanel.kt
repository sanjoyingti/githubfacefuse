package com.facefusion.mobile.ui

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facefusion.mobile.R

/**
 * One person found by "Find everyone in the video". [choice]: null = not set, -1 = keeps
 * their own face, otherwise the source slot.
 */
class VideoPersonRow(val thumb: Bitmap?, val firstMs: Long, val seen: Int, val choice: Int?)

/** "m:ss" (or "h:mm:ss") for the list. */
fun clockOf(ms: Long): String {
    val s = (ms.coerceAtLeast(0) / 1000).toInt()
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60)
           else "%d:%02d".format(s / 60, s % 60)
}

/**
 * ASSIGN PER PERSON, whole video: scan the target once, list every person who appears
 * (also the ones who only come in at minute 5), and give each their own source photo, or
 * their own face, or drop them from the list. A choice holds for that person from the
 * first frame to the last.
 */
@Composable
fun VideoPeoplePanel(
    isVideo: Boolean,
    scanning: Float?,
    scanned: Boolean,
    people: List<VideoPersonRow>,
    sourceThumbs: List<Bitmap>,
    unknownKeep: Boolean,
    enabled: Boolean,
    onFind: () -> Unit,
    onCancelScan: () -> Unit,
    onChoose: (person: Int, choice: Int) -> Unit,
    onRemove: (person: Int) -> Unit,
    onUnknownKeep: (Boolean) -> Unit,
    /** "About 3 min left", or null while it cannot tell yet. */
    timeLeft: String? = null,
    /** The video's length; 0 = unknown (no part-of-the-video choice then). */
    durationMs: Long = 0L,
    /** Scan only [rangeMs] instead of the whole video. */
    rangeOn: Boolean = false,
    rangeMs: ClosedFloatingPointRange<Float> = 0f..0f,
    onRangeOn: (Boolean) -> Unit = {},
    onRange: (ClosedFloatingPointRange<Float>) -> Unit = {},
    /** Set when the swap's trim does not cover the whole video: what it covers. */
    trimNote: String? = null,
    onWholeVideo: () -> Unit = {},
    /** "Same person as ...": join [from] into [into] (both list positions). */
    onJoin: ((from: Int, into: Int) -> Unit)? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (isVideo) {
            if (scanning != null) {
                Text(stringResource(R.string.vpeople_scanning, (scanning * 100).toInt()),
                     style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LinearProgressIndicator(progress = { scanning },
                                            modifier = Modifier.weight(1f))
                    TextButton(onCancelScan, Modifier.testTag("vpeople_cancel")) {
                        Text(stringResource(R.string.vpeople_cancel))
                    }
                }
                timeLeft?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall,
                         modifier = Modifier.testTag("vpeople_time_left"))
                }
                Text(stringResource(R.string.vpeople_scanning_hint),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                if (durationMs > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.vpeople_range),
                             style = MaterialTheme.typography.bodySmall,
                             modifier = Modifier.weight(1f))
                        Switch(checked = rangeOn, onCheckedChange = onRangeOn, enabled = enabled,
                               modifier = Modifier.testTag("vpeople_range_on"))
                    }
                    if (rangeOn) {
                        Text(stringResource(R.string.vpeople_range_from_to,
                                            clockOf(rangeMs.start.toLong()),
                                            clockOf(rangeMs.endInclusive.toLong())),
                             style = MaterialTheme.typography.bodyMedium,
                             modifier = Modifier.testTag("vpeople_range_text"))
                        RangeSlider(
                            value = rangeMs,
                            onValueChange = { r ->
                                onRange(r.start..maxOf(r.endInclusive,
                                    minOf(r.start + 1000f, durationMs.toFloat())))
                            },
                            valueRange = 0f..durationMs.toFloat(),
                            enabled = enabled,
                            modifier = Modifier.testTag("vpeople_range"),
                        )
                        Text(stringResource(R.string.vpeople_range_hint),
                             style = MaterialTheme.typography.bodySmall,
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                OutlinedButton(onFind, enabled = enabled,
                               modifier = Modifier.fillMaxWidth().testTag("vpeople_find")) {
                    Icon(Icons.Default.Search, contentDescription = null, Modifier.size(18.dp))
                    Text(stringResource(when {
                             rangeOn && durationMs > 0 -> R.string.vpeople_find_range
                             scanned -> R.string.vpeople_rescan
                             else -> R.string.vpeople_find }),
                         Modifier.padding(start = 6.dp))
                }
            }
        }
        trimNote?.let { note ->
            Text(note, style = MaterialTheme.typography.bodySmall,
                 color = MaterialTheme.colorScheme.error,
                 modifier = Modifier.testTag("vpeople_trim_note"))
            TextButton(onWholeVideo, enabled = enabled,
                       modifier = Modifier.testTag("vpeople_whole_video")) {
                Text(stringResource(R.string.vpeople_whole_video))
            }
        }
        if (scanned && scanning == null) {
            Text(if (people.isEmpty()) stringResource(R.string.vpeople_none)
                 else stringResource(R.string.vpeople_found, people.size),
                 style = MaterialTheme.typography.bodySmall,
                 color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        people.forEachIndexed { i, p ->
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(8.dp).testTag("vpeople_person_$i"),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(52.dp).clip(CircleShape)
                            .background(MaterialTheme.colorScheme.surface)) {
                        p.thumb?.let {
                            Image(it.asImageBitmap(), null, Modifier.size(52.dp),
                                  contentScale = ContentScale.Crop)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.vpeople_person, i + 1),
                             style = MaterialTheme.typography.titleSmall)
                        Text(stringResource(R.string.vpeople_info, clockOf(p.firstMs), p.seen),
                             fontSize = 12.sp,
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(when (val c = p.choice) {
                                 null -> stringResource(R.string.vpeople_not_set)
                                 -1 -> stringResource(R.string.vpeople_keep)
                                 else -> stringResource(R.string.swap_assign_badge, c + 1)
                             },
                             fontSize = 12.sp,
                             color = if (p.choice != null && p.choice >= 0) FfRed
                                     else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (onJoin != null && people.size > 1) {
                        var open by remember { mutableStateOf(false) }
                        Box {
                            TextButton({ open = true }, enabled = enabled,
                                       modifier = Modifier.testTag("vpeople_join_$i")) {
                                Text(stringResource(R.string.vpeople_same_as), fontSize = 12.sp)
                            }
                            DropdownMenu(open, { open = false }) {
                                people.forEachIndexed { k, q ->
                                    if (k != i) DropdownMenuItem(
                                        text = { Text(stringResource(R.string.vpeople_person, k + 1) +
                                                      " · " + clockOf(q.firstMs)) },
                                        onClick = { open = false; onJoin(i, k) },
                                        modifier = Modifier.testTag("vpeople_join_${i}_$k"),
                                    )
                                }
                            }
                        }
                    }
                    IconButton({ onRemove(i) }, enabled = enabled,
                               modifier = Modifier.testTag("vpeople_remove_$i")) {
                        Icon(Icons.Default.Close, stringResource(R.string.vpeople_remove))
                    }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    sourceThumbs.forEachIndexed { s, thumb ->
                        val on = p.choice == s
                        Image(thumb.asImageBitmap(),
                              contentDescription = stringResource(R.string.swap_assign_badge, s + 1),
                              modifier = Modifier.size(44.dp).clip(RoundedCornerShape(8.dp))
                                  .border(BorderStroke(if (on) 3.dp else 1.dp,
                                          if (on) FfRed else MaterialTheme.colorScheme.outlineVariant),
                                          RoundedCornerShape(8.dp))
                                  .clickable(enabled = enabled) { onChoose(i, s) }
                                  .testTag("vpeople_choose_${i}_$s"),
                              contentScale = ContentScale.Crop)
                    }
                    val keepOn = p.choice == -1
                    Box(Modifier.height(44.dp).clip(RoundedCornerShape(8.dp))
                            .border(BorderStroke(if (keepOn) 3.dp else 1.dp,
                                    if (keepOn) FfRed else MaterialTheme.colorScheme.outlineVariant),
                                    RoundedCornerShape(8.dp))
                            .clickable(enabled = enabled) { onChoose(i, -1) }
                            .padding(horizontal = 10.dp)
                            .testTag("vpeople_keep_$i"),
                        contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.vpeople_keep), fontSize = 12.sp,
                             textAlign = TextAlign.Center)
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(if (unknownKeep) R.string.vpeople_unknown_keep
                                else R.string.vpeople_unknown_keep_off),
                 style = MaterialTheme.typography.bodySmall,
                 modifier = Modifier.weight(1f))
            Switch(checked = unknownKeep, onCheckedChange = onUnknownKeep, enabled = enabled,
                   modifier = Modifier.testTag("vpeople_unknown_keep"))
        }
    }
}
