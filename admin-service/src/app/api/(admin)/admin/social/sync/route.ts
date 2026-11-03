import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { refreshSocialInsights, syncSocialInbox } from '@/lib/social/jobs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Refresh metrics and the inbox now instead of waiting for the next run.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const tenantId = await resolveTenantId()
  const [insights, inbox] = await Promise.all([refreshSocialInsights(tenantId), syncSocialInbox(tenantId)])
  return NextResponse.json({ insights, inbox })
}
