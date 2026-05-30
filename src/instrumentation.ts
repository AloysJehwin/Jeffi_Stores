export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const CRON_SECRET = process.env.CRON_SECRET
  const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL

  if (!CRON_SECRET || !APP_URL) return

  const TEN_MIN    = 10 * 60 * 1000
  const ONE_MIN    =      60 * 1000
  const THIRTY_MIN = 30 * 60 * 1000

  const callCron = async (path: string, method: 'GET' | 'POST') => {
    try {
      await fetch(`${APP_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      })
    } catch {
    }
  }

  setTimeout(() => {
    callCron('/api/admin/delhivery/sync-statuses', 'POST')
    setInterval(() => callCron('/api/admin/delhivery/sync-statuses', 'POST'), TEN_MIN)
  }, 30_000)

  setTimeout(() => {
    callCron('/api/cron/cancel-stale-orders', 'GET')
    setInterval(() => callCron('/api/cron/cancel-stale-orders', 'GET'), ONE_MIN)
  }, 45_000)

  setTimeout(() => {
    callCron('/api/cron/sweep-auto-tasks', 'GET')
    setInterval(() => callCron('/api/cron/sweep-auto-tasks', 'GET'), THIRTY_MIN)
  }, 90_000)

  setTimeout(() => {
    callCron('/api/cron/run-campaigns', 'GET')
    setInterval(() => callCron('/api/cron/run-campaigns', 'GET'), THIRTY_MIN)
  }, 120_000)

  setTimeout(() => {
    callCron('/api/cron/compute-health', 'GET')
    setInterval(() => callCron('/api/cron/compute-health', 'GET'), THIRTY_MIN)
  }, 150_000)
}
