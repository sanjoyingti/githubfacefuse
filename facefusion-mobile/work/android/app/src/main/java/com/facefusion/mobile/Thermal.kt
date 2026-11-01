package com.facefusion.mobile

import android.content.Context
import android.os.PowerManager

/**
 * Keeps a long run from cooking the phone.
 *
 * A swap keeps the NPU, the GPU and the CPU busy for minutes. Left alone, the phone heats
 * until Android throttles it hard or, on some devices, kills the app outright -- which reads
 * as "the app closed itself". So every frame asks the system how hot it is
 * ([PowerManager.getCurrentThermalStatus], polled at most once a second) and, once the
 * phone is warm, pauses briefly between frames. The output is identical; only the pace
 * changes, and a cooler phone usually ends up FASTER than one the system has throttled.
 */
object Thermal {
    @Volatile private var power: PowerManager? = null
    @Volatile private var lastPollMs = 0L
    @Volatile private var status = PowerManager.THERMAL_STATUS_NONE

    fun init(ctx: Context) {
        if (power == null)
            power = ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
    }

    /** The current status, refreshed at most once a second. */
    fun status(): Int {
        val now = System.currentTimeMillis()
        if (now - lastPollMs >= 1000) {
            lastPollMs = now
            status = runCatching { power?.currentThermalStatus }.getOrNull()
                ?: PowerManager.THERMAL_STATUS_NONE
        }
        return status
    }

    /** How long to rest before the next frame at this status, in milliseconds. */
    fun pauseMs(s: Int = status()): Long = when {
        s >= PowerManager.THERMAL_STATUS_CRITICAL -> 1000L
        s >= PowerManager.THERMAL_STATUS_SEVERE -> 250L
        s >= PowerManager.THERMAL_STATUS_MODERATE -> 60L
        else -> 0L
    }

    fun label(s: Int): String = when (s) {
        PowerManager.THERMAL_STATUS_LIGHT -> "light"
        PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
        PowerManager.THERMAL_STATUS_SEVERE -> "severe"
        PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
        else -> "normal"
    }
}
