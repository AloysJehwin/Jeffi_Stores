import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runDueAgentTasks } from '@controller/lib/outreach/agent/runtime'
import { runOutreachWorker } from '@controller/lib/outreach/worker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Platform job: dials the outreach contacts that are due (window, caps, DND, suppression and attempts enforced in
// lib/outreach/worker.ts), settles calls that never reported an end, then runs the agent's own due tasks (follow-up
// turns and calls it scheduled). Each half is isolated: one failing does not stop the other.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const errors: string[] = []
  const attempt = async <T>(fn: () => Promise<T>, label: string): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      errors.push((e as Error)?.message || `${label} failed`)
      return null
    }
  }
  const worker = await attempt(runOutreachWorker, 'Outreach run')
  const agent = await attempt(runDueAgentTasks, 'Agent run')
  if (errors.length) return NextResponse.json({ ...(worker ?? {}), agent, error: errors[0] }, { status: 500 })
  return NextResponse.json({ ...worker, agent })
}
