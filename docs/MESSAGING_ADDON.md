# SMS & WhatsApp add-on

A tenant store sends SMS or WhatsApp only when two things are true: its owner has bought the add-on for
that channel, and the platform has assigned the store a sender (a DLT header or a WhatsApp number) with the
provider credentials to send through it. The flagship store is exempt and sends from the platform env.
Design contract: `docs/plans/UPI_AND_MESSAGING_ADDON.md` §2.

## Price

One monthly service fee covers both channels: what a store's own sender numbers cost the platform each
month, plus a margin (default 40%), rounded up to the rupee. Default cost: a Twilio local number at
$1.15/month (₹101.20 at ₹88) → ₹142/month. The store's messaging server is already on its daily server
bill, and WhatsApp senders and the shared SMS header carry no monthly fee. Platform admins edit the cost
lines and margin in Ecom → Configuration → "SMS & WhatsApp add-on" (control-plane `platform_infra` key
`messaging_addon_pricing`; `GET/PUT /api/admin/ecom/messaging-addon-pricing`); renewals charge the fee
in force on the day.

Paid from the prepaid wallet (category `messaging_addon`, shown as "SMS & WhatsApp add-on"). Usage (per
message) is still debited separately. State lives on the control-plane `tenants` row: `messaging_addon`
(`none|sms|whatsapp|both`; new purchases are always `both`), `messaging_addon_until`, `messaging_addon_renew`.

## How the owner buys

Ecom portal → Billing → "SMS & WhatsApp" (`MessagingAddonCard`): confirm, the wallet is debited and
auto-renew is switched on. A short wallet shows a "Top up wallet" link instead.

- While active, buying again adds a month to the current end date. A store on an older single-channel
  add-on can switch to both; that starts a new month today, without credit for the old one.
- Each period is charged once: the wallet debit is keyed `messaging_addon:<tenant>:<tier>:<period start>`.
- Auto-renew: the daily `messaging_addon_renew` cron (`POST /api/cron/messaging-addon-renew`, controller,
  05:10 IST) charges the next month a day before the end; a short wallet lets the month lapse and is
  retried daily for a week.

API: `GET/POST /api/ecom/billing/messaging-addon` — `{ action: 'buy' }` or `{ action: 'renew_on' | 'renew_off' }`.

## What the flagship admin enters

Flagship admin → Ecom Stores → a store → "SMS & WhatsApp numbers" tab. One card per channel:
provider, sender, credentials. Saved to `tenant_messaging_senders` (one row per tenant and channel) with the
credentials AES-GCM encrypted (`SOCIAL_TOKEN_ENC_KEY`); the page only ever shows the sender, the last 4 of
ids and "stored" for secrets. Replacing a sender means entering every credential again.

| Provider | Sender | Credentials |
| --- | --- | --- |
| Twilio | SMS: DLT header or Twilio number. WhatsApp: the WhatsApp number | Account SID, Auth token (required: Twilio signs the store's delivery callbacks with it), optional API key SID + secret, optional Messaging service SID |
| AWS | SMS: DLT header / sender ID. WhatsApp: the WhatsApp number | Region, Access key ID, Secret access key; WhatsApp: phone number ID (required), WABA ID; SMS: origination identity, DLT entity ID, configuration set |

API: `GET/PUT/DELETE /api/admin/ecom/[tenantId]/messaging-senders/[channel]` (`channel` = `sms|whatsapp`),
platform admins only. A sender can be assigned before the add-on is bought; it is used once the add-on covers
the channel.

## Lock states

`messagingEntitlement(tenantId)` (`lib/billing/messaging-addon.ts`, 60 s cache) returns per channel:

| State | Meaning | Store admin sees |
| --- | --- | --- |
| `ok` | Add-on covers the channel and a sender is active | The normal Site Controls switch |
| `addon` | No active add-on for the channel | "Add SMS & WhatsApp in the ecom portal (Billing) to enable this." |
| `number` | Bought, no sender assigned yet | "Waiting for your number to be assigned by Jeffi." |

A purchase or a newly assigned sender shows in the store within a minute.

## Where it is enforced

- `getSiteControls()` (`lib/catalog/site-controls.ts`): on a tenant store a locked channel has
  `flags.smsEnabled` / `flags.whatsappEnabled` forced false and the reason in `locks`. Everything that reads
  the flags follows: `/api/feature-flags`, login OTP channels, the composer, templates, campaigns,
  `sms.ts`, `whatsapp.ts`, `sendByTemplate`, `phone-otp-delivery`.
- `PATCH /api/admin/settings`: turning `feature_sms_enabled` / `feature_whatsapp_enabled` on while locked
  returns 409 with the hint.
- Site Controls → Notifications: the two switches are locked with the hint. Setup guide SMS / WhatsApp steps
  give the same reason.
- messaging-service refuses a locked channel itself (`channel_locked`), which also covers the public API
  and bulk sends, and sends through the tenant's own sender when one is assigned.
