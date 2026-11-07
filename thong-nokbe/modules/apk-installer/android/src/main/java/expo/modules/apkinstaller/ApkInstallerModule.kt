package expo.modules.apkinstaller

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Opens Android's "Install / Update app" screen for a downloaded APK.
 * Fire-and-forget (no waiting for a result), so it can never be blocked by another screen
 * (a UPI app, settings…) that did not report back.
 */
class ApkInstallerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ApkInstaller")

    Function("install") { contentUri: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("App is not ready")
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(contentUri), "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }
  }
}
