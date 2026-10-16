import { queryMany, queryOne } from '@/lib/shared/db'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { chunk } from '@/lib/channels/ratelimit'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import type { ChangeActor } from '@/lib/channels/types'
import { AMAZON_PUSH_DISABLED } from './client'
import { getFeeEstimates, getItemOffersBatch, patchPrice, submissionProblems } from './pricing-api'
import { marginAt, marginFloor, propose, ruleFor, type PriceInputs, type Proposal, type RepricerRule } from './repricer'

// Amazon console: hourly offers (Buy Box) refresh with the opt-in auto repricer, daily fee
// estimates, and the read side of the console tabs.

const PRICING_PAUSE_MS = 2200 // getItemOffersBatch allows about one call every two seconds
const MAX_AUTO_CHANGES = 50
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface ListingRow {
  sku: string
  asin: string | null
  title: string | null
  price: string | null
  product_type: string | null
  fba: boolean
}

async function listings(): Promise<ListingRow[]> {
  return queryMany<ListingRow>(
    `SELECT sku, asin, title, price, summaries->0->>'productType' AS product_type,
            COALESCE((summaries->0->>'fulfillmentChannel') ILIKE '%AMAZON%', false) AS fba
     FROM amazon_listing_status`
  )
}

interface CatalogCost {
  sku: string
  price: number
  ex_ratio: number
  cost: number | null
}

async function catalogCosts(): Promise<Map<string, CatalogCost>> {
  const rows = await queryMany<any>(
    `SELECT COALESCE(v.sku, p.sku) AS sku, COALESCE(v.price, p.base_price) AS price,
            COALESCE(v.price_ex_gst, p.price_ex_gst) AS price_ex_gst, COALESCE(v.cost_price, p.cost_price) AS cost
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id WHERE COALESCE(v.sku, p.sku) IS NOT NULL`
  )
  return new Map(
    rows.map(r => {
      const price = Number(r.price ?? 0)
      const ex = r.price_ex_gst == null ? null : Number(r.price_ex_gst)
      return [r.sku, { sku: r.sku, price, ex_ratio: ex && price ? ex / price : 1, cost: r.cost == null ? null : Number(r.cost) }]
    })
  )
}

export async function loadRules(): Promise<RepricerRule[]> {
  const rows = await queryMany<any>(`SELECT * FROM amazon_repricer_rules ORDER BY sku NULLS FIRST`).catch(() => [])
  return rows.map(r => ({
    id: String(r.id),
    sku: r.sku,
    strategy: r.strategy,
    beatBy: Number(r.beat_by),
    minPrice: r.min_price == null ? null : Number(r.min_price),
    maxPrice: r.max_price == null ? null : Number(r.max_price),
    minMarginPct: Number(r.min_margin_pct),
    autoApply: !!r.auto_apply,
    enabled: !!r.enabled,
  }))
}

/** Everything the repricer needs per SKU, from the offers and fee snapshots and our catalogue. */
export async function priceInputs(): Promise<(PriceInputs & { productType: string | null; title: string | null })[]> {
  const [rows, costs] = await Promise.all([
    queryMany<any>(
      `SELECT l.sku, l.title, l.summaries->0->>'productType' AS product_type, o.our_price, o.buybox_price, o.buybox_is_ours,
              f.price AS fee_price, f.referral_fee, f.total_fees
       FROM amazon_listing_status l JOIN amazon_offers o ON o.sku = l.sku LEFT JOIN amazon_fee_estimates f ON f.sku = l.sku`
    ),
    catalogCosts(),
  ])
  return rows
    .filter(r => r.our_price != null)
    .map(r => {
      const c = costs.get(r.sku)
      const feePrice = Number(r.fee_price ?? 0)
      const referralRate = feePrice ? Number(r.referral_fee ?? 0) / feePrice : 0
      return {
        sku: r.sku,
        title: r.title,
        productType: r.product_type,
        price: Number(r.our_price),
        exRatio: c?.ex_ratio ?? 1,
        cost: c?.cost ?? null,
        buyboxPrice: r.buybox_price == null ? null : Number(r.buybox_price),
        buyboxIsOurs: r.buybox_is_ours,
        referralRate,
        fixedFees: Math.max(0, Number(r.total_fees ?? 0) - Number(r.referral_fee ?? 0)),
      }
    })
}

