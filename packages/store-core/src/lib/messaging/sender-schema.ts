import { z } from 'zod'

// The body of a sender PUT (platform admin for a store, flagship administrator for the flagship): provider, the
// number / DLT header, and the provider credentials. auth_token is required for Twilio: it signs incoming
// messages and the account's delivery callbacks. An India DLT sender is provider `aws` with
// `credentials: 'platform'`: the platform's AWS account, ap-south-1, no keys.

const opt = z.string().trim().max(400).optional()
const req = z.string().trim().min(1).max(400)

const twilio = z.object({
  provider: z.literal('twilio'),
  sender: z.string().trim().min(1).max(120),
  config: z.object({ account_sid: req, auth_token: req, api_key_sid: opt, api_key_secret: opt, messaging_service_sid: opt }).strict(),
})

const awsKeys = z.object({
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
})

const awsIndiaDlt = z.object({
  provider: z.literal('aws'),
  sender: z.string().trim().regex(/^[A-Za-z0-9]{3,11}$/, 'The DLT header is 3 to 11 letters or digits'),
  config: z
    .object({
      credentials: z.literal('platform'),
      region: z.literal('ap-south-1').optional(),
      dlt_entity_id: z.string().trim().regex(/^\d{15,25}$/, 'The DLT entity ID is the 15 to 25 digit number from the Airtel DLT portal').optional(),
      configuration_set: opt,
    })
    .strict(),
})

export const SenderPutSchema = z.union([twilio, awsKeys, awsIndiaDlt])

/** The flagship's own numbers: Twilio credentials may be left out to send through the platform's account. */
export const FlagshipSenderPutSchema = z.union([
  z.object({
    provider: z.literal('twilio'),
    sender: z.string().trim().min(1).max(120),
    config: z.object({ account_sid: opt, auth_token: opt, api_key_sid: opt, api_key_secret: opt, messaging_service_sid: opt }).strict(),
  }),
  awsKeys,
  awsIndiaDlt,
])
