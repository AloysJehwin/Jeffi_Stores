# Push notifications: order updates, an in-app inbox, and campaign pushes

Status: phases 0–3 in review (2026-10-25): server #584, app #585, Mailer and scenarios #589. Needs the FCM service account and a device check before go-live. Scope: the Android app (`mobile-service/client`), the controller,
messaging-service, and the two campaign systems. iOS, web push and white-label tenant apps come later (phase 4).

## What exists today (audit 2026-10-25)

- **No push anywhere.**
  - The app has `@react-native-firebase/app` and `analytics` (GA4) only: no `expo-notifications`, no FCM messaging,
    no `POST_NOTIFICATIONS` permission.
  - The server has no FCM client, no device-token table and no token routes.
  - The Firebase project for the app is `jeffi-stores-215e5` (number 547714650610); `google-services.json` is in the
    repo, and the `android/` folder is gitignored, so EAS runs prebuild and config plugins apply.
- **messaging-service** sends email (SES), SMS and WhatsApp (Twilio).
  - The channel union is `email | sms | whatsapp` in `packages/api-contracts`; prices are in `packages/pricing`.
  - Every send debits the tenant wallet. Delivery is logged in `messages` / `message_events`.
  - The controller calls it in-process by default (`MESSAGING_INLINE`), over HMAC service auth otherwise.
- **Transactional messages:**
  - SMS and WhatsApp: `lib/shared/notify.ts` (`notifyOrderConfirmed`, `Shipped`, `OutForDelivery`, `Delivered`,
    `Cancelled`, `PaymentFailed`, `AccessGranted`, …), routed by `users.notification_channel`.
  - Emails: `lib/email/*`.
- **Two campaign systems:**
  - *Automated scenarios* (`campaigns` table, `lib/campaigns/runner.ts`, cron every 30 min). Email goes through
    `sendCampaignEmail`; SMS and WhatsApp through `sendCampaignWhatsApp`. Dedup is the unique index on
    `email_campaigns_sent (campaign_kind, user_id, reference_id)`, with `reference_id` set to `wa:<kind>` or
    `sms:<kind>` per channel.
  - *Broadcast Mailer* (`email_campaigns` + `email_campaign_logs`). Audiences come from `resolveAudience` in
    `lib/shared/email-campaigns.ts`, which today always requires an email address. Scheduling runs through
    `cron-dispatch-mailer` every minute. The channel CHECK on `email_campaign_logs` allows only
    email/sms/whatsapp.
- **Preferences:** `users.notification_channel` and one global `users.marketing_opt_out`. There is no per-channel or
  per-category consent and no quiet hours.
- **An unused `notifications` table** (`database/crm.sql`: `user_id`, `type`, `title`, `message`, `link`, `is_read`)
  fits a customer inbox. Admin has its own `admin_notifications` and bell.
- **Deep links.** The app's `openHref` (`src/lib/links.ts`) already maps storefront paths (`/product/…`, `/orders/…`,
  `/category/…`, cart, wishlist, account pages) to screens, so a push only needs to carry a storefront path.
- **Gating.** Campaigns and the Mailer are plan-gated (`campaigns:read`, `mailer:read`); the flagship is never
  limited. The app and mobile-service are flagship-only.

## Decisions

1. **Client: `expo-notifications`.** It handles the Android 13 permission, notification channels, foreground display,
   tap responses (warm and cold start), and returns the native FCM token (`getDevicePushTokenAsync`). We don't add
   `@react-native-firebase/messaging` (two FCM services would conflict).
2. **Send straight to FCM HTTP v1** with a service account for `jeffi-stores-215e5`, not through Expo's push relay.
   Tokens and payloads stay in our stack.
3. **Push is a fourth channel in messaging-service.**
   - An `fcm` provider sits next to SES and Twilio, so delivery logs, bulk workers, templates, wallet and tenancy
     work the same way.
   - `Channel` gains `push`; push costs 0 in `packages/pricing`.
4. **Push adds to SMS, WhatsApp and email; it doesn't replace them.** OTPs never go by push. A later option (phase 4):
   push first for non-critical updates, falling back to SMS only if the push wasn't delivered, to save SMS cost.
5. **Every push also lands in the inbox** (`notifications` row), so nothing is lost when a push is dismissed or the
   permission is off.
6. **Categories, each with its own Android channel and preference:**

   | Category | Kind | Default |
   |---|---|---|
   | `orders` | transactional | on |
   | `account` | transactional | on |
   | `offers` | marketing | follows the user's opt-in |
   | `price_alerts` | marketing | follows the user's opt-in |

   Users can mute offers in Android settings without losing order updates.

## Data model

