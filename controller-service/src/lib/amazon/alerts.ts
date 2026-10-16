import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { SUPPRESSED_SQL, priceInputs } from './console'
import { marginAt, marginFloor } from './repricer'

// Amazon alert rules, run after the pricing, fees and status jobs (and orders/stock jobs once
// they exist; those rules read empty tables until then).

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  suppressed: z.object({ enabled: z.boolean() }),
  buybox_lost: z.object({ enabled: z.boolean(), minOffers: num(1, 100) }),
  negative_margin: z.object({ enabled: z.boolean() }),
  below_floor: z.object({ enabled: z.boolean(), minMarginPct: num(0, 90) }),
  push_failed: z.object({ enabled: z.boolean() }),
  orders_stalled: z.object({ enabled: z.boolean(), hours: num(1, 72) }),
  stock_drift: z.object({ enabled: z.boolean(), units: num(1, 1000) }),
})
export type AmazonAlertConfig = z.infer<typeof schema>

export const AMAZON_DEFAULTS: AmazonAlertConfig = {
  suppressed: { enabled: true },
  buybox_lost: { enabled: true, minOffers: 2 },
  negative_margin: { enabled: true },
  below_floor: { enabled: true, minMarginPct: 5 },
  push_failed: { enabled: true },
  orders_stalled: { enabled: true, hours: 6 },
  stock_drift: { enabled: true, units: 2 },
}

export interface AmazonAlertSnapshot {
  suppressed: { sku: string; title: string | null }[]
  buyboxLost: { sku: string; title: string | null; ours: number | null; buybox: number | null; offers: number }[]
  margins: { sku: string; title: string | null; price: number; margin: number | null; floor: number | null }[]
  lastPush: { status: string; finishedAt: string | null } | null
  lastOrderImport: { status: string; finishedAt: string | null } | null
  stockDrift: { sku: string; ours: number; amazon: number }[]
}

export function evaluateAmazon(s: AmazonAlertSnapshot, cfg: AmazonAlertConfig, now = new Date()): Finding[] {
  const out: Finding[] = []
  if (cfg.suppressed.enabled && s.suppressed.length) {
    out.push({
      rule: 'suppressed',
      key: `suppressed:${s.suppressed.length}`,
      severity: 'warning',
      title: `${s.suppressed.length} Amazon listing${s.suppressed.length === 1 ? ' is' : 's are'} suppressed`,
      message: s.suppressed.slice(0, 3).map(x => x.title ?? x.sku).join(' · '),
    })
  }
  if (cfg.buybox_lost.enabled) {
    for (const b of s.buyboxLost) {
      if (b.offers < cfg.buybox_lost.minOffers) continue
      out.push({
        rule: 'buybox_lost',
        key: `buybox_lost:${b.sku}`,
        severity: 'warning',
        title: `Not winning the Buy Box on ${b.title ?? b.sku}`,
        message: `Your price ${b.ours ?? '-'} vs Buy Box ${b.buybox ?? '-'} (${b.offers} offers).`,
        entityType: 'amazon_listing',
        entityId: b.sku,
      })
    }
  }
  for (const m of s.margins) {
    if (cfg.negative_margin.enabled && m.margin != null && m.margin < 0) {
      out.push({
        rule: 'negative_margin',
        key: `negative_margin:${m.sku}`,
        severity: 'critical',
        title: `Selling ${m.title ?? m.sku} at a loss on Amazon`,
        message: `About ${Math.abs(m.margin).toFixed(0)} lost per unit after Amazon fees and cost.`,
        entityType: 'amazon_listing',
        entityId: m.sku,
      })
    } else if (cfg.below_floor.enabled && m.floor != null && m.price < m.floor) {
      out.push({
        rule: 'below_floor',
        key: `below_floor:${m.sku}`,
        severity: 'warning',
        title: `${m.title ?? m.sku} is priced below your margin floor`,
        message: `Price ${m.price} vs floor ${m.floor} for a ${cfg.below_floor.minMarginPct}% margin.`,
        entityType: 'amazon_listing',
        entityId: m.sku,
      })
    }
  }
  if (cfg.push_failed.enabled && s.lastPush && s.lastPush.status !== 'success' && s.lastPush.status !== 'running') {
    out.push({
      rule: 'push_failed',
      key: `push_failed:${s.lastPush.finishedAt ?? 'last'}`,
      severity: 'warning',
      title: 'The last Amazon listing push had errors',
      message: 'Open Listings to see the grouped errors.',
    })
  }
  if (cfg.orders_stalled.enabled && s.lastOrderImport?.finishedAt) {
    const age = (now.getTime() - new Date(s.lastOrderImport.finishedAt).getTime()) / 3_600_000
    if (age > cfg.orders_stalled.hours || s.lastOrderImport.status === 'error') {
      out.push({
        rule: 'orders_stalled',
        key: 'orders_stalled',
        severity: 'critical',
        title: 'Amazon order import has stopped',
        message: `The last successful import was ${Math.round(age)} hours ago. New Amazon orders are not reaching Orders.`,
      })
    }
  }
  if (cfg.stock_drift.enabled) {
    const drift = s.stockDrift.filter(d => Math.abs(d.ours - d.amazon) >= cfg.stock_drift.units)
    if (drift.length) {
      out.push({
        rule: 'stock_drift',
        key: `stock_drift:${drift.length}`,
        severity: 'warning',
        title: `${drift.length} SKU${drift.length === 1 ? '' : 's'} show different stock on Amazon`,
        message: drift
          .slice(0, 3)
          .map(d => `${d.sku}: ours ${d.ours}, Amazon ${d.amazon}`)
          .join(' · '),
      })
    }
  }
  return out
}

