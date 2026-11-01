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
    /** Pieces finished and on disk. */
    var done: Int = 0,
) {
    val count: Int get() = maxOf(1, ((endUs - startUs + chunkUs - 1) / chunkUs).toInt())

    /** Piece i's range on the target's timeline, end inclusive, as VideoSwapper takes it. */
    fun range(i: Int): Pair<Long, Long> {
        val s = startUs + i * chunkUs
        val last = i >= count - 1
        val e = when {
            last && toEnd -> Long.MAX_VALUE
            last -> endUs
            else -> s + chunkUs - 1
        }
        return s to e
    }

    /** Where piece i's samples go in the joined file. */
    fun offset(i: Int): Long = i * chunkUs

    /** Length of the part already finished, for the "continue?" question. */
    val doneUs: Long get() = minOf(endUs - startUs, done * chunkUs)
    val totalUs: Long get() = endUs - startUs

    fun toJson(): String = JSONObject().apply {
        put("targetPath", targetPath); put("targetName", targetName)
        put("startUs", startUs); put("endUs", endUs); put("toEnd", toEnd)
        put("chunkUs", chunkUs); put("outputFps", outputFps)
        put("outputMaxShortEdge", outputMaxShortEdge); put("trackPeriod", trackPeriod)
        put("done", done)
    }.toString()

    companion object {
        /**
         * 5 seconds of video per piece. Progress is only saved when a piece finishes, and
         * with the heavy settings at 60 fps a 20-second piece took minutes -- closing the
         * app before the first one finished left nothing to continue. Each piece costs
         * only an encoder start and re-decoding from the nearest keyframe, which is small
         * next to swapping its frames.
         */
        const val CHUNK_US = 5_000_000L

        fun fromJson(s: String): ResumeJob? = runCatching {
            val o = JSONObject(s)
            ResumeJob(o.getString("targetPath"), o.optString("targetName", ""),
                      o.getLong("startUs"), o.getLong("endUs"), o.getBoolean("toEnd"),
                      o.getLong("chunkUs"), o.getInt("outputFps"),
                      o.getInt("outputMaxShortEdge"), o.getInt("trackPeriod"), o.getInt("done"))
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
    fun targetFor(ctx: Context): File = File(ctx.cacheDir, "resume_target.mp4")

    fun load(ctx: Context): ResumeJob? {
        val f = jobFile(ctx)
        if (!f.isFile) return null
        val job = ResumeJob.fromJson(runCatching { f.readText() }.getOrNull() ?: return null)
            ?: return null
        // The pieces it claims must exist, and the target must still be there.
        if (!File(job.targetPath).isFile) return null
        var ok = 0
        while (ok < job.done && part(ctx, ok).isFile && part(ctx, ok).length() > 0) ok++
        job.done = ok
        return job
    }

    fun save(ctx: Context, job: ResumeJob) {
        val f = jobFile(ctx)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(job.toJson())
        tmp.renameTo(f)   // atomic: a crash mid-write never leaves a half record
    }

    /** Forget the job and its pieces (and its target handle). */
    fun clear(ctx: Context) {
        dir(ctx).listFiles()?.forEach { it.safeDelete() }
        targetFor(ctx).safeDelete()
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
