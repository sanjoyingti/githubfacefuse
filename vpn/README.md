# Your own free, fast VPN (WireGuard + Oracle Cloud Always Free)

You get a private VPN server that only you use. It runs WireGuard, the fastest VPN
protocol, with speed tuning turned on. It costs ₹0, and Oracle includes 10 TB of
traffic every month for free.

You do the setup once (about 20 minutes, from your phone's browser). After that you
only open the **WireGuard** app and tap the switch.

---

## Step 1: Create a free Oracle Cloud account

1. Open **https://signup.oraclecloud.com** (Chrome works, so does "Desktop site" mode).
2. Fill in your name and email, then verify the email.
3. **Home Region**: pick it carefully, **because you can't change it later.** Your VPN's country will be this region.
   * **Singapore**: best overall. It's close to India (low ping) and gives you a foreign IP.
   * **India West (Mumbai)** / **India South (Hyderabad)**: fastest ping, but the IP stays Indian.
   * Other nearby choices: Japan (Tokyo/Osaka), South Korea (Seoul/Chuncheon).
4. Add a debit/credit card. It's **only for verification**: you'll see a small temporary hold that is refunded, and nothing is charged on the free tier.
5. Wait for "Your account is ready" (sometimes a few minutes).

## Step 2: Open Cloud Shell and make an SSH key

1. Log in at **https://cloud.oracle.com**.
2. Tap the **Cloud Shell** icon (`>_`, top right). A terminal opens in the browser.
3. Paste this and press Enter:
   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
   ```
4. **Copy** the line it prints (it starts with `ssh-ed25519`). You'll need it in Step 3.

## Step 3: Create the free server

1. Menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Image**: tap *Change image* → **Canonical Ubuntu** (22.04 or 24.04).
3. **Shape**: tap *Change shape* and pick one marked **Always Free-eligible**:
   * **Ampere → VM.Standard.A1.Flex** (set 1–4 OCPU). This is the fastest. If you get "Out of capacity", try again later or use the next option.
   * **AMD → VM.Standard.E2.1.Micro**. Always available, and still fine for phone streaming.
4. **Networking**: leave the defaults. Make sure **"Assign a public IPv4 address"** is on.
5. **Add SSH keys** → **Paste public keys** → paste the line you copied in Step 2.
6. Tap **Create**. Wait until the status says **Running**, then copy the **Public IP address**.

## Step 4: Open the VPN port in Oracle's firewall

1. On the instance page, tap the **Subnet** link (under *Primary VNIC*).
2. Open **Security** (or **Security Lists**) → **Default Security List** → **Add Ingress Rules**:
   * Source CIDR: `0.0.0.0/0`
   * IP Protocol: **UDP**
   * Destination Port Range: `51820`
3. Tap **Add Ingress Rules**.

## Step 5: Install the VPN (one command)

Go back to **Cloud Shell** and connect to your server (replace `YOUR_IP`):

```bash
ssh ubuntu@YOUR_IP
```

Type `yes` if it asks. Then run:

```bash
curl -fsSLo install.sh https://raw.githubusercontent.com/sanjoyingti/githubfacefuse/main/vpn/server/install.sh && sudo bash install.sh
```

When it finishes (about 1–2 minutes), it prints a **QR code**.

## Step 6: Connect your Android phone

1. Install **WireGuard** from the Play Store. It's the official app by WireGuard Development Team: free, no ads, no account.
2. Open it → **+** → **Scan from QR code** → scan the QR on the screen.
3. Name it (for example `Singapore`) and turn the switch **on**. Done ✅

To check it worked, open the Chrome address bar and search "what is my ip". It should show your server's country.

> **Only have one phone (no PC)?** You can't scan your own screen, so download the file instead:
> 1. In Cloud Shell type `exit` to leave the server.
> 2. Run: `ssh ubuntu@YOUR_IP sudo cat /etc/wireguard/clients/phone.conf > phone.conf`
> 3. Cloud Shell menu (⚙ / ☰ at the top of the shell) → **Download** → type `phone.conf` → Download.
> 4. WireGuard app → **+** → **Import from file or archive** → Downloads → `phone.conf`.

---

## Managing devices

Connect to the server again (`ssh ubuntu@YOUR_IP` from Cloud Shell), then:

| What | Command |
|---|---|
| Add a device (laptop, 2nd phone…) | `sudo bash install.sh add laptop` |
| Show a device's QR again | `sudo bash install.sh show phone` |
| Remove a device | `sudo bash install.sh remove laptop` |
| Check who's connected | `sudo wg show` |

Each device needs its own entry, so don't share one QR between two phones.

## Speed tips

* The script already turns on **BBR** congestion control, larger network buffers, and MSS clamping.
* If some apps or sites hang on mobile data, edit the tunnel in the WireGuard app and set **MTU** to `1280`.
* If speed is low on one Wi-Fi network, that network may be throttling UDP. Try mobile data to compare.
* The Ampere (A1.Flex) server is noticeably faster than the E2.1.Micro.

## Want more countries?

One free Oracle account = one region. To add more countries, run the same `install.sh` on
another Ubuntu VPS in that country (any provider). Then scan its QR code too. The WireGuard
app keeps a list of tunnels, so switching country is just a tap.

## Good to know

* Oracle may reclaim an Always Free server that stays **idle** for a long time (very low CPU,
  network and memory use for 7 days). Using the VPN regularly avoids this. If it ever happens,
  just repeat Steps 3–6.
* Keep your QR code and config files private, because anyone who has one can use your VPN.
