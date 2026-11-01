# Thong Nokbe 💪 — gym app

A React Native (Expo SDK 58) app for a gym and its members. It works on Android and iOS.

| Tab | What it does |
| --- | --- |
| **Workouts** | 20 exercise videos for each day: **Mon chest · Tue biceps · Wed back · Thu triceps · Fri shoulders · Sat legs** (Sunday is rest). Each video has a play button and plays inside the app (YouTube). The top card shows a **"NEW TODAY"** exercise of the day, which rotates every week. |
| **Chats** | WhatsApp-style groups and 1:1 chats. Create a group, then add members **from phone contacts or by typing a number**. The creator is the **admin** and can add or remove members and **make other members admin** (or dismiss them). Messages are real-time over the internet. The 📹 button starts a **video call** with one person or the whole group. |
| **Attendance** | Only **admins** can mark each member **Present / Absent** for a day. **Every member can view** attendance: the day list, monthly totals, and a calendar per member. |
| **Fees** | Fees are due on the **1st of every month**. Paid members show **green**, unpaid members show **red**. **Pay ₹X via UPI** opens GPay, PhonePe, Paytm or BHIM with the admin's UPI ID and the amount already filled in. When the UPI app reports success, the member is marked paid automatically. The admin adds their UPI ID, fee amount and QR code, and can mark cash payments or undo a payment. |
| **Profile** | Name, about, and log out. |

Members **must install the app** to be in a group. You can add someone who doesn't have the app yet by phone number. They show as *Invited*, and they join the group automatically the first time they sign in with that number.

## How it's built

* **Expo Router** screens are in `src/app/`. Shared code is in `src/lib`, `src/components` and `src/context`.
* **Firebase**:
  * Phone-number OTP login (Auth).
  * Real-time chats, attendance, fees and call signalling (Firestore).
  * UPI QR images (Storage).
  * Push notifications (Cloud Messaging).
  * Cloud Functions in `functions/`.
* **Agora** handles video calls, both 1:1 and group (`react-native-agora`).
* **UPI**: on Android the app opens the UPI app with `startActivityForResult` (`expo-intent-launcher`), so it can read back the `Status=SUCCESS&txnId=…` result. iOS doesn't return a result, so the member types in the UTR number instead.
* **Security rules** (`firestore.rules`) enforce the important parts on the server:
  * Only admins can change members or admins, mark attendance, or mark cash payments.
  * A member can only record their own UPI payment.
  * Only group members can read a group's chat, attendance and fees.

  The tests are in `rules-tests/` and run against the Firestore emulator.
* **Videos**: `src/data/exerciseList.json` holds the 120 exercises. `scripts/fetch-exercise-videos.mjs` finds an embeddable YouTube tutorial for each one (all 120 are different videos) and writes `src/data/exerciseVideos.json`. Run `node scripts/fetch-exercise-videos.mjs --force` any time to refresh them.

## Setup (one time)

1. **Firebase project** at <https://console.firebase.google.com>:
   * Turn on **Authentication → Phone**.
   * Create a **Firestore** database and a **Storage** bucket.
   * Upgrade to the **Blaze** plan. Cloud Functions and SMS need it, and there is a free quota.
   * Add an **Android app** with package `com.thongnokbe.app`. Add your **SHA-1 and SHA-256** fingerprints (from `npx eas-cli credentials`); phone auth needs them. Download **`google-services.json`** into this folder.
   * Add an **iOS app** with bundle ID `com.thongnokbe.app`. Download **`GoogleService-Info.plist`** into this folder. Upload an APNs key under *Project settings → Cloud Messaging*.
2. **Agora** at <https://console.agora.io>: create a project with an App ID and an App Certificate.
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
* **Incoming calls when the app is closed** arrive as a high-priority push notification. Tapping it joins the call. When the app is open, a full-screen accept/decline screen appears. A ringing lock-screen UI like WhatsApp's would need CallKit or ConnectionService.
* Change the default country code (`+91`) in `src/theme.ts`.
