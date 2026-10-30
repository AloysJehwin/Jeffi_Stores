// k3s placement names for tenant workloads. Every store runs its own controller, messaging and document
// pods; what they run on comes from the store's compute spec (lib/compute). Pool stores share
// pool-basic nodes; a store with its own servers gets nodes labelled + tainted to it.

export const POOL_NODE_TYPE = 't4g.medium'
export const POOL_NODE_CAPACITY = Number(process.env.POOL_NODE_CAPACITY || 4)

export const tenantNamespace = (slug: string) => `tenant-${slug}`
export const dedicatedNodeName = (slug: string) => `t-${slug}`

/** A store server's node name: t-{slug} for the first of generation 0 (named before generations), else t-{slug}.{gen}-{i}. */
export const tenantNodeName = (slug: string, gen: number, i: number) => (gen === 0 && i === 0 ? dedicatedNodeName(slug) : `t-${slug}.${gen}-${i}`)
/** Slugs never contain a dot, so no store's server name can match another store's. */
export const isTenantNodeName = (slug: string, name: string) => name === dedicatedNodeName(slug) || new RegExp(`^t-${slug}\\.\\d+-\\d+$`).test(name)
