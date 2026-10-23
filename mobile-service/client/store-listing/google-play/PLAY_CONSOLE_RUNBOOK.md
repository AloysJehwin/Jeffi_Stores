# Jeffi Stores — Google Play Console runbook

Written for a browser agent finishing the Play Console setup. Status as of 24 Oct 2026.

**How to use this file:**
- Do the tasks in **Part 4** in order.
- Copy every answer exactly from **Part 5**.
- **Stop and ask the owner** whenever a rule in **Part 2** applies, or the screen differs from what is described here.

---

## Part 1 — What this app is

| Field | Value |
|---|---|
| App name (store listing) | Jeffi Stores |
| Package name | `com.jeffistores.app` |
| What it is | Shopping app for an online industrial hardware and tools store (fasteners, power transmission, welding, electricals, piping, safety equipment). Same catalogue as https://jeffistores.in |
| Business | Jeffi Stores, Raipur, Chhattisgarh, India. Sells to consumers and businesses; GST tax invoice on every order. |
| Version | 1.0.0 |
| Latest build | **Version code 6**. Download: https://expo.dev/artifacts/eas/iMR-LfbOuXlLi0tqBsUEJWfrbhUF4cpVa-aGDUaGrIo.aab |
| Do not use | Version code 5. It has the placeholder grey-grid icon. |
| Developer account | **Personal** (individual) Google Play developer account. It is **not** an organisation account. |
| Default listing language | English (United Kingdom), `en-GB` |
| Contact email | support@jeffistores.in |
| Website | https://jeffistores.in |
| Privacy policy | https://jeffistores.in/legal/privacy-policy |
| Account deletion page | https://jeffistores.in/legal/account-deletion (see the warning below) |

**Warning about the deletion page.** It is in GitHub PR #564 and is **not live yet** (it shows "page could not be found"). **Do not click "Send for review" until it loads.** Tell the owner if it still 404s.

**Features the app really has** (answer the forms truthfully from this list):
- Browse and search products; product pages with variants and photos; compare products.
- Cart and checkout. Payment is through **Razorpay** checkout inside the app (UPI, cards, net banking, wallets).
- Sign-in with **Google**, or a one-time code (OTP) by email, SMS or WhatsApp. There is **no password**.
- Orders, order tracking and invoices. Some orders contain **digital products**, opened in a "vault" in the browser.
- **Reward points**, redeemable only for discount coupons in this store (no cash value, not transferable). Referral rewards work the same way.
- Customers can write **product reviews** (text and rating). An admin approves every review before it appears. No photo upload in the app.
- **Firebase Analytics** (Google Analytics 4) is built in. It uses the advertising ID for analytics only.

**Features the app does NOT have:**
- No ads inside the app (no AdMob or any other ad SDK).
- No location or GPS, no camera, no contacts, no chat between users.
- No health or fitness features.
- No financial services: no loans, wallet balance, banking, crypto or insurance.

---

## Part 2 — Rules (stop and ask the owner when any of these apply)

1. **Never** publish or roll out to **Production**. That needs the closed test first (Part 3).
2. **Never** change the developer account type, transfer the app, delete the app, or delete a track or release.
3. **Never** enter payment details, buy anything, or accept a paid add-on or upgrade.
4. **Never** tick a **financial feature**. A personal account plus any financial feature gets flagged ("Violation of Play Console Requirements"). The answer is "My app doesn't provide any financial features".
5. **Never** invent sign-in details. The review login is **not built yet** (Task 6). Do not type test credentials into "Sign-in details" until the owner gives them.
6. **Never** mark images as AI-generated, and never replace the provided images.
7. If a form asks something this file doesn't cover, or a field already holds a different value, **stop and ask**. Don't guess.
8. A Play Console error like "An unexpected error has occurred (5DECEF30)" is transient.
   - Reload, re-enter the answer, and save again.
   - Keep only **one** Play Console tab open for this app.