export async function repricerProposals(): Promise<Proposal[]> {
  const [inputs, rules] = await Promise.all([priceInputs(), loadRules()])
  return inputs.flatMap(i => {
    const rule = ruleFor(rules, i.sku)
    const p = rule ? propose(i, rule) : null
    return p ? [p] : []
  })
}

const systemActor: ChangeActor = { adminId: null, email: 'repricer' }

/** Changes one SKU's Amazon price: Amazon validates first (nothing sent on problems), then the
 * change is applied and logged. Refuses prices below the margin floor of the default rule. */
export async function changeAmazonPrice(sku: string, price: number, actor: ChangeActor, preview: boolean, opts: { allowBelowFloor?: boolean } = {}): Promise<ChangeOutcome<unknown>> {
  const input = (await priceInputs()).find(i => i.sku === sku)
  const listing = await queryOne<{ product_type: string | null; title: string | null }>(
    `SELECT summaries->0->>'productType' AS product_type, title FROM amazon_listing_status WHERE sku = $1`,
    [sku]
  )
  const rule = ruleFor(await loadRules(), sku)
  const floor = input ? marginFloor(input, rule?.minMarginPct ?? 0) : null
  return runChange(
    {
      channel: 'amazon',
      action: 'price.change',
      entityType: 'listing',
      entityId: sku,
      summary: `Changed the Amazon price of ${listing?.title ?? sku} to ${price.toFixed(2)}`,
      before: input ? { price: input.price, buybox: input.buyboxPrice, marginPerUnit: marginAt(input.price, input) } : null,
      after: input ? { price, buybox: input.buyboxPrice, marginPerUnit: marginAt(price, input), floor } : { price },
      validate: async () => {
        if (AMAZON_PUSH_DISABLED) return ['Pushing to Amazon is turned off in this environment (AMAZON_PUSH_DISABLED).']
        if (!listing?.product_type) return ['This SKU is not listed on Amazon yet (refresh listing status first).']
        if (floor != null && price < floor && !opts.allowBelowFloor) return [`That is below your floor of ${floor} (cost, Amazon fees and minimum margin).`]
        if (input && Math.abs(price - input.price) / input.price > 0.5) return ['That is more than a 50% change; check the price.']
        return submissionProblems(await patchPrice(sku, listing.product_type, price, true))
      },
      apply: async () => {
        const res = await patchPrice(sku, listing!.product_type!, price, false)
        const problems = submissionProblems(res)
        if (problems.length) throw new Error(problems.join('; '))
        await queryOne(`UPDATE amazon_offers SET our_price = $2 WHERE sku = $1 RETURNING sku`, [sku, price])
        return res
      },
    },
    actor,
    preview
  )
}

