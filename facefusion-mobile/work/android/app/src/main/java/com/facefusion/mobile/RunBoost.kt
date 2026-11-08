package com.facefusion.mobile

import android.content.Context
import android.os.PerformanceHintManager
import android.os.Process
import java.io.File

/**
 * Keeps a video run at its ON-SCREEN pace when the app is in the background -- and no faster.
 *
 * On screen, Android puts the app in its "top app" group: its busy threads get the fast
 * cores and the clocks ramp up for them. Leave the app and the swap carries on (the
 * foreground notification keeps it alive), but that boost is gone -- the same frames run
 * on slower cores at lower clocks, which is why a swap crawled in the background and sped
 * up again on return.
 *
 * While the app is on screen this does NOTHING: no hint session exists and the run is
 * exactly as it was, so battery use on screen is unchanged. It measures how long a frame
 * takes there. Off screen it opens the platform's performance-hint session (ADPF) with
 * THAT time as the target, and reports each frame against it, so the system gives the
 * threads back only the speed they had on screen. Back on screen the session is closed.
 * No memory beyond a few numbers; the pixels are untouched.
 */
class RunBoost private constructor(private val tids: IntArray) {
    private var session: PerformanceHintManager.Session? = null
    private var tried = false

    /** Whether a hint is in force right now (for the tests). */
    internal val active get() = session != null

    /** One frame's swap took [nanos]. */
    fun report(nanos: Long) {
        if (nanos <= 0) return
        if (visible) {
            // On screen: learn the pace, and make sure no hint is in force.
            onScreenNs = if (onScreenNs <= 0) nanos else (onScreenNs * 7 + nanos) / 8
            if (session != null) close()
            return
        }
        val s = session ?: open() ?: return
        runCatching { s.reportActualWorkDuration(nanos) }
    }

    private fun open(): PerformanceHintManager.Session? {
        if (tried) return null
        tried = true
        val mgr = hints ?: return null
        val target = if (onScreenNs > 0) onScreenNs else FALLBACK_NS
        val all = LinkedHashSet<Int>()
        tids.filter { it > 0 }.forEach { all += it }
        all += workerTids()
        session = runCatching { mgr.createHintSession(all.toIntArray(), target) }.getOrNull()
            ?: runCatching {
                // A listed thread may have ended between the listing and the call.
                mgr.createHintSession(tids.filter { it > 0 }.toIntArray(), target)
            }.getOrNull()
        return session
    }

    fun close() {
        runCatching { session?.close() }
        session = null
        tried = false
    }

    companion object {
        @Volatile private var hints: PerformanceHintManager? = null

        /** Whether the app is on screen; set by the Activity's onStart / onStop. */
        @Volatile var visible = true

        /**
         * The on-screen time per frame, kept across runs so a run started and then left
         * at once still has a target. Only ever measured, never made tighter.
         */
        @Volatile private var onScreenNs = 0L

        /** Target before any on-screen frame was ever measured. */
        private const val FALLBACK_NS = 50_000_000L

        /** Once, from the Activity (next to [Thermal.init]). */
        fun init(ctx: Context) {
            if (hints == null) hints = runCatching {
                ctx.applicationContext.getSystemService(PerformanceHintManager::class.java)
            }.getOrNull()
        }

        /** For the run's own threads plus the app's native worker threads. Never fails. */
        fun start(tids: IntArray): RunBoost = RunBoost(tids)

        /** Threads of this process that do frame work outside the run's own threads. */
        private fun workerTids(): List<Int> = runCatching {
            File("/proc/self/task").listFiles().orEmpty().mapNotNull { d ->
                val tid = d.name.toIntOrNull() ?: return@mapNotNull null
                val comm = runCatching { File(d, "comm").readText().trim() }.getOrNull()
                    ?: return@mapNotNull null
                if (comm.startsWith("ff-") || comm.startsWith("DefaultDispatch")) tid else null
            }
        }.getOrDefault(emptyList())

        /**
         * A little above ordinary work, so another busy app does not push the run aside.
         * Priority only orders the waiting; it does not raise clocks or cost battery.
         * Returns the old value so a pooled thread can be put back as it was.
         */
        fun raiseCurrentThread(): Int {
            val tid = Process.myTid()
            val old = runCatching { Process.getThreadPriority(tid) }.getOrDefault(0)
            runCatching { Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY) }
            return old
        }

        fun restoreCurrentThread(old: Int) {
            runCatching { Process.setThreadPriority(old) }
        }
    }
}
