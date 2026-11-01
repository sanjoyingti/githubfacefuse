# Thong Nokbe Gym 🏋️

A simple gym app for Android and iPhone, built with React Native (Expo SDK 58). It uses big buttons, plain words and pictures, so anyone (even a kid) can use it. The logo is a person lifting a barbell (`assets/icon.png`).

The five tabs at the bottom are **Exercise · Chat · Call · Attendance · Fees**. Tap **Me** at the top right for your profile.

| Tab | What it does |
| --- | --- |
| **Exercise** | 20 exercise videos for each day: **Mon chest · Tue biceps · Wed back · Thu triceps · Fri shoulders · Sat legs** (Sunday is rest). Each video has a play button and plays inside the app (YouTube). The top card shows a **"NEW TODAY"** exercise of the day, which rotates every week. |
| **Chat** | WhatsApp-style groups and 1:1 chats. Create a group, then add members **from phone contacts or by typing a number**. The creator is the **admin** and can add or remove members and **make other members admin** (or dismiss them). Messages are real-time over the internet. |
| **Call** | Call **any app user** one-to-one, or call a **whole gym group** at once (everyone in it rings). Every call offers 📞 **Voice** or 📹 **Video**. Video calls are live, with camera on/off and front/back flip; voice calls have mute and a speaker button. The call buttons are also in every chat's top bar and on the group info page. |
| **Attendance** | Only **admins** can mark each member **Present / Absent** for a day. **Every member can view** attendance: the day list, monthly totals, and a calendar per member. |
| **Fees** | Fees are due on the **1st of every month**. Paid members show **green**, unpaid members show **red**. **Pay ₹X via UPI** opens GPay, PhonePe, Paytm or BHIM with the admin's UPI ID and the amount already filled in. When the UPI app reports success, the member is marked paid automatically. The admin adds their UPI ID, fee amount and QR code, and can mark cash payments or undo a payment. |
| **Me** | Name, about, and log out. |

**Only people who have installed the app can call or be called.** The server only lets you ring people who share a chat with you (your gym group, or a 1:1 chat, which any app user can open with any other app user). Only the people in a call get a pass to its call room, and only while the call is live. Someone who logs out or uninstalls shows as *Not on the app now* and can't be called until they sign in again.

Members **must install the app** to be in a group. You can add someone who doesn't have the app yet by phone number. They show as *Invited*, and they join the group automatically the first time they sign in with that number.

## How it's built

* **Expo Router** screens are in `src/app/`. Shared code is in `src/lib`, `src/components` and `src/context`.
* **Firebase**:
  * Phone-number OTP login (Auth).
  * Real-time chats, attendance, fees and call signalling (Firestore).
  * UPI QR images (Storage).
  * Push notifications (Cloud Messaging).
  * Cloud Functions in `functions/`.
* **Agora** handles voice and video calls, both 1:1 and group (`react-native-agora`). Call rooms need a server-issued pass (`agoraToken` Cloud Function).
* **UPI**: on Android the app opens the UPI app with `startActivityForResult` (`expo-intent-launcher`), so it can read back the `Status=SUCCESS&txnId=…` result. iOS doesn't return a result, so the member types in the UTR number instead.
* **Security rules** (`firestore.rules`) enforce the important parts on the server:
  * Only admins can change members or admins, mark attendance, or mark cash payments.
  * A member can only record their own UPI payment.
  * Only group members can read a group's chat, attendance and fees.

  The tests are in `rules-tests/` and run against the Firestore emulator.
* **Videos**: `src/data/exerciseList.json` holds the 120 exercises. `scripts/fetch-exercise-videos.mjs` finds an embeddable YouTube tutorial for each one (all 120 are different videos) and writes `src/data/exerciseVideos.json`. Run `node scripts/fetch-exercise-videos.mjs --force` any time to refresh them.

## Quick start: connect the app to Firebase (about 15 minutes)

The downloadable APK only signs in once it's connected to **your** Firebase project. Until then it shows "Setup not finished".

1. Go to <https://console.firebase.google.com> → **Add project** → name it `thong-nokbe-gym` → Create.
2. Click the **⚙️ → Project settings → Usage and billing** and switch to the **Blaze** plan. SMS sign-in needs it, and it has a free quota.
3. **Build → Authentication → Get started → Sign-in method → Phone → Enable → Save.**
   *Tip:* under "Phone numbers for testing" you can add your own number with a fixed code (e.g. `123456`) to try the app without waiting for SMS.
