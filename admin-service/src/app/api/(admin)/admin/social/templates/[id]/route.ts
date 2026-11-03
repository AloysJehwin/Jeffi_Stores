import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { TemplateSchema, deleteTemplate, saveTemplate } from '@/lib/social/library'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = TemplateSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid template' }, { status: 400 })
  const template = await saveTemplate(await resolveTenantId(), parsed.data, (await params).id)
  return template ? NextResponse.json({ template }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  return (await deleteTemplate(await resolveTenantId(), (await params).id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
