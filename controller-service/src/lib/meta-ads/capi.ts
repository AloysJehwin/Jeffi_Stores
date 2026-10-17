import { createHash } from 'crypto'
import { queryMany } from '@/lib/shared/db'
import { withChannelLock, errorText, type RunResult } from '@/lib/channels/sync-run'
import { storePublicBaseUrl } from '@/lib/merchant/store-url'
import { MetaGraph, readMetaAdsConfig } from './client'

// Conversions API: a server-side Purchase for each paid order (cash on delivery once delivered),
// event_id = order id so Meta dedupes it against a browser pixel event with the same id. Meta only
// accepts events up to 7 days old. A buyer who refused advertising cookies is never sent; with no
// recorded choice only the Meta browser ids are sent, and hashed email and phone only with consent.

export const CAPI_WINDOW_DAYS = 7
const BATCH = 500

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

export function normEmail(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase()
  return s.includes('@') ? s : null
}

/** E.164 digits without '+'; a bare 10-digit Indian number gets 91. */
export function normPhone(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  return d.length >= 11 && d.length <= 15 ? d : null
}

export interface CapiOrder {
  id: string
  order_number: string
  total_amount: string | number
  created_at: string
  paid_at: string | null
  customer_email: string | null
  customer_phone: string | null
  ads_consent: boolean | null
  meta_click_ids: { fbp?: string; fbc?: string } | null
  items: { sku: string | null; quantity: number; price: number }[] | null
}

export function buildPurchaseEvent(
  o: CapiOrder,
  siteUrl: string
): { event: Record<string, unknown> | null; matched: string[] } {
  if (o.ads_consent === false) return { event: null, matched: [] }
  const user: Record<string, unknown> = {}
  const matched: string[] = []
  if (o.meta_click_ids?.fbp) {
    user.fbp = o.meta_click_ids.fbp
    matched.push('fbp')
  }
  if (o.meta_click_ids?.fbc) {
    user.fbc = o.meta_click_ids.fbc
    matched.push('fbc')
  }
  if (o.ads_consent === true) {
    const em = normEmail(o.customer_email)
    const ph = normPhone(o.customer_phone)
    if (em) {
      user.em = [sha256(em)]
      matched.push('em')
    }
    if (ph) {
      user.ph = [sha256(ph)]
      matched.push('ph')
    }
    user.country = [sha256('in')]
  }
  if (!matched.length) return { event: null, matched }
  const items = (o.items ?? []).filter(i => i.sku)
  return {
    matched,
    event: {
      event_name: 'Purchase',
      event_time: Math.floor(new Date(o.paid_at ?? o.created_at).getTime() / 1000),
      event_id: o.id,
      action_source: 'website',
      event_source_url: siteUrl,
      user_data: user,
      custom_data: {
        currency: 'INR',
        value: Math.round(Number(o.total_amount) * 100) / 100,
        order_id: o.order_number,
        content_type: 'product',
        content_ids: items.map(i => i.sku),
        contents: items.map(i => ({ id: i.sku, quantity: Number(i.quantity), item_price: Number(i.price) })),
        num_items: items.reduce((s, i) => s + Number(i.quantity), 0),
      },
    },
  }
}

export async function capiReady(): Promise<boolean> {
  const cfg = await readMetaAdsConfig()
  return !!(cfg?.pixel_id && (cfg.capi_token || cfg.access_token))
}

/** Sends Purchases for paid orders from the last 7 days that have not been sent yet. */
export async function sendCapiEvents(): Promise<RunResult> {
  const cfg = await readMetaAdsConfig()
  return withChannelLock('meta_ads', 'meta_capi', 'capi', async ({ db, step }) => {
    if (!cfg?.pixel_id) throw new Error('Set the Meta pixel id first.')
    const graph = new MetaGraph(cfg.capi_token || cfg.access_token)
    const site = await storePublicBaseUrl().catch(() => '')
    const orders = await queryMany<CapiOrder>(
      `SELECT o.id, o.order_number, o.total_amount, o.created_at,
              COALESCE(o.delivered_at, o.confirmed_at, o.created_at) AS paid_at,
              o.customer_email, o.customer_phone, o.ads_consent, o.meta_click_ids,
              (SELECT json_agg(json_build_object('sku', i.product_sku, 'quantity', i.quantity, 'price', i.unit_price)) FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o
       WHERE o.created_at > now() - make_interval(days => $1)
         AND o.source IS DISTINCT FROM 'amazon' AND o.status <> 'cancelled'
         AND ((o.payment_status = 'paid' AND o.payment_mode IS DISTINCT FROM 'cod') OR (o.payment_mode = 'cod' AND o.status = 'delivered'))
         AND NOT EXISTS (SELECT 1 FROM mads_capi_events e WHERE e.order_id = o.id AND e.event_name = 'Purchase' AND e.status IN ('sent', 'skipped'))
       ORDER BY o.created_at LIMIT 2000`,
      [CAPI_WINDOW_DAYS]
    )
    const record = (o: CapiOrder, status: string, matched: string[], error: string | null, trace: string | null) =>
      db.query(
        `INSERT INTO mads_capi_events (order_id, value, status, attempts, matched_keys, error, fbtrace_id, event_time, sent_at)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7, CASE WHEN $3 = 'sent' THEN now() END)
         ON CONFLICT (order_id, event_name) DO UPDATE SET status = EXCLUDED.status, attempts = mads_capi_events.attempts + 1,
           matched_keys = EXCLUDED.matched_keys, error = EXCLUDED.error, fbtrace_id = EXCLUDED.fbtrace_id, sent_at = EXCLUDED.sent_at`,
        [o.id, Number(o.total_amount), status, matched, error, trace, o.paid_at ?? o.created_at]
      )
    const built = orders.map(o => ({ o, ...buildPurchaseEvent(o, site) }))
    await step('skipped', async () => {
      let s = 0
      for (const b of built.filter(b => !b.event)) {
        await record(
          b.o,
          'skipped',
          [],
          b.o.ads_consent === false
            ? 'Buyer refused advertising cookies'
            : 'No Meta browser id and no consent for email or phone',
          null
        )
        s++
      }
      return s
    })
    const ready = built.filter(b => b.event)
    for (let i = 0; i < ready.length; i += BATCH) {
      const batch = ready.slice(i, i + BATCH)
      await step('sent', async () => {
        try {
          const res = await graph.post<any>(`${cfg.pixel_id}/events`, {
            data: batch.map(b => b.event),
            ...(process.env.META_CAPI_TEST_CODE ? { test_event_code: process.env.META_CAPI_TEST_CODE } : {}),
          })
          for (const b of batch) await record(b.o, 'sent', b.matched, null, res?.fbtrace_id ?? null)
          return batch.length
        } catch (e) {
          for (const b of batch) await record(b.o, 'failed', b.matched, errorText(e), null)
          throw e
        }
      })
    }
  })
}
