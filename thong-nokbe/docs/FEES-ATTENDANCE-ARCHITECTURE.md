# Fees, advance payments, attendance — architecture

How Thong Nokbe Gym records fee payments and attendance so that statuses update live for everyone and
**no history is ever lost** — not by app updates, reinstalls, schema changes or mistakes in the app.

## 1. Where the data lives (and why updates can't erase it)

| Layer | What it holds | Affected by app update / reinstall? |
|---|---|---|
| **Cloud Firestore** (project `roid-266a2`) | Groups, fee ledger, attendance, chats — the only source of truth | **No.** An APK / Play Store / over-the-air update replaces app *code* only. Reinstalling the app signs back into the same account and reads the same cloud data. |
| Phone (Firestore offline cache, AsyncStorage) | A cache of cloud data + small preferences (live-location switch, last update check) | Cleared on uninstall — harmless, it is re-downloaded. |

Writes made while offline are queued on the phone and sent when it is online again. (Only if the app is
uninstalled *before* the phone reconnects would such an unsent write be lost — the person simply records it again.)

So "keep data across updates" is really "never delete or overwrite data while the app is used". That is
enforced in three places:

1. **Data model:** append-only ledger — a payment is never edited; corrections are new entries.
2. **Security rules** (`firestore.rules`): the database itself refuses deletes and rewrites, whatever
   app version or tool sends them. Tested in `rules-tests/rules.test.mjs`.
3. **Migrations:** additive only (new fields / new collections), old data is read in place, never moved.

## 2. Database schema (Firestore, NoSQL)

```
chats/{groupId}                                   group document
  name, members[], admins[], createdBy
  upi: { vpa, payeeName, amount }                 where members pay (admin + co-admins edit)
  feeHistory: [ { from: 'yyyy-mm', amount } ]     monthly fee over time; only appended to

chats/{groupId}/ledger/{entryId}                  ★ permanent fee ledger (one doc per money event)
  uid          member the money is for
  kind         'payment' | 'reversal'
  amount       rupees (> 0)
  forMonth     'yyyy-mm' — first month the payment counts for
  method       'upi' | 'upi-manual' | 'cash' | 'gateway'
  status       'confirmed' | 'pending' | 'rejected'
  utr          UPI reference (UTR) or null
  reversalOf   entryId this correction cancels (kind 'reversal')
  note, recordedBy, createdAt (server time), v (schema version, now 1)
  verifiedBy, verifiedAt                          set once when an admin confirms/rejects a UTR

chats/{groupId}/utrs/{UTR}                        each UTR can be claimed once per group
  entryId, uid, createdAt

chats/{groupId}/fees/{yyyy-mm}/payments/{uid}     records from app versions before the ledger
                                                  (read-only history; still counted)

chats/{groupId}/attendance/{yyyy-mm-dd}           one doc per day
  date, month, records: { uid: 'present' | 'absent' }, markedBy, updatedAt
```

The same model in SQL terms (useful if the data is ever exported to a relational database):

```sql
CREATE TABLE ledger (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('payment','reversal')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  for_month   CHAR(7) NOT NULL,              -- 'yyyy-mm'
  method      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('confirmed','pending','rejected')),
  utr         TEXT,
  reversal_of TEXT REFERENCES ledger(id),
  recorded_by TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (group_id, utr)                     -- a UTR is used once
);
-- No UPDATE/DELETE grants for the app role: append-only.

CREATE TABLE attendance (
  group_id TEXT, day DATE, member_id TEXT, status TEXT CHECK (status IN ('present','absent')),
  marked_by TEXT, updated_at TIMESTAMP,
  PRIMARY KEY (group_id, day, member_id)
);
```

## 3. Advance and partial payments (how statuses are worked out)

Month statuses are **computed** from the ledger (`src/lib/feeMath.ts`, unit-tested in `tests/feeMath.test.mjs`):

```ts
// For each confirmed payment, oldest first: fill its first month, overflow into the next months.
for (const p of payments) {
  let left = effectiveAmount(p);            // amount minus any reversals of it
  let m = p.forMonth;
  while (left > 0) {
    const room = feeFor(m) - paid[m];       // fee of THAT month (fee history aware)
    const take = Math.min(room, left);
    paid[m] += take; left -= take;
    if (left > 0) m = nextMonth(m);
  }
}
// status(m) = paid >= fee ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
```

* ₹2400 with an ₹800 fee → 3 months paid (advance). "Paid up to Jan 2027 · 2 months in advance".
* ₹300 → that month "part paid ₹300 of ₹800"; a later ₹500 completes it.
* A fee change from ₹800 to ₹1000 in Jan applies from Jan on; earlier months keep ₹800.
* A mistake is fixed with a **reversal** entry — the original payment stays in the history.

Statuses update **in real time** for everyone because every phone listens to the ledger
(`onSnapshot`); a new entry changes all screens within about a second.

