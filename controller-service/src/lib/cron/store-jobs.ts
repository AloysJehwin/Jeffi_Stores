import 'server-only'
import { getTenantPlan } from '@/lib/auth/plan-gate'
import { storeCronJobs } from '@/lib/shared/cron-jobs'
import { queryMany } from '@/lib/shared/db'

export interface StoreCronRun {
  at: string | null
  status: 'ok' | 'failed' | 'skipped'
  detail: string | null
}

export interface StoreCronJobView {
  id: string
  name: string
  interval: string
  last: StoreCronRun | null
}

/**
 * The jobs a store's plan gets and, for each, the store's result in the newest fan-out run that included it.
 * Runs are recorded on the controller (/api/internal/cron-record) in the flagship's site_settings, cron_log_{id},
 * newest first, each with the fan-out's body as `detail`; only the matching result leaves the database.
 */
export async function loadStoreCronJobs(tenantId: string, slug: string): Promise<StoreCronJobView[]> {
  const scopes = await getTenantPlan(tenantId).then(
    p => p.scopes,
    () => new Set<string>()
  )
  const jobs = storeCronJobs(scopes)
  if (!jobs.length) return []
  const rows = await queryMany<{ key: string; t: string | null; r: { status?: string; detail?: string } }>(
    `SELECT s.key, x.t, x.r
       FROM site_settings s
       CROSS JOIN LATERAL (
         SELECT e->>'t' AS t, r
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.value::jsonb) = 'array' THEN s.value::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS a(e, i),
                jsonb_array_elements(CASE WHEN jsonb_typeof(e->'detail'->'results') = 'array' THEN e->'detail'->'results' ELSE '[]'::jsonb END) AS r
          WHERE r->>'slug' = $2
          ORDER BY a.i
          LIMIT 1
       ) x
      WHERE s.key = ANY($1::text[])`,
    [jobs.map(j => `cron_log_${j.id}`), slug]
  ).catch(() => [])
  const last = new Map(rows.map(row => [row.key.slice('cron_log_'.length), row]))
  return jobs.map(j => {
    const row = last.get(j.id)
    const status = row?.r?.status
    return {
      id: j.id,
      name: j.name,
      interval: j.intervalLabel,
      last: row && (status === 'ok' || status === 'failed' || status === 'skipped') ? { at: row.t, status, detail: row.r.detail ?? null } : null,
    }
  })
}
