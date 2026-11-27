import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { getProgram } from '@controller/lib/outreach/programs/_registry'
import { getProgramState } from '@controller/lib/outreach/program-state'
import { BUILTIN_SKILLS } from '@controller/lib/outreach/agent/skill/builtin'
import { SkillError, createSkill, listSkills } from '@controller/lib/outreach/agent/skill/store'

export const dynamic = 'force-dynamic'

const DEFAULT_PROGRAM = 'showcase-offer'

// GET ?program&archived=1 → the skills, the builtin starting points and the program's default skill id.
export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const program = req.nextUrl.searchParams.get('program') || DEFAULT_PROGRAM
  if (!getProgram(program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
  try {
    const [skills, state] = await Promise.all([
      listSkills({ tenantId: null, program, includeArchived: req.nextUrl.searchParams.get('archived') === '1' }),
      getProgramState(program),
    ])
    return NextResponse.json({ skills, builtins: BUILTIN_SKILLS, defaultSkillId: state.default_skill_id ?? null })
  } catch (e) {
    return serverError(e)
  }
}

const CreateSchema = z.object({ program: z.string().default(DEFAULT_PROGRAM), content: z.string().min(1).max(200_000) })

// POST { content } → a new skill (version 1, current). 400 carries the validation, 409 means the name is taken.
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  if (!getProgram(parsed.data.program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
  try {
    const out = await createSkill({ tenantId: null, program: parsed.data.program, content: parsed.data.content, actor: admin })
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof SkillError) return NextResponse.json({ error: e.message, ...(e.validation ? { validation: e.validation } : {}) }, { status: e.status })
    return serverError(e)
  }
}
