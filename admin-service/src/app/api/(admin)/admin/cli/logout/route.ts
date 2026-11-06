import { NextRequest, NextResponse } from 'next/server'
import { gatedPrincipal } from '@/lib/auth/admin-principal'
import { revokeApiToken } from '@/lib/auth/api-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// `jeffi logout`: revokes the token the request came with.
export async function POST(request: NextRequest) {
  const p = await gatedPrincipal(request)
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!p.tokenId || p.via === 'service_account' || p.kind === 'service_account') {
    return NextResponse.json({ error: 'Only a CLI or extension token can log out this way' }, { status: 400 })
  }
  const revoked = await revokeApiToken({ id: p.tokenId, tenantId: p.tenantId, adminId: p.adminId })
  return NextResponse.json({ success: true, revoked })
}
