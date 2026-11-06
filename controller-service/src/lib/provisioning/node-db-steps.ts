import type { ComputeSpec } from '@/lib/compute/spec'
import { dedicatedNodeName, tenantNodeName } from '@/lib/provisioning/tiers'
import { ok, skip, wait, type StepResult } from './pipeline'
import { TENANT_DB_NAME, nodeDbHost, withTenantAdminPool } from './tenant-admin-pool'

// A store whose Postgres runs on its own server: the server, its data disk, the Postgres pod and the
// store database, one step each. The runner bounds each wait (pipeline STEP_CATALOG timeouts).

export interface NodeDbCompute {
  spec: ComputeSpec
  nodeGen: number
  dbPoolMax: number
}

export interface NodeDbCtx {
  slug: string
  res: Record<string, any>
  compute: () => Promise<NodeDbCompute>
  /** The store's servers, launched if missing (steps.placeNodes). */
  placeNodes: (c: NodeDbCompute, opts: { dbVolume: boolean }) => Promise<{ ready: boolean }>
  /** Apply the store's namespace (steps.applyWorkload). */
  applyWorkload: (c: NodeDbCompute) => Promise<void>
}

const NO_CLUSTER = 'no cluster (stub engine)'
const noCluster = () => process.env.PROVISIONING_COMPUTE !== 'k8s'

const setDbHost = (slug: string, res: Record<string, any>) => {
  res.endpoint = nodeDbHost(slug)
  res.dbName = TENANT_DB_NAME
}

/** The store's own server(s). The database host is recorded first, as create_db_instance did for a node store. */
export async function launchServer(ctx: NodeDbCtx): Promise<StepResult> {
  setDbHost(ctx.slug, ctx.res)
  if (noCluster()) return skip(NO_CLUSTER)
  const c = await ctx.compute()
  if (!(await ctx.placeNodes(c, { dbVolume: false })).ready) {
    return wait(c.spec.node.count > 1 ? 'waiting for the servers to join the cluster' : 'waiting for the server to join the cluster')
  }
  ctx.res.computeMode = 'k8s'
  return ok()
}

/** The database's EBS volume, created in the first server's zone and attached to it. */
export async function attachDbDisk(ctx: NodeDbCtx): Promise<StepResult> {
  if (noCluster()) return skip(NO_CLUSTER)
  const c = await ctx.compute()
  if (c.spec.node.placement !== 'dedicated') return skip('no server of its own to attach a disk to')
  const { ensureNodeDbVolume } = await import('@/lib/k8s/tenant-compute')
  const first = tenantNodeName(ctx.slug, c.nodeGen, 0)
  const known: Record<string, string> =
    ctx.res.nodeInstances ?? (ctx.res.ec2InstanceId ? { [dedicatedNodeName(ctx.slug)]: ctx.res.ec2InstanceId } : {})
  const vol = await ensureNodeDbVolume(ctx.slug, first, c.spec.db.storageGb, known[first])
  return vol.attached ? ok() : wait(vol.detail)
}

/** The store's namespace with its Postgres pod, rendered with the stored password. */
export async function startPostgres(ctx: NodeDbCtx): Promise<StepResult> {
  if (noCluster()) return skip(NO_CLUSTER)
  const c = await ctx.compute()
  const { getOrCreateTenantDbPassword } = await import('./tenant-db-secret')
  await getOrCreateTenantDbPassword(ctx.slug)
  await ctx.applyWorkload(c)
  const { postgresPodReady } = await import('@/lib/k8s/tenant-compute')
  return (await postgresPodReady(ctx.slug)) ? ok() : wait('waiting for the Postgres pod to be ready')
}

/** The image creates the store database only on a fresh data directory; make sure it is there. */
export async function createDatabase(ctx: NodeDbCtx): Promise<StepResult> {
  const { slug, res } = ctx
  if (noCluster()) {
    setDbHost(slug, res)
    return skip(NO_CLUSTER)
  }
  const { getOrCreateTenantDbPassword } = await import('./tenant-db-secret')
  const dbPassword = await getOrCreateTenantDbPassword(slug)
  try {
    await withTenantAdminPool({ endpoint: nodeDbHost(slug), dbName: 'postgres', dbPassword }, async pool => {
      const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [TENANT_DB_NAME])
      if (!found.rowCount) await pool.query(`CREATE DATABASE ${TENANT_DB_NAME}`)
    })
  } catch (e: any) {
    res.dbConnectError = e?.message || String(e)
    return wait(res.dbConnectError)
  }
  delete res.dbConnectError
  setDbHost(slug, res)
  return ok()
}
