# KYB: verifying the business behind each service

Before KYB, only a store application asked for business details, and nothing checked an uploaded document against
what the owner typed. A Showcase or services-only workspace could request Messaging or Documents without giving a
PAN, a GST certificate or anything else, and services picked in the store wizard worked while the KYC was still
pending. KYB fixes both:

- **Each service needs a defined set of things verified** before it can be requested or approved.
- **Every uploaded document is checked automatically.** OCR reads the PAN card, GST certificate or licence, and the
  check compares it with the number, name, constitution and expiry the owner gave.

Code: `controller-service/src/lib/kyb/`. Owner page: Dashboard → Business verification (`/dashboard/business`).
Admin: Ecom → customer → KYC tab.

## What each service needs

| | Showcase site | Documents API | Messaging API | Online store |
|---|---|---|---|---|
| Business details: legal name, type, address with state and PIN, authorised signatory | | ✓ | ✓ | ✓ |
| PAN and PAN card | | ✓ | ✓ | ✓ |
| GST: GSTIN and GST certificate, or a reason for not being registered | | ✓ | ✓ | ✓ |
| Registration proof (only without GST) | | ✓ | ✓ | ✓ |
| Website or business page | | | ✓ | |
| How you will message people (purposes, volume, opt-in, sample, policy) | | | ✓ | |
| Verified payout bank account | | | | ✓ |
| Licences for what you sell (FSSAI, BIS, drug licence…) | | | | ✓ |

The source of truth is `SERVICE_ITEMS` in `lib/kyb/requirements.ts`. Why each service needs what it needs:

- **Showcase** is a public page about the business, with no payments and no messages. It needs only the name and a
  contact, which its own onboarding already asks for.
- **Documents** issues tax invoices, quotations and purchase orders in the business's name. GST invoicing needs the
  GSTIN and the state, and an unregistered business can only issue bills of supply.
- **Messaging** sends WhatsApp, SMS and email to people in the business's name. It runs on Jeffi's shared SMS header
  and WhatsApp accounts, so Jeffi must know who is sending and why. That includes the opt-in method and a sample
  message, which carriers and Meta also ask for.
- **A store** also takes payments and ships orders. That adds the penny-drop-verified payout account and the
  category licences that already existed (`lib/catalog/compliance.ts`).

## Registration proof by business type

Without GST, the business proves it exists with one of these (`registrationDocsFor`):

| Business type | Accepted proofs |
|---|---|
| Sole proprietorship | Udyam certificate, Shop and Establishment registration |
| Partnership | Udyam, Shop and Establishment, partnership deed or Registrar of Firms certificate |
| LLP | Udyam, LLP certificate of incorporation (LLPIN) |
| Private, OPC or public company | Udyam, certificate of incorporation (CIN) |
| HUF | Udyam, Shop and Establishment |
| Trust or society | Trust deed or society registration certificate |

## The checks

**When the owner types** (`lib/kyb/ids.ts`, shared by the page and the API):

- **PAN:** the shape, and its 4th letter against the business type. P is an individual, which is what a proprietorship
  must use. C is a company, F a firm or LLP, H an HUF, T a trust, A an association.
- **GSTIN:** the shape and GSTN's mod-36 check character. Characters 3 to 12 must equal the PAN, and the first two
  must be the state code of the address.
- **CIN, LLPIN, Udyam and FSSAI numbers:** their formats.

**When a document is uploaded** (`analyze.ts`, `read.ts`, `extract.ts`):

1. **Read the text.**
   - A PDF with a text layer is read directly; the GST portal's certificates have one.
   - Images and scanned PDFs (first two pages) go to **PaddleOCR (PP-OCRv5)** through the AI gateway's `POST /v1/ocr`.
   - If PaddleOCR is down, the gateway's vision model transcribes the image instead. Set `KYB_VISION_FALLBACK=false`
     to keep documents away from it; the check is then marked failed and a reviewer looks.
2. **Compare with what the owner gave.** OCR misreads common in the number's layout (0/O, 1/I, 5/S, 8/B…) are
   repaired before comparing.
   - The number must match.
   - The name is matched by token similarity (≥ 0.85 passes, 0.6 to 0.85 goes to a reviewer). Legal suffixes and
     honorifics are ignored. A proprietor's PAN card is matched against the authorised signatory's name.
   - The expiry date must match the one entered, and must not have passed.
   - For GST certificates, the stated constitution is checked against the business type.
   - A document that doesn't look like the right kind is flagged.
3. **Store the result** on the document row (`analysis`) as one of four verdicts:
   - `verified`: everything matched.
   - `review`: something is close or unreadable, for a reviewer.
   - `mismatch`: the number or name differs, or it has expired.
   - `unreadable`: the number couldn't be found.

   The raw text is never stored, only the verdict, the checks and the fields read.

