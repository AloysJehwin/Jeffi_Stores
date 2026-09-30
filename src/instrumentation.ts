// Redis is imported dynamically below — only in the nodejs runtime — because
// ioredis uses Node.js APIs (process.version.charCodeAt) that are unavailable
// in the edge runtime and cause a module evaluation crash if imported at the
// top level of instrumentation.ts (which Turbopack evaluates in both runtimes).

import { CRON_JOBS } from '@/lib/cron-jobs'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const CRON_SECRET = process.env.CRON_SECRET
  const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL

  if (!CRON_SECRET || !APP_URL) return

  const recordRun = async (jobId: string, ok: boolean, errorMsg?: string, detail?: unknown) => {
    try {
      await fetch(`${APP_URL}/api/internal/cron-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
        body: JSON.stringify({ jobId, ok, errorMsg, detail }),
      })
    } catch {}
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
    if (!won) return // Another instance is already running this job

    try {
      const res = await fetch(`${APP_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      })
      let body: unknown
      try {
        body = await res.json()
      } catch {
        body = undefined
      }
      await recordRun(jobId, res.ok, res.ok ? undefined : `HTTP ${res.status}`, body)
    } catch (err: any) {
      await recordRun(jobId, false, err?.message || 'fetch failed')
    }
  }

  // One staggered setTimeout per registered job, then its steady interval. The registry is the
  // single source for ids/paths/intervals so the recorder and status page always agree.
  for (const job of CRON_JOBS) {
    setTimeout(() => {
      callCron(job.id, job.path, job.method, job.lockTtlMs)
      setInterval(() => callCron(job.id, job.path, job.method, job.lockTtlMs), job.intervalMs)
    }, job.startDelayMs)
  }
}
