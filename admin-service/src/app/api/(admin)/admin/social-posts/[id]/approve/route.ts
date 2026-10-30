import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { decideApproval } from '@/lib/social/posts'

export const dynamic = 'force-dynamic'

// Approve or reject a post waiting for approval (and the other networks in its group).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  if (!hasScope(admin.role, admin.scopes, 'social:approve')) return NextResponse.json({ error: 'Approving posts needs approval rights' }, { status: 403 })
  const body = await readJson(request)
  if (typeof body?.approve !== 'boolean') return NextResponse.json({ error: 'approve must be true or false' }, { status: 400 })
  const n = await decideApproval(await resolveTenantId(), (await params).id, body.approve, admin.email ?? admin.adminId ?? null)
  return n ? NextResponse.json({ updated: n }) : NextResponse.json({ error: 'Nothing waiting for approval' }, { status: 409 })
}
