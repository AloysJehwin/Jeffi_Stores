import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { managerClient } from '@/lib/google-ads/credentials'
import { listManagedAccounts } from '@/lib/google-ads/manager-view'
import { adsErrorResponse } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Platform admins: the client accounts under the Jeffi manager account, by store.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const mgr = managerClient()
  if (!mgr) return NextResponse.json({ error: 'The platform manager account is not configured (GOOGLE_ADS_LOGIN_CUSTOMER_ID / GOOGLE_ADS_MANAGER_REFRESH_TOKEN).' }, { status: 503 })
  try {
    return NextResponse.json(await listManagedAccounts(mgr))
  } catch (e) {
    return adsErrorResponse(e)
  }
}
