import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { presetOf } from './presets'
import { normalizeSpec, type ComputeSpec } from './spec'

export interface TenantCompute {
  tenant_id: string
  preset: string | null
  desired: ComputeSpec
  applied: ComputeSpec | null
  status: 'pending' | 'applying' | 'applied' | 'failed' | 'paused'
  apply_mode: 'window' | 'now'
  rate_inr_hour: string | null
  node_gen: number
  progress: Record<string, any> | null
  attempts: number
  last_error: string | null
  applied_at: string | null
  updated_at: string
}

/** The store's compute choice, to be applied by provisioning (or the resize reconciler). */
export async function saveDesiredCompute(tenantId: string, spec: ComputeSpec, applyMode: 'window' | 'now' = 'window'): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO tenant_compute (tenant_id, preset, desired, status, apply_mode) VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT (tenant_id) DO UPDATE SET preset = EXCLUDED.preset, desired = EXCLUDED.desired, apply_mode = EXCLUDED.apply_mode,
       status = 'pending', attempts = 0, next_at = NULL, last_error = NULL, updated_at = now()`,
    [tenantId, presetOf(spec), JSON.stringify(spec), applyMode]
  )
}

const COLUMNS = ['applied', 'progress', 'status', 'node_gen', 'attempts', 'next_at', 'last_error', 'rate_inr_hour', 'applied_at'] as const
type Patch = Partial<Record<(typeof COLUMNS)[number], unknown>>

/** Update the given columns of a store's compute row (jsonb columns take objects). */
export async function patchTenantCompute(tenantId: string, patch: Patch): Promise<void> {
  const keys = COLUMNS.filter(k => k in patch)
  if (!keys.length) return
  const json = (k: string, v: unknown) => (k === 'applied' || k === 'progress') && v != null ? JSON.stringify(v) : v
  await controlPlanePool().query(
    `UPDATE tenant_compute SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE tenant_id = $1`,
    [tenantId, ...keys.map(k => json(k, patch[k]))]
  )
}

/** Stores whose compute change is due to be worked on. */
export async function dueComputeChanges(): Promise<string[]> {
  const r = await controlPlanePool().query<{ tenant_id: string }>(
    `SELECT c.tenant_id FROM tenant_compute c JOIN tenants t ON t.id = c.tenant_id
     WHERE ((c.status IN ('pending','applying') AND t.status = 'active') OR c.progress ? 'oldDb')
       AND (c.next_at IS NULL OR c.next_at <= now())
     ORDER BY c.updated_at LIMIT 20`
  )
  return r.rows.map(x => x.tenant_id)
}

export async function getTenantCompute(tenantId: string): Promise<TenantCompute | null> {
  const r = await controlPlanePool().query<TenantCompute>(`SELECT * FROM tenant_compute WHERE tenant_id = $1`, [tenantId])
  const row = r.rows[0]
  if (!row) return null
  return { ...row, desired: normalizeSpec(row.desired), applied: row.applied ? normalizeSpec(row.applied) : null }
}

/** Stores whose app pods run another layout than STORE_ROLES_ENABLED asks for, and no compute change is running. */
export async function dueLayoutSwitches(target: 'controller' | 'services'): Promise<string[]> {
  const r = await controlPlanePool().query<{ tenant_id: string }>(
    `SELECT c.tenant_id FROM tenant_compute c JOIN tenants t ON t.id = c.tenant_id
     WHERE t.status = 'active' AND c.applied IS NOT NULL AND c.status NOT IN ('pending', 'applying')
       AND (COALESCE(c.applied->>'layout', 'controller') <> $1 OR c.progress ? 'layout')
     ORDER BY c.updated_at LIMIT 5`,
    [target]
  )
  return r.rows.map(x => x.tenant_id)
}
