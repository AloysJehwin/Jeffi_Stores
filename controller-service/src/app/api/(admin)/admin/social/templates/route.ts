import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listTemplates } from '@/lib/social/data'
import { TemplateSchema, saveTemplate } from '@/lib/social/library'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ templates: await listTemplates(await resolveTenantId()) })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = TemplateSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid template' }, { status: 400 })
  return NextResponse.json({ template: await saveTemplate(await resolveTenantId(), parsed.data) })
}