9. Uploaded `.aab` files must come from the link in Part 1. **Never** use an APK.

---

## Part 3 — How a personal account gets to Production

New personal accounts must run a **closed test**:
- at least **12 testers** opted in
- for **14 days in a row**

Only then does "Apply for production" unlock. Google reviews that application in up to about 7 days.

The owner's tester list "Internal Team" has 12 emails.
- **Recommend adding 2–3 more.** If the count drops below 12, the 14 days restart.
- Each tester opens the "Join on Android" link with the Gmail account on the list, taps **Become a tester**, installs from Play, and keeps the app installed for the full 14 days.

---

## Part 4 — Tasks, in order

### Task 1 — Fix the Financial features violation
The policy issue "Some types of apps can only be distributed by organizations…" was caused by ticking "Rewards, points…".

1. Go to Policy → **App content** → **Financial features** → **Manage**.
2. Untick everything and select **"My app doesn't provide any financial features"**.
3. Save.
4. If the issue page has an **Appeal** option and the issue doesn't clear after the next review, use this text:

   > Our app is an online store for industrial hardware. Loyalty points can only be redeemed for discount coupons in our own store; they have no cash value and cannot be withdrawn, transferred or purchased. The app offers no financial products or services.

### Task 2 — Advertising ID declaration
1. Policy → App content → **Advertising ID**.
2. "Does your app use an advertising ID?" → **Yes**. The manifest declares `com.google.android.gms.permission.AD_ID` via Firebase Analytics.
3. Purpose: tick **Analytics** only.
4. Save.

### Task 3 — Finish every App content section
Use the answers in **Part 5**. Every section must show a green tick / "Completed".

### Task 4 — Fix the store listing errors
Main store listing showed **"Some languages have errors"** on `Default – English (United Kingdom) – en-GB`.
1. Open the listing and scroll for fields marked in red.
2. Fill or re-upload using **Part 6**.
3. Save.
4. If an image is rejected, report the exact message to the owner.

### Task 5 — Closed testing (Alpha) release
1. Testing → **Closed testing** → **Alpha**.
2. **Countries:** India.
3. **Testers:** tick the email list **Internal Team**. Feedback email: `support@jeffistores.in`.
4. Open the draft release ("Untitled release") → upload the **version code 6** `.aab` from Part 1. Release name auto-fills as `6 (1.0.0)`; keep it.
5. Release notes:
   ```
   <en-GB>
   Closed test of the Jeffi Stores app: browse and search products, product details with variants, cart, checkout with Razorpay, orders, rewards and account.
   </en-GB>
   ```
6. **Next**. The warning "There is no deobfuscation file associated with this App Bundle" is expected; ignore it. Any **error** → stop and report it.
7. **Save**. **Do not send for review yet** (Task 7).

### Task 6 — Internal testing release (optional, quick)
1. Testing → **Internal testing** → **Create new release**.
2. Upload the same version code 6 `.aab` and use the same notes, with "Internal test" instead of "Closed test".
3. **Save and publish.** Internal testing has no review.

### Task 7 — Send for review (only when ALL are true)
- https://jeffistores.in/legal/account-deletion loads a page titled **"Delete Your Account"** (not "could not be found").
- Every App content section and the store listing show no errors.
- The owner has decided about **Sign-in details** (see Part 5 → App access).

When all three hold: **Publishing overview** → **Send changes for review**. Report back to the owner, and include any review message word for word.

---

## Part 5 — App content answers

### Privacy policy
`https://jeffistores.in/legal/privacy-policy`

### App access / Sign-in details
"Is any part of your app restricted?" → **Yes** (checkout, orders and account need sign-in).

**PENDING the owner.** The app uses OTP-only sign-in, which reviewers can't receive. The owner must first approve and deploy a dedicated review login (one email that accepts a fixed 6-digit code). Until then, **leave this section for the owner**.

Once the owner provides the details, the instruction text (500 chars max) is:

