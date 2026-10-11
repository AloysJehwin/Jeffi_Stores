# WhatsApp campaign templates

Campaign WhatsApp messages are **Meta-approved Twilio Content templates**, not free-form text. The admin
picks an approved template per campaign, fills its variable slots, and (for media-header templates) sets a
header image — see the **WhatsApp message** panel in Marketing → Campaigns when WhatsApp is enabled.

## How it works
- The catalogue of selectable templates lives in `src/lib/templates/whatsapp-registry.ts`
  (`WHATSAPP_TEMPLATES`). Each entry has a `key` (stored on the campaign in `campaigns.wa_template_sid`),
  a `sidEnv` (the env var holding the live Twilio Content SID), the `kinds` it's offered for, its numbered
  `slots`, `hasImageHeader`, and a `bodyPreview` used only for the admin chat-bubble preview.
- At send time `sendCampaignWhatsApp` (`src/lib/campaigns/whatsapp-dispatch.ts`) resolves the campaign's
  chosen key → the SID from `process.env[sidEnv]` and sends via `sendCampaignTemplateWhatsApp`
  (`src/lib/shared/whatsapp.ts`). If no key is chosen it falls back to the built-in per-kind dispatch; if
  the SID isn't configured the send returns false and the SMS fallback carries the message.
- Twilio/WhatsApp credentials are **platform-global** (`TWILIO_*` env). Tenants pick from the shared
  approved set; they don't register their own sender.

## Applying for more templates
1. In the **Twilio Console → Content Template Builder**, create a template (body with `{{1}}`, `{{2}}`…
   placeholders; add a media/image header if you want one). Submit it for **WhatsApp (Meta) approval**.
2. When approved, copy its **Content SID** (`HX…`).
3. Add the SID to the environment as a new `TWILIO_WA_<NAME>_SID` (Secrets Manager → regenerated into
   `.env.local` locally; the deploy secret in prod).
4. Add an entry to `WHATSAPP_TEMPLATES` in `src/lib/templates/whatsapp-registry.ts`: a `key`, `label`,
   `sidEnv` (the new var), the campaign `kinds` it suits, its `slots` (matching the `{{n}}` order),
   `hasImageHeader`, and a `bodyPreview` mirroring the approved copy.
5. It appears automatically in the campaign WhatsApp picker for the listed kinds — no other code change.

## Constraints
- Un-approved / free-form WhatsApp bodies are not deliverable to users outside the 24-hour customer
  service window, which is why the admin picks approved templates rather than authoring text.
- The `bodyPreview` is for the admin UI only; Twilio sends by `contentSid` + `contentVariables`.
