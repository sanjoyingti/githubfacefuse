import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * If someone opens an invite link before signing in, remember the code and open the
 * "Join group" screen right after they finish signing in / registering.
 */
const KEY = 'pending-invite-code';

export function inviteCodeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/join\/([A-Za-z0-9]{12,32})/);
  return m ? m[1] : null;
}

export const savePendingInvite = (code: string) => AsyncStorage.setItem(KEY, code).catch(() => {});
export const takePendingInvite = async () => {
  const c = await AsyncStorage.getItem(KEY).catch(() => null);
  if (c) await AsyncStorage.removeItem(KEY).catch(() => {});
  return c;
};
export const clearPendingInvite = () => AsyncStorage.removeItem(KEY).catch(() => {});
