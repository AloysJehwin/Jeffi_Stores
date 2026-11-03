import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listAutopostRules } from '@/lib/social/data'
import { RuleSchema, saveRule } from '@/lib/social/library'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ rules: await listAutopostRules(await resolveTenantId()) })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = RuleSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, { status: 400 })
  return NextResponse.json({ rule: await saveRule(await resolveTenantId(), parsed.data) })
}
