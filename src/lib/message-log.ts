import { query } from '@/lib/db'

// Persist an outbound SMS/WhatsApp notification to message_logs.
// OTP is intentionally excluded by callers (kind === 'otp' is never passed here).
// Fire-and-forget: never throws, never blocks the send path.

export function logMessage(params: {
  channel: 'sms' | 'whatsapp'
  to: string
  from: string
  body: string | null
  kind: string
  status: 'sent' | 'failed'
  error?: string | null
  providerSid?: string | null
}): void {
  // Never log OTP messages.
  if (params.kind === 'otp') return
  query(
    `INSERT INTO message_logs (channel, to_number, from_number, body, kind, status, error, provider_sid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [params.channel, params.to, params.from, params.body, params.kind, params.status, params.error ?? null, params.providerSid ?? null]
  ).catch(() => {})
}