## 4. Recognising QR / UPI payments automatically

What each method can and cannot do:

| Method | Automatic? | Matches the member? | Needs |
|---|---|---|---|
| **A. Payment gateway + webhook** (Razorpay/Cashfree/PhonePe PG: dynamic QR or payment link per member) | **Yes, instantly** | Yes — the order carries `groupId` + `memberId` | A gateway merchant account (KYC), a small fee per payment (~2%) |
| B. UPI app result (`upi://pay` intent) — *implemented* | Yes on success | Yes (payer is the logged-in member) | Nothing; some UPI apps don't return a result |
| C. UTR + admin confirmation — *implemented* | Semi (admin taps Confirm) | Yes | Nothing |
| D. Bank statement APIs (Account Aggregator) | Yes | Via amount/UTR | A licensed FIU — not practical for a gym |
| E. Reading the admin's bank SMS | Partly | Via amount/UTR/name | SMS permission (restricted by Google Play), privacy risk — not recommended |

**Important:** a payment to a *personal* UPI ID through a *static* QR cannot be detected by any app —
no bank or UPI app tells a third-party app that money arrived. Full automation needs **A**.

### A. Gateway webhook design (recommended for full automation)

1. Member taps **Pay** → app asks our Cloudflare Worker to create a gateway order / dynamic QR for
   `{ groupId, memberId, amount, forMonth }` (stored in the order's `notes`).
2. Member pays (UPI QR, card…). The gateway calls our webhook `POST /webhook/razorpay`.
3. The Worker verifies the signature, then writes **one** ledger entry with id = gateway payment id
   (so a repeated webhook can never record the payment twice), `method: 'gateway'`, `status: 'confirmed'`.
4. Every member's phone sees the new entry instantly.

```js
// token-server/worker.js — webhook handler sketch (Razorpay). Secrets: RAZORPAY_WEBHOOK_SECRET.
async function handleRazorpayWebhook(req, env) {
  const body = await req.text();
  const sig = req.headers.get('x-razorpay-signature') || '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.RAZORPAY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== sig) return new Response('bad signature', { status: 401 });

  const evt = JSON.parse(body);
  if (evt.event !== 'payment.captured') return new Response('ignored');
  const p = evt.payload.payment.entity;                  // amount in paise
  const { groupId, memberId, forMonth } = p.notes;
  const token = await googleAccessToken(env, 'https://www.googleapis.com/auth/datastore');
  // documentId = payment id → creating it twice fails, so retries are safe (idempotent).
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/chats/${groupId}/ledger?documentId=${p.id}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: {
      uid: { stringValue: memberId }, kind: { stringValue: 'payment' },
      amount: { integerValue: String(Math.round(p.amount / 100)) }, forMonth: { stringValue: forMonth },
      method: { stringValue: 'gateway' }, status: { stringValue: 'confirmed' },
      utr: { stringValue: p.acquirer_data?.rrn ?? p.id }, recordedBy: { stringValue: 'gateway' },
      createdAt: { timestampValue: new Date().toISOString() }, v: { integerValue: '1' },
    } }),
  });
  return new Response(r.ok || r.status === 409 ? 'ok' : 'retry', { status: r.ok || r.status === 409 ? 200 : 500 });
}
```

Because each group pays its own admin, money must reach each admin's account: either every admin
connects their own gateway account, or one platform account uses split payouts (e.g. Razorpay Route
"linked accounts" per gym). This needs a business decision and KYC, so it is **not switched on yet**.

## 5. Migrations without data loss

Rules followed for every future update:

1. **Additive only.** New fields and new collections; never rename or delete a field or collection
   that holds data. (Example: the ledger was added next to `fees/…/payments`, which stays.)
2. **Read old formats in place** (dual read). `useGroupLedger` merges old monthly records with the
   ledger; nothing is copied, so nothing can be lost in a copy.
3. **Version stamps.** Each ledger entry has `v` (schema version). A future format bumps `v`; code
   reads every version it has ever written.
4. **The rules guard history**, not the app: deletes/rewrites of ledger, old fee records and attendance
   days are refused by the database for every app version, including old ones still installed.
5. **Test before release:** rules tests + fee-math tests run on every change (CI runs the fee tests
   before building the APK).
6. **Backups:** admins can export the full fee history as a spreadsheet (Fee report → 💾). For automatic
   daily backups, Firestore Point-in-Time Recovery or scheduled exports need the paid Blaze plan.

## 6. Attendance history

* One document per group per day (`attendance/{yyyy-mm-dd}`) with every member's mark — daily view
  reads one doc, weekly/monthly views query by `month` and summarise per member on the phone.
* Admins can mark and correct a day; **no one can delete a day** (rule + test).
* Stored only in the cloud, so updates and reinstalls never affect it.
