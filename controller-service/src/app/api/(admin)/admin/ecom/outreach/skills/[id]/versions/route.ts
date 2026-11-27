import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { SkillError, addSkillVersion } from '@controller/lib/outreach/agent/skill/store'

export const dynamic = 'force-dynamic'

const Schema = z.object({ content: z.string().min(1).max(200_000) })

// POST { content } → a new version of the skill, made current. 400 carries the validation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid skill id' }, { status: 400 })
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    return NextResponse.json(await addSkillVersion(id, parsed.data.content, admin), { status: 201 })
  } catch (e) {
    if (e instanceof SkillError) return NextResponse.json({ error: e.message, ...(e.validation ? { validation: e.validation } : {}) }, { status: e.status })
    return serverError(e)
  }
}
