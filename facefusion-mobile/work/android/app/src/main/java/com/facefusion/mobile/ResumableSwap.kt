package com.facefusion.mobile

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer

/**
 * A video swap that can be CONTINUED after Cancel, a crash or the app being closed.
 *
 * The output of one VideoSwapper run is a single MP4 that only becomes playable when the
 * muxer is stopped at the very end -- a crash halfway leaves nothing usable. So a long swap
 * is run as consecutive PIECES of [CHUNK_US] (each a normal VideoSwapper run over its own
 * time range, each a finished MP4), and the job's progress is written to disk after every
 * piece. At the end the pieces are joined, by copying their samples (no re-encode), into
 * the one output file. A crash loses at most the piece that was running.
 *
 * The pieces are back to back with no overlap: piece i covers [start + i*CHUNK, start +
 * (i+1)*CHUNK) of the target, and VideoSwapper writes both its video and its audio with
 * timestamps relative to the piece's start, so piece i's samples go into the joined file at
 * offset i*CHUNK.
 */
data class ResumeJob(
    val targetPath: String,
    val targetName: String,
    val startUs: Long,
    /** Inclusive end of the swap on the target's timeline; the clip's duration for "to the end". */
    val endUs: Long,
    /** True when the swap runs to the end of the clip (the last piece then has no end). */
    val toEnd: Boolean,
    val chunkUs: Long,
    val outputFps: Int,
    val outputMaxShortEdge: Int,
    val trackPeriod: Int,
    /**
     * Where each finished piece ENDS on the target's timeline (exclusive), in order; piece
     * k starts where piece k-1 ended (piece 0 at [startUs]). Pieces are normally
     * [chunkUs] long, but one stopped with Cancel/Stop is kept at the exact frame it
     * reached, so Continue picks up from there and no swapped frame is ever redone.
     */
    val ends: MutableList<Long> = mutableListOf(),
    /** Every piece is done, the last one to the end of the range. */
    var complete: Boolean = false,
) {
    /** Pieces finished and on disk. */
    val done: Int get() = ends.size

    /** Where the next piece starts on the target's timeline. */
    val resumeAtUs: Long get() = ends.lastOrNull() ?: startUs

    /** Piece k's start on the target's timeline. */
    fun pieceStart(k: Int): Long = if (k == 0) startUs else ends[k - 1]

    /** The next piece's range, end inclusive, as VideoSwapper takes it. */
    fun nextRange(): Pair<Long, Long> {
        val s = resumeAtUs
        val e = s + chunkUs - 1
        return if (e >= endUs - 1) s to (if (toEnd) Long.MAX_VALUE else endUs) else s to e
    }

    /** Whether the next piece is the last one (it runs to the end of the range). */
    fun nextIsLast(): Boolean = resumeAtUs + chunkUs - 1 >= endUs - 1

    /** Where piece k's samples go in the joined file. */
    fun offset(k: Int): Long = pieceStart(k) - startUs

    /** Length of the part already finished, for the "continue?" question. */
    val doneUs: Long get() = if (complete) totalUs else minOf(totalUs, resumeAtUs - startUs)
    val totalUs: Long get() = endUs - startUs

    fun toJson(): String = JSONObject().apply {
        put("targetPath", targetPath); put("targetName", targetName)
        put("startUs", startUs); put("endUs", endUs); put("toEnd", toEnd)
        put("chunkUs", chunkUs); put("outputFps", outputFps)
        put("outputMaxShortEdge", outputMaxShortEdge); put("trackPeriod", trackPeriod)
        put("done", done)
        put("ends", org.json.JSONArray(ends))
        put("complete", complete)
    }.toString()

    companion object {
        /**
         * 2 seconds of video per piece (5 until build 30: with the most realistic settings
         * the first 5 s could take over a minute, and closing the app before it finished
         * left nothing to continue). A crash loses at most the piece that was running;
         * Stop loses nothing.
         */
        const val CHUNK_US = 2_000_000L

        fun fromJson(s: String): ResumeJob? = runCatching {
            val o = JSONObject(s)
            val startUs = o.getLong("startUs")
            val chunk = o.getLong("chunkUs")
            val ends = mutableListOf<Long>()
            val arr = o.optJSONArray("ends")
            if (arr != null) for (i in 0 until arr.length()) ends += arr.getLong(i)
            else for (i in 1..o.optInt("done", 0)) ends += startUs + i * chunk  // pre-build 31
            ResumeJob(o.getString("targetPath"), o.optString("targetName", ""),
                      startUs, o.getLong("endUs"), o.getBoolean("toEnd"),
                      chunk, o.getInt("outputFps"),
                      o.getInt("outputMaxShortEdge"), o.getInt("trackPeriod"), ends,
                      o.optBoolean("complete", false))
        }.getOrNull()
    }
}

