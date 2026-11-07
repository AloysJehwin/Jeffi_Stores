import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { withPlan } from '@/lib/channels/route'
import { getSetupGuide } from '@/lib/setup-guide/status'
import { setupTenantId } from '@/lib/setup-guide/route'

export const dynamic = 'force-dynamic'

/** Every step this store's plan sells, with its status and the own-credentials guide. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'setup_guide:read'), 'setup_guide:read', 'Setup guide')
  if (admin instanceof NextResponse) return admin
  try {
    const tenantId = await setupTenantId()
    const guide = await getSetupGuide({ role: admin.role, scopes: admin.scopes }, tenantId)
    return NextResponse.json({
      ...guide,
      canWrite: hasScope(admin.role, admin.scopes, 'setup_guide:write'),
      platform: !tenantId && isPlatformAdmin(admin.role),
    })
  } catch (e) {
    console.error('[setup-guide] load failed', e)
    return NextResponse.json({ error: 'Could not load the setup guide' }, { status: 500 })
  }
}
