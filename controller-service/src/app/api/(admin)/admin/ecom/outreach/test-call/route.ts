import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { normalizePhone } from '@controller/lib/outreach/phone'
import { ProgramStateError } from '@controller/lib/outreach/program-state'
import { InvalidTransitionError } from '@controller/lib/outreach/state'
import { LANGUAGES } from '@controller/lib/outreach/types'
import { startTestCall, TestCallError } from '@controller/lib/outreach/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  phone: z.string().trim().min(1).max(20),
  language: z.enum(LANGUAGES).default('en'),
  program: z.string().trim().min(1).max(64).default('showcase-offer'),
  businessName: z.string().trim().min(1).max(120).optional(),
  ownerName: z.string().trim().min(1).max(120).optional(),
})

// POST { phone, language } → { callId }: a real call to one of the program's test numbers (platform admin only).
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const phone = normalizePhone(parsed.data.phone)
  if (!phone) return NextResponse.json({ error: 'Not a valid Indian mobile number' }, { status: 400 })
  try {
    const { callId } = await startTestCall({ ...parsed.data, phone }, admin.label)
    return NextResponse.json({ callId })
  } catch (e) {
    if (e instanceof TestCallError) return NextResponse.json({ error: e.message, ...(e.callId ? { callId: e.callId } : {}) }, { status: e.status })
    if (e instanceof ProgramStateError) return NextResponse.json({ error: e.message }, { status: 400 })
    if (e instanceof InvalidTransitionError) return NextResponse.json({ error: e.message }, { status: 409 })
    return serverError(e)
  }
}
