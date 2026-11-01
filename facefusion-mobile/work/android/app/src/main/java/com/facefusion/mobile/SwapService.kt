package com.facefusion.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager

/** What the running single swap reports to its notification, and the Cancel it receives. */
object SwapStatus {
    @Volatile var running = false; private set
    @Volatile var done = 0
    @Volatile var total = 0
    /** Set by the notification's Cancel; the run checks it with its own Cancel button. */
    @Volatile var cancelRequested = false

    fun begin() { running = true; done = 0; total = 0; cancelRequested = false }
    fun end() { running = false; done = 0; total = 0 }
}

/**
 * Keeps a single Swap alive when the app is in the background or the screen is off.
 *
 * Like [BatchService] it does no processing itself -- the Activity runs the swap -- it only
 * holds a FOREGROUND notification (so Android does not reclaim the process when you switch
 * apps) and a partial WAKE LOCK (so the CPU keeps feeding the NPU with the screen off).
 * Before this a normal Swap had neither, and leaving the app during a long clip could get
 * it frozen or killed, which looked like the app closing itself.
 */
class SwapService : Service() {
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            SwapStatus.cancelRequested = true
            return START_NOT_STICKY
        }
        createChannel()
        startForeground(NOTIF_ID, build())
        if (wake == null) {
            wake = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "facefusion:swap").apply {
                    setReferenceCounted(false)
                    // A ceiling, not the expected length: released as soon as the run ends.
                    acquire(4 * 60 * 60 * 1000L)
                }
        }
        Thread({
            while (SwapStatus.running) {
                runCatching { Thread.sleep(1000) }
                if (!SwapStatus.running) break
                runCatching {
                    getSystemService(NotificationManager::class.java).notify(NOTIF_ID, build())
                }
            }
            runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
            stopSelf()
        }, "swap-notify").start()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        runCatching { wake?.takeIf { it.isHeld }?.release() }
        wake = null
        super.onDestroy()
    }

    private fun build(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val cancel = PendingIntent.getService(
            this, 1, Intent(this, SwapService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val d = SwapStatus.done
        val t = SwapStatus.total
        val b = Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notif_swap_title))
            .setContentText(if (t > 0) getString(R.string.notif_swap_text, d, t)
                            else getString(R.string.notif_swap_preparing))
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
        if (t > 0) b.setProgress(t, d, false) else b.setProgress(0, 0, true)
        b.addAction(Notification.Action.Builder(
            null as android.graphics.drawable.Icon?,
            getString(R.string.notif_cancel), cancel).build())
        return b.build()
    }

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL, getString(R.string.notif_swap_channel),
                                     NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    companion object {
        private const val CHANNEL = "swap_run"
        private const val NOTIF_ID = 1003
        private const val ACTION_CANCEL = "com.facefusion.mobile.CANCEL_SWAP"

        fun start(context: Context) {
            SwapStatus.begin()
            runCatching {
                context.startForegroundService(Intent(context, SwapService::class.java))
            }
        }

        /** Ends the run's keep-alive; the service stops itself within a second. */
        fun stop() { SwapStatus.end() }
    }
}
