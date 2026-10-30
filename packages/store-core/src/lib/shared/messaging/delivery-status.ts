import 'server-only'
import { query } from '@/lib/shared/db'
import { setStatusByProviderSid } from '@/lib/support/messages'
import type { MessageStatus } from '@/lib/support/types'

// Provider delivery callbacks (Twilio, AWS) → message_logs and support chat ticks. Statuses only move
// forward: a late "delivered" never overwrites "read".

const RANK_SQL = (col: string) =>
  `CASE ${col} WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 WHEN 'queued' THEN 1 WHEN 'accepted' THEN 1 ELSE 0 END`

const TO_TICK: Record<string, MessageStatus> = {
  accepted: 'sent',
  queued: 'sent',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
}

export async function applyDeliveryStatus(p: { providerSid: string; status: string; provider: 'twilio' | 'aws'; error?: string | null; priceInr?: number | null }): Promise<void> {
  const status = p.status.toLowerCase()
  await Promise.resolve(query(
    `UPDATE message_logs
        SET delivery_status = CASE WHEN $2 IN ('failed', 'undelivered') OR ${RANK_SQL('$2')} >= ${RANK_SQL('delivery_status')} THEN $2 ELSE delivery_status END,
            provider = COALESCE(provider, $3),
            price = COALESCE($4, price),
            currency = CASE WHEN $4 IS NULL THEN currency ELSE 'INR' END,
            priced_at = CASE WHEN $4 IS NULL THEN priced_at ELSE now() END
      WHERE provider_sid = $1`,
    [p.providerSid, status, p.provider, p.priceInr ?? null]
  )).catch(() => {})
  const tick = TO_TICK[status]
  if (tick) await setStatusByProviderSid(p.providerSid, tick, tick === 'failed' ? p.error ?? 'Not delivered' : null).catch(() => false)
}
