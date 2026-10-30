import 'server-only'
import { computeTierFor } from '@/lib/provisioning/tiers'

// Guards plans that need a dedicated EC2 node while the account's On-Demand vCPU quota is too small.
// EC2_VCPU_QUOTA (provisioning ConfigMap) is the applied quota; unset = no guard.

const VCPU: Record<string, number> = { nano: 2, micro: 2, small: 2, medium: 2, large: 2, xlarge: 4, '2xlarge': 8 }

export function vcpusFor(instanceType: string): number {
  return VCPU[instanceType.split('.')[1] ?? ''] ?? 2
}

export const CAPACITY_MESSAGE =
  'This plan needs a dedicated server and we are adding capacity right now. Please choose Basic for now ' +
  '(you can upgrade later) or try again in a few days — you have not been charged.'

/** null when the plan can be served; otherwise a customer-facing reason. */
export async function dedicatedCapacityError(plan: string | null | undefined): Promise<string | null> {
  if (process.env.PROVISIONING_COMPUTE !== 'k8s') return null
  const tier = computeTierFor(plan ?? 'basic')
  if (tier.placement !== 'dedicated') return null
  const quota = Number(process.env.EC2_VCPU_QUOTA)
  if (!Number.isFinite(quota) || quota <= 0) return null
  try {
    const { describeActiveInstanceTypes } = await import('@/lib/shared/ec2-client')
    const used = (await describeActiveInstanceTypes()).reduce((n, t) => n + vcpusFor(t), 0)
    return used + vcpusFor(tier.nodeType) > quota ? CAPACITY_MESSAGE : null
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

export const COMPUTE_CAPACITY_MESSAGE =
  'We are adding server capacity right now, so this size is not available today. Choose a smaller size ' +
  '(you can grow later) or try again in a few days. You have not been charged.'