/** Where an unfinished swap lives: its record, its pieces, and its own copy of the target. */
object ResumeStore {
    private fun dir(ctx: Context): File =
        File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "resume").apply { mkdirs() }

    private fun jobFile(ctx: Context) = File(dir(ctx), "job.json")

    fun part(ctx: Context, i: Int) = File(dir(ctx), "part_%03d.mp4".format(i))

    /**
     * The job's own handle on the target video, so picking another target meanwhile does
     * not change what a resumed swap reads. A hard link (no copy, no extra space) next to
     * the app's target copy; a copy if the link is not possible.
     */
    // In filesDir, NOT cacheDir: Android and phone-cleaner tools empty the cache, and
    // with it went the video an unfinished swap needs. filesDir is on the same file
    // system as the app's target copy (cacheDir), so the hard link still works.
    fun targetFor(ctx: Context): File = File(ctx.filesDir, "resume_target.mp4")
    private fun oldTargetFor(ctx: Context): File = File(ctx.cacheDir, "resume_target.mp4")

    fun load(ctx: Context): ResumeJob? {
        val f = jobFile(ctx)
        if (!f.isFile) return null
        val job = ResumeJob.fromJson(runCatching { f.readText() }.getOrNull() ?: return null)
            ?: return null
        // The pieces it claims must exist, and the target must still be there.
        if (!File(job.targetPath).isFile) return null
        var ok = 0
        while (ok < job.done && part(ctx, ok).isFile && part(ctx, ok).length() > 0) ok++
        if (ok < job.done) {
            while (job.ends.size > ok) job.ends.removeAt(job.ends.lastIndex)
            job.complete = false
        }
        return job
    }

    fun save(ctx: Context, job: ResumeJob) {
        val f = jobFile(ctx)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(job.toJson())
        tmp.renameTo(f)   // atomic: a crash mid-write never leaves a half record
    }

    /**
     * Who gets which face in the unfinished swap (Assign per person), so Continue -- even
     * after the app was closed -- swaps each person the same way to the end of the video.
     * Deleted with the job.
     */
    fun assignFile(ctx: Context) = File(dir(ctx), "assign.json")

    /** Forget the job and its pieces (and its target handle). */
    fun clear(ctx: Context) {
        dir(ctx).listFiles()?.forEach { it.safeDelete() }
        targetFor(ctx).safeDelete()
        oldTargetFor(ctx).safeDelete()
    }

    /** Start a new job for [target], replacing any old one. */
    fun begin(ctx: Context, target: File, job: (String) -> ResumeJob): ResumeJob {
        clear(ctx)
        val handle = targetFor(ctx)
        val linked = runCatching {
            android.system.Os.link(target.absolutePath, handle.absolutePath); true
        }.getOrDefault(false)
        if (!linked) target.copyTo(handle, overwrite = true)
        return job(handle.absolutePath).also { save(ctx, it) }
    }
}

/** Joins finished MP4 pieces into one file by copying their samples. No re-encoding. */
object Mp4Concat {
    fun join(parts: List<Pair<File, Long>>, out: File) {
        require(parts.isNotEmpty()) { "nothing to join" }
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        try {
            // Track formats from the first piece: every piece was encoded with the same
            // settings by the same encoder configuration.
            var videoFmt: MediaFormat? = null
            var audioFmt: MediaFormat? = null
            MediaExtractor().run {
                setDataSource(parts[0].first.absolutePath)
                for (t in 0 until trackCount) {
                    val f = getTrackFormat(t)
                    val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                    if (mime.startsWith("video/") && videoFmt == null) videoFmt = f
                    if (mime.startsWith("audio/") && audioFmt == null) audioFmt = f
                }
                release()
            }
            val vOut = videoFmt?.let { muxer.addTrack(it) } ?: error("no video track")
            val aOut = audioFmt?.let { muxer.addTrack(it) }
            muxer.start()

            val buf = ByteBuffer.allocate(8 * 1024 * 1024)
            val info = MediaCodec.BufferInfo()
            var lastAudio = Long.MIN_VALUE
            for ((file, offset) in parts) {
                val ex = MediaExtractor()
                try {
                    ex.setDataSource(file.absolutePath)
                    for (t in 0 until ex.trackCount) {
                        val mime = ex.getTrackFormat(t).getString(MediaFormat.KEY_MIME) ?: continue
                        val target = when {
                            mime.startsWith("video/") -> vOut
                            mime.startsWith("audio/") -> aOut ?: continue
                            else -> continue
                        }
                        ex.selectTrack(t)
                        while (true) {
                            val n = ex.readSampleData(buf, 0)
                            if (n < 0) break
                            val pts = ex.sampleTime + offset
                            // Audio pieces can share one packet at a boundary; keep time moving
                            // forward so the joined track never steps back.
                            if (target == aOut && pts <= lastAudio) { ex.advance(); continue }
                            if (target == aOut) lastAudio = pts
                            info.offset = 0; info.size = n; info.presentationTimeUs = pts
                            info.flags = if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
                                MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                            muxer.writeSampleData(target, buf, info)
                            ex.advance()
                        }
                        ex.unselectTrack(t)
                    }
                } finally {
                    ex.release()
                }
            }
            muxer.stop()
        } finally {
            runCatching { muxer.release() }
        }
    }
}
