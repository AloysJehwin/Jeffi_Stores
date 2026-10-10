import { NextRequest, NextResponse } from 'next/server'
import { isCronJobId } from '@/lib/shared/cron-jobs'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { recordCronRun } from '@/lib/shared/cron-record'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { jobId, ok, errorMsg, detail } = body
  if (!isCronJobId(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })

  await recordCronRun(jobId, !!ok, errorMsg, detail)
  return NextResponse.json({ ok: true })
}
