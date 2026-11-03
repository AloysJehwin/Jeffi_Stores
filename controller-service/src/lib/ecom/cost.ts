import 'server-only'
import { DEFAULT_SETTINGS, computePlans, getCatalog } from '@controller/lib/compute/catalog'
import { monthlyTotal, pausedInrHour, quoteSpec } from '@controller/lib/compute/pricing'
import { normalizeSpec, type Catalog, type ComputeSpec } from '@/lib/compute/spec'

// What a store costs us and its owner, from what it runs (tenant_compute.applied) and its plan.

export interface CostPlan {
  monthlyPriceInr: number
  /** plans.infra_margin; unset falls back to the catalog's margin. */
  infraMargin?: number
}

export interface StoreCost {
  /** The owner's monthly total: plan fee + infra at the plan's margin + GST on the infra. */
  priceMonth: number | null
  /** Infra per hour at the plan's margin, no GST or plan fee (what tenant_compute.rate_inr_hour holds). */
  priceHour: number | null
  /** AWS's bill for it per month, in INR (no margin). */
  awsMonth: number | null
  /** What Jeffi keeps per month: the infra markup plus the plan fee net of GST. */
  marginMonth: number | null
  /** Infra billed this month so far (IST): priceHour, or the paused rate, × hours since max(appliedAt, month start). */
  mtdEstimate: number | null
}

const NONE: StoreCost = { priceMonth: null, priceHour: null, awsMonth: null, marginMonth: null, mtdEstimate: null }
const round2 = (n: number) => Math.round(n * 100) / 100
const IST_MS = 330 * 60_000

/** Start of the current calendar month in India. */
export function istMonthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS)
}

/** All null without a spec or when a part has no price; no plan prices at the catalog margin with no fee. */
export function storeCost(args: {
  spec: ComputeSpec | null
  plan: CostPlan | null
  appliedAt: string | Date | null
  status: string | null
  catalog: Catalog
  now?: Date
}): StoreCost {
  const { spec, plan, catalog } = args
  if (!spec) return { ...NONE }
  const margin = plan?.infraMargin == null ? undefined : { infraMargin: plan.infraMargin }
  let quote: ReturnType<typeof quoteSpec>
  try {
    quote = quoteSpec(spec, catalog, margin)
  } catch {
    return { ...NONE }
  }
  const fee = plan?.monthlyPriceInr ?? 0
  const gst = catalog.settings.gstRate
  let mtdEstimate: number | null = null
  if (args.appliedAt) {
    const now = args.now ?? new Date()
    const from = Math.max(new Date(args.appliedAt).getTime(), istMonthStart(now).getTime())
    const hours = Math.max(0, (now.getTime() - from) / 3_600_000)
    let rate: number | null = quote.inrHour
    if (args.status === 'paused') {
      try {
        rate = pausedInrHour(spec, catalog, margin)
      } catch {
        rate = null
      }
    }
    mtdEstimate = rate == null ? null : round2(rate * hours)
  }
  return {
    priceMonth: monthlyTotal(quote, fee, gst).total,
    priceHour: quote.inrHour,
    awsMonth: quote.awsInrMonth,
    marginMonth: round2(quote.marginInrMonth + fee / (1 + gst)),
    mtdEstimate,
  }
}

/** Costs for many stores (e.g. listTenants rows), keyed by tenant id; the catalog and plans are read once. Never throws. */
export async function costsFor(
  rows: {
    id: string
    plan: string | null
    applied: ComputeSpec | null
    applied_at: string | Date | null
    compute_status: string | null
    /** tenant_compute.price_inr_month; a store without one (applied before prices were stored) pays the plan fee. */
    price_inr_month?: number | null
  }[],
  now = new Date()
): Promise<Record<string, StoreCost>> {
  const [catalog, plans] = await Promise.all([
    getCatalog().catch((): Catalog => ({ prices: [], settings: DEFAULT_SETTINGS })),
    computePlans({ includeInactive: true }).catch(() => []),
  ])
  const bySlug = new Map(plans.map(p => [p.slug, p]))
  const out: Record<string, StoreCost> = {}
  for (const r of rows) {
    const p = r.plan ? bySlug.get(r.plan) : undefined
    const c = storeCost({
      spec: r.applied ? normalizeSpec(r.applied) : null,
      plan: p ? { monthlyPriceInr: p.monthlyPriceInr, infraMargin: p.infraMargin } : null,
      appliedAt: r.applied_at,
      status: r.compute_status,
      catalog,
      now,
    })
    // Only the plan fee is billed (no hourly infra): price and margin from the fee, no month-to-date infra.
    if (r.price_inr_month === null && p && c.awsMonth != null) {
      const fee = p.monthlyPriceInr
      c.priceMonth = fee
      c.marginMonth = round2(fee / (1 + catalog.settings.gstRate) - c.awsMonth)
      c.mtdEstimate = null
    }
    out[r.id] = c
  }
  return out
}
