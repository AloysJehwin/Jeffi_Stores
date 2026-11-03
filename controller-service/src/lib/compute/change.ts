import 'server-only'
import { getTenant } from '@/lib/tenant-registry'
import { computeSpecEnabled, getCatalog, planCompute } from './catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { specKey } from '@/lib/compute/presets'
import { quoteForPlan, type PlanQuote } from './quote'
import { getTenantCompute, type TenantCompute } from './store'
import { ec2Code, priceOf, type Catalog, type ComputeSpec } from '@/lib/compute/spec'

/** vCPUs a change adds while it runs: extra servers of the same type, or a whole next generation beside the current one. */
export function extraVcpus(current: ComputeSpec, next: ComputeSpec, catalog: Catalog): number {
  const d = next.node
  if (d.placement !== 'dedicated' || !d.type) return 0
  const vcpu = priceOf(catalog, ec2Code(d.type))?.vcpu ?? 2
  const a = current.node
  if (a.placement === 'dedicated' && a.type === d.type && d.count >= a.count) return (d.count - a.count) * vcpu
  return d.count * vcpu
}

export interface ChangeCheck {
  status: number
  error?: string
  quote?: PlanQuote
  current?: ComputeSpec
  row?: TenantCompute | null
}

/**
 * Whether a running store may change to `spec`, with the server's price. `planSlug` checks it against the
 * plan the store is moving to (default: the one it is on); `billingChanged` allows an unchanged spec when only
 * the billing interval changes. An admin may go outside the plan's sizes; the servers must still fit and have capacity.
 */
export async function checkComputeChange(
  tenantId: string,
  spec: ComputeSpec,
  opts: { admin?: boolean; planSlug?: string; billingChanged?: boolean } = {}
): Promise<ChangeCheck> {
  if (!computeSpecEnabled()) return { status: 403, error: 'Choosing server sizes is not available yet.' }
  const tenant = await getTenant(tenantId)
  if (!tenant || tenant.status !== 'active' || !tenant.service_types?.includes('store')) {
    return { status: 409, error: 'The store must be live to change its servers.' }
  }
  const row = await getTenantCompute(tenantId)
  if (row?.status === 'applying') return { status: 409, error: 'A change is still being applied. Try again once it has finished.' }
  if (row?.status === 'paused') return { status: 409, error: 'The store is paused. Its servers can change once it runs again.' }
  if (row?.progress?.layout && !row.progress.layout.failed) {
    return { status: 409, error: 'The store is moving to its own services. Try again in a few minutes.' }
  }
  const planSlug = opts.planSlug ?? tenant.plan ?? ''
  const planChanged = planSlug !== (tenant.plan ?? '')
  const plan = await planCompute(planSlug)
  if (!plan) return { status: 400, error: 'Unknown plan.' }
  if (planChanged && !plan.active) return { status: 400, error: 'That plan is no longer offered.' }
  const catalog = await getCatalog()
  const current = row?.applied ?? legacySpecFor(tenant.plan)
  if (!planChanged && !opts.billingChanged && specKey(spec) === specKey(current)) return { status: 400, error: 'That is what the store runs now.' }

  const oldDb = row?.progress?.oldDb
  if (oldDb && spec.db.mode !== current.db.mode && oldDb.kind === spec.db.mode) {
    const at = new Date(oldDb.dropAfter).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    return { status: 409, error: `The previous database is kept for a day after a move. Try again after ${at}.` }
  }

  const quote = await quoteForPlan(spec, plan, catalog, { current, anyPlan: opts.admin, extraVcpus: extraVcpus(current, spec, catalog) })
  if (!quote.validation.ok) return { status: 400, error: quote.validation.errors[0], quote }
  if (quote.capacityError) return { status: 409, error: quote.capacityError, quote }
  return { status: 200, quote, current, row }
}
