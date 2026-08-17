import { describeInstance, stopInstance, startInstance, modifyInstanceType, waitForState } from './ec2-client'
import { activeTenantCount } from './tenant-registry'

/**
 * Tenant-pool auto-scale-UP controller. The pool is a SINGLE EC2 whose instance TYPE steps
 * up with the active-tenant count. Never scales out (add count) and never auto-downsizes.
 *
 * Driven by GET /api/cron/pool-autoscale (Bearer CRON_SECRET). Guardrails:
 *  - up-only (a transient tenant dip must not trigger downtime)
 *  - hard flagship interlock (never operate on FLAGSHIP_INSTANCE_ID)
 *  - kill switch (POOL_AUTOSCALE_ENABLED must be 'true' to mutate; else dry-run)
 */

export const POOL_SIZE_TIERS = [
  { type: 't4g.small', maxTenants: 10 },
  { type: 't4g.medium', maxTenants: 25 },
  { type: 't4g.large', maxTenants: 50 },
  { type: 't4g.xlarge', maxTenants: 100 },
] as const

const FLAGSHIP_INSTANCE_ID = process.env.FLAGSHIP_INSTANCE_ID || 'i-0b2466b2a540d6f23'

export function targetType(count: number): string {
  const tier = POOL_SIZE_TIERS.find((t) => count <= t.maxTenants)
  if (!tier) throw new Error(`Pool capacity exceeded: ${count} active tenants > ${POOL_SIZE_TIERS[POOL_SIZE_TIERS.length - 1].maxTenants} (needs a bigger architecture — paging a human)`)
  return tier.type
}

function tierIndex(type: string): number {
  return POOL_SIZE_TIERS.findIndex((t) => t.type === type)
}

export interface AutoscaleResult {
  tenantCount: number
  currentType: string
  targetType: string
  action: 'none' | 'resized' | 'skipped-downsize' | 'dry-run' | 'disabled'
  detail?: string
}

/**
 * Evaluate tenant count → decide + (if enabled) perform an up-resize of the pool instance.
 * Idempotent: no-op when current == target.
 */
export async function runPoolAutoscale(): Promise<AutoscaleResult> {
  const poolId = process.env.POOL_INSTANCE_ID
  if (!poolId) return { tenantCount: 0, currentType: '', targetType: '', action: 'disabled', detail: 'POOL_INSTANCE_ID not set' }

  // Flagship interlock — three ways this can never touch the dedicated box.
  if (poolId === FLAGSHIP_INSTANCE_ID) {
    throw new Error(`Refusing: POOL_INSTANCE_ID equals the flagship ${FLAGSHIP_INSTANCE_ID}`)
  }

  const count = await activeTenantCount()
  const want = targetType(count)
  const { instanceType: current } = await describeInstance(poolId)
  const result: AutoscaleResult = { tenantCount: count, currentType: current, targetType: want, action: 'none' }

  if (want === current) return result
  if (tierIndex(want) < tierIndex(current)) {
    // up-only: a smaller target than current is a downsize → skip (manual op only).
    return { ...result, action: 'skipped-downsize' }
  }

  if (process.env.POOL_AUTOSCALE_ENABLED !== 'true') {
    return { ...result, action: 'dry-run', detail: `would resize ${current} → ${want}` }
  }

  // Resize: stop → modify type → start. EIP survives stop/start so DNS/IP are stable.
  await stopInstance(poolId)
  await waitForState(poolId, 'stopped')
  await modifyInstanceType(poolId, want)
  await startInstance(poolId)
  await waitForState(poolId, 'running')
  return { ...result, action: 'resized', detail: `${current} → ${want}` }
}
