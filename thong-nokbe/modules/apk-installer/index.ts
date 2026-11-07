import { requireOptionalNativeModule } from 'expo';

type ApkInstallerModule = { install(contentUri: string): void };

/** Native "open the APK installer" (Android only; null on other platforms or older app builds). */
export const ApkInstaller = requireOptionalNativeModule<ApkInstallerModule>('ApkInstaller');