export async function refreshOffers(opts: { autoReprice?: boolean } = {}): Promise<RunResult> {
  return withChannelLock('amazon', 'amazon_pricing', 'pricing', async ({ db, step }) => {
    const rows = (await listings()).filter(l => l.asin)
    const skuByAsin = new Map<string, string[]>()
    for (const l of rows) skuByAsin.set(l.asin!, [...(skuByAsin.get(l.asin!) ?? []), l.sku])
    const batches = chunk([...skuByAsin.keys()], 20)
    for (let b = 0; b < batches.length; b++) {
      await step('offers', async () => {
        const snaps = await getItemOffersBatch(batches[b])
        for (const s of snaps) {
          for (const sku of skuByAsin.get(s.asin) ?? []) {
            await db.query(
              `INSERT INTO amazon_offers (sku, asin, our_price, buybox_price, buybox_is_ours, buybox_fba, lowest_price, lowest_fba_price, offer_count, buybox_eligible, refreshed_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
               ON CONFLICT (sku) DO UPDATE SET asin=EXCLUDED.asin, our_price=COALESCE(EXCLUDED.our_price, amazon_offers.our_price), buybox_price=EXCLUDED.buybox_price,
                 buybox_is_ours=EXCLUDED.buybox_is_ours, buybox_fba=EXCLUDED.buybox_fba, lowest_price=EXCLUDED.lowest_price,
                 lowest_fba_price=EXCLUDED.lowest_fba_price, offer_count=EXCLUDED.offer_count, buybox_eligible=EXCLUDED.buybox_eligible, refreshed_at=now()`,
              [sku, s.asin, s.ourPrice, s.buyboxPrice, s.buyboxIsOurs, s.buyboxFba, s.lowestPrice, s.lowestFbaPrice, s.offerCount, s.buyboxEligible]
            )
          }
        }
        return snaps.length
      })
      if (b < batches.length - 1) await sleep(PRICING_PAUSE_MS)
    }
    if (opts.autoReprice) {
      await step('repriced', async () => {
        const auto = (await repricerProposals()).filter(p => p.autoApply).slice(0, MAX_AUTO_CHANGES)
        let n = 0
        for (const p of auto) {
          const out = await changeAmazonPrice(p.sku, p.target, systemActor, false)
          if (out.ok) n++
        }
        return n
      })
    }
  })
}

export async function refreshFees(): Promise<RunResult> {
  return withChannelLock('amazon', 'amazon_fees', 'fees', async ({ db, step }) => {
    const rows = (await listings()).filter(l => l.price != null && Number(l.price) > 0)
    for (const batch of chunk(rows, 20)) {
      await step('fees', async () => {
        const est = await getFeeEstimates(batch.map(r => ({ sku: r.sku, price: Number(r.price), fba: r.fba })))
        for (const e of est) {
          await db.query(
            `INSERT INTO amazon_fee_estimates (sku, price, referral_fee, closing_fee, fulfillment_fee, other_fees, total_fees, gst_on_fees, fba, details, refreshed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
             ON CONFLICT (sku) DO UPDATE SET price=EXCLUDED.price, referral_fee=EXCLUDED.referral_fee, closing_fee=EXCLUDED.closing_fee,
               fulfillment_fee=EXCLUDED.fulfillment_fee, other_fees=EXCLUDED.other_fees, total_fees=EXCLUDED.total_fees,
               gst_on_fees=EXCLUDED.gst_on_fees, fba=EXCLUDED.fba, details=EXCLUDED.details, refreshed_at=now()`,
            [e.sku, e.price, e.referral, e.closing, e.fulfillment, e.other, e.total, e.gstOnFees, batch.find(b => b.sku === e.sku)?.fba ?? false, JSON.stringify(e.details)]
          )
        }
        return est.length
      })
    }
  })
}

// ---- Console tabs ----

export const AMAZON_TABS = ['overview', 'listings', 'suppressed', 'buybox', 'fees', 'repricer', 'alerts', 'changes', 'runs'] as const
export type AmazonTab = (typeof AMAZON_TABS)[number]

/** Suppressed: Amazon reports an error, or the listing is not discoverable (not shown in search). */
export const SUPPRESSED_SQL = `(issues @> '[{"severity":"ERROR"}]'::jsonb OR NOT (summaries->0->'status' ? 'DISCOVERABLE'))`

