import { controlPlanePool } from '@/lib/tenant-registry'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

// On the platform (flagship) admin there is no ALS tenant — middleware sets one only on tenant
// hosts. import_jobs.tenant_id is NOT NULL, so flagship jobs are keyed to this sentinel; the worker
// runs them with NO tenant context (the platform pool), exactly how flagship product publishing works.
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

/** The tenant id to key an import job to: the current request's tenant, or the platform sentinel on flagship. */
export async function resolveImportTenantId(): Promise<string> {
  return (await resolveTenantId()) ?? PLATFORM_TENANT_ID
}

export type ImportSource = 'upload' | 'google_sheet'
export type ImportStatus = 'pending' | 'running' | 'done' | 'failed'

export interface RowResult {
  row: number
  sheet?: string
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
    [
      input.tenantId,
      input.source,
      input.fileKey ?? null,
      input.spreadsheetId ?? null,
      input.totalRows,
      input.createdBy ?? null,
    ]
  )
  return res.rows[0] as ImportJob
}

/** A running job with no progress write for this long is dead (its worker was lost to a restart). */
export const STALE_JOB_MINUTES = 15

// Claim the oldest pending job atomically (multi-instance safe). A global advisory lock serialises
// claims, and a tenant that already has a live running job is skipped, so two jobs of one store
// never publish at once (concurrent creates of the same SKU would race).
export async function claimNextImportJob(): Promise<ImportJob | null> {
  const client = await controlPlanePool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('import_jobs:claim'))`)
    const res = await client.query(
      `UPDATE import_jobs SET status='running', updated_at=now()
       WHERE id = (
         SELECT j.id FROM import_jobs j
         WHERE j.status='pending'
           AND NOT EXISTS (
             SELECT 1 FROM import_jobs r
             WHERE r.tenant_id = j.tenant_id AND r.status='running'
               AND r.updated_at > now() - make_interval(mins => $1)
           )
         ORDER BY j.created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [STALE_JOB_MINUTES]
    )
    await client.query('COMMIT')
    return (res.rows[0] as ImportJob) || null
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export const STALE_JOB_MESSAGE =
  'The import stopped before it finished (the worker restarted). Products saved before that are kept; run it again to finish.'

/** Fail running jobs that stopped writing progress, so they stop blocking new work and show as failed. */
export async function failStaleImportJobs(tenantId?: string): Promise<number> {
  const res = await controlPlanePool().query(
    `UPDATE import_jobs SET status='failed', last_error=$1, finished_at=now(), updated_at=now()
     WHERE status='running' AND updated_at < now() - make_interval(mins => $2)
       AND ($3::uuid IS NULL OR tenant_id = $3::uuid)`,
    [STALE_JOB_MESSAGE, STALE_JOB_MINUTES, tenantId ?? null]
  )
  return res.rowCount ?? 0
}

export async function updateImportJob(
  id: string,
  patch: Partial<{
    status: ImportStatus
    total_rows: number
    processed_rows: number
    created_count: number
    updated_count: number
    error_count: number
    row_results: RowResult[]
    image_progress: ImageProgress
    pending_deletions: PendingDeletion[]
    last_error: string | null
    finished: boolean
  }>
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: unknown[] = []
  const set = (col: string, val: unknown, cast = '') => {
    args.push(val)
    sets.push(`${col}=$${args.length}${cast}`)
  }
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.total_rows !== undefined) set('total_rows', patch.total_rows)
  if (patch.processed_rows !== undefined) set('processed_rows', patch.processed_rows)
  if (patch.created_count !== undefined) set('created_count', patch.created_count)
  if (patch.updated_count !== undefined) set('updated_count', patch.updated_count)
  if (patch.error_count !== undefined) set('error_count', patch.error_count)
  if (patch.row_results !== undefined) set('row_results', JSON.stringify(patch.row_results), '::jsonb')
  if (patch.image_progress !== undefined) set('image_progress', JSON.stringify(patch.image_progress), '::jsonb')
  if (patch.pending_deletions !== undefined)
    set('pending_deletions', JSON.stringify(patch.pending_deletions), '::jsonb')
  if (patch.last_error !== undefined) set('last_error', patch.last_error)
  if (patch.finished) sets.push('finished_at = now()')
  args.push(id)
  await pool.query(`UPDATE import_jobs SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export async function getImportJob(id: string, tenantId: string): Promise<ImportJob | null> {
  if (!isUuid(id)) return null
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
  return (res.rows[0] as ImportJob) || null
}

export type JobListFilter = 'all' | 'active' | 'done' | 'failed' | 'with_errors'

/** A history page without row_results (the detail route returns those), newest first. */
export async function listImportJobs(
  tenantId: string,
  opts: number | { limit?: number; offset?: number; status?: JobListFilter; source?: ImportSource | 'all' } = {}
): Promise<ImportJob[]> {
  return (await pageImportJobs(tenantId, typeof opts === 'number' ? { limit: opts } : opts)).jobs
}

export async function pageImportJobs(
  tenantId: string,
  opts: { limit?: number; offset?: number; status?: JobListFilter; source?: ImportSource | 'all' } = {}
): Promise<{ jobs: ImportJob[]; total: number }> {
  const int = (v: number | undefined, d: number) => (Number.isFinite(v) ? Math.trunc(v as number) : d)
  const limit = Math.min(Math.max(int(opts.limit, 30), 1), 100)
  const offset = Math.min(Math.max(int(opts.offset, 0), 0), 1_000_000)
  const where = ['tenant_id=$1']
  const args: unknown[] = [tenantId]
  if (opts.status === 'active') where.push(`status IN ('pending','running')`)
  else if (opts.status === 'done') where.push(`status='done' AND error_count=0`)
  else if (opts.status === 'failed') where.push(`status='failed'`)
  else if (opts.status === 'with_errors') where.push(`status='done' AND error_count>0`)
  if (opts.source === 'upload' || opts.source === 'google_sheet') {
    args.push(opts.source)
    where.push(`source=$${args.length}`)
  }
  const pool = controlPlanePool()
  const w = where.join(' AND ')
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT id, tenant_id, source, status, file_key, spreadsheet_id, total_rows, processed_rows, created_count,
              updated_count, error_count, '[]'::jsonb AS row_results, image_progress, pending_deletions, last_error,
              created_by, created_at, updated_at, finished_at
       FROM import_jobs WHERE ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      args
    ),
    pool.query(`SELECT count(*)::int AS n FROM import_jobs WHERE ${w}`, args),
  ])
  return { jobs: rows.rows as ImportJob[], total: total.rows[0]?.n ?? 0 }
}

export async function latestJobBySource(tenantId: string, source: ImportSource): Promise<ImportJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM import_jobs WHERE tenant_id=$1 AND source=$2 ORDER BY created_at DESC LIMIT 1`,
    [tenantId, source]
  )
  return (res.rows[0] as ImportJob) || null
}