> Sign in with email OTP. On the login screen enter the email above and tap Send OTP, then enter the code <CODE>. No code is sent; this account always accepts this fixed code. Browsing products and the cart work without signing in; checkout, orders and account pages need sign-in. Payments use Razorpay; please don't complete a real payment.

- Name: `Customer account`.
- Username: the review email from the owner.
- Password: leave blank.

### Ads
**No, my app does not contain ads.**

### Content rating (IARC questionnaire)
**Category page**
- Email: support@jeffistores.in
- Category: **All other app types**
- Agree to the IARC terms.

**Answers**
- Downloaded app (ratings-relevant content in the package): **No**.
- User content sharing:

  | Question | Answer |
  |---|---|
  | Users interact or exchange content | **Yes** (product reviews) |
  | UGC is the primary content | **No** |
  | Nudity | **No** |
  | Graphic violence | **No** |
  | Block users | **No** |
  | Report users | **No** |
  | Chat moderation | **No** (no chat) |
  | Invited friends only | **No** |

- Online content (content not in the download, e.g. product listings): **Yes**.
- Violence, Sexuality, Language, Controlled substance, Age-restricted products: **No** to all.
- Miscellaneous:

  | Question | Answer |
  |---|---|
  | Shares precise location | **No** |
  | Purchase digital goods | **Yes** |
  | Cash rewards / gift cards / play-to-earn / crypto / NFT | **No** |
  | Web browser or search engine | **No** |
  | Primarily news or educational | **No** |

**Expected result:** Everyone / 3+. Submit.

### Target audience and content
- Target age: **18 and over only**. Untick 13–15 and 16–17.
- "Could your store listing unintentionally appeal to children?" → **No**.

### News app
No.

### COVID-19 contact tracing / status
My app is not a publicly available COVID-19 contact tracing or status app.

### Data safety
**Section 1 — Data collection and security**
- Collects or shares required user data types: **Yes**.
- All data encrypted in transit: **Yes**.
- Account creation methods: ☑ **Username and other authentication**, ☑ **OAuth**. Nothing else.
- Account deletion URL: `https://jeffistores.in/legal/account-deletion`
- Can users delete some data without deleting the account? **Yes**. URL: `https://jeffistores.in/legal/account-deletion`
- Badges (Independent security review, UPI payments verified): leave both off.

**Section 2 — Data types.** Tick exactly these and nothing else:

| Category | Tick |
|---|---|
| Location | Approximate location |
| Personal info | Name, Email address, User IDs, Address, Phone number, Other info (GSTIN) |
| Financial info | User payment info, Purchase history |
| App activity | App interactions, In-app search history, Other user-generated content |
| Device or other IDs | Device or other IDs |

Leave **unticked**:
- Precise location
- Race, ethnicity, political, religious beliefs, sexual orientation
- Credit score, other financial info
- Health and fitness, Messages, Photos and videos, Audio, Files and docs, Calendar, Contacts
- Installed apps, Other actions, Web browsing
- App info and performance (crash logs, diagnostics)

**Section 3 — Usage of each ticked type.** For **every** type:
- Collected ☑, Shared ☐.
  - Delhivery (shipping), Razorpay (payments) and Firebase act as service providers or on the user's request, which is exempt from "shared".
- Processed ephemerally: **No**.

Then:

| Data type | Required or optional | Purposes (tick exactly these) |
|---|---|---|
| Approximate location | Required | Analytics; Fraud prevention, security and compliance |
| Name | Required | App functionality; Account management |
| Email address | Required | App functionality; Account management; Developer communications; Advertising or marketing; Fraud prevention, security and compliance |
| User IDs | Required | App functionality; Account management; Analytics; Fraud prevention, security and compliance |
| Address | Required | App functionality |
| Phone number | Optional | App functionality; Account management; Developer communications; Advertising or marketing; Fraud prevention, security and compliance |
| Other info (GSTIN) | Optional | App functionality; Fraud prevention, security and compliance |
| User payment info | Required | App functionality; Fraud prevention, security and compliance |
| Purchase history | Required | App functionality; Analytics; Personalisation; Advertising or marketing |
| App interactions | Required | App functionality; Analytics |
| In-app search history | Required | App functionality; Analytics |
| Other user-generated content | Optional | App functionality |
| Device or other IDs | Required | Analytics |

