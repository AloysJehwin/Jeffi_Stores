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

  const callCron = async (jobId: string, path: string, method: 'GET' | 'POST') => {
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
    callCron('delhivery_sync', '/api/admin/delhivery/sync-statuses', 'POST')
    setInterval(() => callCron('delhivery_sync', '/api/admin/delhivery/sync-statuses', 'POST'), TEN_MIN)
  }, 30_000)

  setTimeout(() => {
    callCron('cancel_stale_orders', '/api/cron/cancel-stale-orders', 'GET')
    setInterval(() => callCron('cancel_stale_orders', '/api/cron/cancel-stale-orders', 'GET'), ONE_MIN)
  }, 45_000)

  setTimeout(() => {
    callCron('sweep_auto_tasks', '/api/cron/sweep-auto-tasks', 'GET')
    setInterval(() => callCron('sweep_auto_tasks', '/api/cron/sweep-auto-tasks', 'GET'), THIRTY_MIN)
  }, 90_000)

  setTimeout(() => {
    callCron('run_campaigns', '/api/cron/run-campaigns', 'GET')
    setInterval(() => callCron('run_campaigns', '/api/cron/run-campaigns', 'GET'), THIRTY_MIN)
  }, 120_000)

  setTimeout(() => {
    callCron('compute_health', '/api/cron/compute-health', 'GET')
    setInterval(() => callCron('compute_health', '/api/cron/compute-health', 'GET'), THIRTY_MIN)
  }, 150_000)

  setTimeout(() => {
    callCron('daily_briefing', '/api/cron/daily-briefing', 'GET')
    setInterval(() => callCron('daily_briefing', '/api/cron/daily-briefing', 'GET'), ONE_DAY)
  }, 180_000)
}
