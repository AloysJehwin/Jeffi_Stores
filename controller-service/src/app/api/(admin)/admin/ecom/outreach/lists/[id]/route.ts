import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { ListError, setListSkill } from '@controller/lib/outreach/lists'

export const dynamic = 'force-dynamic'

const Schema = z.object({ skill_id: z.string().uuid().nullable(), skill_version_id: z.string().uuid().nullable().optional() })

// PATCH { skill_id, skill_version_id? } → the campaign's skill (null clears it), optionally pinned to one version.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid list id' }, { status: 400 })
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    return NextResponse.json({ list: await setListSkill(id, parsed.data.skill_id, parsed.data.skill_version_id ?? null, admin.label) })
  } catch (e) {
    if (e instanceof ListError) return NextResponse.json({ error: e.message }, { status: e.status })
    return serverError(e)
  }
}
