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
| ecom | +1 (872) 270-4479 (bought 2026-11-19 with Get a number; WhatsApp and SMS) | | Online |

+1 (872) 219-0609 was bought for ecom on 2026-11-15. Its WhatsApp sender went offline with Twilio error 410 ("create a support ticket"), and the number was released on 2026-11-18.

+1 (872) 217-1682 was the intended ecom number until 2026-11-19. If it is still in the Twilio account, nothing binds it any more: messages to it land in the flagship's customer chat. Release it, or bind it to an audience again.

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

- **A store without a number** can't send SMS or WhatsApp. messaging-service locks the channel (`channel_locked`), and store-core's direct sends (support replies, the admin assistant, CRM free text, campaign SMS) report the channel unconfigured. They never fall back to the platform env, whose numbers are the flagship's.
- **API workspaces** (the ecom dashboard's Play and Bulk messages, `/v1`): a workspace without a number of its own sends from the flagship's ecom number, else the platform env. `metadata.sender.tenant` records the row's owner, so status callbacks and polling use that row's account. Replies to the ecom number land in the support inbox.
- **Staff verification codes** (an admin's mobile, `admin-mobile.ts`: Account settings and the certificate portal) are sent and billed as the platform, outside the store's Site Controls switches and the add-on lock, so a store with an empty wallet or no add-on still gets them. They go out from the store's admin number, else its customer number (a code by SMS always uses the customer SMS number), else the flagship's numbers as before. A store's row that can't be decrypted falls through to the flagship's numbers instead of failing.
  - The store travels in the service token, not the request: `sendByTemplate({ asPlatform, senderTenant })` → `serviceToken(…, senderTenant)`. messaging-service honours `senderTenant` only on the platform tenant's internal tokens, so it never appears in the public `SendMessageRequest`.
  - The store's admin pod sends to the store's own messaging pod, which takes this one call (`POST /messages`, a platform internal token naming its own store) besides its own tenant's. It used to refuse it.
  - `metadata.sender.tenant` names the store, so status callbacks and polling use its row. The message itself stays the platform's.

- Callers pass `audience`: `sendByTemplate({ audience })` (→ `POST /messages { audience }`), `sendWhatsAppDirect({ audience })`, `getWhatsAppProvider(audience)`.
- Admin-facing today: the admin assistant's replies, admin mobile verification codes (from the store's numbers, above), and the "staff only" reply.
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

## Providers for Outreach

_Added 2026-11-24._ The Outreach program's providers are set on the flagship in **Settings → Providers → Outreach providers**, by the platform owner only. Non-secret values go to `platform_provider_settings` (`voice_provider`, `voice_config`, `sms_dlt_entity_id`, `sms_dlt_sender_ids`). Secrets go to `tenant_integration_credentials` under the platform id, encrypted with `SOCIAL_TOKEN_ENC_KEY`. They are write-only: the screen shows `Configured · ••••1234`, never the value. voice-service reads the merged config, secrets included, from `GET /api/internal/outreach/voice-config` on the controller with a service token whose `service` is `voice`.

| Field | Where it comes from |
| --- | --- |
| Call provider | Exotel places real calls (AgentStream). Twilio test line calls only the test numbers. |
| Exotel Account SID, API key, API token, region | Exotel dashboard → Settings → API settings (the host beside the keys: `api.in.exotel.com` for Mumbai) |
| Exotel caller number | Exotel → ExoPhones: the 140-series number |
| AgentStream app ID | Exotel App Bazaar: the flow with the AgentStream applet, the number in its URL |
| Twilio from number, Account SID, Auth token | Twilio Console → Phone numbers, Account info. The credentials are optional: without them the messaging account (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) is used |
| Test numbers | Your own phones, E.164, at most 20 |
| Sarvam API key | Sarvam dashboard → API keys. Models default to Saaras v3 (speech-to-text) and Bulbul v3 (text-to-speech) |
| Voice per language | Sarvam's Bulbul v3 voice list (`en` ishita, `hi` priya, `ta` ishita, `te` neha, `kn` neha, `ml` pooja, `mr` priya, `bn` roopa, `gu` priya by default) |
| Claude model ID, Anthropic API key | Default `claude-haiku-5-5`. The key is optional: without it `ANTHROPIC_API_KEY` is used. Console → API keys |
| DLT entity ID, sender IDs | Airtel DLT portal: Entity → Profile, and Headers. Env fallbacks are `AWS_SMS_DLT_ENTITY_ID` and `AWS_SMS_DLT_SENDER_IDS` (comma-separated); a store override row wins over both. Each SMS template's DLT template ID is set on the template |

On the Airtel DLT portal, add PE–TM chains for Karix and Sinch, the telemarketers AWS End User Messaging delivers through, and Exotel's TM ID `1002641844184516305` for calls. **Test Exotel** reads the account balance with the saved credentials; it places no call. Sarvam has no read-only endpoint, so it has no test.

## India DLT on AWS

Indian SMS must carry the Principal Entity ID and the content template ID. On AWS End User Messaging both go in `DestinationCountryParameters` (`IN_ENTITY_ID`, `IN_TEMPLATE_ID`), and only for +91 numbers. A send with an entity ID but no template ID still goes out (AWS may reject it) and logs one `sms_dlt_template_id_missing` warning naming the template slug, never the number.

Where each id comes from:
- Entity ID, first match wins: the store sender's `dlt_entity_id`, then the Providers setting `sms_dlt_entity_id` (the store's row, then the platform default), then env `AWS_SMS_DLT_ENTITY_ID`.
- Template ID, first match wins: the per-send `dlt_template_id`, then the template's `sms_dlt_template` row (set by `dltTemplateId` on a seed catalog SMS entry, the "DLT template ID" field in the SMS template editor, or `dlt_template_id` on the template API).
- Sender id: the row's `dlt_header`, else `sms_dlt.default_header`, replaces the origination identity for Indian sends.
- Message type: the row's `dlt_route` (`promotional` sends as PROMOTIONAL; transactional, service and otp as TRANSACTIONAL); with no row, a marketing/promotional/campaign template category sends as PROMOTIONAL.

**India SMS (DLT) via AWS sender.** An SMS sender of this type (Settings → Numbers for the flagship, Ecom → store → Numbers for a store) is an `aws` row with `credentials: 'platform'`: messaging-service sends with the platform's own AWS credentials from **ap-south-1**, so no keys are stored or shown. Pick a header from the platform's registered headers (`sms_dlt_sender_ids`; shared under Jeffi's entity) or enter the store's own header plus its own entity ID. "Check sender ID" calls `DescribeSenderIds` in ap-south-1 and shows Registered or Not registered; it requests nothing. Only the platform administrator can create, change or remove senders. The DLT sheet to approve before registering templates is `docs/DLT_SMS_TEMPLATES.csv` (`node scripts/dlt-template-sheet.mjs > docs/DLT_SMS_TEMPLATES.csv`). SMS bodies start with the brand, say "Rs." (a rupee sign forces UCS-2: 70 characters a segment) and stay GSM-7.

One-time steps for the founder:
1. On the Airtel DLT portal, add PE–TM chains for **Karix and Sinch**, AWS's Indian aggregators.
2. Register transactional sender IDs in the AWS console in **ap-south-1**; promotional ones go through an AWS Support case.
3. Set the entity ID (`sms_dlt_entity_id` in Providers, or `AWS_SMS_DLT_ENTITY_ID`) and fill each SMS template's DLT template ID.
