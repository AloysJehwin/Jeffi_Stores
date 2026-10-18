import { scopeSql, type ServiceScope } from '@jeffi/tenancy'
import { processingFeeInr, type MessagingChannel } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import { db, one } from './db.js'
import { poolsForTenant } from './pools.js'
import { callbacksEnabled, fetchStatus } from './providers/twilio.js'

const REASONS: Record<string, string> = {
  '63049': "Meta held back this marketing message — WhatsApp caps marketing messages to people who haven't chatted with the business recently",
  '63016': 'Outside the 24-hour window — only an approved template can be sent',
  '63024': 'Invalid WhatsApp recipient',
  '63003': 'This number is not on WhatsApp',
  '63032': "The recipient's WhatsApp can't receive this message",
  '21211': 'Invalid phone number',
  '21610': 'The recipient opted out (STOP)',
  '30003': 'Phone unreachable',
  '30005': 'Unknown or inactive number',
  '30006': 'Landline or unreachable carrier',
  '30007': 'Blocked by the carrier as spam',
}
export const deliveryReason = (code?: string, message?: string) =>
  code ? `${REASONS[code] ?? message ?? 'Not delivered'} (${code})` : message || 'Not delivered'

const TERMINAL: Record<string, 'delivered' | 'failed'> = { delivered: 'delivered', read: 'delivered', failed: 'failed', undelivered: 'failed' }

/** Records a provider status; a failure also flips the store campaign's log row so it stops saying "sent". */
export async function applyStatus(id: string, status: string, o: { code?: string; message?: string; payload?: unknown } = {}) {
  await db.query(`INSERT INTO message_events (message_id, event, payload) VALUES ($1,$2,$3)`, [id, status, o.payload ?? { status, code: o.code }])
  const next = TERMINAL[status]
  if (!next) {
    await db.query(`UPDATE messages SET updated_at=now() WHERE id=$1`, [id])
    return
  }
  const error = next === 'failed' ? deliveryReason(o.code, o.message) : null
  const m = await one<{ tenant_id: string; reference: string | null; channel: string; to_address: string; charged_inr: string; metadata: Record<string, unknown> | null }>(
    `UPDATE messages SET status=$2, error=COALESCE($3,error), updated_at=now() WHERE id=$1 AND status <> $2
     RETURNING tenant_id, reference, channel, to_address, charged_inr, metadata`, [id, next, error])
  // Nothing reached the recipient (e.g. Meta's marketing cap, 63049): keep the processing fee under P2
  // and refund the rest; media (if any) is fully refunded. wallet.trueUp is idempotent per externalRef,
  // so an unconditional media:${id} refund is a no-op when the row wasn't hosted (closes audit Gap 2).
  if (m && next === 'failed' && Number(m.charged_inr) > 0) {
    const internal = !!(m.metadata && (m.metadata as Record<string, unknown>).internal)
    const fee = processingFeeInr(m.channel as MessagingChannel, internal)
    await wallet.trueUp({ tenantId: m.tenant_id, amountInr: fee, externalRef: `pub:${id}`, note: `refund: ${m.channel} not delivered` })
    await wallet.trueUp({ tenantId: m.tenant_id, amountInr: 0, externalRef: `media:${id}`, note: 'refund: media for a non-delivered send' })
    await db.query(`UPDATE messages SET charged_inr=$2 WHERE id=$1`, [id, fee])
    if (fee > 0) console.log(`processing fee kept: ₹${fee.toFixed(2)} on ${id}`)
  }
  const campaignId = m?.reference?.match(/^messaging:([0-9a-f-]{36})$/)?.[1]
  if (!m || next !== 'failed' || !campaignId) return
  const { pool } = await poolsForTenant(m.tenant_id)
  await pool.query(
    `UPDATE email_campaign_logs SET status='failed', error=$4 WHERE campaign_id=$1 AND channel=$2 AND to_address=$3 AND status='sent'`,
    [campaignId, m.channel, m.to_address, error]).catch(() => {})
}

/** Dev has no public status callback: poll Twilio for recent sends, backing off as they age. */
export function startDeliverySync(log: (m: string) => void, scope: ServiceScope) {
  if (callbacksEnabled()) return
  const sweep = async () => {
    const w = scopeSql(scope, 'tenant_id', 1)
    const rows = await db.query<{ id: string; provider_ref: string }>(
      `SELECT id, provider_ref FROM messages
       WHERE provider='twilio' AND status='sent' AND provider_ref IS NOT NULL AND created_at > now() - interval '24 hours'
         AND updated_at < now() - greatest(interval '10 seconds', (now() - created_at) / 4) AND ${w.sql}
       ORDER BY created_at DESC LIMIT 50`, w.params)
    for (const r of rows.rows) {
      try {
        const s = await fetchStatus(r.provider_ref)
        await applyStatus(r.id, s.status, { code: s.code, message: s.message, payload: { polled: true, ...s } })
      } catch (e: any) {
        log(`delivery sync ${r.id}: ${e?.message}`)
      }
    }
  }
  setInterval(() => sweep().catch(e => log(`delivery sync: ${e?.message}`)), 60_000).unref()
  sweep().catch(e => log(`delivery sync: ${e?.message}`))
}