export async function loadAmazonOverview() {
  const [counts, buybox, margins, last] = await Promise.all([
    queryOne<any>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE status = 'approved') AS approved, count(*) FILTER (WHERE ${SUPPRESSED_SQL}) AS suppressed
       FROM amazon_listing_status`
    ),
    queryOne<any>(
      `SELECT count(*) AS priced, count(*) FILTER (WHERE buybox_is_ours) AS ours, count(*) FILTER (WHERE buybox_is_ours = false) AS lost,
              max(refreshed_at) AS refreshed_at FROM amazon_offers`
    ),
    priceInputs(),
    queryOne<any>(`SELECT status, synced, started_at, finished_at FROM amazon_sync_log ORDER BY started_at DESC LIMIT 1`).catch(() => null),
  ])
  const m = margins.map(i => marginAt(i.price, i)).filter((v): v is number => v != null)
  return {
    listings: { total: Number(counts?.total ?? 0), approved: Number(counts?.approved ?? 0), suppressed: Number(counts?.suppressed ?? 0) },
    buybox: { priced: Number(buybox?.priced ?? 0), ours: Number(buybox?.ours ?? 0), lost: Number(buybox?.lost ?? 0), refreshedAt: buybox?.refreshed_at ?? null },
    margin: { known: m.length, negative: m.filter(v => v < 0).length, average: m.length ? m.reduce((s, v) => s + v, 0) / m.length : null },
    lastPush: last,
  }
}

export async function loadSuppressed() {
  const rows = await queryMany<any>(
    `SELECT sku, title, asin, status, summaries->0->'status' AS statuses, issues, synced_at FROM amazon_listing_status
     WHERE ${SUPPRESSED_SQL} ORDER BY title LIMIT 1000`
  )
  return { rows }
}

export async function loadBuybox() {
  const inputs = await priceInputs()
  const offers = await queryMany<any>(`SELECT o.*, l.title FROM amazon_offers o LEFT JOIN amazon_listing_status l ON l.sku = o.sku ORDER BY o.buybox_is_ours NULLS LAST, l.title`)
  const bySku = new Map(inputs.map(i => [i.sku, i]))
  return {
    rows: offers.map(o => {
      const i = bySku.get(o.sku)
      const n = (v: unknown) => (v == null ? null : Number(v))
      return {
        sku: o.sku,
        asin: o.asin,
        title: o.title,
        ourPrice: n(o.our_price),
        buyboxPrice: n(o.buybox_price),
        buyboxIsOurs: o.buybox_is_ours,
        buyboxFba: o.buybox_fba,
        lowestPrice: n(o.lowest_price),
        offerCount: Number(o.offer_count),
        marginNow: i ? marginAt(i.price, i) : null,
        marginAtBuybox: i && o.buybox_price != null ? marginAt(Number(o.buybox_price), i) : null,
        refreshedAt: o.refreshed_at,
      }
    }),
  }
}

export async function loadFees() {
  const [inputs, rows] = await Promise.all([priceInputs(), queryMany<any>(`SELECT f.*, l.title FROM amazon_fee_estimates f LEFT JOIN amazon_listing_status l ON l.sku = f.sku ORDER BY l.title`)])
  const bySku = new Map(inputs.map(i => [i.sku, i]))
  const costs = await catalogCosts()
  return {
    rows: rows.map(r => {
      const c = costs.get(r.sku)
      const price = Number(r.price)
      const fees = Number(r.total_fees)
      const exPrice = price * (c?.ex_ratio ?? 1)
      const margin = c?.cost == null ? null : Math.round((exPrice - fees - c.cost) * 100) / 100
      return {
        sku: r.sku,
        title: r.title,
        price,
        priceExGst: Math.round(exPrice * 100) / 100,
        referral: Number(r.referral_fee),
        closing: Number(r.closing_fee),
        fulfillment: Number(r.fulfillment_fee),
        other: Number(r.other_fees),
        fees,
        gstOnFees: Number(r.gst_on_fees),
        cost: c?.cost ?? null,
        margin,
        marginPct: margin == null || !exPrice ? null : margin / exPrice,
        fba: r.fba,
        inBuybox: bySku.get(r.sku)?.buyboxIsOurs ?? null,
      }
    }),
  }
}

export async function loadRepricer() {
  const [rules, proposals, inputs] = await Promise.all([loadRules(), repricerProposals(), priceInputs()])
  const titles = new Map(inputs.map(i => [i.sku, i.title]))
  return { rules, proposals: proposals.map(p => ({ ...p, title: titles.get(p.sku) ?? null })) }
}

export async function loadAmazonTab(tab: AmazonTab) {
  switch (tab) {
    case 'overview':
      return loadAmazonOverview()
    case 'suppressed':
      return loadSuppressed()
    case 'buybox':
      return loadBuybox()
    case 'fees':
      return loadFees()
    case 'repricer':
      return loadRepricer()
    default:
      return {}
  }
}