async function loadSnapshot(cfg: AmazonAlertConfig): Promise<AmazonAlertSnapshot> {
  const [suppressed, lost, inputs, lastPush, lastOrderImport, drift] = await Promise.all([
    queryMany<any>(`SELECT sku, title FROM amazon_listing_status WHERE ${SUPPRESSED_SQL} LIMIT 200`).catch(() => []),
    queryMany<any>(
      `SELECT o.sku, l.title, o.our_price, o.buybox_price, o.offer_count FROM amazon_offers o LEFT JOIN amazon_listing_status l ON l.sku = o.sku
       WHERE o.buybox_is_ours = false AND o.buybox_price IS NOT NULL ORDER BY o.offer_count DESC LIMIT 50`
    ).catch(() => []),
    priceInputs().catch(() => []),
    queryOne<any>(`SELECT status, finished_at FROM amazon_sync_log ORDER BY started_at DESC LIMIT 1`).catch(() => null),
    queryOne<any>(`SELECT status, finished_at FROM channel_sync_log WHERE channel = 'amazon' AND kind = 'orders' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`).catch(() => null),
    queryMany<any>(`SELECT sku, our_available, amazon_quantity FROM amazon_inventory_state WHERE amazon_quantity IS NOT NULL AND our_available IS NOT NULL`).catch(() => []),
  ])
  return {
    suppressed,
    buyboxLost: lost.map((b: any) => ({ sku: b.sku, title: b.title, ours: b.our_price == null ? null : Number(b.our_price), buybox: Number(b.buybox_price), offers: Number(b.offer_count) })),
    margins: inputs.map(i => ({ sku: i.sku, title: i.title, price: i.price, margin: marginAt(i.price, i), floor: marginFloor(i, cfg.below_floor.minMarginPct) })),
    lastPush: lastPush ? { status: lastPush.status, finishedAt: lastPush.finished_at } : null,
    lastOrderImport: lastOrderImport ? { status: lastOrderImport.status, finishedAt: lastOrderImport.finished_at } : null,
    stockDrift: drift.map((d: any) => ({ sku: d.sku, ours: Number(d.our_available), amazon: Number(d.amazon_quantity) })),
  }
}

export const AMAZON_RULES: RuleSet<AmazonAlertConfig, AmazonAlertSnapshot> = {
  channel: 'amazon',
  schema: schema as any,
  defaults: AMAZON_DEFAULTS,
  labels: {
    suppressed: 'Suppressed listings',
    buybox_lost: 'Buy Box not won',
    negative_margin: 'Selling at a loss after fees',
    below_floor: 'Priced below the margin floor',
    push_failed: 'Listing push failed',
    orders_stalled: 'Order import stopped',
    stock_drift: 'Stock on Amazon differs from ours',
  },
  loadSnapshot: cfg => loadSnapshot(cfg),
  evaluate: (s, cfg) => evaluateAmazon(s, cfg),
}
