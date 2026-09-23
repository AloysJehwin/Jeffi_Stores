// Single source of truth for the in-app scheduler (src/instrumentation.ts), the run recorder
// (/api/internal/cron-record) and the admin status page (/api/admin/cron/status). A job that is
// scheduled but missing here is rejected by the recorder with 400 and its history is lost.

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface CronJob {
  id: string
  name: string
  path: string
  method: 'GET' | 'POST'
  intervalMs: number
  intervalLabel: string
  /** First run after boot; staggered so a cold instance does not fire everything at once. */
  startDelayMs: number
  /** Redis lock TTL, slightly shorter than the interval so it expires before the next tick. */
  lockTtlMs: number
  /**
   * Plan scope a TENANT must hold for this job to run against its store; null = platform-only
   * (control-plane / infra jobs). Drives the per-tenant fan-out.
   */
  tenantScope: string | null
}

export const CRON_JOBS: readonly CronJob[] = [
  { id: 'delhivery_sync', name: 'Delhivery status sync', path: '/api/admin/delhivery/sync-statuses', method: 'POST', intervalMs: 10 * MIN, intervalLabel: 'every 10 min', startDelayMs: 30 * SEC, lockTtlMs: 10 * MIN - 30 * SEC, tenantScope: 'delhivery:read' },
  { id: 'cancel_stale_orders', name: 'Cancel stale orders', path: '/api/cron/cancel-stale-orders', method: 'GET', intervalMs: MIN, intervalLabel: 'every 1 min', startDelayMs: 45 * SEC, lockTtlMs: MIN - 5 * SEC, tenantScope: 'orders:read' },
  { id: 'sweep_auto_tasks', name: 'Sweep auto tasks', path: '/api/cron/sweep-auto-tasks', method: 'GET', intervalMs: 30 * MIN, intervalLabel: 'every 30 min', startDelayMs: 90 * SEC, lockTtlMs: 30 * MIN - 30 * SEC, tenantScope: 'tasks:read' },
  { id: 'dispatch_mailer', name: 'Dispatch mailer', path: '/api/cron/dispatch-mailer', method: 'GET', intervalMs: MIN, intervalLabel: 'every 1 min', startDelayMs: 60 * SEC, lockTtlMs: MIN - 5 * SEC, tenantScope: 'mailer:read' },
  { id: 'run_campaigns', name: 'Run campaigns', path: '/api/cron/run-campaigns', method: 'GET', intervalMs: 30 * MIN, intervalLabel: 'every 30 min', startDelayMs: 120 * SEC, lockTtlMs: 30 * MIN - 30 * SEC, tenantScope: 'campaigns:read' },
  { id: 'compute_health', name: 'Compute store health', path: '/api/cron/compute-health', method: 'GET', intervalMs: 30 * MIN, intervalLabel: 'every 30 min', startDelayMs: 150 * SEC, lockTtlMs: 30 * MIN - 30 * SEC, tenantScope: 'crm:read' },
  { id: 'daily_briefing', name: 'Daily briefing email', path: '/api/cron/daily-briefing', method: 'GET', intervalMs: DAY, intervalLabel: 'every 24 h', startDelayMs: 180 * SEC, lockTtlMs: DAY - MIN, tenantScope: 'agent:read' },
  { id: 'provisioning_worker', name: 'Provisioning worker', path: '/api/internal/provisioning/worker', method: 'GET', intervalMs: 45 * SEC, intervalLabel: 'every 45 s', startDelayMs: 90 * SEC, lockTtlMs: 45 * SEC - 5 * SEC, tenantScope: null },
  { id: 'import_worker', name: 'Bulk import worker', path: '/api/internal/import/worker', method: 'GET', intervalMs: 45 * SEC, intervalLabel: 'every 45 s', startDelayMs: 105 * SEC, lockTtlMs: 45 * SEC - 5 * SEC, tenantScope: null },
  { id: 'provisioning_reconcile', name: 'Provisioning drift sweep', path: '/api/internal/provisioning/reconcile', method: 'POST', intervalMs: HOUR, intervalLabel: 'every 1 h', startDelayMs: 210 * SEC, lockTtlMs: HOUR - MIN, tenantScope: null },
  { id: 'publish_social_posts', name: 'Publish social posts', path: '/api/cron/publish-social-posts', method: 'GET', intervalMs: MIN, intervalLabel: 'every 1 min', startDelayMs: 240 * SEC, lockTtlMs: MIN - 5 * SEC, tenantScope: 'campaigns:read' },
  { id: 'customer_notes_digest', name: 'Customer notes digest', path: '/api/cron/customer-notes-digest', method: 'GET', intervalMs: DAY, intervalLabel: 'every 24 h', startDelayMs: 200 * SEC, lockTtlMs: DAY - MIN, tenantScope: 'customers:read' },
]

export const CRON_JOB_IDS: readonly string[] = CRON_JOBS.map(j => j.id)

export function isCronJobId(id: unknown): id is string {
  return typeof id === 'string' && CRON_JOB_IDS.includes(id)
}
