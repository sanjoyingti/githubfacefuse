import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';
import { getFunctions } from '@react-native-firebase/functions';
import { getMessaging } from '@react-native-firebase/messaging';
import { getStorage } from '@react-native-firebase/storage';

export const auth = getAuth();
export const db = getFirestore();
export const storage = getStorage();
export const functions = getFunctions();
export const messaging = getMessaging();
