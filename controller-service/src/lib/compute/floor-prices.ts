import { computePlans, getCatalog } from '@controller/lib/compute/catalog'
import { presetSpec, withDedicatedDb } from '@/lib/compute/presets'
import { quoteSpec, monthlyTotal } from '@controller/lib/compute/pricing'

export interface FloorPrices {
  /** Each plan's "from" price before GST: its minPreset at its own margin plus the plan fee, GST taken out. */
  floors: Record<string, number>
  /** What moving Basic's database to RDS adds per month, before GST. */
  rdsExtra: Record<string, number>
  gstRate: number
}

/**
 * The public "₹X + GST" prices. monthlyTotal's checkout total is the plan fee (GST included) plus infra with GST on
 * top, so the base is the fee without its GST plus the infra; base × (1 + GST) is the checkout total.
 * Shown whether or not owners can pick a size yet: every plan runs on its own server either way.
 */
export async function floorPrices(): Promise<FloorPrices | null> {
  try {
    const [catalog, plans] = await Promise.all([getCatalog(), computePlans()])
    const gstRate = catalog.settings.gstRate
    const base = (spec: ReturnType<typeof presetSpec>, p: (typeof plans)[number]) => {
      const m = monthlyTotal(quoteSpec(spec, catalog, p), p.monthlyPriceInr, gstRate)
      return Math.round(m.planFee / (1 + gstRate) + m.infra)
    }
    const floors: Record<string, number> = {}
    const rdsExtra: Record<string, number> = {}
    for (const p of plans) {
      const key = p.minPreset ?? p.defaultPreset ?? (p.minPlacement === 'pool' ? 'shared' : 'small')
      floors[p.slug] = base(presetSpec(key), p)
      if (key === 'basic') rdsExtra[p.slug] = base(withDedicatedDb(presetSpec('basic'), 'basic'), p) - floors[p.slug]
    }
    return { floors, rdsExtra, gstRate }
  } catch {
    return null
  }
}

/** The lowest monthly price before GST among the given (active store) plans, or null when prices can't be computed. */
export async function lowestPlanInr(planSlugs: string[]): Promise<number | null> {
  const prices = await floorPrices()
  if (!prices) return null
  const vals = planSlugs.map(s => prices.floors[s]).filter((v): v is number => Number.isFinite(v))
  return vals.length ? Math.min(...vals) : null
}
