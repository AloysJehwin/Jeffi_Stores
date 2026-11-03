import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listInbox } from '@/lib/social/data'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  const filter = request.nextUrl.searchParams.get('filter') === 'all' ? 'all' : 'open'
  return NextResponse.json({ items: await listInbox(await resolveTenantId(), filter) })
}
