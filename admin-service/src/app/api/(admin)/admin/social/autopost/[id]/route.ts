import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { RuleSchema, deleteRule, saveRule } from '@/lib/social/library'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = RuleSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })
  const rule = await saveRule(await resolveTenantId(), parsed.data, (await params).id)
  return rule ? NextResponse.json({ rule }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  return (await deleteRule(await resolveTenantId(), (await params).id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
