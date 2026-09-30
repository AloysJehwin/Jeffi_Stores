import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/shared/db'
import { isCronJobId } from '@/lib/shared/cron-jobs'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { jobId, ok, errorMsg, detail } = body

  if (!isCronJobId(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })

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

  return NextResponse.json({ ok: true })
}