/** A 'running' row with no progress write for 15 minutes is dead: a worker lost to a restart never updates it again. */
export async function isSheetSyncRunning(tenantId: string): Promise<boolean> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT 1 FROM import_jobs
     WHERE tenant_id=$1 AND source='google_sheet' AND status='running' AND updated_at > now() - interval '15 minutes'
     LIMIT 1`,
    [tenantId]
  )
  return res.rows.length > 0
}

/** A sheet sync that is queued or still writing progress. */
export async function hasActiveSheetSync(tenantId: string): Promise<boolean> {
  const res = await controlPlanePool().query(
    `SELECT 1 FROM import_jobs
     WHERE tenant_id=$1 AND source='google_sheet'
       AND (status='pending' OR (status='running' AND updated_at > now() - make_interval(mins => $2)))
     LIMIT 1`,
    [tenantId, STALE_JOB_MINUTES]
  )
  return res.rows.length > 0
}

/** An upload of the same file (by content fingerprint in its staged key) that is queued or running. */
export async function findActiveUploadByFingerprint(tenantId: string, fingerprint: string): Promise<ImportJob | null> {
  const res = await controlPlanePool().query(
    `SELECT * FROM import_jobs
     WHERE tenant_id=$1 AND source='upload' AND status IN ('pending','running')
       AND file_key LIKE $2 AND created_at > now() - interval '30 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, `%-${fingerprint}-%`]
  )
  return (res.rows[0] as ImportJob) || null
}

export class ImportBusyError extends Error {
  constructor(message = 'Another action on this data source is in progress. Try again in a moment.') {
    super(message)
    this.name = 'ImportBusyError'
  }
}

/** Run `fn` holding a per-tenant advisory lock; throws ImportBusyError when someone else holds it. */
export async function withImportLock<T>(tenantId: string, kind: 'sheet' | 'upload', fn: () => Promise<T>): Promise<T> {
  const client = await controlPlanePool().connect()
  const key = `import:${kind}:${tenantId}`
  try {
    const got = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key])
    if (!got.rows[0]?.ok) throw new ImportBusyError()
    try {
      return await fn()
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {})
    }
  } finally {
    client.release()
  }
}

export async function cancelPendingSheetSyncs(tenantId: string, reason: string): Promise<number> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `UPDATE import_jobs SET status='failed', last_error=$2, finished_at=now(), updated_at=now()
     WHERE tenant_id=$1 AND source='google_sheet' AND status='pending'`,
    [tenantId, reason]
  )
  return res.rowCount ?? 0
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
  // connected | needs_reconnect (refresh token refused) | not_connected
  state: 'connected' | 'needs_reconnect' | 'not_connected'
  spreadsheetId: string | null
  account: string | null
  connectedAt: string | null
  // Granted drive.file, so "Create sheet" can make a file in the account's Drive.
  canCreate: boolean
  lastSync: GsheetSyncSummary | null
}

export const toSyncSummary = (last: ImportJob): GsheetSyncSummary => ({
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
})

/** Single source of truth for the Data Source Google-sheet tab state, shared by the status route
 * and the SSR page. Never returns the refresh token, only non-secret meta. */
