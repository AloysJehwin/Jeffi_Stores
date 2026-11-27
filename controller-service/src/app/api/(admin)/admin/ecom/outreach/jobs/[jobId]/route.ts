import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cancelJob, getJobDetail, JobError, retryJob } from '@controller/lib/outreach/agent/jobs'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
type Ctx = { params: Promise<{ jobId: string }> }

const fail = (e: unknown) => (e instanceof JobError ? NextResponse.json({ error: e.message }, { status: e.status }) : serverError(e))

// GET → the job with its contact, run, calls, messages and tool calls.
export async function GET(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const { jobId } = await params
  if (!UUID.test(jobId)) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  try {
    const detail = await getJobDetail(jobId)
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'Job not found' }, { status: 404 })
  } catch (e) {
    return fail(e)
  }
}

const Patch = z.object({ action: z.enum(['cancel', 'retry']) })

// PATCH { action: 'cancel' | 'retry' } → the job. A retry needs a failed or cancelled job.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { jobId } = await params
  if (!UUID.test(jobId)) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    if (parsed.data.action === 'retry') return NextResponse.json({ job: await retryJob(jobId, admin.label) })
    const job = await cancelJob(jobId, admin.label, 'cancelled_by_admin')
    if (!job) return NextResponse.json({ error: 'The job has already ended' }, { status: 409 })
    return NextResponse.json({ job })
  } catch (e) {
    return fail(e)
  }
}
