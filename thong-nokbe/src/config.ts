// Values come from EXPO_PUBLIC_* env vars (see .env.example) so no secrets live in git.
export const AGORA_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID ?? '';
// Link shared with contacts who don't have the app yet.
export const APP_INVITE_LINK =
  process.env.EXPO_PUBLIC_INVITE_LINK ?? 'https://play.google.com/store/apps/details?id=com.thongnokbe.app';
