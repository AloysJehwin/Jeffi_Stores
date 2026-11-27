import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { adminUsesSiteTheme, setAdminUsesSiteTheme } from '@/lib/site/admin-theme'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

// Whether the admin panel also takes the store's published Site Builder theme.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ enabled: await adminUsesSiteTheme() })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { enabled: true | false }' }, { status: 400 })
  await setAdminUsesSiteTheme(parsed.data.enabled)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'site_builder',
    entityId: 'admin_theme',
    summary: parsed.data.enabled ? 'Admin panel now uses the site theme' : 'Admin panel back to its own look',
    request,
  }).catch(() => {})
  return NextResponse.json({ enabled: parsed.data.enabled })
}
