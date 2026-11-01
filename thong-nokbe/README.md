# Thong Nokbe Gym 🏋️

A simple gym app for Android and iPhone, built with React Native (Expo SDK 58). It uses big buttons, plain words and pictures, so anyone (even a kid) can use it. The icon is the owner's chosen bodybuilder image (`assets/brand-original.jpg`), used unchanged; `python3 scripts/make-icon.py assets` places it on a square and makes the icon sizes.

The five tabs at the bottom are **Exercise · Chat · Call · Attendance · Fees**. Tap **Me** at the top right for your profile.

| Tab | What it does |
| --- | --- |
| **Exercise** | 20 exercise videos for each day: **Mon chest · Tue biceps · Wed back · Thu triceps · Fri shoulders · Sat legs** (Sunday is rest). Videos play in the app's own simple player (big play/pause, ±10 s, 🐢 slow motion, previous/next, **Mark as done** with a daily progress bar); nothing opens outside the app. Videos stream from YouTube, so they need internet. The top card shows a **"NEW TODAY"** exercise of the day, which rotates every week. |
| **Chat** | WhatsApp-style groups and 1:1 chats. Create a group, then add members **from phone contacts or by typing a number**. The creator is the **admin** and can add or remove members and **make other members admin** (or dismiss them). Messages are real-time over the internet. |
| **Call** | Call **any app user** one-to-one, or call a **whole gym group** at once (everyone in it rings). Every call offers 📞 **Voice** or 📹 **Video**. Video calls are live, with camera on/off and front/back flip; voice calls have mute and a speaker button. The call buttons are also in every chat's top bar and on the group info page. |
| **Attendance** | Only **admins** can mark each member **Present / Absent** for a day. **Every member can view** attendance with a **Day / Week / Month** switch: Week and Month rank everyone by days they came, and tapping a name shows their calendar. |
| **Fees** | Fees are due on the **1st of every month**. Paid members show **green**, unpaid members show **red**. **Pay ₹X via UPI** opens GPay, PhonePe, Paytm or BHIM with the admin's UPI ID and the amount already filled in. When the UPI app reports success, the member is marked paid automatically. The admin adds their UPI ID and fee amount (the app draws the UPI QR code itself), can mark cash payments or undo a payment, can send a **🔔 fee reminder** to one unpaid member or all of them (a private message plus a phone notification), and can send a **📢 fee notice to every member** (group message plus a notification on every member's phone). |
| **Me** | Name, about, and log out. |

**Login:** **Continue with Google** (free), then register your name and phone number once.

**Only people who use the app can call or be called.** The security rules only let you ring people who share a chat with you (your gym group, or a 1:1 chat, which any app user can open with any other app user). Someone who logs out shows as *Not on the app now* and can't be called until they sign in again.

**Invite links (like WhatsApp):** admins open **Group info → Invite via link** to send a link by SMS, WhatsApp or QR code. Anyone with the app who taps it sees **"Join group"**. Without the app, the link opens a page with a download button. Admins can reset the link.

Members **must install the app** to be in a group. You can add someone who doesn't have the app yet by phone number. They show as *Invited* and **join the group automatically** as soon as they register with that number.

## How it's built

* **Expo Router** screens are in `src/app/`. Shared code is in `src/lib`, `src/components` and `src/context`.
* **Firebase**:
  * Google Sign-In (Auth).
  * Real-time chats, attendance, fees and call signalling (Firestore).
  * Everything runs on the free Spark plan.
* **Agora** handles voice and video calls, both 1:1 and group (`react-native-agora`).
* **UPI**: on Android the app opens the UPI app with `startActivityForResult` (`expo-intent-launcher`), so it can read back the `Status=SUCCESS&txnId=…` result. iOS doesn't return a result, so the member types in the UTR number instead.
* **Security rules** (`firestore.rules`) enforce the important parts on the server:
  * Only admins can change members or admins, mark attendance, or mark cash payments.
  * A member can only record their own UPI payment.
  * Only group members can read a group's chat, attendance and fees.

  The tests are in `rules-tests/` and run against the Firestore emulator.
* **Videos**: `src/data/exerciseList.json` holds the 120 exercises. `scripts/fetch-exercise-videos.mjs` finds an embeddable YouTube tutorial for each one (all 120 are different videos) and writes `src/data/exerciseVideos.json`. Run `node scripts/fetch-exercise-videos.mjs --force` any time to refresh them.

**Setup:** follow the plain-language **[SETUP-GUIDE.md](SETUP-GUIDE.md)**. It's 100% free: Firebase Spark plan, Google login, Agora free minutes, no card.

## Free version: how it works

* **Login:** Google Sign-In (Firebase Auth, free). After the first sign-in each person registers their name and phone number.
  A number can belong to one account only (`phoneIndex` collection). Numbers aren't SMS-verified; a number an admin added to a group (`pendingPhones`) joins automatically when someone registers with it.
* **Data:** Cloud Firestore on the free Spark plan. Rules in `firestore.rules`, indexes in `firestore.indexes.json`. Deploy with `firebase deploy --only firestore`.
* **No paid server parts:** there are no Cloud Functions and no Cloud Storage.
  * Alerts for messages and calls are local notifications (`expo-notifications`), shown while the app is open or running in the background.
  * The fee reminder is a monthly local alarm (1st, 9 AM).
  * The UPI QR is generated in the app from the UPI ID (`react-native-qrcode-svg`).
* **Calls:** Agora (10,000 free minutes a month). A free Cloudflare Worker (`token-server/worker.js`) keeps the Agora certificate secret and issues a call token only after checking the Firebase sign-in token and that the person can read the call in Firestore. Tests: `node --test token-server/worker.test.mjs`.
* **Build:** `.github/workflows/thong-nokbe-apk.yml` builds the APK (using `google-services.json`) and publishes it as a GitHub Release.

## Checks

```bash
npx tsc --noEmit && npx expo lint && npx expo-doctor
cd rules-tests && npm install && npm test     # needs Java (Firestore emulator)
```

## Good to know

* **UPI auto-confirmation**: Android UPI apps return a success or failure result, and the app marks the member paid from that. Some apps return nothing; then the member confirms with the UTR number, and the admin can see it and undo the payment if it's wrong. Some UPI apps limit "pay with amount" links to **personal** UPI IDs. A **merchant/business UPI ID** (e.g. GPay for Business, PhonePe Business) works most reliably. For bank-verified payments, use a gateway such as Razorpay.
* **Alerts:** incoming calls and new messages show as phone notifications while the app is open or still running in the background. If the app has been fully closed, alerts appear the next time it's opened. Instant alerts on a closed app would need a paid server (Cloud Functions + Cloud Messaging).
* **"Not on the app"** shows when someone logs out. Uninstalling without logging out can't be detected without a server.
* Change the default country code (`+91`) in `src/theme.ts`.
