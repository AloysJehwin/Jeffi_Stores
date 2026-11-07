import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { UNSETTLED_AFTER_DAYS } from './settlements'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Myntra and AJIO alert rules on the channels alert engine, run by the sync cron.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  accept_sla: z.object({ enabled: z.boolean(), warnMinutes: num(0, 720) }),
  events_stuck: z.object({ enabled: z.boolean(), minutes: num(5, 1440) }),
  stock_problem: z.object({ enabled: z.boolean() }),
  push_errors: z.object({ enabled: z.boolean() }),
  rejected_listings: z.object({ enabled: z.boolean() }),
  no_push: z.object({ enabled: z.boolean(), hours: num(1, 720) }),
  unsettled: z.object({ enabled: z.boolean(), days: num(1, 120) }),
})
export type MarketplaceAlertConfig = z.infer<typeof schema>

export const MARKETPLACE_ALERT_DEFAULTS: MarketplaceAlertConfig = {
  accept_sla: { enabled: true, warnMinutes: 60 },
  events_stuck: { enabled: true, minutes: 30 },
  stock_problem: { enabled: true },
  push_errors: { enabled: true },
  rejected_listings: { enabled: true },
  no_push: { enabled: true, hours: 48 },
  unsettled: { enabled: true, days: UNSETTLED_AFTER_DAYS },
}

