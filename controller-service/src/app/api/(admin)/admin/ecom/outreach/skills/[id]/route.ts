import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { AGENT_STATUSES, SkillError, archiveSkill, getSkillDetail, updateSkill } from '@controller/lib/outreach/agent/skill/store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
type Ctx = { params: Promise<{ id: string }> }

const fail = (e: unknown) => (e instanceof SkillError ? NextResponse.json({ error: e.message }, { status: e.status }) : serverError(e))

export async function GET(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 })
  try {
    const detail = await getSkillDetail(id)
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  } catch (e) {
    return fail(e)
  }
}

const PatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    current_version_id: z.string().uuid().optional(),
    status: z.enum(AGENT_STATUSES).optional(),
  })
  .refine(b => Object.keys(b).length > 0, 'Nothing to change')

// PATCH { title?, description?, current_version_id?, status? } → set the title, description, which version is current, or the agent's status (draft | active | paused).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 })
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    return NextResponse.json({ skill: await updateSkill(id, parsed.data, admin) })
  } catch (e) {
    return fail(e)
  }
}

// DELETE → archive (versions, runs and pinned lists keep working; new runs skip it).
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 })
  try {
    await archiveSkill(id, admin)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}
