# Mandatory mobile + OTP verification for customer accounts

Branch: `fix/tenant-forms-host` (current — no new branch). No commit/push without explicit instruction.

## Goal
1. New customer signing up via **Google** lands on a fallback "confirm your details" step: name + **mandatory mobile**, and the mobile must be **OTP-verified inline (SMS)** before the account is usable.
2. Fix the existing **login-page phone modal** that appears and cannot be dismissed (the "won't go back" trap) — keep it **blocking** but with a real exit (cancel = logout), and route it through the same OTP verification.
3. Treat **email + mobile as the customer's identity**: enforce **unique verified phone going forward** (no migration risk to legacy null/dup phones).
4. OTP-verify the number whenever it is **first added or changed** (skip if already verified & unchanged).

## Decisions (confirmed with user)
- OTP: **inline, mandatory** (SMS via existing `sendOTPSMS`).
- Uniqueness: **unique verified phone going forward**; legacy rows untouched; enforced only on new verified saves.
- Legacy prompt: **on login, blocking**, but with a working cancel that logs the user out (never truly trapped).

## Current state (verified)
- `POST /api/auth/google` creates a customer with **no phone**, returns `user.phone` (null for new Google users). — `src/app/api/auth/google/route.ts:106-112`
- `POST /api/auth/signup` (email path) **already** requires + normalizes phone. — `src/app/api/auth/signup/route.ts:27-47`
- OTP lib (`src/lib/otp.ts`) is **email-keyed** in Redis. SMS is only a *delivery channel* for the email-account OTP; the phone itself is never independently verified.
- `sendOTPSMS({ phone, otp })` exists and Twilio is configured. — `src/lib/sms.ts:114`
- `PATCH /api/user/update` saves phone (validates 10-digit). — `src/app/api/user/update/route.ts`
- Login page phone modal: `src/app/login/page.tsx:511-578` has **no X/cancel/backdrop/Esc**; effect at `:51-55` replaces route only when `!showPhoneModal`, so once open with `user` set the user is stuck. **This is the reported bug.**
- Signup page **already** has a `step === 'phone'` screen after Google (`src/app/signup/page.tsx:560+`) but collects phone with **no OTP**.
- `users`: `phone varchar(20)` nullable (customer row, `users.sql:147`); **no `phone_verified` column**; phone is **not unique** (only trigram index `idx_users_phone_trgm`). Unique keys today: `(email,user_type)`, `(google_id,user_type)`.

## Schema changes (split files, LOCAL DB only — never migrations, never RDS)
`database/users.sql` — add two columns to `public.users`:
- `phone_verified boolean DEFAULT false NOT NULL`
- `phone_verified_at timestamp with time zone`

`database/indexes.sql` — add a **partial unique index** (going-forward, verified only, per user_type):
```sql
CREATE UNIQUE INDEX idx_users_phone_verified_unique
  ON public.users (phone, user_type)
  WHERE phone_verified = true AND phone IS NOT NULL;
```
(Partial index leaves legacy null/unverified/dup phones untouched; only two verified rows can't share a number.)

No `constraints.sql` change needed (using a partial unique *index*, not a table constraint).

## Backend

### 1. Generalize OTP lib to key by phone as well — `src/lib/otp.ts`
The functions already take a string identifier and lowercase it. Add thin phone-keyed wrappers so phone OTP uses a distinct namespace and doesn't collide with email OTP:
- Add `storePhoneOTP`, `verifyPhoneOTP`, `isPhoneOTPVerified`, `deletePhoneOTP`, `checkSendOtpRateLimit`/`recordSendOtp` reuse with a `phone:` prefixed key.
- Minimal approach: add an internal `keyFor(kind, id)` and expose phone variants; keep existing email exports unchanged (login/signup email flow must not regress).

### 2. New route: send phone OTP — `src/app/api/auth/phone/send-otp/route.ts`
- Auth: `authenticateAnyUser` (must be logged in — this runs *after* Google login / for existing customers).
- Body: `{ phone }`. Normalize to 10-digit (reuse the existing cleaning logic).
- **Uniqueness pre-check**: reject if another customer row already has this phone with `phone_verified = true` (app-level check backing the partial index).
- Rate-limit per phone, `storePhoneOTP`, `sendOTPSMS`. Return `{ nextCooldown }`.

### 3. New route: verify phone OTP + persist — `src/app/api/auth/phone/verify-otp/route.ts`
- Auth required. Body: `{ phone, otp }`.
- `verifyPhoneOTP`; on success `UPDATE users SET phone=$1, phone_verified=true, phone_verified_at=NOW() WHERE id=$authUser` guarded so it can't steal another verified number (unique index is the backstop; catch `23505` → friendly "number already in use").
- `deletePhoneOTP`, `logActivity`. Return updated `user`.

### 4. `/api/auth/me` — expose `phoneVerified`
Add `phoneVerified: user.phone_verified` to the `me` payload and to `AuthContext` `User` so the client can gate on it. (Check `src/app/api/auth/me/route.ts` shape first.)

## Frontend

### 5. Shared component: `src/components/visitor/PhoneVerifyModal.tsx` (new)
One reusable modal/panel with two sub-steps: **enter mobile** → **enter OTP** (resend w/ cooldown). Props: `{ requiresPolicy, onVerified, onCancel }`.
- `onCancel` always present → calls `logout()` (blocking but never trapped).
- Calls the two new phone routes; on verify calls `refreshUser()` then `onVerified()`.
- No emojis. Under 500 lines.

### 6. Login page — `src/app/login/page.tsx`
- Replace the inline dead-end modal (`:511-578`) with `<PhoneVerifyModal>`.
- Trigger when `needsPhone || !phoneVerified || needsPolicy` (currently only `!phone`).
- Cancel → `logout()` (fixes the trap). Keep blocking.

### 7. Signup page — `src/app/signup/page.tsx`
- Google path `step === 'phone'` (`:560+`) becomes the **confirm-details** step: name (prefilled, editable) + mandatory mobile, then OTP via `PhoneVerifyModal` (or reuse its inner steps).
- Only `router.push(redirectTo)` after phone is **verified**, not merely saved.

### 8. Google route — `src/app/api/auth/google/route.ts`
- No new account behavior needed server-side beyond returning `phone`/`phone_verified` (already returns `phone`; add `phoneVerified`). The gating happens client-side via the modal. New Google users have `phone_verified=false` by default → modal fires.

## Out of scope / untouched
- Business/ecom/staff/admin auth portals (customer only).
- Email OTP flow stays as-is (email already verified on signup).
- Legacy data cleanup (partial unique index avoids needing it).

## Verification (local only, when asked)
- New Google signup → forced to confirm name + mobile + SMS OTP before entering.
- Existing customer w/o phone → blocking modal on login, cancel logs out, verify unblocks.
- Two accounts can't verify the same number (2nd gets "already in use").
- Email login for a customer who already has a verified phone → no modal.
- Schema applied to LOCAL db (5432) via the pipeline's split-file apply; not RDS.