export interface MarketplaceAlertSnapshot {
  acceptMissed: string[]
  acceptDueSoon: string[]
  eventsPending: number
  eventsFailed: number
  oldestPendingMinutes: number | null
  stockProblems: { externalOrderId: string; state: string }[]
  pushErrors: { sku: string; error: string }[]
  rejected: { sku: string; title: string }[]
  mappedListings: number
  lastPushAt: string | null
  firstMappedAt: string | null
  unsettled: { count: number; value: number }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sample = (list: string[]) => list.slice(0, 3).join(' · ') + (list.length > 3 ? ` +${list.length - 3} more` : '')

export function evaluateMarketplace(channel: MarketplaceChannel, s: MarketplaceAlertSnapshot, cfg: MarketplaceAlertConfig, now = new Date()): Finding[] {
  const name = CHANNEL_LABEL[channel]
  const out: Finding[] = []
  if (cfg.accept_sla.enabled && s.acceptMissed.length) {
    out.push({
      rule: 'accept_sla',
      key: `accept_sla:missed:${s.acceptMissed.length}`,
      severity: 'critical',
      title: `${plural(s.acceptMissed.length, 'order')} missed the ${name} accept-by time`,
      message: `${sample(s.acceptMissed)}. ${name} may cancel these and count them against you.`,
    })
  }
  if (cfg.accept_sla.enabled && s.acceptDueSoon.length) {
    out.push({
      rule: 'accept_sla',
      key: `accept_sla:soon:${s.acceptDueSoon.length}`,
      severity: 'warning',
      title: `${plural(s.acceptDueSoon.length, 'order')} to accept on ${name} within ${cfg.accept_sla.warnMinutes} minutes`,
      message: sample(s.acceptDueSoon),
    })
  }
  if (cfg.events_stuck.enabled) {
    if (s.eventsFailed) {
      out.push({
        rule: 'events_stuck',
        key: `events_stuck:failed:${s.eventsFailed}`,
        severity: 'critical',
        title: `${plural(s.eventsFailed, `${name} order update`)} could not be processed`,
        message: 'They were retried and still failed. Orders may be missing or out of date.',
      })
    }
    if (s.eventsPending && (s.oldestPendingMinutes ?? 0) >= cfg.events_stuck.minutes) {
      out.push({
        rule: 'events_stuck',
        key: 'events_stuck:pending',
        severity: 'warning',
        title: `${plural(s.eventsPending, `${name} order update`)} waiting to be processed`,
        message: `The oldest arrived ${Math.round(s.oldestPendingMinutes!)} minutes ago; they are being retried.`,
      })
    }
  }
  if (cfg.stock_problem.enabled && s.stockProblems.length) {
    const unmatched = s.stockProblems.filter(p => p.state === 'unmatched').length
    out.push({
      rule: 'stock_problem',
      key: `stock_problem:${s.stockProblems.length}`,
      severity: 'warning',
      title: `${plural(s.stockProblems.length, `${name} order`)} did not move stock`,
      message: `${unmatched ? `${unmatched} had SKUs not in your catalogue (map them on Listings). ` : ''}${s.stockProblems.length - unmatched ? `${s.stockProblems.length - unmatched} found too little stock. ` : ''}${sample(s.stockProblems.map(p => p.externalOrderId))}`,
    })
  }
  if (cfg.push_errors.enabled && s.pushErrors.length) {
    out.push({
      rule: 'push_errors',
      key: `push_errors:${s.pushErrors.length}`,
      severity: 'warning',
      title: `${name} refused the stock for ${plural(s.pushErrors.length, 'SKU')}`,
      message: `${s.pushErrors[0].sku}: ${s.pushErrors[0].error}`.slice(0, 300),
    })
  }
  if (cfg.rejected_listings.enabled && s.rejected.length) {
    out.push({
      rule: 'rejected_listings',
      key: `rejected_listings:${s.rejected.length}`,
      severity: 'warning',
      title: `${name} rejected ${plural(s.rejected.length, 'listing')}`,
      message: `${sample(s.rejected.map(r => r.title || r.sku))}. Open Listings for the reasons.`,
    })
  }
  if (cfg.no_push.enabled && s.mappedListings) {
    const since = s.lastPushAt ?? s.firstMappedAt
    const hours = since ? (now.getTime() - new Date(since).getTime()) / 3_600_000 : 0
    if (since && hours >= cfg.no_push.hours) {
      out.push({
        rule: 'no_push',
        key: 'no_push',
        severity: 'warning',
        title: s.lastPushAt ? `No stock update reached ${name} for ${Math.round(hours)} hours` : `Stock has never been sent to ${name}`,
        message: `${plural(s.mappedListings, 'mapped listing')} may be showing old stock. Check Inventory and Runs.`,
      })
    }
  }
  if (cfg.unsettled.enabled && s.unsettled.count) {
    out.push({
      rule: 'unsettled',
      key: `unsettled:${s.unsettled.count}`,
      severity: 'warning',
      title: `${plural(s.unsettled.count, `delivered ${name} order`)} not settled after ${cfg.unsettled.days} days`,
      message: `About ₹${Math.round(s.unsettled.value).toLocaleString('en-IN')} outstanding. Import the latest settlement report, or raise it with ${name}.`,
    })
  }
  return out
}

async function loadSnapshot(channel: MarketplaceChannel, cfg: MarketplaceAlertConfig): Promise<MarketplaceAlertSnapshot> {
  const [sla, events, stock, pushErrors, rejected, listings, unsettled] = await Promise.all([
    queryMany<{ external_order_id: string; missed: boolean }>(
      `SELECT external_order_id, accept_by < now() AS missed FROM marketplace_orders
        WHERE channel = $1 AND status = 'created' AND accept_by IS NOT NULL AND accept_by < now() + ($2::int * interval '1 minute')
        ORDER BY accept_by LIMIT 200`,
      [channel, cfg.accept_sla.warnMinutes]
    ).catch(() => []),
    queryOne<any>(
      `SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'failed' AND received_at > now() - interval '7 days') AS failed,
              EXTRACT(EPOCH FROM now() - MIN(received_at) FILTER (WHERE status = 'pending')) / 60 AS oldest
         FROM marketplace_webhook_events WHERE channel = $1 AND status IN ('pending', 'failed')`,
      [channel]
    ).catch(() => null),
    queryMany<any>(
      `SELECT external_order_id, stock_state FROM marketplace_orders
        WHERE channel = $1 AND stock_state IN ('short', 'unmatched') AND status NOT IN ('cancelled', 'rejected', 'returned') LIMIT 200`,
      [channel]
    ).catch(() => []),
    queryMany<any>(
      `SELECT s.marketplace_sku AS sku, s.push_error AS error FROM marketplace_inventory_state s
         JOIN marketplace_listings l ON l.channel = s.channel AND l.marketplace_sku = s.marketplace_sku
        WHERE s.channel = $1 AND s.push_error IS NOT NULL ORDER BY s.updated_at DESC LIMIT 200`,
      [channel]
    ).catch(() => []),
    queryMany<any>(
      `SELECT COALESCE(l.marketplace_sku, l.our_sku, '') AS sku, concat_ws(' · ', p.name, v.variant_name, sv.sub_variant_name) AS title
         FROM marketplace_listings l JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id LEFT JOIN product_sub_variants sv ON sv.id = l.sub_variant_id
        WHERE l.channel = $1 AND l.status = 'rejected' LIMIT 200`,
      [channel]
    ).catch(() => []),
    queryOne<any>(
      `SELECT count(*) AS mapped, MIN(l.created_at) AS first_mapped,
              (SELECT MAX(pushed_at) FROM marketplace_inventory_state WHERE channel = $1) AS last_push
         FROM marketplace_listings l WHERE l.channel = $1 AND l.marketplace_sku IS NOT NULL AND l.status IN ('mapped', 'submitted', 'live')`,
      [channel]
    ).catch(() => null),
    queryOne<any>(
      `SELECT count(*) AS count, COALESCE(SUM(mo.order_total), 0) AS value
         FROM marketplace_orders mo LEFT JOIN orders o ON o.id = mo.order_id
        WHERE mo.channel = $1 AND mo.status = 'delivered'
          AND COALESCE(o.delivered_at, mo.event_at, mo.updated_at) < now() - ($2::int * interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM marketplace_settlement_lines sl WHERE sl.marketplace_order_id = mo.id)`,
      [channel, cfg.unsettled.days]
    ).catch(() => null),
  ])
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return {
    acceptMissed: sla.filter(r => r.missed).map(r => r.external_order_id),
    acceptDueSoon: sla.filter(r => !r.missed).map(r => r.external_order_id),
    eventsPending: Number(events?.pending ?? 0),
    eventsFailed: Number(events?.failed ?? 0),
    oldestPendingMinutes: events?.oldest == null ? null : Number(events.oldest),
    stockProblems: stock.map((r: any) => ({ externalOrderId: r.external_order_id, state: r.stock_state })),
    pushErrors: pushErrors.map((r: any) => ({ sku: r.sku, error: String(r.error) })),
    rejected: rejected.map((r: any) => ({ sku: r.sku, title: r.title })),
    mappedListings: Number(listings?.mapped ?? 0),
    lastPushAt: iso(listings?.last_push),
    firstMappedAt: iso(listings?.first_mapped),
    unsettled: { count: Number(unsettled?.count ?? 0), value: Number(unsettled?.value ?? 0) },
  }
}

const LABELS: Record<keyof MarketplaceAlertConfig, string> = {
  accept_sla: 'Orders near or past the accept-by time',
  events_stuck: 'Order updates not processed',
  stock_problem: 'Orders that could not move stock (short or unmatched SKU)',
  push_errors: 'Stock refused by the marketplace',
  rejected_listings: 'Rejected listings',
  no_push: 'No stock update for a while',
  unsettled: 'Delivered orders not settled',
}

function rulesFor(channel: MarketplaceChannel): RuleSet<MarketplaceAlertConfig, MarketplaceAlertSnapshot> {
  return {
    channel,
    schema: schema as any,
    defaults: MARKETPLACE_ALERT_DEFAULTS,
    labels: LABELS,
    loadSnapshot: cfg => loadSnapshot(channel, cfg),
    evaluate: (s, cfg) => evaluateMarketplace(channel, s, cfg),
  }
}

export const MYNTRA_RULES = rulesFor('myntra')
export const AJIO_RULES = rulesFor('ajio')
export const marketplaceRules = (channel: MarketplaceChannel) => (channel === 'myntra' ? MYNTRA_RULES : AJIO_RULES)
