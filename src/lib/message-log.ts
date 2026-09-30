import { query } from '@/lib/db'

// Persist an SMS/WhatsApp message to message_logs (outbound sends + inbound replies).
// OTP messages ARE logged, but the sensitive value (the code itself) is redacted —
// we keep the message shape/context, never the secret. Fire-and-forget: never
// throws, never blocks the send path.

// Mask the actual secret in OTP/verification messages while keeping the wording.
// We only mask the CODE itself — a 4–8 char token that is (nearly) all digits —
// never the surrounding English words. Two passes:
//   1) a code that directly follows an OTP/code/pin keyword + separator
//   2) any remaining standalone 4–8 digit run (defensive)
export function redactOtpBody(body: string | null): string | null {
  if (!body) return body
  const MASK = '••••••'
  const isCodeLike = (s: string) => /^[0-9][0-9A-Za-z]{2,7}$/.test(s) && /\d/.test(s)
  return body
    .replace(
      /\b(otp|code|password|pin)\b(\s*(?:is|:|=)?\s*)([A-Za-z0-9]{3,12})/gi,
      (m, kw: string, sep: string, val: string) => (isCodeLike(val) ? `${kw}${sep}${MASK}` : m)
    )
    .replace(/\b\d{4,8}\b/g, MASK)
}

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
  entityType?: string | null
  entityId?: string | null
}): void {
  // OTP messages are logged for the audit trail, but with the code redacted so
  // the secret never lands in the DB.
  const body = params.kind === 'otp' ? redactOtpBody(params.body) : params.body
  query(
    `INSERT INTO message_logs (channel, direction, to_number, from_number, body, kind, status, error, provider_sid, user_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      params.channel,
      params.direction ?? 'outbound',
      params.to,
      params.from,
      body,
      params.kind,
      params.status,
      params.error ?? null,
      params.providerSid ?? null,
      params.userId ?? null,
      params.entityType ?? null,
      params.entityId ?? null,
    ]
  ).catch(() => {})
}