New tables go in a topic file (`database/notifications.sql`), with PK/CHECK in `constraints.sql` and indexes in
`indexes.sql`. No migration files.

- **`push_devices`**
  - Columns: `id`, `user_id` (nullable for signed-out installs; FK users ON DELETE CASCADE), `token` (unique),
    `platform` (CHECK android/ios), `app_version`, `os_version`, `locale`, `timezone` (default `Asia/Kolkata`),
    `offers_opt_in` and `offers_opt_in_at` (the marketing consent of a signed-out install), `created_at`,
    `last_seen_at`, `disabled_at`, `disabled_reason`.
  - When a signed-out install signs in, its opt-in carries over to the user's preferences.
  - Index on `user_id` where `disabled_at IS NULL`.
- **`notification_preferences`**
  - Columns: `user_id`, `category`, `push`, `email`, `sms`, `whatsapp`, `updated_at`; PK `(user_id, category)`.
  - A missing row means the category default. `users.marketing_opt_out` still wins for every marketing category.
- **`notifications`** (existing): add `category`, `image_url`, `source` (transactional | campaign | scenario),
  `source_ref` (order id, campaign id or kind), `opened_at`.
- **Campaigns:**
  - `email_campaign_logs` channel CHECK adds `push`.
  - `email_campaigns.channels` carries the push payload (title, body, image, link).
  - `campaigns` (scenarios) gains `push_title` / `push_body` / `push_link`, or a push block in `parameters`.
- **Site Controls:** `feature_push_enabled` and `feature_marketing_push_enabled`, checked by the send helper *and* by
  messaging-service.

## API

All routes are on the controller under `/api/user/…`; the app reaches them through mobile-service's `/api/*`
forwarding.

| Route | Purpose |
|---|---|
| `POST /push-devices` | Register or refresh a token: upsert by token, attach the signed-in user, bump `last_seen_at`. Called on launch, on token change and after sign-in. |
| `DELETE /push-devices/:token` | On sign-out: detach the user (the device stays as a guest install). |
| `GET` / `PUT /notification-preferences` | Read and save categories × channels. |
| `GET /notifications?cursor=` | The inbox. |
| `POST /notifications/read` | Mark ids or all as read. |
| `POST /notifications/:id/opened` | Tap tracking for opens and conversion attribution. |

## App

- **Permission:** a soft-ask sheet in the app's style, never at first launch.
  - Show it after the first order ("Get delivery updates") and from Account → Notifications.
  - Only then show the Android 13 system prompt. If the user declines, show it again at most once per 30 days.
- **Setup:** create the channels at startup (orders and account high importance, offers default). Register the token
  and handle token refresh.
- **Taps:** route through `openHref` with the payload's storefront path. A cold-start tap waits for auth rehydration
  first.
- **Foreground:** order updates show as an in-app banner; offers go only to the inbox and update the badge.
- **Top bar:** a bell with the unread count opens the Notifications screen (list, mark read, swipe to dismiss, empty
  state). It fits the top bar now that the bottom tabs are gone.
- **Settings:** an Account → Notifications screen with the categories × channels toggles and a link to Android's
  notification settings when the permission is off.
  - Signed out, it is reachable from the menu and shows just the offers toggle for this device.
- **Native build:** adding `expo-notifications` needs a Play build. Also add the notification icon (monochrome) and
  accent colour.

## Transactional pushes (phase 1)

Each `notify*` in `lib/shared/notify.ts` also calls a new `notifyPush(userId, { category, title, body, link,
image })`. It writes the inbox row, then sends to the user's active devices if the category's push preference is on
and the Site Controls flag allows.

| Event | Link |
|---|---|
| Order confirmed, payment failed, shipped, out for delivery, delivered, cancelled | `/orders/:id` |
| Refund issued; return requested, approved or rejected | `/orders/:id` |
| Digital access granted | the vault or order page |
| Subscription renewal and failure | `/account/subscriptions` |
| Quote ready (business) | `/account/quotes` |

Copy lives in the messaging template library (`template_family` `push/order-shipped` and so on) so admins edit it
like SMS and WhatsApp templates.

## Campaign pushes

**Broadcast (Mailer), phase 2**
- **Composer:** a Push channel next to email, SMS and WhatsApp.
  - Fields: title (up to 65 characters), body (up to 240), optional image from the gallery (AI-platform images
    included), and a link picker (product, category, offer, collection or storefront path).
  - A live Android preview, collapsed and expanded.
- **Audience:** the existing segments, plus "All signed-in app users" and "All installs, including signed out".
  - Reach counts active devices whose user allows `offers` and isn't opted out of marketing, plus signed-out devices
    with `offers_opt_in`.
  - `resolveAudience` gets a per-channel reachability rule instead of always requiring an email address.
