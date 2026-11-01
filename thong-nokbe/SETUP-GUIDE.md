# Thong Nokbe Gym: free setup guide (no card, no coding)

This version is **100% free**. You don't need a credit or debit card.
Do this **once, on a computer**. It takes about 25 minutes. You need your Gmail and GitHub logins.

| Part | Free service | Used for |
|---|---|---|
| A | **Firebase (Google), free "Spark" plan** | Google login, chat, attendance, fees |
| B | **Agora, 10,000 free minutes every month** | Voice and video calls |
| C | **GitHub** | Builds the app (APK) for you |
| D | **Google Cloud Shell** | Uploads the security rules (one time) |

---

## Part A: Firebase (Google)

**1. Create the project**
1. Open **https://console.firebase.google.com** and sign in with Gmail.
2. **Create a project** → name `thong-nokbe-gym` → **Continue**.
3. Turn **Google Analytics off** → **Create project** → **Continue**.
4. Stay on the free **Spark** plan. **Don't** click Upgrade.

**2. Turn on Google login**
1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** → **Google** → switch **Enable** on.
3. Pick your Gmail as the **support email** → **Save**.

**3. Create the database**
1. **Build → Firestore Database → Create database**.
2. Location **asia-south1 (Mumbai)** → **Next** → **Start in production mode** → **Create**.

**4. Connect the Android app**
1. **⚙️ (top-left) → Project settings** → scroll to **Your apps** → **Android** icon.
2. Fill in:
   * **Package name:** `com.thongnokbe.app`
   * **App nickname:** `Thong Nokbe Gym`
   * **SHA-1:** `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
3. **Register app** → click **Next / Continue to console** (you'll download the file in step 5).
4. Back in **Project settings → Your apps**, under the Android app, click **Add fingerprint** → paste the SHA-256:
   `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` → **Save**.

**5. Download the app's connection file**
1. Still in **Project settings → Your apps**, click **google-services.json** to download it.
   *(Download it **after** steps 2 and 4. Google login only works with a file downloaded after turning on Google sign-in and adding SHA-1.)*
2. Note your **Project ID** shown at the top of this page (e.g. `thong-nokbe-gym-1a2b3`).

---

## Part B: Calls (Agora + a free Cloudflare "call pass" server)

**B1. Agora (free 10,000 minutes a month, no card)**
1. **https://console.agora.io** → **Google** → **Create a new account** → tick terms + **I am human** → **Continue**.
2. Choose **Realtime Communications Builder**. **Skip "Add a Card"**.
3. **New Project** → name `Thong Nokbe Gym` → any use case → **Submit** → open it with **Configure**.
4. Keep this page open. You'll copy the **App ID** and the **Primary Certificate** in B2.

**B2. Cloudflare Worker (free, no card)**
This small server keeps the Agora certificate secret. It gives a call pass only to people signed in to your app who are part of that call.
1. Open **https://dash.cloudflare.com/sign-up** → sign up (email + password) → confirm the email they send.
2. Left menu **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World!** (or **Create Worker**).
3. Name it `thong-nokbe-calls` → **Deploy**.
4. Tap **Edit code**. Delete all the code in the editor.
5. Open **https://raw.githubusercontent.com/sanjoyingti/githubfacefuse/ccr-a6556477-keal6c/thong-nokbe/token-server/worker.phone.js** (comment-free version that pastes cleanly in the phone editor) → select all → copy → paste into the empty editor → **Deploy**.
6. Go back to the worker → **Settings → Variables and Secrets → + Add**, three times:
   * Type **Text**, name `FIREBASE_PROJECT_ID`, value `roid-266a2`
   * Type **Text**, name `AGORA_APP_ID`, value: your Agora **App ID**
   * Type **Secret**, name `AGORA_APP_CERTIFICATE`, value: your Agora **Primary Certificate**

   → **Deploy**.
7. Copy the worker's address. It looks like `https://thong-nokbe-calls.YOURNAME.workers.dev`.
   Open it in the browser. It should say `"ok": true`.
8. Send Claude that address. It's not a secret. Claude adds it to the app and builds the APK.

---

## Part C: Give the app its Firebase file

Send **google-services.json** (Part A step 5) to Claude in the chat. It's not a password: it's built into every copy of the app anyway.
Claude adds it to the project, and GitHub builds the APK with it.

---

## Part D: Publish the security rules (one time, 2 minutes on the phone)

These rules decide who can see and change what. For example, only admins mark attendance. Until they're published, the app can't save anything.

1. Open **https://raw.githubusercontent.com/sanjoyingti/githubfacefuse/ccr-a6556477-keal6c/thong-nokbe/firestore.rules** → long-press → **Select all** → **Copy**.
2. Firebase → **Firestore** → **Rules** tab → select and delete the old text → **Paste** → **Publish**.

---

## Part E: Install and use

1. Open the APK link on your Android phone → download → tap it → allow **Install unknown apps** → **Install**.
2. Open **Thong Nokbe Gym** → **Continue with Google** → pick your Gmail.
3. Type your **name** and **phone number** → **Activate my account ✅**.
4. **Chat → New group** → name your gym group and add members from contacts or by number. You're the admin.
5. **Fees → Add your UPI ID** → enter your UPI ID and monthly fee. The app makes your UPI QR code automatically.

**Members:** they install the same APK, tap **Continue with Google**, and register with their phone number.
* If you already added them as app users, they're in the group straight away.
* If you invited their number before they registered, you'll see **"🙋 Waiting for your approval"** in **Group info**. Tap **✓ Add**.
  (In the free version numbers aren't checked by SMS, so only approve people you know.)

---

## What's different from the paid version
* Login is with **Google** instead of an SMS code.
* Message and call alerts appear while the app is open or running in the background. If the app is fully closed, nothing pops up until it's opened.
* The fee reminder is an alarm on each phone on the **1st of every month at 9 AM**.
* Calls use Agora's free minutes. A free Cloudflare Worker hands out call passes and keeps the Agora certificate secret.
