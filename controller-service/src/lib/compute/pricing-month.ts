import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import type { ComputeSpec } from '@/lib/compute/spec'
import { getCatalog, planCompute } from './catalog'
import { monthlyTotal, quoteSpec } from './pricing'

/** Rupee-rounded total (plan margin + GST) for `spec` on the tenant's plan. Returns null if plan or price unknown. */
export async function priceInrMonthFor(tenantId: string, spec: ComputeSpec): Promise<number | null> {
  const r = await controlPlanePool().query<{ slug: string | null }>(
    `SELECT p.slug FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
    [tenantId]
  )
  const slug = r.rows[0]?.slug
  if (!slug) return null
  return priceInrMonthForPlan(slug, spec)
}

/** Rupee-rounded total for `spec` on an explicit plan slug. */
export async function priceInrMonthForPlan(planSlug: string, spec: ComputeSpec): Promise<number | null> {
  const [plan, catalog] = await Promise.all([planCompute(planSlug), getCatalog()])
  if (!plan) return null
  try {
    const quote = quoteSpec(spec, catalog, { infraMargin: plan.infraMargin })
    return Math.round(monthlyTotal(quote, plan.monthlyPriceInr ?? 0, catalog.settings.gstRate).total)
  } catch {
    return null
  }
}
