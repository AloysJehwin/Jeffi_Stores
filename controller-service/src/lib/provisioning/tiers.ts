// Per-plan compute for tenant workloads on k3s. Every store runs its own controller, messaging and
// document pods; Basic tenants share pool nodes, growth and above get a dedicated node labelled +
// tainted to that tenant.

export type PlanSlug = 'basic' | 'growth' | 'pro' | 'enterprise'

type Resources = { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } }

export interface ComputeTier {
  placement: 'pool' | 'dedicated'
  nodeType: string
  replicas: number
  maxReplicas: number
  requests: { cpu: string; memory: string }
  limits: { cpu: string; memory: string }
  services: { replicas: number; messaging: Resources; documents: Resources }
}

export const POOL_NODE_TYPE = 't4g.medium'
export const POOL_NODE_CAPACITY = Number(process.env.POOL_NODE_CAPACITY || 4)

export const COMPUTE_TIERS: Record<PlanSlug, ComputeTier> = {
  basic: {
    placement: 'pool',
    nodeType: POOL_NODE_TYPE,
    replicas: 1,
    maxReplicas: 1,
    requests: { cpu: '200m', memory: '384Mi' },
    limits: { cpu: '1', memory: '640Mi' },
    services: {
      replicas: 1,
      messaging: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '300m', memory: '256Mi' } },
      documents: { requests: { cpu: '50m', memory: '160Mi' }, limits: { cpu: '500m', memory: '384Mi' } },
    },
  },
  growth: {
    placement: 'dedicated',
    nodeType: 't4g.small',
    replicas: 2,
    maxReplicas: 2,
    requests: { cpu: '200m', memory: '384Mi' },
    limits: { cpu: '1', memory: '640Mi' },
    services: {
      replicas: 1,
      messaging: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '500m', memory: '320Mi' } },
      documents: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '1', memory: '448Mi' } },
    },
  },
  pro: {
    placement: 'dedicated',
    nodeType: 't4g.medium',
    replicas: 2,
    maxReplicas: 3,
    requests: { cpu: '300m', memory: '512Mi' },
    limits: { cpu: '1500m', memory: '900Mi' },
    services: {
      replicas: 2,
      messaging: { requests: { cpu: '100m', memory: '160Mi' }, limits: { cpu: '500m', memory: '384Mi' } },
      documents: { requests: { cpu: '100m', memory: '224Mi' }, limits: { cpu: '1', memory: '512Mi' } },
    },
  },
  enterprise: {
    placement: 'dedicated',
    nodeType: 't4g.large',
    replicas: 2,
    maxReplicas: 5,
    requests: { cpu: '500m', memory: '768Mi' },
    limits: { cpu: '2', memory: '1200Mi' },
    services: {
      replicas: 2,
      messaging: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '1', memory: '448Mi' } },
      documents: { requests: { cpu: '200m', memory: '256Mi' }, limits: { cpu: '1500m', memory: '640Mi' } },
    },
  },
}

// Unknown or legacy plan slugs fall back to the smallest tier rather than failing a provision.
export function computeTierFor(plan: string | null | undefined): ComputeTier {
  return COMPUTE_TIERS[(plan ?? '') as PlanSlug] ?? COMPUTE_TIERS.basic
}

export const tenantNamespace = (slug: string) => `tenant-${slug}`
export const dedicatedNodeName = (slug: string) => `t-${slug}`
