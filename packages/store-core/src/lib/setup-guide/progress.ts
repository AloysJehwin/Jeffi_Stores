import { query, queryMany } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import type { StepStatus } from './registry'

// Manual setup progress: what the app cannot see (applied on a date, approved, skipped). Store steps
// live in the store's own DB (setup_guide_progress); platform items in the control plane.

export const MANUAL_STATES = ['applied', 'approved', 'skipped'] as const
export type ManualState = (typeof MANUAL_STATES)[number]

export type ManualProgress = {
  step_id: string
  state: ManualState
  applied_at: string | null
  note: string | null
  updated_by: string | null
  updated_at: string
}

export interface ManualInput {
  state: ManualState | null
  appliedAt?: string | null
  note?: string | null
}

const MANUAL_STATUS: Record<ManualState, StepStatus> = { applied: 'in_progress', approved: 'done', skipped: 'skipped' }

/** A detected state wins; manual state fills in only where the app sees nothing (todo). */
export function mergeStatus(detected: StepStatus, manual: ManualState | null | undefined): StepStatus {
  if (detected !== 'todo' || !manual) return detected
  return MANUAL_STATUS[manual]
}

const COLS = `step_id, state, applied_at::text AS applied_at, note, updated_by, updated_at::text AS updated_at`

export async function listStoreProgress(): Promise<Map<string, ManualProgress>> {
  const rows = await queryMany<ManualProgress>(`SELECT ${COLS} FROM setup_guide_progress`).catch(() => [])
  return new Map(rows.map(r => [r.step_id, r]))
}

export async function setStoreProgress(stepId: string, input: ManualInput, by: string | null): Promise<void> {
  if (!input.state) {
    await query(`DELETE FROM setup_guide_progress WHERE step_id = $1`, [stepId])
    return
  }
  await query(
    `INSERT INTO setup_guide_progress (step_id, state, applied_at, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (step_id) DO UPDATE SET state = EXCLUDED.state, applied_at = EXCLUDED.applied_at,
       note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [stepId, input.state, input.appliedAt ?? null, input.note ?? null, by]
  )
}

const PCOLS = `item_id AS step_id, state, applied_at::text AS applied_at, note, updated_by, updated_at::text AS updated_at`

export async function listPlatformProgress(): Promise<Map<string, ManualProgress>> {
  const r = await controlPlanePool()
    .query<ManualProgress>(`SELECT ${PCOLS} FROM platform_setup_progress`)
    .catch(() => null)
  return new Map((r?.rows ?? []).map(row => [row.step_id, row]))
}

export async function setPlatformProgress(itemId: string, input: ManualInput, by: string | null): Promise<void> {
  const pool = controlPlanePool()
  if (!input.state) {
    await pool.query(`DELETE FROM platform_setup_progress WHERE item_id = $1`, [itemId])
    return
  }
  await pool.query(
    `INSERT INTO platform_setup_progress (item_id, state, applied_at, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (item_id) DO UPDATE SET state = EXCLUDED.state, applied_at = EXCLUDED.applied_at,
       note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [itemId, input.state, input.appliedAt ?? null, input.note ?? null, by]
  )
}
