import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { presetOf } from './presets'
import type { ComputeSpec } from './spec'

export interface TenantCompute {
  tenant_id: string
  preset: string | null
  desired: ComputeSpec
  applied: ComputeSpec | null
  status: 'pending' | 'applying' | 'applied' | 'failed' | 'paused'
  apply_mode: 'window' | 'now'
  rate_inr_hour: string | null
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

export async function getTenantCompute(tenantId: string): Promise<TenantCompute | null> {
  const r = await controlPlanePool().query<TenantCompute>(`SELECT * FROM tenant_compute WHERE tenant_id = $1`, [tenantId])
  return r.rows[0] ?? null
}
