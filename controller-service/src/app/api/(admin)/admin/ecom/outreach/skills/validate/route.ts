import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { validateSkill } from '@controller/lib/outreach/agent/skill/validate'

export const dynamic = 'force-dynamic'

const Schema = z.object({ content: z.string().max(200_000) })

// POST { content } → the validation (errors, warnings, tools) without saving; the admin UI calls it as you type.
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    return NextResponse.json({ validation: validateSkill(parsed.data.content) })
  } catch (e) {
    return serverError(e)
  }
}