4. **Build → Firestore Database → Create database** (pick region `asia-south1`, production mode). Then **Build → Storage → Get started**.
5. **⚙️ Project settings → Your apps → Android icon**:
   * Package name: `com.thongnokbe.app`
   * Then **Add fingerprint** twice and paste these (they match the APKs built by GitHub):
     * SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
     * SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
   * Click **Download google-services.json**.
6. On GitHub open **this repo → Settings → Secrets and variables → Actions → New repository secret**:
   * Name `GOOGLE_SERVICES_JSON`, value: open `google-services.json` in a text editor, copy **everything**, paste.
   * Name `AGORA_APP_ID`, value: your Agora App ID (from <https://console.agora.io>, project in "Secured mode").
7. Go to **Actions → Thong Nokbe Gym APK → Run workflow**, or push any change. In about 15 minutes a new release appears under **Releases** with the working APK.
8. Deploy the database rules and the server functions once (step 4 below), so chat, calls, attendance and fees are allowed and protected.

> These fingerprints belong to React Native's shared debug key, which is fine for your gym's own use. Before publishing on the Play Store, make your own signing key with `npx eas-cli credentials` and add its fingerprints in Firebase too.

## Setup (one time)

1. **Firebase project** at <https://console.firebase.google.com>:
   * Turn on **Authentication → Phone**.
   * Create a **Firestore** database and a **Storage** bucket.
   * Upgrade to the **Blaze** plan. Cloud Functions and SMS need it, and there is a free quota.
   * Add an **Android app** with package `com.thongnokbe.app`. Add your **SHA-1 and SHA-256** fingerprints (from `npx eas-cli credentials`); phone auth needs them. Download **`google-services.json`** into this folder.
   * Add an **iOS app** with bundle ID `com.thongnokbe.app`. Download **`GoogleService-Info.plist`** into this folder. Upload an APNs key under *Project settings → Cloud Messaging*.
2. **Agora** at <https://console.agora.io>: create a project in **secure mode (App ID + App Certificate)**. The certificate is required: without it, calls won't start.
3. **Configure**:
   ```bash
   cp .env.example .env          # set EXPO_PUBLIC_AGORA_APP_ID
   npm install
   ```
4. **Deploy the backend**:
   ```bash
   npm i -g firebase-tools && firebase login && firebase use --add
   (cd functions && npm install)
   firebase functions:secrets:set AGORA_APP_CERTIFICATE   # paste the Agora certificate
   # When asked for AGORA_APP_ID during deploy, paste the Agora App ID
   firebase deploy --only firestore,storage,functions
   ```
5. **Build the app**. It uses native modules, so **Expo Go won't work**:
   ```bash
   npx eas-cli@latest build --profile preview --platform android   # installable APK to share with members
   npx eas-cli@latest build --profile development --platform android  # dev build, then: npx expo start
   ```
   For EAS builds, set `EXPO_PUBLIC_AGORA_APP_ID` as an EAS environment variable too.

## Checks

```bash
npx tsc --noEmit && npx expo lint && npx expo-doctor
cd rules-tests && npm install && npm test     # needs Java (Firestore emulator)
```

## Good to know

* **UPI auto-confirmation**: Android UPI apps return a success or failure result, and the app marks the member paid from that. Some apps return nothing; then the member confirms with the UTR number, and the admin can see it and undo the payment if it's wrong. Some UPI apps limit "pay with amount" links to **personal** UPI IDs. A **merchant/business UPI ID** (e.g. GPay for Business, PhonePe Business) works most reliably. For bank-verified payments, use a gateway such as Razorpay.
* **Incoming calls when the app is closed** arrive as a high-priority push notification. Tapping it joins the call. When the app is open, a full-screen Answer/No screen appears.
* **"Not on the app"** is detected when someone logs out, or the next time the server tries to notify a phone that has uninstalled the app. So right after an uninstall, a person can still show as on the app for a short while. A ringing lock-screen UI like WhatsApp's would need CallKit or ConnectionService.
* Change the default country code (`+91`) in `src/theme.ts`.
