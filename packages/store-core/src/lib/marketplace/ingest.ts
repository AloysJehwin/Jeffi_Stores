import { query, queryMany, queryOne } from '@/lib/shared/db'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import { AdapterUnavailableError, eventKey, type MarketplaceAdapter, type PushEvent } from './adapter'
import { mockAdapter } from './mock'
import { afterOrderEvent } from './order-events'
import { getAdapter } from './registry'
import { upsertMarketplaceOrder } from './upsert'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Pushed events are stored first (idempotent on event_key), then processed. A failed event stays
// pending with an exponential backoff and is failed after MAX_ATTEMPTS; the sync cron retries what
// the push request didn't finish. Claiming an event leases it for a few minutes, so a crashed run
// is picked up again instead of sticking.

export { eventKey }

export type EventSource = 'push' | 'mock' | 'poll' | 'manual'
export const MAX_ATTEMPTS = 8
const PARKED_MS = 6 * 3600_000

/** Wait before the next attempt after `attempts` tries: 30 s doubling, at most 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(PARKED_MS, 30_000 * 2 ** Math.max(0, attempts - 1))
}

const iso = (v: unknown) => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Stores events; replays (same channel and key) are skipped. Throws when the write fails. */
export async function recordEvents(
  channel: MarketplaceChannel,
  events: PushEvent[],
  source: EventSource = 'push'
): Promise<{ ids: string[]; duplicates: number }> {
  const seen = new Set<string>()
  const rows = []
  for (const e of events) {
    const raw = String(e.key ?? '').trim()
    const key = raw && raw.length <= 200 ? raw : eventKey(channel, raw, JSON.stringify(e.payload ?? null))
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ key, type: e.type ? String(e.type).slice(0, 100) : null, order_id: e.externalOrderId ?? null, occurred_at: iso(e.occurredAt), payload: e.payload ?? {} })
  }
  if (!rows.length) return { ids: [], duplicates: events.length }
  const res = await query<{ id: string }>(
    `INSERT INTO marketplace_webhook_events (channel, event_key, event_type, external_order_id, occurred_at, payload, source)
     SELECT $1, e.key, e.type, e.order_id, e.occurred_at, COALESCE(e.payload, '{}'::jsonb), $3
       FROM jsonb_to_recordset($2::jsonb) AS e(key text, type text, order_id text, occurred_at timestamptz, payload jsonb)
     ON CONFLICT (channel, event_key) DO NOTHING
     RETURNING id`,
    [channel, JSON.stringify(rows), source]
  )
  const ids = res.rows.map(r => r.id)
  return { ids, duplicates: events.length - ids.length }
}

interface EventRow {
  id: string
  channel: MarketplaceChannel
  event_key: string
  event_type: string | null
  external_order_id: string | null
  occurred_at: string | Date | null
  payload: unknown
  source: EventSource
  attempts: number
}

export interface ProcessResult {
  outcome: 'done' | 'ignored' | 'retry' | 'failed' | 'skipped'
  error?: string
  orderNumber?: string
}

async function adapterFor(ev: EventRow): Promise<MarketplaceAdapter> {
  if (ev.source === 'mock') return mockAdapter(ev.channel)
  const creds = await resolveMarketplaceCreds(ev.channel)
  if (!creds) throw new Error(`${CHANNEL_LABEL[ev.channel]} is not connected.`)
  return getAdapter(ev.channel, creds)
}

/** Processes one pending, due event. 'skipped' when it is not due, already handled, or leased. */
export async function processEvent(id: string): Promise<ProcessResult> {
  const ev = await queryOne<EventRow>(
    `UPDATE marketplace_webhook_events SET attempts = attempts + 1, last_attempt_at = now(), next_attempt_at = now() + interval '5 minutes'
      WHERE id = $1 AND status = 'pending' AND next_attempt_at <= now()
      RETURNING id, channel, event_key, event_type, external_order_id, occurred_at, payload, source, attempts`,
    [id]
  )
  if (!ev) return { outcome: 'skipped' }
  try {
    const adapter = await adapterFor(ev)
    // A body stored whole because the adapter couldn't split it then: split it now and run its events.
    if (ev.event_type === 'raw') {
      const { ids } = await recordEvents(ev.channel, adapter.parsePush(ev.payload, new Headers()), ev.source)
      await query(`UPDATE marketplace_webhook_events SET status = 'done', processed_at = now(), last_error = NULL WHERE id = $1`, [ev.id])
      await processEvents(ids)
      return { outcome: 'done' }
    }
    const order = adapter.normalize({ key: ev.event_key, type: ev.event_type ?? '', externalOrderId: ev.external_order_id, occurredAt: iso(ev.occurred_at), payload: ev.payload })
    if (!order) {
      await query(`UPDATE marketplace_webhook_events SET status = 'ignored', processed_at = now(), last_error = NULL WHERE id = $1`, [ev.id])
      return { outcome: 'ignored' }
    }
    if (order.channel !== ev.channel) throw new Error(`Event for ${order.channel} recorded under ${ev.channel}`)
    const r = await upsertMarketplaceOrder(order)
    await afterOrderEvent(order, r)
    await query(`UPDATE marketplace_webhook_events SET status = 'done', processed_at = now(), last_error = NULL, marketplace_order_id = $2 WHERE id = $1`, [
      ev.id,
      r.marketplaceOrderId,
    ])
    return { outcome: 'done', orderNumber: r.orderNumber }
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 1000)
    // The adapter can't read it yet (unmapped push or missing API): keep it rather than burning its attempts.
    const parked = e instanceof AdapterUnavailableError
    const failed = !parked && ev.attempts >= MAX_ATTEMPTS
    await query(
      `UPDATE marketplace_webhook_events SET status = $2, last_error = $3, next_attempt_at = now() + ($4::bigint * interval '1 millisecond') WHERE id = $1`,
      [ev.id, failed ? 'failed' : 'pending', error, parked ? PARKED_MS : backoffMs(ev.attempts)]
    )
    return { outcome: failed ? 'failed' : 'retry', error }
  }
}

/** Processes events in order until the budget runs out; the rest stay pending for the cron. */
export async function processEvents(ids: string[], budgetMs = 5000): Promise<{ processed: number; pending: number }> {
  const deadline = Date.now() + budgetMs
  let processed = 0
  for (const id of ids) {
    if (Date.now() >= deadline) break
    await processEvent(id).catch(() => null)
    processed++
  }
  return { processed, pending: ids.length - processed }
}

/** The sync cron's pass: due pending events, oldest first, within a time budget. */
export async function retryPendingEvents(
  channel: MarketplaceChannel,
  opts: { limit?: number; budgetMs?: number } = {}
): Promise<{ processed: number; done: number; failed: number; retry: number; remaining: number }> {
  const rows = await queryMany<{ id: string }>(
    `SELECT id FROM marketplace_webhook_events WHERE channel = $1 AND status = 'pending' AND next_attempt_at <= now() ORDER BY received_at LIMIT $2`,
    [channel, opts.limit ?? 100]
  )
  const deadline = Date.now() + (opts.budgetMs ?? 50_000)
  const tally = { processed: 0, done: 0, failed: 0, retry: 0, remaining: 0 }
  for (const { id } of rows) {
    if (Date.now() >= deadline) break
    const r = await processEvent(id)
    tally.processed++
    if (r.outcome === 'done' || r.outcome === 'ignored') tally.done++
    else if (r.outcome === 'failed') tally.failed++
    else if (r.outcome === 'retry') tally.retry++
  }
  tally.remaining = rows.length - tally.processed
  return tally
}
