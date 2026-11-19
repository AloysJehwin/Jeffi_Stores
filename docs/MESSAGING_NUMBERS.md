# Messaging numbers per audience

_Added 2026-11-14._

Every store sends and receives SMS and WhatsApp on numbers split by **audience**:

| Audience | Who | Channels | Flagship | Store tenant |
| --- | --- | --- | --- | --- |
| `customer` | Shoppers: order updates, OTPs, campaigns, support, the shopping assistant | WhatsApp + SMS | yes | yes |
| `admin` | Store staff: the admin assistant, staff sign-in codes | WhatsApp only | yes | yes |
| `ecom` | Store owners on the ecom portal (messages reach the support inbox) | WhatsApp + SMS | yes | no |

`AUDIENCE_CHANNELS` (lib/messaging/tenant-senders.ts) and the `tenant_messaging_senders_audience_channel_check` constraint enforce the channels. An SMS to staff (a sign-in code sent by SMS) goes out from the customer SMS sender: in India SMS goes out under the DLT header, which names the store rather than an audience.

Numbers live in control-plane `tenant_messaging_senders`, one row per (tenant, channel, audience), with the provider credentials encrypted (`SOCIAL_TOKEN_ENC_KEY`). One number serves one audience: saving a number already used by another store or audience is refused.

## The flagship's numbers (Twilio, US, $1.15/month each)

| Audience | Number | WhatsApp display name | WhatsApp sender, checked 2026-11-18 |
| --- | --- | --- | --- |
| customer | +1 (872) 217-9910 (the platform env `TWILIO_WHATSAPP_FROM`) | Jeffi Stores | Online |
| admin | None: flagship staff use the customer number (decided 2026-11-18) | | |
| ecom | +1 (872) 217-1682 (bought 2026-11-15 as the admin number) | Jeffi Stores Team | Online |

+1 (872) 219-0609 was bought for ecom on 2026-11-15. Its WhatsApp sender went offline with Twilio error 410 ("create a support ticket"), and the number was released on 2026-11-18.

Both numbers are in the platform's own Twilio account, which has no sub-accounts, and on the same WhatsApp Business account. That means they share its business verification and approved templates, and each new number starts at Meta's lowest sending tier.

- **Webhooks:** both WhatsApp webhooks point at `https://jeffistores.in/api/webhooks/twilio`, and so does the ecom number's SMS webhook. The customer number's incoming SMS goes to a separate n8n workflow.
- **Entering them:** enter the ecom number in Settings → Numbers → Ecom portal → WhatsApp with the Twilio fields **blank**. A flagship row without credentials sends through the platform env's account.
- **Left empty:** admin-facing stays empty. The ecom portal's SMS waits for the DLT header on MSG91.

## Where they are set

- **Flagship**: Settings → Numbers, by the flagship's administrator (`administrator` role, on the flagship). Five cards: customer WhatsApp + SMS, admin WhatsApp, ecom WhatsApp + SMS. Twilio credentials are optional here: blank means the platform's account. API: `PUT|DELETE /api/admin/settings/messaging-numbers/{channel}?audience=`.
  - The admin-facing and ecom cards also have **Get a number**, the same one-step buy as a store's (below), through `/api/admin/ecom/00000000-0000-0000-0000-000000000000/numbers`.
  - The customer-facing number can't be bought there (the API refuses it too). A bought number would take live shopper messages before WhatsApp approves it.
- **A store**: the platform administrator, Ecom → Stores → the store → Numbers (customer-facing and admin-facing). API: `PUT|DELETE /api/admin/ecom/{tenantId}/messaging-senders/{channel}?audience=`.
- The store's own Settings → Numbers shows its numbers read-only (no credentials).

## Getting a store's numbers (messaging add-on, ₹500/month)

The add-on costs ₹500 a month:

| Item | Monthly cost |
| --- | --- |
| Customer-facing Twilio number | ₹101.20 |
| Admin-facing Twilio number | ₹101.20 |
| WhatsApp registration, upkeep and support | ₹197.60 |
| Cost | ₹400 |
| Price, with the 25% margin (`DEFAULT_MESSAGING_COST_LINES`; migration `2026-11-15_messaging_addon_price_500.sql`) | ₹500 |

Message usage is billed from the wallet as before.

When a store buys it, the platform administrator opens **Ecom → Customers → the store → SMS & WhatsApp numbers**. For each audience, **Get a number** does the following (`lib/messaging/tenant-numbers.ts`, `/api/admin/ecom/[tenantId]/numbers`):

1. Searches the platform's Twilio account by US area code. Twilio sells no Indian numbers.
2. Buys the chosen number, after a confirm that shows the monthly price, and points its incoming messages at the platform webhook.
3. Binds the number to every channel the audience has: customer gets WhatsApp and SMS, admin gets WhatsApp. No credentials are stored (`platform_account`); the number sends through the platform's Twilio account.
4. Registers the number as a WhatsApp sender on the platform's WhatsApp Business account under the display name you typed, which Meta reviews. The status shows on the page, with Refresh, Retry WhatsApp and Release. Release removes the number from WhatsApp and gives it back to Twilio, which stops the charges.
5. Holds WhatsApp back until the sender is Online:
   - The SMS row is `active` at once. The WhatsApp row is saved `pending`, and the card shows "Waiting for WhatsApp".
   - Sender lookups only take `active` rows, so the audience's previous number keeps sending WhatsApp: the customer-facing number, or on the flagship the platform default.
   - Every 5 minutes, the `messaging_numbers_online` job (`/api/cron/messaging-numbers-online`) checks the pending senders. When one is Online, the job makes its row `active`. Refresh status does the same.
   - Retry WhatsApp puts the row back to `pending` until the sender is Online again.
   - A row that is already active stays active if WhatsApp later reports it offline. The page shows the status, and Retry is there.

