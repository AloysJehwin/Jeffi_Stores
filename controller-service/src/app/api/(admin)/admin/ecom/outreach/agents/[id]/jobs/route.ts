import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createJob, JobError, listJobs } from '@controller/lib/outreach/agent/jobs'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i
type Ctx = { params: Promise<{ id: string }> }

const MAX_ROWS = 200

// GET ?status=&outcome=&page= → { rows: JobListRow[], total, page, pageSize }
export async function GET(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid agent id' }, { status: 400 })
  const q = req.nextUrl.searchParams
  try {
    return NextResponse.json(await listJobs(id, { status: q.get('status') || undefined, outcome: q.get('outcome') || undefined, page: Number(q.get('page')) || 1 }))
  } catch (e) {
    return serverError(e)
  }
}

const Row = z.object({ inputs: z.record(z.string(), z.unknown()), dueAt: z.string().datetime({ offset: true }).optional() })
const Body = z.union([Row, z.object({ rows: z.array(Row).min(1).max(MAX_ROWS) })])

// POST { inputs, dueAt? } (the form) or { rows: [{ inputs, dueAt? }] } (the API) → { results: { ok, created, jobId?, errors }[] }
export async function POST(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid agent id' }, { status: 400 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const batch = 'rows' in parsed.data
  const rows = 'rows' in parsed.data ? parsed.data.rows : [parsed.data]
  try {
    const results: { ok: boolean; created: boolean; jobId?: string; errors: string[] }[] = []
    for (const r of rows) {
      const out = await createJob({ skillId: id, inputs: r.inputs, source: batch ? 'api' : 'form', dueAt: r.dueAt ? new Date(r.dueAt) : undefined, actor: admin })
      results.push({ ok: !!out.job && !out.errors.length, created: out.created, ...(out.job ? { jobId: out.job.id } : {}), errors: out.errors })
    }
    return NextResponse.json({ results }, { status: results.some(r => r.created) ? 201 : 200 })
  } catch (e) {
    if (e instanceof JobError) return NextResponse.json({ error: e.message }, { status: e.status })
    return serverError(e)
  }
}
