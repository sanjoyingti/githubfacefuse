# Building the APK

## Android Studio (any OS)

1. **File → Open** and choose this folder: `work/android` (the one with `settings.gradle.kts`).
2. Let Gradle sync. Android Studio installs what the project asks for:
   - Android SDK platform 35, build tools 34
   - NDK **27.2.12479018** and CMake **3.22.1** (SDK Manager → SDK Tools, if it does not
     offer to install them itself)
   - JDK 17 or newer (the one bundled with Android Studio is fine)
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, or run on a device.

The first build downloads the **Qualcomm AI Runtime (QAIRT) 2.49** from Qualcomm, about
2.3 GB, once. Only about 85 MB of it (the NPU runtime and its headers) is extracted into
the project; the zip stays in `work/android/.qairt-cache/` so later builds skip the
download. This happens inside Gradle (`qnnStage` in `app/build.gradle.kts`), so it needs no
bash and works the same on Windows, macOS and Linux. Those files are Qualcomm's and are not
redistributed with this source.

Already have a QAIRT SDK unpacked? Set the environment variable `QNN_SDK_ROOT` to it before
starting Android Studio and it is copied from there instead. A different QAIRT release:
`-PqairtVersion=2.xx.x.yyyymmdd` (it must be 2.49 or newer: the model files are built with
2.49).

The debug APK lands in `app/build/outputs/apk/debug/`. Its application ID is
`com.facefusion.mobile.debug` and it is labelled "FaceFusion Debug", so it installs next to
the release app. On first launch the app downloads its face models (Settings → Models).

## Command line

```sh
cd work/android
./gradlew :app:assembleDebug        # Windows: gradlew.bat :app:assembleDebug
```

Set `sdk.dir` in `local.properties` or `ANDROID_HOME` if Android Studio is not installed.

## What is in this source tree

| Path | What |
|---|---|
| `app/src/main/cpp/` | the native pipeline (C++), built by CMake |
| `app/src/main/cpp/ffmotion.*` | head-pose fade, motion smoothing, rotated detection |
| `app/src/main/assets/masks/` | the bundled mask models (XSeg occlusion, BiSeNet face parser), ncnn format |
| `ncnn/` | ncnn 20260526 for Android (BSD-3-Clause), the GPU/CPU backend and the mask models' runtime |
| `../masks/` | how the mask models were converted (`convert_masks.sh`) and checked |
| `../native/test_quality.cpp` | host (PC) test of the pipeline on the ncnn CPU backend |

`ncnn/` must stay at least at 20260113: the published content-checker model uses ncnn's
`SDPA` layer, which older releases do not have, and without it the app cannot start on a
phone without a Qualcomm NPU. Releases built with NDK r28+ (20261020 on) do not link
against NDK 27.

## Release signing

`keystore.properties` next to this file (gitignored) with `storeFile`, `storePassword`,
`keyAlias`, `keyPassword`. Without it the release build is produced unsigned.

## Building this zip with an AI coding agent

Do not let an agent "fix" compile errors by editing the source: it can silently remove
features (for example the extra-photos controls). Build with the project's own Gradle
wrapper and its pinned Kotlin (2.0.21) instead:

    ./gradlew :app:assembleDebug

or in Android Studio: Build > Build APK(s). If a build fails, send the exact error text
instead of letting the agent change files.

## What is in this zip

Everything Android Studio needs is here: the sources, the Gradle wrapper, the bundled
ncnn libraries (`ncnn/`), the mask models (`app/src/main/assets`), the debug keystore and
the build scripts. Two things are fetched on the FIRST build, automatically:

* the Qualcomm AI Runtime (about 2.4 GB, into `.qairt-cache/`) - needs internet;
* Gradle dependencies and, if missing, the Android SDK pieces named in `AGENTS.md`.

## When Qualcomm's download is blocked (HTTP 403)

Some cloud IDEs (GitHub Codespaces among them) cannot reach Qualcomm's download. The build
then falls back by itself: it downloads the published APK of THIS release (named by the
`BUILD_NUMBER` file) into `.apk-cache/`, takes the arm64 native libraries out of it, and
compiles only the Kotlin code around them - no C++ compile, no Qualcomm download. The result
is the same app. `-PapkFallbackUrl=<url>` names a different APK; `-PprebuiltNativeDir=<dir>`
names the libraries directly. They MUST be from the same release as this source: the build
refuses libraries that lack any native function the Kotlin code declares.
