import { query } from '@/lib/db'

// Persist an SMS/WhatsApp message to message_logs (outbound sends + inbound replies).
// OTP is intentionally excluded by callers (kind === 'otp' is never stored).
// Fire-and-forget: never throws, never blocks the send path.

export function logMessage(params: {
  channel: 'sms' | 'whatsapp'
  to: string
  from: string
  body: string | null
  kind: string
  status: 'sent' | 'failed' | 'received'
  direction?: 'outbound' | 'inbound'
  error?: string | null
  providerSid?: string | null
  userId?: string | null
}): void {
  // Never log OTP messages.
  if (params.kind === 'otp') return
  query(
    `INSERT INTO message_logs (channel, direction, to_number, from_number, body, kind, status, error, provider_sid, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [params.channel, params.direction ?? 'outbound', params.to, params.from, params.body, params.kind,
     params.status, params.error ?? null, params.providerSid ?? null, params.userId ?? null]
  ).catch(() => {})
}
