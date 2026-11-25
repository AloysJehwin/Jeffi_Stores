import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runOutreachWorker } from '@controller/lib/outreach/worker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Platform job: dials the outreach contacts that are due (window, caps, DND, suppression and attempts enforced in
// lib/outreach/worker.ts) and settles calls that never reported an end.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runOutreachWorker())
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Outreach run failed' }, { status: 500 })
  }
}
