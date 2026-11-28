import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { createJob } from '@controller/lib/outreach/agent/jobs'
import { activeTriggerAgents } from '@controller/lib/outreach/agent/skill/store'
import { findTriggerCandidates } from '@controller/lib/outreach/agent/store/triggers'
import { outreachPool } from '@controller/lib/outreach/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const PER_AGENT = 100

// Platform job: for each active task agent with an event trigger, polls the flagship store for that event (lib/outreach/
// agent/store/triggers.ts) and creates a job per new occurrence. createJob validates the inputs, resolves the references
// and dedupes on (agent, source ref), so a re-run never creates a second job. One agent failing does not stop the others.
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const out = { agents: 0, candidates: 0, created: 0, duplicates: 0, failed: 0 }
  const errors: string[] = []
  const agents = await activeTriggerAgents()
  for (const a of agents) {
    // Showcase (lead) agents are fed by lists; events only exist for the store's shoppers.
    if (a.meta.audience !== 'shopper' || a.meta.trigger.event === 'manual') continue
    out.agents++
    try {
      const found = await findTriggerCandidates(a.meta.trigger, a.meta.inputs, now)
      out.candidates += found.length
      // Skip what already has a job: the poll sees an event on every run until it leaves the lookback window.
      const known = found.length
        ? new Set<string>(
            (await outreachPool().query(`SELECT source_ref FROM outreach_jobs WHERE skill_id = $1 AND source_ref = ANY($2::text[])`, [a.skillId, found.map(c => c.sourceRef)])).rows.map((r: { source_ref: string }) => r.source_ref)
          )
        : new Set<string>()
      out.duplicates += found.filter(c => known.has(c.sourceRef)).length
      for (const c of found.filter(c => !known.has(c.sourceRef)).slice(0, PER_AGENT)) {
        const r = await createJob({ skillId: a.skillId, inputs: c.inputs, source: 'event', sourceRef: c.sourceRef, dueAt: c.dueAt, actor: { id: null, label: 'outreach-triggers' } })
        if (r.created) out.created++
        else if (r.job) out.duplicates++
        else {
          out.failed++
          if (errors.length < 5) errors.push(`${a.meta.name}: ${r.errors[0] ?? 'not created'}`)
        }
      }
    } catch (e) {
      out.failed++
      errors.push(`${a.meta.name}: ${(e as Error)?.message || 'trigger poll failed'}`)
    }
  }
  return NextResponse.json({ ...out, ...(errors.length ? { errors } : {}) }, { status: errors.length && !out.created ? 500 : 200 })
}
