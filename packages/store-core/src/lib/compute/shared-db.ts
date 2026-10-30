import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import type { ProvisioningProvider } from '@/lib/provisioning/provider'
import { DEFAULT_SETTINGS, getCatalog } from './catalog'

// Starter stores share RDS hosts: each gets its own database and IAM login role on one, and a
// seat (shared_db_hosts.tenants) from reservation until its database is dropped.

const PARAM_GROUP = 'jeffi-starter-pg16'

export interface SharedDbHost {
  id: string
  endpoint: string | null
  db_class: string
  capacity: number
  tenants: number
  status: 'creating' | 'available' | 'retired'
}

/** The store's database and login role names on a shared host. */
export function tenantDbNames(slug: string) {
  const s = slug.replace(/-/g, '_')
  return { db: `t_${s}`, role: `app_${s}` }
}

/** Take a seat on a host with room (the oldest first), or create the next host and take its first seat. */
export async function reserveSharedDbHost(provider: ProvisioningProvider): Promise<SharedDbHost> {
  const pool = controlPlanePool()
  const seat = await pool.query<SharedDbHost>(
    `UPDATE shared_db_hosts SET tenants = tenants + 1, updated_at = now()
     WHERE id = (SELECT id FROM shared_db_hosts WHERE status IN ('creating','available') AND tenants < capacity
                 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`
  )
  if (seat.rows[0]) return seat.rows[0]

  const s = (await getCatalog().catch(() => null))?.settings ?? DEFAULT_SETTINGS
  const n = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM shared_db_hosts`)).rows[0].n + 1
  const id = `jeffi-starter-${n}`
  const storageGb = Math.max(20, s.sharedDbCapacity * s.sharedDbStorageGb)
  await provider.ensureParamGroup(PARAM_GROUP, s.sharedDbMaxConnections)
  const created = await provider.createDbInstance({
    dbInstanceId: id,
    paramGroup: PARAM_GROUP,
    maxConnections: s.sharedDbMaxConnections,
    instanceClass: s.sharedDbClass,
    storageGb,
  })
  const row = await pool.query<SharedDbHost>(
    `INSERT INTO shared_db_hosts (id, db_class, storage_gb, capacity, tenants) VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (id) DO UPDATE SET tenants = shared_db_hosts.tenants + 1, updated_at = now() RETURNING *`,
    [id, created.instanceClass ?? s.sharedDbClass, storageGb, s.sharedDbCapacity]
  )
  return row.rows[0]
}

export async function markSharedDbHostAvailable(id: string, endpoint: string): Promise<void> {
  await controlPlanePool().query(
    `UPDATE shared_db_hosts SET endpoint = $2, status = 'available', updated_at = now() WHERE id = $1 AND status = 'creating'`,
    [id, endpoint]
  )
}

export async function releaseSharedDbSeat(id: string): Promise<void> {
  await controlPlanePool().query(
    `UPDATE shared_db_hosts SET tenants = GREATEST(tenants - 1, 0), updated_at = now() WHERE id = $1`,
    [id]
  )
}
