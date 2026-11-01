# Thong Nokbe Gym: easy setup guide (no coding needed)

Do this **once, on a computer** (it's easier than on a phone). It takes about 30 minutes.
You need: your Gmail account, a debit/credit card (for Google's pay-as-you-go plan), and your GitHub login.

Everything except video/voice calling runs on **Google** (Firebase is Google's app service).
Calls use **Agora**, which has a free monthly allowance, because Google has no ready-made calling service for apps.

---

## Part A: Firebase (Google) for login by SMS, chat, attendance and fees

**1. Create the project**
1. Open **https://console.firebase.google.com** and sign in with your Gmail.
2. Click **Create a project** (or **Add project**).
3. Name it **thong-nokbe-gym** → **Continue**.
4. Turn **Google Analytics off** → **Create project** → **Continue**.

**2. Turn on the pay-as-you-go plan (needed for SMS codes)**
1. At the bottom-left you'll see **Spark**. Click **Upgrade**.
2. Choose **Blaze**, then add your card.
3. When asked, set a **budget alert** (for example ₹200), so you get an email if costs go up.
   A small gym normally pays nothing or very little. Each SMS code costs a small amount.

**3. Turn on login by phone number**
1. Left menu: **Build → Authentication → Get started**.
2. Tab **Sign-in method** → click **Phone** → switch **Enable** on.
3. (Recommended) Open **Phone numbers for testing** → add your own number, e.g. `+91 70023 97371`, with code `123456`.
   That number can then log in with code 123456 without any SMS (free, good for testing).
4. Click **Save**.

**4. Create the database**
1. Left menu: **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)** → **Next**.
3. Choose **Start in production mode** → **Create**.

**5. Create file storage (for the UPI QR picture)**
1. Left menu: **Build → Storage → Get started**.
2. Choose **production mode**, the same location → **Done**.

**6. Connect the Android app**
1. Click the **⚙️ gear (top-left) → Project settings**.
2. Scroll to **Your apps** → click the **Android** icon.
3. Fill in:
   * **Android package name:** `com.thongnokbe.app`
   * **App nickname:** `Thong Nokbe Gym`
   * **Debug signing certificate SHA-1:** `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
4. Click **Register app** → **Download google-services.json**. Keep this file.
5. Click **Next → Next → Continue to console**.
6. Back in **Project settings → Your apps**, under the Android app click **Add fingerprint** and paste the SHA-256:
   `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` → **Save**.
7. Note your **Project ID** shown at the top of this page (e.g. `thong-nokbe-gym-1a2b3`). You'll need it in Part D.

---

## Part B: Agora for voice and video calls (free monthly minutes)

1. Open **https://console.agora.io** and sign up (Google sign-in works).
2. **Projects → Create a new project** → name `Thong Nokbe Gym`.
3. Authentication: choose **Secured mode: APP ID + Token** → **Submit**.
4. Copy two values and keep them private:
   * **App ID**
   * **Primary Certificate** (click the eye/copy icon)

---

## Part C: Put the keys into GitHub, so it builds the full app

1. Open **https://github.com/sanjoyingti/githubfacefuse** → **Settings** (top tabs).
2. Left menu: **Secrets and variables → Actions → New repository secret**.
3. Add secret 1:
   * Name: `GOOGLE_SERVICES_JSON`
   * Value: open **google-services.json** with Notepad (Windows) or TextEdit (Mac), press **Ctrl+A** then **Ctrl+C**, and paste here.
   * **Add secret**.
4. Add secret 2:
   * Name: `AGORA_APP_ID`
   * Value: your Agora **App ID** → **Add secret**.
5. Tell Claude "secrets added". Claude starts the build and sends you the download link (about 15 minutes).

---

## Part D: Upload the server part (one time, copy & paste)

This uploads the security rules (who may see and change what) and the small server programs (call passes, notifications, fee reminders).
You do it in **Google Cloud Shell**, a terminal that runs in your browser. Nothing gets installed on your computer.

1. Open **https://shell.cloud.google.com** with the same Gmail. Wait until you see a black terminal with a `$` prompt.
2. Copy this whole block, paste it into the terminal, and press **Enter**:
   ```bash
   git clone -b ccr-a6556477-keal6c https://github.com/sanjoyingti/githubfacefuse.git
   cd githubfacefuse/thong-nokbe
   npm install -g firebase-tools
   (cd functions && npm install)
   firebase login --no-localhost
   ```
3. The last command shows a link. Open it, choose your Gmail, **Allow**, copy the code it shows, paste it back into the terminal, and press **Enter**.
4. Paste this, **replacing `YOUR-PROJECT-ID`** with the Project ID from Part A step 6:
   ```bash
   firebase use YOUR-PROJECT-ID
   firebase functions:secrets:set AGORA_APP_CERTIFICATE
   ```
   When asked, paste your **Agora Primary Certificate** and press **Enter**.
5. Paste this and press **Enter**:
   ```bash
   firebase deploy --only firestore,storage,functions
   ```
   * If it asks for **AGORA_APP_ID**, paste your Agora App ID.
   * If it asks to **enable APIs** or to **allow cross-service rules**, type `y` and press **Enter**.
   * It takes 3–5 minutes. At the end you'll see **Deploy complete!**

---

## Part E: Install and register

1. On your Android phone, open the APK link Claude sends you → download → tap it → allow **Install unknown apps** → **Install**.
2. Open **Thong Nokbe Gym** → **📝 Register** → type your name and phone number → **Send activation code**.
3. Type the 6-digit code from the SMS (or `123456` for your test number) → **Activate my account ✅**.
4. Go to **Chat → New group** to create your gym group and add members. You become the group admin.
5. In **Fees**, tap **Add your UPI ID** to set your UPI ID and monthly fee.

Share the same APK link with your members. They install it, register, and you add them to the group.