export async function getGsheetStatus(tenantId: string): Promise<GsheetStatus> {
  const { getIntegrationCredential } = await import('@/lib/tenant-registry')
  const row = await getIntegrationCredential(tenantId, 'google_sheets')
  const meta = (row?.meta ?? {}) as Record<string, unknown>
  const connected = !!row && row.status === 'connected'
  const needsReconnect = connected && !!meta.needs_reconnect
  const last = await latestJobBySource(tenantId, 'google_sheet')
  return {
    enabled: true,
    connected: connected && !needsReconnect,
    state: !connected ? 'not_connected' : needsReconnect ? 'needs_reconnect' : 'connected',
    spreadsheetId: typeof meta.spreadsheet_id === 'string' && meta.spreadsheet_id ? meta.spreadsheet_id : null,
    account: typeof meta.account_email === 'string' ? meta.account_email : null,
    connectedAt: connected ? ((row as { updated_at?: string }).updated_at ?? null) : null,
    // Older connections did not record scopes; they asked for drive.file, so assume it.
    canCreate: connected && meta.can_create !== false,
    lastSync: last ? toSyncSummary(last) : null,
  }
}

/** Flag (or clear) a Google Sheets connection whose refresh token Google refused. */
export async function setSheetsNeedsReconnect(tenantId: string, needs: boolean): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_integration_credentials
     SET meta = CASE WHEN $3 THEN meta || jsonb_build_object('needs_reconnect', true, 'needs_reconnect_at', now())
                     ELSE meta - 'needs_reconnect' - 'needs_reconnect_at' END
     WHERE tenant_id=$1 AND provider=$2`,
    [tenantId, 'google_sheets', needs]
  )
}

/** Point the connection at another spreadsheet (stored config and the non-secret meta). */
export async function setSheetsSpreadsheet(tenantId: string, spreadsheetId: string): Promise<void> {
  const { getIntegrationCredential, saveIntegrationCredential } = await import('@/lib/tenant-registry')
  const { encryptToken, decryptToken } = await import('@/lib/crypto/token-cipher')
  const row = await getIntegrationCredential(tenantId, 'google_sheets')
  if (!row) return
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(decryptToken(row.config_enc))
  } catch {}
  config.spreadsheet_id = spreadsheetId
  const meta = { ...(row.meta ?? {}), spreadsheet_id: spreadsheetId }
  delete (meta as Record<string, unknown>).needs_spreadsheet_id
  await saveIntegrationCredential({
    tenantId,
    provider: 'google_sheets',
    label: row.label ?? 'Google Sheet (product sync)',
    configEnc: encryptToken(JSON.stringify(config)),
    meta,
  })
}

export interface ImportStats {
  days: number
  jobs: number
  created: number
  updated: number
  failedRows: number
  failedJobs: number
  withErrors: number
  lastImport: ImportJob | null
  active: ImportJob[]
  stuck: ImportJob[]
  waiting: ImportJob[]
}

/** Import-job numbers for the overview tab (row_results omitted). */
export async function getImportStats(tenantId: string, days = 30): Promise<ImportStats> {
  const pool = controlPlanePool()
  const cols = `id, tenant_id, source, status, file_key, spreadsheet_id, total_rows, processed_rows, created_count,
    updated_count, error_count, '[]'::jsonb AS row_results, image_progress, pending_deletions, last_error, created_by,
    created_at, updated_at, finished_at`
  const [agg, last, active] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS jobs, coalesce(sum(created_count),0)::int AS created,
              coalesce(sum(updated_count),0)::int AS updated, coalesce(sum(error_count),0)::int AS failed_rows,
              count(*) FILTER (WHERE status='failed')::int AS failed_jobs,
              count(*) FILTER (WHERE status='done' AND error_count>0)::int AS with_errors
       FROM import_jobs WHERE tenant_id=$1 AND created_at > now() - make_interval(days => $2)`,
      [tenantId, days]
    ),
    pool.query(`SELECT ${cols} FROM import_jobs WHERE tenant_id=$1 AND source='upload' ORDER BY created_at DESC LIMIT 1`, [
      tenantId,
    ]),
    pool.query(
      `SELECT ${cols} FROM import_jobs WHERE tenant_id=$1 AND status IN ('pending','running') ORDER BY created_at`,
      [tenantId]
    ),
  ])
  const a = agg.rows[0] ?? {}
  const now = Date.now()
  const activeJobs = active.rows as ImportJob[]
  const age = (j: ImportJob, col: 'updated_at' | 'created_at') => now - new Date(j[col]).getTime()
  return {
    days,
    jobs: a.jobs ?? 0,
    created: a.created ?? 0,
    updated: a.updated ?? 0,
    failedRows: a.failed_rows ?? 0,
    failedJobs: a.failed_jobs ?? 0,
    withErrors: a.with_errors ?? 0,
    lastImport: (last.rows[0] as ImportJob) ?? null,
    active: activeJobs,
    stuck: activeJobs.filter(j => j.status === 'running' && age(j, 'updated_at') > STALE_JOB_MINUTES * 60_000),
    // Queued for over 5 minutes: the worker is not picking jobs up.
    waiting: activeJobs.filter(j => j.status === 'pending' && age(j, 'created_at') > 5 * 60_000),
  }
}
