package com.facefusion.mobile

import android.content.Context
import java.io.File

/**
 * The ONLY way this app deletes a file.
 *
 * Every delete in the app is of its own working files -- copies of picked targets and
 * sources, finished outputs, model downloads, recordings -- all inside the app's private
 * folders. The user's own photos and videos are only ever READ (openInputStream on what the
 * picker returns) and are never written, moved or deleted.
 *
 * This makes that a hard rule instead of a convention: [safeDelete] refuses any path that
 * does not resolve inside one of the app's private roots (filesDir, cacheDir, the
 * app-specific external folders), so no future bug can remove a file outside the app.
 */
object SafeFiles {
    @Volatile private var roots: List<String> = emptyList()

    fun init(ctx: Context) {
        val c = ctx.applicationContext
        roots = listOfNotNull(
            c.filesDir, c.cacheDir, c.noBackupFilesDir, c.codeCacheDir,
            c.getExternalFilesDir(null), c.externalCacheDir,
        ).mapNotNull { runCatching { it.canonicalPath }.getOrNull() }
    }

    /**
     * The same roots by package name, usable before [init] has run (a service can delete a
     * stale download before any Activity exists). /data/user/0 is a link to /data/data, so
     * both spellings are listed.
     */
    private val fallbackRoots: List<String> by lazy {
        val id = BuildConfig.APPLICATION_ID
        listOf("/data/data/$id", "/data/user/0/$id", "/data/user_de/0/$id",
               "/storage/emulated/0/Android/data/$id", "/sdcard/Android/data/$id")
    }

    fun isAppPrivate(f: File): Boolean {
        val p = runCatching { f.canonicalPath }.getOrNull() ?: return false
        return (roots + fallbackRoots).any { r -> p == r || p.startsWith(r + File.separator) }
    }
}

/** Delete this file ONLY if it lives in the app's private storage; otherwise do nothing. */
fun File.safeDelete(): Boolean {
    if (!SafeFiles.isAppPrivate(this)) {
        android.util.Log.w("ffsafe", "refused to delete outside app storage: $path")
        return false
    }
    return delete()
}
