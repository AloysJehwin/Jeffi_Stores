import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parsePageRefKey } from '@jeffi/site-blocks'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { listPageVersions, rollbackPage } from '@/lib/site/store'
import { afterSiteChange } from '@/lib/site/after-publish'
import { requireAdminScope } from '@/lib/auth/jwt'
import { noAppDenial } from '../_no-app'

export const dynamic = 'force-dynamic'

// GET ?key=<audience:surface:page:slug>: a page's published versions. POST { key, version }: republish one.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  const ref = parsePageRefKey(request.nextUrl.searchParams.get('key') ?? '')
  if (!ref) return NextResponse.json({ error: 'Unknown page' }, { status: 400 })
  const noApp = await noAppDenial(ref.surface)
  if (noApp) return noApp
  return NextResponse.json({ versions: await listPageVersions(ref) })
}

const Body = z.object({ key: z.string(), version: z.number().int().positive() })

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  const ref = parsed.success ? parsePageRefKey(parsed.data.key) : null
  if (!parsed.success || !ref) return NextResponse.json({ error: 'Send { key, version }' }, { status: 400 })
  const noApp = await noAppDenial(ref.surface)
  if (noApp) return noApp
  const version = await rollbackPage(ref, parsed.data.version, admin.adminId)
  if (version == null) return NextResponse.json({ error: 'That version is not kept any more' }, { status: 404 })
  await afterSiteChange(request)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'site_builder',
    entityId: parsed.data.key,
    summary: `Rolled ${parsed.data.key} back to version ${parsed.data.version}`,
    request,
  }).catch(() => {})
  return NextResponse.json({ version })
}
