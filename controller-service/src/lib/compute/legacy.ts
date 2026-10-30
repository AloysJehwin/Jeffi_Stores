import type { ComputeSpec, PodSize } from './spec'

// What each plan ran before owners chose their compute (the old per-plan tiers, each on a 20 GB micro
// database). Stores without a tenant_compute row run this; seed-plans.sql records the same for them.
const legacy = (placement: 'pool' | 'dedicated', type: string | null, c: [number, number, PodSize], s: [number, number, PodSize]): ComputeSpec => ({
  node: { placement, type, count: 1 },
  db: { mode: 'dedicated', class: 'db.t4g.micro', storageGb: 20, multiAz: false },
  services: {
    controller: { replicas: c[0], maxReplicas: c[1], size: c[2] },
    messaging: { replicas: s[0], maxReplicas: s[1], size: s[2] },
    documents: { replicas: s[0], maxReplicas: s[1], size: s[2] },
  },
})

const LEGACY: Record<string, ComputeSpec> = {
  basic: legacy('pool', null, [1, 1, 'S'], [1, 1, 'S']),
  growth: legacy('dedicated', 't4g.small', [2, 2, 'S'], [1, 1, 'S']),
  pro: legacy('dedicated', 't4g.medium', [2, 3, 'M'], [2, 2, 'M']),
  enterprise: legacy('dedicated', 't4g.large', [2, 5, 'L'], [2, 2, 'L']),
}

/** Unknown plans (and Starter before it has a row) run as Basic did. */
export const legacySpecFor = (plan: string | null | undefined): ComputeSpec => JSON.parse(JSON.stringify(LEGACY[plan ?? ''] ?? LEGACY.basic))
