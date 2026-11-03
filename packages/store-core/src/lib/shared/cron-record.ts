import { query, queryOne } from '@/lib/shared/db'

// Record a cron job run into the CURRENT store's site_settings (tenant pool via db.ts — the store is
// whatever ensureTenantContext resolves: the ALS tenant when called in-process, or the Host-resolved
// tenant when called from the HTTP cron-record route). Shared by /api/internal/cron-record (k8s path)
// and the in-process manual trigger so both write identical cron_last_* keys + a rolling log.
export async function recordCronRun(
  jobId: string,
  ok: boolean,
  errorMsg?: string,
  detail?: unknown
): Promise<void> {
  const now = new Date().toISOString()
  const upserts: Array<[string, string]> = [
    [`cron_last_run_${jobId}`, now],
    [`cron_last_status_${jobId}`, ok ? 'ok' : 'error'],
    [`cron_last_error_${jobId}`, !ok && errorMsg ? String(errorMsg).slice(0, 500) : ''],
  ]
  for (const [key, value] of upserts) {
    await query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    )
  }

  const logKey = `cron_log_${jobId}`
  const existing = await queryOne<{ value: string }>(`SELECT value FROM site_settings WHERE key = $1`, [logKey])
  let entries: Array<{ t: string; ok: boolean; err?: string; detail?: unknown }> = []
  try {
    entries = existing ? JSON.parse(existing.value) : []
  } catch {
    entries = []
  }
  entries.unshift({
    t: now,
    ok: !!ok,
    err: !ok && errorMsg ? String(errorMsg).slice(0, 200) : undefined,
    ...(detail !== undefined ? { detail } : {}),
  })
  if (entries.length > 50) entries = entries.slice(0, 50)
  await query(
    `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [logKey, JSON.stringify(entries)]
  )
}
