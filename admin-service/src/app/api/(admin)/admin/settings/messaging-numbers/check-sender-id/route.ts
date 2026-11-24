import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { PLATFORM_TENANT_ID } from '@/lib/messaging/audiences'
import { checkSenderId } from '@/lib/messaging/dlt-sender-check'

export const dynamic = 'force-dynamic'

// Read-only "Check sender ID": is ?header= registered on the platform's AWS account in ap-south-1. The flagship's
// administrator only; a store's numbers are the platform's to manage.

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role) || !hasScope(admin.role, admin.scopes, 'settings:write'))
    return NextResponse.json({ error: 'Only the administrator can check sender IDs' }, { status: 403 })
  const tenantId = (await resolveTenantId().catch(() => null)) ?? PLATFORM_TENANT_ID
  if (tenantId !== PLATFORM_TENANT_ID) return NextResponse.json({ error: "A store's numbers are assigned by the platform" }, { status: 403 })
  const header = request.nextUrl.searchParams.get('header') ?? ''
  try {
    return NextResponse.json(await checkSenderId(header))
  } catch (e: any) {
    const bad = /letters or digits/.test(e?.message ?? '')
    return NextResponse.json({ error: bad ? e.message : 'Could not check the sender ID on AWS' }, { status: bad ? 400 : 502 })
  }
}
