export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const CRON_SECRET = process.env.CRON_SECRET
  const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL

  if (!CRON_SECRET || !APP_URL) return

  const INTERVAL_MS = 10 * 60 * 1000

  const runSync = async () => {
    try {
      await fetch(`${APP_URL}/api/admin/delhivery/sync-statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      })
    } catch {
    }
  }

  setTimeout(() => {
    runSync()
    setInterval(runSync, INTERVAL_MS)
  }, 30_000)
}
