import { computePlans, getCatalog } from '@controller/lib/compute/catalog'
import { presetSpec, withDedicatedDb } from '@/lib/compute/presets'
import { quoteSpec, monthlyTotal } from '@controller/lib/compute/pricing'

/**
 * Each plan's "from" price: its minPreset at its own margin, GST on the servers, plus the plan fee.
 * Shown whether or not owners can pick a size yet: every plan runs on its own server either way.
 * `rdsExtra`: what moving Basic's database to RDS adds per month.
 */
export async function floorPrices(): Promise<{ floors: Record<string, number>; rdsExtra: Record<string, number> } | null> {
  try {
    const [catalog, plans] = await Promise.all([getCatalog(), computePlans()])
    const total = (spec: ReturnType<typeof presetSpec>, p: (typeof plans)[number]) =>
      Math.round(monthlyTotal(quoteSpec(spec, catalog, p), p.monthlyPriceInr, catalog.settings.gstRate).total)
    const floors: Record<string, number> = {}
    const rdsExtra: Record<string, number> = {}
    for (const p of plans) {
      const key = p.minPreset ?? p.defaultPreset ?? (p.minPlacement === 'pool' ? 'shared' : 'small')
      floors[p.slug] = total(presetSpec(key), p)
      if (key === 'basic') rdsExtra[p.slug] = total(withDedicatedDb(presetSpec('basic'), 'basic'), p) - floors[p.slug]
    }
    return { floors, rdsExtra }
  } catch {
    return null
  }
}

/** The lowest monthly price among the given (active store) plans, or null when prices can't be computed. */
export async function lowestPlanInr(planSlugs: string[]): Promise<number | null> {
  const prices = await floorPrices()
  if (!prices) return null
  const vals = planSlugs.map(s => prices.floors[s]).filter((v): v is number => Number.isFinite(v))
  return vals.length ? Math.min(...vals) : null
}