A mismatch tells the owner exactly what differs ("The PAN card reads ABCPK1234F, but you entered ABCPK9999F"). They
fix the typo or upload a clearer copy. If the document is right (a name change, an odd scan), they can send it to a
reviewer with a note (`owner_note`). Changing the legal name, PAN or GSTIN later re-runs the checks: each analysis
keeps the values it compared against.

Selling licences get the same checks when an admin runs "Run checks again" on the KYC tab. FSSAI has its own reader
(number, licensee, valid-up-to); other licences are checked loosely (number on the page, name, expiry).

**Not done: live lookups against government registries.** The GST portal's taxpayer search is behind a CAPTCHA, and
PAN verification (Protean/NSDL) needs a licensed provider. Plugging one in (Cashfree Verification, Surepass, IDfy…)
belongs in `analyze.ts` as another check; it needs a contract and keys.

## Gates

- **Owner requests a service:** `POST /api/ecom/services/add` answers 409 `kyb_required` with what's missing until that
  service's KYB is complete. "Complete" means everything is in and no check failed without a note; documents may
  still be waiting for a reviewer. Requesting again after a rejection reopens it.
- **Store wizard:** collects the store's KYB, PAN card included, and checks each upload as it goes. Messaging or
  Documents picked with the store now get approval rows, so they wait for approval like any other request.
- **Platform admin approves:**
  - Approving a service, or an API-only workspace's KYC, answers 409 until its KYB is complete.
  - A store's KYC approval checks the store's KYB.
  - Both accept `force: true` ("Approve anyway") for a business verified another way, or an application sent
    before the wizard asked for everything.
- **What stays as it was:**
  - Sending and rendering are still blocked until a service is approved (`tenant_service_approvals`; public-api,
    the console proxy, Play, AI routes).
  - Services approved before KYB stay approved. The Business verification page shows their owners what's missing.
- **After approval,** the legal name, business type, PAN and GST answers are locked; support changes them. Documents
  can still be added or replaced, and go back to review.

## Data

Additive schema, applied by the release's schema diff. No migration.

- **`tenant_kyc`:** `entity_type` (10 types; `business_type` keeps its five), `trade_name`, `address_line`,
  `address_city`, `address_state`, `address_pincode`, `authorized_name`, `authorized_designation`, `website`,
  `gst_registered`, `gst_exempt_reason`, `gst_exempt_note` and `messaging_use`. `business_address` is rebuilt from
  the parts so invoices, Razorpay and older readers see the same address.
- **`tenant_compliance_documents`:**
  - KYB documents are rows with `category = 'KYB'`: `pan_card`, `gst_cert`, `udyam`, `shop_est`, `coi`, `llp_cert`,
    `partnership_deed` and `trust_reg`. The licence pages and the wizard's replace-all leave them alone.
  - Every row gains `analysis`, `analysis_status` (pending, done or failed), `analyzed_at` and `owner_note`.
  - Files stay in the platform bucket under `kyc/{ownerId}/{docType}/`.
  - The GST certificate's key is also kept on `tenant_kyc.gst_cert_s3_key`.

## Deploying OCR

PaddleOCR (PP-OCRv5) runs as a sidecar next to the AI gateway on the Razer box. The image is built from
`ai-platform/paddleocr/` (pinned `requirements.txt`, models baked in) by the box's release script
(`ai-platform/deploy/overlays/razer/host/ai-gateway-release.sh`, which the CI release runs). The gateway reaches the
sidecar at `PADDLE_OCR_URL` (default `http://paddleocr:8866`), and the platform pods reach the gateway as before,
over Tailscale (`AI_GATEWAY_URL`).

`POST /v1/ocr {data, mime_type}` answers `{ok, text, lines: [{text, score}], meanScore, pages}`. It answers 503 when
the sidecar is down, and never falls back to a model. `/readyz` and `/v1/providers` report the sidecar as `ocr`.

- **First release after merging:** the box still runs the old installed release script, which replaces itself at
  the end. The paddleocr pod waits in `ErrImageNeverPull` until the next release, so run the release once more, or
  run `ai-gateway-release release <sha>` on the box. The `ai-platform/README.md` section "Build and roll out" has the
  manual commands.
- **Until the sidecar runs,** `/v1/ocr` answers 503. Uploads are then read by the vision model, or wait for a reviewer
  if `KYB_VISION_FALLBACK=false`.
- **Locally:** `pip install -r ai-platform/paddleocr/requirements.txt`, then `python ai-platform/paddleocr/ocr_service.py`
  (port 8866), and point the laptop gateway's `PADDLE_OCR_URL` at it.
