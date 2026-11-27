import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { getProgram, listPrograms } from '@controller/lib/outreach/programs/_registry'
import { getProgramState, updateProgramState, ProgramStateError } from '@controller/lib/outreach/program-state'
import { statusCounts } from '@controller/lib/outreach/contacts'

export const dynamic = 'force-dynamic'

const DEFAULT_PROGRAM = 'showcase-offer'

// GET ?program → registry info plus the program's state and contact counts by status.
export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const key = req.nextUrl.searchParams.get('program') || DEFAULT_PROGRAM
  const def = getProgram(key)
  if (!def) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
  try {
    const [state, counts] = await Promise.all([getProgramState(key), statusCounts(key)])
    return NextResponse.json({ program: def, programs: listPrograms().map(p => ({ key: p.key, title: p.title })), state, counts })
  } catch (e) {
    return serverError(e)
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM')
const PatchSchema = z.object({
  program: z.string().default(DEFAULT_PROGRAM),
  enabled: z.boolean().optional(),
  daily_cap: z.number().int().min(0).max(5000).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  window_start: hhmm.optional(),
  window_end: hhmm.optional(),
  test_numbers: z.array(z.string().min(1).max(20)).max(10).optional(),
  default_skill_id: z.string().uuid().nullable().optional(),
})

// PATCH → enable/disable, daily cap, concurrency, calling window (09:30-20:30 IST at most), test numbers, the default skill.
export async function PATCH(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const { program, ...patch } = parsed.data
  if (!getProgram(program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
  try {
    return NextResponse.json({ state: await updateProgramState(program, patch, admin) })
  } catch (e) {
    if (e instanceof ProgramStateError) return NextResponse.json({ error: e.message }, { status: 400 })
    return serverError(e)
  }
}