Local dev and tests use a fake number provider (`number-provider.ts`): nothing is bought.

- **WhatsApp account policy:** Meta expects each business to have its own WhatsApp Business account. Registering store numbers on the platform's account works for now, but a display name Meta doesn't see as related to the verified business can be rejected. The long-term path is each store connecting its own account through Twilio's Tech Provider sign-up.
- **SMS in India:** SMS on a Twilio number goes over the international route (about ₹7.86 per message). Once the Jeffi DLT header and MSG91 are live, a store's customer SMS moves to the shared header.

## Which number sends

`getTenantSender(tenant, channel, audience)` (store-core) and `tenantSender(...)` (messaging-service) take the audience's own row, else the customer row, else (flagship only) the platform env (`TWILIO_WHATSAPP_FROM`, `TWILIO_FROM_NUMBER`, the AWS keys). So nothing changes until a number is entered. The flagship has no tenant, so its rows are looked up under `00000000-0000-0000-0000-000000000000` both by store-core's direct sends (`ownSender`) and by messaging-service (`messagingTenant()`).

- Callers pass `audience`: `sendByTemplate({ audience })` (→ `POST /messages { audience }`), `sendWhatsAppDirect({ audience })`, `getWhatsAppProvider(audience)`.
- Admin-facing today: the admin assistant's replies, admin mobile verification codes, and the "staff only" reply.
- Everything else defaults to `customer`.
- messaging-service records `metadata.sender.audience` on each message, so delivery callbacks and polling use the same account.

## Inbound

All numbers point at one webhook: Twilio `https://jeffistores.in/api/webhooks/twilio`, or the AWS SNS topic → `/api/webhooks/aws-messaging`. The number messaged (`To`, or `display_phone_number` on AWS) decides the store and audience (`resolveInbound`, matched on digits). The legacy `?t=<tenantId>` hint still works for a number with no row.

- **admin number**: only the admin assistant.
  - Anyone who isn't an eligible admin gets one "this number is for staff only, message us at <customer number>" reply a day.
  - Nothing from it reaches the customer chat.
- **ecom number** (flagship): the support inbox (`handleInboundWhatsApp` with `audience: 'ecom'`), with no shopper assistant.
  - The session remembers the number last messaged (`support_sessions.wa_audience`: customer or ecom).
  - Replies go out from that number: text, attachments, and the template sent outside the 24-hour window. A store owner who wrote to the ecom number gets the answer in the same chat.
- **customer number**: the customer chat and the shopping assistant.
  - On a store **without** a separate admin number, an admin's verified mobile still reaches the assistant (the old shared-number behaviour).
  - Once the store has an admin number, the customer number never reaches the assistant.
- **Twilio signatures**: checked against the platform token and the number's own auth token, so a store's own Twilio account works.

## Admin assistant sign-in (WhatsApp)

A verified admin mobile (`admin_mobiles`) is not enough. Each (store, admin, phone) needs a session (`controller-service/src/lib/admin-agent/whatsapp-auth.ts`):

1. The first message gets a challenge. The admin sends the 6-digit code from the authenticator app they use for admin sign-in. Without one, a 6-digit code is emailed to their address.
2. A correct code opens an **8-hour** session and answers the message that triggered the challenge.
3. **LOGOUT** ends every session for that phone.
4. **5 wrong codes** lock sign-in for 15 minutes.
5. The existing gates still apply on every message:
   - store switch (`feature_agent_whatsapp_enabled`)
   - plan scope `agent:write`
   - the admin's own `agent:write`
   - YES/NO approval for every change, with money, cancellations and mass sends kept panel-only

## Shopping assistant links

Customer tools (`customer-agent/tools.ts`, through `getCustomerTool`) add `url`, the product's page on this store, to every product they return. The prompt asks the assistant to:
- find products in the catalogue,
- ask one question when the need is vague,
- suggest 1–3 products with name, price, stock and the url on its own line,
- send only urls the tools returned.

WhatsApp shows a preview of the first link.

## Going live

1. Release this change. The schema diff adds the `audience` column; the flagship migration `controller-service/database/platform-only/migrations/2026-11-14_messaging_sender_audience_key.sql` drops the old (tenant, channel) key.
2. Buy or assign the extra numbers. Point each number's incoming webhook at the URL above; no `?t=` is needed.
3. Enter them:
   - flagship: Settings → Numbers
   - each store: Ecom → store → Numbers
4. WhatsApp templates belong to the WhatsApp Business account. A number on the same account (the flagship's three) shares its approved templates. A store's own account needs its templates approved there.
