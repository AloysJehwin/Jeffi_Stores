// Per-plan compute for tenant workloads on k3s. Basic tenants get their own pod on a shared
// pool node; growth and above get a dedicated node labelled + tainted to that tenant.

export type PlanSlug = 'basic' | 'growth' | 'pro' | 'enterprise'

export interface ComputeTier {
  placement: 'pool' | 'dedicated'
  nodeType: string
  replicas: number
  maxReplicas: number
  requests: { cpu: string; memory: string }
  limits: { cpu: string; memory: string }
}

export const POOL_NODE_TYPE = 't4g.medium'
export const POOL_NODE_CAPACITY = 6

export const COMPUTE_TIERS: Record<PlanSlug, ComputeTier> = {
  basic: {
    placement: 'pool',
    nodeType: POOL_NODE_TYPE,
    replicas: 1,
    maxReplicas: 1,
    requests: { cpu: '200m', memory: '384Mi' },
    limits: { cpu: '1', memory: '640Mi' },
  },
  growth: {
    placement: 'dedicated',
    nodeType: 't4g.small',
    replicas: 2,
    maxReplicas: 2,
    requests: { cpu: '200m', memory: '384Mi' },
    limits: { cpu: '1', memory: '640Mi' },
  },
  pro: {
    placement: 'dedicated',
    nodeType: 't4g.medium',
    replicas: 2,
    maxReplicas: 3,
    requests: { cpu: '300m', memory: '512Mi' },
    limits: { cpu: '1500m', memory: '900Mi' },
  },
  enterprise: {
    placement: 'dedicated',
    nodeType: 't4g.large',
    replicas: 2,
    maxReplicas: 5,
    requests: { cpu: '500m', memory: '768Mi' },
    limits: { cpu: '2', memory: '1200Mi' },
  },
}

// Unknown or legacy plan slugs fall back to the smallest tier rather than failing a provision.
export function computeTierFor(plan: string | null | undefined): ComputeTier {
  return COMPUTE_TIERS[(plan ?? '') as PlanSlug] ?? COMPUTE_TIERS.basic
}

export const tenantNamespace = (slug: string) => `tenant-${slug}`
export const dedicatedNodeName = (slug: string) => `t-${slug}`
