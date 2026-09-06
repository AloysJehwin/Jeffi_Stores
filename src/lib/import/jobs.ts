import { controlPlanePool } from '@/lib/tenant-registry'
import { getCurrentTenantId } from '@/lib/tenant-context'

// On the platform (flagship) admin there is no ALS tenant — middleware sets one only on tenant
// hosts. import_jobs.tenant_id is NOT NULL, so flagship jobs are keyed to this sentinel; the worker
// runs them with NO tenant context (the platform pool), exactly how flagship product publishing works.
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

/** The tenant id to key an import job to: the current ALS tenant, or the platform sentinel on flagship. */
export function resolveImportTenantId(): string {
  return getCurrentTenantId() ?? PLATFORM_TENANT_ID
}

export type ImportSource = 'upload' | 'google_sheet'
export type ImportStatus = 'pending' | 'running' | 'done' | 'failed'

export interface RowResult {
  row: number
  sku: string | null
  outcome: 'created' | 'updated' | 'error' | 'warning' | 'deleted'
  message?: string
}

export interface PendingDeletion {
  productId: string
  sku: string
  name: string
}

export interface ImageProgress {
  total: number
  fetched: number
  failed: number
}

export interface ImportJob {
  id: string
  tenant_id: string
  source: ImportSource
  status: ImportStatus
  file_key: string | null
  spreadsheet_id: string | null
  total_rows: number
  processed_rows: number
  created_count: number
  updated_count: number
  error_count: number
  row_results: RowResult[]
  image_progress: ImageProgress
  pending_deletions: PendingDeletion[]
  last_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

export async function enqueueImportJob(input: {
  tenantId: string
  source: ImportSource
  fileKey?: string | null
  spreadsheetId?: string | null
  totalRows: number
  createdBy?: string | null
}): Promise<ImportJob> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `INSERT INTO import_jobs (tenant_id, source, file_key, spreadsheet_id, total_rows, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.tenantId, input.source, input.fileKey ?? null, input.spreadsheetId ?? null, input.totalRows, input.createdBy ?? null],
  )
  return res.rows[0] as ImportJob
}

// Claim the oldest pending job atomically (multi-instance safe). Only one worker wins a
// given row; the losers get null. Returns the claimed job already flipped to running.
export async function claimNextImportJob(): Promise<ImportJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `UPDATE import_jobs SET status='running', updated_at=now()
     WHERE id = (
       SELECT id FROM import_jobs WHERE status='pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  )
  return (res.rows[0] as ImportJob) || null
}

export async function updateImportJob(
  id: string,
  patch: Partial<{
    status: ImportStatus
    processed_rows: number
    created_count: number
    updated_count: number
    error_count: number
    row_results: RowResult[]
    image_progress: ImageProgress
    pending_deletions: PendingDeletion[]
    last_error: string | null
    finished: boolean
  }>,
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: unknown[] = []
  const set = (col: string, val: unknown, cast = '') => { args.push(val); sets.push(`${col}=$${args.length}${cast}`) }
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.processed_rows !== undefined) set('processed_rows', patch.processed_rows)
  if (patch.created_count !== undefined) set('created_count', patch.created_count)
  if (patch.updated_count !== undefined) set('updated_count', patch.updated_count)
  if (patch.error_count !== undefined) set('error_count', patch.error_count)
  if (patch.row_results !== undefined) set('row_results', JSON.stringify(patch.row_results), '::jsonb')
  if (patch.image_progress !== undefined) set('image_progress', JSON.stringify(patch.image_progress), '::jsonb')
  if (patch.pending_deletions !== undefined) set('pending_deletions', JSON.stringify(patch.pending_deletions), '::jsonb')
  if (patch.last_error !== undefined) set('last_error', patch.last_error)
  if (patch.finished) sets.push('finished_at = now()')
  args.push(id)
  await pool.query(`UPDATE import_jobs SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

export async function getImportJob(id: string, tenantId: string): Promise<ImportJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
  return (res.rows[0] as ImportJob) || null
}

export async function listImportJobs(tenantId: string, limit = 30): Promise<ImportJob[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM import_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit],
  )
  return res.rows as ImportJob[]
}

export async function latestJobBySource(tenantId: string, source: ImportSource): Promise<ImportJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM import_jobs WHERE tenant_id=$1 AND source=$2 ORDER BY created_at DESC LIMIT 1`,
    [tenantId, source],
  )
  return (res.rows[0] as ImportJob) || null
}

export interface GsheetSyncSummary {
  id: string
  status: ImportStatus
  totalRows: number
  processedRows: number
  createdCount: number
  updatedCount: number
  errorCount: number
  imageProgress: ImageProgress
  pendingDeletions: PendingDeletion[]
  lastError: string | null
  createdAt: string
  finishedAt: string | null
}

export interface GsheetStatus {
  enabled: boolean
  connected: boolean
  spreadsheetId: string | null
  lastSync: GsheetSyncSummary | null
}

/** Single source of truth for the Data Source Google-sheet tab state, shared by the status route
 * and the SSR page so the tab renders on first paint without a client round-trip. Never returns the
 * refresh token — only the non-secret spreadsheet id from meta. */
export async function getGsheetStatus(tenantId: string): Promise<GsheetStatus> {
  const { getIntegrationCredential } = await import('@/lib/tenant-registry')
  const row = await getIntegrationCredential(tenantId, 'google_sheets')
  const connected = !!row && row.status === 'connected'
  const spreadsheetId = (row?.meta as any)?.spreadsheet_id || null

  const last = await latestJobBySource(tenantId, 'google_sheet')
  const lastSync: GsheetSyncSummary | null = last
    ? {
        id: last.id,
        status: last.status,
        totalRows: last.total_rows,
        processedRows: last.processed_rows,
        createdCount: last.created_count,
        updatedCount: last.updated_count,
        errorCount: last.error_count,
        imageProgress: last.image_progress,
        pendingDeletions: last.pending_deletions ?? [],
        lastError: last.last_error,
        createdAt: last.created_at,
        finishedAt: last.finished_at,
      }
    : null

  return { enabled: true, connected, spreadsheetId, lastSync }
}
