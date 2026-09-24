# Google OAuth — URLs to register (copy-paste)

Two SEPARATE OAuth clients. Do not mix them up — editing the wrong one is the usual
cause of `redirect_uri_mismatch`.

Replace `jeffistores.in` if `PLATFORM_ROOT_DOMAIN` differs. `<slug>` = a tenant slug,
`<custom-domain>` = a verified tenant CNAME.

---

## Client A — Sign-in  (`GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`)

Customer, business, ecom-owner, and certificate-portal sign-in. All use the popup flow,
which collapses every `*.jeffistores.in` subdomain to the apex, so ONE redirect covers all
platform hosts. Custom domains do NOT collapse — each needs its own entry.

The sign-in popup uses the IMPLICIT flow (response_type=token) and COLLAPSES every
`*.jeffistores.in` host to the apex before redirecting. So every platform subdomain is covered
by the single apex redirect URI — do NOT add per-slug redirects or origins. Only a real custom
domain keeps its own origin. Google rejects placeholder/wildcard entries like
`https://<slug>.jeffistores.in` — never enter those literally.

### Authorized redirect URIs (the ones that actually gate this flow)
```
https://jeffistores.in/auth/google/callback
http://localhost:3000/auth/google/callback
```
Per REAL verified custom domain that uses Google sign-in (only when onboarded — no wildcard):
```
https://<the-actual-domain>/auth/google/callback   e.g. https://shop.acme.com/auth/google/callback
```
(Adding the subdomain sign-in redirects — www/business/admin `/auth/google/callback` — is harmless
but unnecessary; those hosts collapse to the apex.)

### Authorized JavaScript origins
This implicit flow validates the redirect URI, not the JS origin, so these are not strictly
gating — list the real platform hosts and skip anything with a placeholder:
```
https://jeffistores.in
https://www.jeffistores.in
https://ecom.jeffistores.in
https://business.jeffistores.in
https://admin.jeffistores.in
https://certificate.jeffistores.in
http://localhost:3000
```
Do NOT add `https://<slug>.jeffistores.in`, `https://admin-<slug>.jeffistores.in`, or
`https://<custom-domain>` as literal entries — Google rejects them (needs a real public TLD).

---

## Client B — Google Sheets data-source sync  (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`)

Sheets connect + callback. Uses ONE fixed central host (the tenant travels in the signed
`state`), so there is exactly ONE redirect URI regardless of how many tenants exist.
**THIS is the one currently blocking the Sheets connect — make sure it is present.**

### Authorized redirect URIs
```
https://admin.jeffistores.in/api/admin/data-source/google/callback
http://localhost:3000/api/admin/data-source/google/callback
```

### Scopes (consent screen)
```
https://www.googleapis.com/auth/spreadsheets.readonly
https://www.googleapis.com/auth/drive.file
```
Consent screen must be Published (not "Testing"), or your Google account added as a test user.

---

## Non-Google (for completeness — register in their own dashboards, NOT Google)

Meta / social (Meta app):
```
https://admin.jeffistores.in/api/admin/social/callback
https://admin-<slug>.jeffistores.in/api/admin/social/callback
```
Razorpay payment-link (Razorpay dashboard):
```
https://<store-host>/api/razorpay/payment-link/callback
```

---

## Quick fault map
- `Error 400: redirect_uri_mismatch` → the exact redirect string is missing from that client.
- `access_blocked` / "app not verified" → consent screen not published (Client B scopes).
- `invalid_client` → wrong client id/secret for the URI you registered.