- **Sending:**
  - Schedule through the existing dispatcher. Send in batches of up to 500 tokens per FCM call, with one log row per
    device.
  - FCM `UNREGISTERED` or `INVALID_ARGUMENT` disables the device.
- **Guardrails:**
  - Quiet hours 00:00 to 09:00 in the device's time zone (configurable); sends inside the window wait for it to end.
  - A frequency cap of two marketing pushes per person or signed-out device per day (configurable), shared with
    scenario pushes.
  - Collapse keys so a newer offer replaces an older one.
- **Reporting:** sent, delivered, failed, opened (tap API), and converted (an order within 24 hours of the open,
  attributed like email's `converted_at`).

**Automated scenarios, phase 3**
- `sendCampaignPush` sits beside `sendCampaignWhatsApp`, with a `pushEnabled` parameter per scenario and dedup
  reference `push:<kind>` on the existing index.
- First scenarios to wire:
  - abandoned cart (1 hour)
  - back in stock and price drop on wishlist items
  - coupon or reward expiring
  - birthday (the app now collects date of birth)
  - review request after delivery
  - win-back after 60 days
- The scenario editor gets a push block with the same preview; the scenario report gains a push column.

## Security, privacy, operations

- **Credentials:** an FCM service account with only the "Firebase Cloud Messaging API Admin" role, stored as a
  Kubernetes secret. Enable the FCM v1 API on the project; never ship the account in the app.
- **Token hygiene:** refresh `last_seen_at` on every launch, disable tokens on FCM errors, and prune devices unseen
  for 270 days (a weekly cron in `lib/shared/cron-jobs.ts`).
- **Payloads:** title, body, image and link only; no personal data beyond what the notification shows.
- **Consent:**
  - Marketing push needs the user's opt-in (soft ask plus toggles), recorded with a timestamp, in line with the
    DPDP Act.
  - Update the privacy policy and the Play Data safety form (device IDs for push).
- **Tenancy:** the schema lands in every tenant database through the fan-out, but only the flagship has an app. Push
  campaigns use the same plan gates as other channels. Per-tenant Firebase credentials (in
  `messaging_tenant_settings`) come with white-label apps.
- **Toggles:** while touching campaign sends, also gate the two WhatsApp campaign paths that skip the Site Controls
  toggle today (`email-campaigns.ts` broadcast and `whatsapp-dispatch.ts` `sendWhatsAppPart`).

## Phases

| Phase | Scope | Ships with |
|---|---|---|
| 0. Groundwork | Schema; FCM provider and `push` channel in messaging-service; Site Controls flags; device and preference routes; app: `expo-notifications`, channels, soft ask, token registration, tap routing; admin "Send test push to my devices" | Play build (native) + server release |
| 1. Order updates and inbox | `notifyPush` in every transactional notifier; push templates; inbox writes; top-bar bell and Notifications screen; Account → Notifications settings | Play build + server |
| 2. Broadcast push | Mailer composer channel, audience reachability, quiet hours, frequency cap, batching, reporting | Server (+ app only if the inbox needs changes) |
| 3. Scenario push | Push in the scenario runner and editor; first scenarios listed above; rich images | Server |
| 4. Later | iOS (APNs key in Firebase), web push on the storefront, push-first with SMS fallback, A/B tests, white-label tenant apps | — |

## Verification

- **Phase 0:**
  - A test push reaches a device in the background, foreground and killed states.
  - A tap opens the right screen from a cold start.
  - The token re-registers after reinstall and moves between users on sign-out and sign-in.
  - Denying the permission leaves the inbox working.
- **Phase 1:** walk an order through confirmed → delivered and get one push and one inbox row per step. Muting
  `orders` in Android stops the pushes but not the inbox.
- **Phase 2:**
  - A scheduled campaign respects quiet hours and the frequency cap.
  - Audience counts match the devices sent.
  - An uninstalled device's token is disabled after the first send.
  - Opens and conversions show in the report.
- **Phase 3:** the dry run lists eligible users; a second run in the cooldown sends nothing (dedup).
- **Every phase:** the CI check set and the app typecheck; schema applied to the local database only.

## Decisions (2026-10-25)

- **Signed-out installs** receive marketing pushes when they opted in on the device.
- **Quiet hours** are 00:00 to 09:00, recorded from "12pm–9am" as midnight to 9 am; noon to 9 am would leave only
  three hours a day.
- **Frequency cap:** at most two marketing pushes a day.

## Open decisions

1. **Web push.** Add browser push to the storefront later, or keep push app-only.
2. **Cost saving.** Should order updates eventually go push-first, with SMS only when the push isn't delivered?
