import { z } from 'zod'

// The body of a sender PUT (platform admin for a store, flagship administrator for the flagship): provider, the
// number / DLT header, and the provider credentials. auth_token is required for Twilio: it signs incoming
// messages and the account's delivery callbacks.

const opt = z.string().trim().max(400).optional()
const req = z.string().trim().min(1).max(400)

export const SenderPutSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('twilio'),
    sender: z.string().trim().min(1).max(120),
    config: z.object({ account_sid: req, auth_token: req, api_key_sid: opt, api_key_secret: opt, messaging_service_sid: opt }).strict(),
  }),
  z.object({
    provider: z.literal('aws'),
    sender: z.string().trim().min(1).max(120),
    config: z
      .object({
        region: req,
        access_key_id: req,
        secret_access_key: req,
        whatsapp_phone_number_id: opt,
        waba_id: opt,
        sms_origination: opt,
        dlt_entity_id: opt,
        configuration_set: opt,
      })
      .strict(),
  }),
])

/** The flagship's own numbers: Twilio credentials may be left out to send through the platform's account. */
export const FlagshipSenderPutSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('twilio'),
    sender: z.string().trim().min(1).max(120),
    config: z.object({ account_sid: opt, auth_token: opt, api_key_sid: opt, api_key_secret: opt, messaging_service_sid: opt }).strict(),
  }),
  SenderPutSchema.options[1],
])