How to read the table:
- **Required** = "Data collection is required (users can't turn off this data collection)".
- **Optional** = "Users can choose whether this data is collected".
- Advertising or marketing covers the opt-in promotional emails, SMS and WhatsApp messages and cart reminders.

### Government apps
No.

### Financial features
**My app doesn't provide any financial features.** (See Task 1.)

### Health
**My app does not have any health features.**

### Advertising ID
Yes. Purpose: Analytics only. (See Task 2.)

---

## Part 6 — Store listing (Grow → Store presence → Main store listing)

All files are in the repo under `mobile-service/client/store-listing/google-play/`.

### Text
| Field | Value |
|---|---|
| App name | `Jeffi Stores` |
| Short description (76/80) | `Industrial hardware & tools online — GST invoices and delivery across India.` |
| Full description | Paste the block below exactly |

```
Jeffi Stores brings industrial hardware, tools and spares to your phone. Shop fasteners, power transmission parts, welding supplies, electricals, piping and safety equipment from brands you know, including Taparia, GMF, JK Fenner and NESCO.

WHY SHOP WITH JEFFI STORES
• 10,000+ products in stock across fasteners, tools, electricals, welding and more
• Clear prices with GST shown, and a GST tax invoice on every order
• Free delivery on orders above ₹2,000, shipped across India
• Pick the exact variant — size, capacity or pack — before you buy
• Easy 7-day returns on eligible items

MADE FOR BUSINESSES AND WORKSHOPS
• Add your GSTIN at checkout for a tax invoice you can claim input credit on
• Compare products side by side before you decide
• Buy again from your past orders in one tap
• Track every order and download invoices from your account

SIMPLE AND SECURE
• Sign in with Google, or a one-time code by email, SMS or WhatsApp
• Pay securely with UPI, cards, net banking or wallets through Razorpay
• Earn reward points on orders and redeem them for discounts

Need help? Write to support@jeffistores.in — we're based in Raipur, Chhattisgarh.
```

### Graphics
| Field | File | Size |
|---|---|---|
| App icon | `app-icon-512.png` | 512×512 |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 |
| Phone screenshots | `screenshots/screenshot-1-home.png` … `screenshot-6-login.png` | 1080×1920 each |
| Video | leave empty | — |
| Tablet / Chromebook / XR screenshots | leave empty (optional; don't reuse phone images) | — |

Upload the phone screenshots in number order (1 to 6).

**AI asset declaration:** **Don't label assets**. Screenshots are real captures; the icon and feature graphic are the store's logo and a real product photo.

### Store settings (Grow → Store presence → Store settings)
- App category: **Shopping**.
- Tags: pick from the offered list, e.g. "Shopping", "Tools & hardware" if offered. Max 5.
- Email: `support@jeffistores.in`
- Website: `https://jeffistores.in`
- Phone: leave empty unless the owner gives one.
- External marketing: leave the default (on).

---

## Part 7 — Already done (don't redo)

- App created: name Jeffi Stores, free, app (not game).
- Ads, content rating answers, target audience, health features answered.
- Data safety partly filled: Approximate location completed; the other data types are in progress.
- Internal testing: version code 5 uploaded. Version code 6 replaces it.
- Testers list "Internal Team" (12 emails) created.

## Part 8 — Owner to-do (not for the agent)

- Merge GitHub PR #564 and approve the production deploy. This makes the account deletion page live.
- Decide on the review login, then give its email and code for **App access**.
- Add 2–3 more testers (target 15).
- After 14 days with 12+ testers: Dashboard → **Apply for production**.
