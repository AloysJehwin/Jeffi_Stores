import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createJob, SHOWCASE_PROGRAM } from '@controller/lib/outreach/agent/jobs'
import { getAgent } from '@controller/lib/outreach/agent/skill/store'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { normalizePhone } from '@controller/lib/outreach/phone'
import { getProgramState } from '@controller/lib/outreach/program-state'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i
const Body = z.object({ inputs: z.record(z.string(), z.unknown()) })

// POST { inputs } → a test job due now, for one of the program's test numbers only (like the test call).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid agent id' }, { status: 400 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    const agent = await getAgent(id)
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    const key = Object.entries(agent.resolved.skill.meta.inputs).find(([, s]) => s.role === 'contact')?.[0]
    const phone = key ? normalizePhone(parsed.data.inputs[key]) : null
    if (!phone) return NextResponse.json({ error: `${key ?? 'The contact input'} must be a valid Indian mobile number` }, { status: 400 })
    const state = await getProgramState(SHOWCASE_PROGRAM)
    if (!(state.test_numbers ?? []).includes(phone)) return NextResponse.json({ error: 'A test job only goes to one of the program\'s test numbers (Outreach settings)' }, { status: 400 })
    const out = await createJob({ skillId: id, inputs: parsed.data.inputs, source: 'test', dueAt: new Date(), actor: admin })
    if (!out.job) return NextResponse.json({ error: out.errors[0] ?? 'Could not create the test job', errors: out.errors }, { status: 400 })
    return NextResponse.json({ jobId: out.job.id, created: out.created }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}
