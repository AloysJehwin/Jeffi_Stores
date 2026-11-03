import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { retryPost } from '@/lib/social/posts'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const ok = await retryPost(await resolveTenantId(), (await params).id)
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'Only failed or cancelled posts can be retried' }, { status: 409 })
}
