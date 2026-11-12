# Instructions for AI coding agents (Copilot, Claude, Cursor, ...)

This project is a finished, tested Android app. **Do not edit any file** to make a build
"pass": a compile error you "fix" by changing or removing code silently deletes features
(for example the up-to-5-photos controls on the Faces tab and the Swap screen).

## To build the APK

    ./gradlew :app:assembleDebug

(Windows: `gradlew.bat :app:assembleDebug`.) The APK is in `app/build/outputs/apk/debug/`.

* Use the project's own Gradle wrapper and its pinned plugins (Kotlin 2.0.21, AGP in
  `build.gradle.kts`). Do not upgrade or downgrade Kotlin, Gradle, AGP, the NDK or CMake.
* The first build downloads the Qualcomm AI Runtime (about 2.4 GB) into `.qairt-cache`.
  That needs internet and about 6 GB of free disk. A slow first build is normal.
* Needs JDK 17, Android SDK platform 35, build-tools 34.0.0, NDK 27.2.12479018, CMake 3.22.1.
  Android Studio offers to install them; `sdk.dir` goes in `local.properties`.

## If Qualcomm's download is blocked (HTTP 403, common in cloud IDEs / Codespaces)

Do nothing special: the build detects it and takes the native libraries from the published
APK **of the same release** (the `BUILD_NUMBER` file names it:
`https://github.com/sanjoyingti/githubfacefuse/releases/download/v1.0.<N>/FaceFusion-1.0.<N>.apk`),
then compiles only the Kotlin code around them. Just run the normal build command.

**Never** point `-PprebuiltNativeDir` at an APK of another/older release (for example v0.9.0):
its native library lacks newer functions and the app would crash. The build checks this
(`checkPrebuiltNative`) and fails with a clear message instead.

## If the build fails

Do not change source files. Report the exact error text (the first `e:` or `error:` line and
the lines around it) to the user, and name what is missing (SDK, NDK, disk space, network).
