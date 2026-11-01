import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Space to leave at the bottom so content isn't hidden behind the phone's navigation buttons
 * (Android draws apps edge-to-edge). While the keyboard is open the buttons are covered anyway,
 * so no extra space is added then.
 */
export function useBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return keyboardOpen ? 0 : bottom;
}
