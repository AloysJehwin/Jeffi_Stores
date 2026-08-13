// Redis is imported dynamically below — only in the nodejs runtime — because
// ioredis uses Node.js APIs (process.version.charCodeAt) that are unavailable
// in the edge runtime and cause a module evaluation crash if imported at the
// top level of instrumentation.ts (which Turbopack evaluates in both runtimes).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const CRON_SECRET = process.env.CRON_SECRET
  const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL

  if (!CRON_SECRET || !APP_URL) return

  const TEN_MIN    = 10 * 60 * 1000
  const ONE_MIN    =      60 * 1000
  const THIRTY_MIN = 30 * 60 * 1000
  const ONE_DAY    = 24 * 60 * 60 * 1000

  const recordRun = async (jobId: string, ok: boolean, errorMsg?: string, detail?: unknown) => {
    try {
      await fetch(`${APP_URL}/api/internal/cron-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
        body: JSON.stringify({ jobId, ok, errorMsg, detail }),
      })
    } catch {
    }
  }

  // Acquire a distributed Redis lock for the given job.
  // Returns true if this instance won the lock and should run the job.
  // TTL slightly shorter than the cron interval so the lock expires before next run.
  // Redis is imported dynamically so ioredis is never evaluated in the edge runtime.
  const acquireLock = async (jobId: string, ttlMs: number): Promise<boolean> => {
    try {
      const { default: redis } = await import('@/lib/redis')
      const key = `cron:lock:${jobId}`
      const result = await redis.set(key, '1', 'PX', ttlMs, 'NX' as any)
      return result === 'OK'
    } catch {
      // Redis unavailable — allow execution to avoid starvation
      return true
    }
  }

  const callCron = async (jobId: string, path: string, method: 'GET' | 'POST', lockTtlMs: number) => {
    const won = await acquireLock(jobId, lockTtlMs)
    if (!won) return  // Another instance is already running this job

    try {
      const res = await fetch(`${APP_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      })
      let body: unknown
      try { body = await res.json() } catch { body = undefined }
      await recordRun(jobId, res.ok, res.ok ? undefined : `HTTP ${res.status}`, body)
    } catch (err: any) {
      await recordRun(jobId, false, err?.message || 'fetch failed')
    }
  }

  setTimeout(() => {
    callCron('delhivery_sync', '/api/admin/delhivery/sync-statuses', 'POST', TEN_MIN - 30_000)
    setInterval(() => callCron('delhivery_sync', '/api/admin/delhivery/sync-statuses', 'POST', TEN_MIN - 30_000), TEN_MIN)
  }, 30_000)

  setTimeout(() => {
    callCron('cancel_stale_orders', '/api/cron/cancel-stale-orders', 'GET', ONE_MIN - 5_000)
    setInterval(() => callCron('cancel_stale_orders', '/api/cron/cancel-stale-orders', 'GET', ONE_MIN - 5_000), ONE_MIN)
  }, 45_000)

  setTimeout(() => {
    callCron('sweep_auto_tasks', '/api/cron/sweep-auto-tasks', 'GET', THIRTY_MIN - 30_000)
    setInterval(() => callCron('sweep_auto_tasks', '/api/cron/sweep-auto-tasks', 'GET', THIRTY_MIN - 30_000), THIRTY_MIN)
  }, 90_000)

  setTimeout(() => {
    callCron('dispatch_mailer', '/api/cron/dispatch-mailer', 'GET', ONE_MIN - 5_000)
    setInterval(() => callCron('dispatch_mailer', '/api/cron/dispatch-mailer', 'GET', ONE_MIN - 5_000), ONE_MIN)
  }, 60_000)

  setTimeout(() => {
    callCron('run_campaigns', '/api/cron/run-campaigns', 'GET', THIRTY_MIN - 30_000)
    setInterval(() => callCron('run_campaigns', '/api/cron/run-campaigns', 'GET', THIRTY_MIN - 30_000), THIRTY_MIN)
  }, 120_000)

  setTimeout(() => {
    callCron('compute_health', '/api/cron/compute-health', 'GET', THIRTY_MIN - 30_000)
    setInterval(() => callCron('compute_health', '/api/cron/compute-health', 'GET', THIRTY_MIN - 30_000), THIRTY_MIN)
  }, 150_000)

  setTimeout(() => {
    callCron('daily_briefing', '/api/cron/daily-briefing', 'GET', ONE_DAY - 60_000)
    setInterval(() => callCron('daily_briefing', '/api/cron/daily-briefing', 'GET', ONE_DAY - 60_000), ONE_DAY)
  }, 180_000)
}
