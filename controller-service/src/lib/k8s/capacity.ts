import 'server-only'
import { legacySpecFor } from '@/lib/compute/legacy'

// Guards plans that need a dedicated EC2 node while the account's On-Demand vCPU quota is too small.
// EC2_VCPU_QUOTA (provisioning ConfigMap) is the applied quota; unset = no guard.

/**
 * vCPUs of an EC2 type, by AWS's naming: {n}xlarge is 4n and large 2 in every family; medium is 1
 * outside the burstable families (r7g/m7g/c7g.medium); a burstable t3/t3a/t4g is 2 at any size below
 * xlarge (t2 is 1 up to small). Unknown sizes count 2.
 */
export function vcpusFor(instanceType: string): number {
  const [family = '', size = ''] = instanceType.split('.')
  const xl = /^(\d*)xlarge$/.exec(size)
  if (xl) return 4 * (Number(xl[1]) || 1)
  if (size === 'large') return 2
  if (family === 't2') return size === 'medium' ? 2 : 1
  if (family.startsWith('t')) return 2
  return size === 'medium' ? 1 : 2
}

export const CAPACITY_MESSAGE =
  'This plan needs a dedicated server and we are adding capacity right now. Please choose Basic for now ' +
  '(you can upgrade later) or try again in a few days — you have not been charged.'

/** null when the plan can be served; otherwise a customer-facing reason. */
export async function dedicatedCapacityError(plan: string | null | undefined): Promise<string | null> {
  if (process.env.PROVISIONING_COMPUTE !== 'k8s') return null
  const { node } = legacySpecFor(plan ?? 'basic')
  if (node.placement !== 'dedicated' || !node.type) return null
  const quota = Number(process.env.EC2_VCPU_QUOTA)
  if (!Number.isFinite(quota) || quota <= 0) return null
  try {
    const { describeActiveInstanceTypes } = await import('@/lib/shared/ec2-client')
    const used = (await describeActiveInstanceTypes()).reduce((n, t) => n + vcpusFor(t), 0)
    return used + vcpusFor(node.type) * node.count > quota ? CAPACITY_MESSAGE : null
  } catch (e) {
    console.error('[capacity] vCPU headroom check failed; allowing:', (e as Error)?.message)
    return null
  }
}

/** null when a store's own servers (vcpus in total) fit the vCPU quota; same guard as dedicatedCapacityError. */
export async function vcpuCapacityError(vcpus: number): Promise<string | null> {
  if (process.env.PROVISIONING_COMPUTE !== 'k8s' || vcpus <= 0) return null
  const quota = Number(process.env.EC2_VCPU_QUOTA)
  if (!Number.isFinite(quota) || quota <= 0) return null
  try {
    const { describeActiveInstanceTypes } = await import('@/lib/shared/ec2-client')
    const used = (await describeActiveInstanceTypes()).reduce((n, t) => n + vcpusFor(t), 0)
    return used + vcpus > quota ? COMPUTE_CAPACITY_MESSAGE : null
  } catch (e) {
    console.error('[capacity] vCPU headroom check failed; allowing:', (e as Error)?.message)
    return null
  }
}

/** The store's own servers fit the vCPU quota: its chosen compute when owners choose, else its plan's tier. */
export async function tenantCapacityError(tenantId: string, plan: string | null): Promise<string | null> {
  const { computeSpecEnabled } = await import('@controller/lib/compute/catalog')
  if (!computeSpecEnabled()) return dedicatedCapacityError(plan)
  const { resolveCompute } = await import('@controller/lib/compute/resolve')
  const { node } = (await resolveCompute(tenantId, plan)).spec
  return node.placement === 'dedicated' && node.type ? vcpuCapacityError(vcpusFor(node.type) * node.count) : null
}

export const COMPUTE_CAPACITY_MESSAGE =
  'We are adding server capacity right now, so this size is not available today. Choose a smaller size ' +
  '(you can grow later) or try again in a few days. You have not been charged.'
