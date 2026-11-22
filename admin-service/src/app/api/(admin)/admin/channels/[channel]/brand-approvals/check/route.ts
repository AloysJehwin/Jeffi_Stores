import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'
import { channelAdmin, channelError } from '@/lib/channels/route'
import { checkAmazonBrandApprovals, parsePushScope } from '@/lib/channels/brand-approvals'
import { getListingsRestrictions } from '@/lib/amazon/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Ask Amazon (Listings Restrictions API) which brands need approval, using one matched ASIN per brand.
 * Brands set by hand keep their status; `brandIds` limits the check. Amazon only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params
  if (channel !== 'amazon') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = await channelAdmin(request, 'amazon:read', 'Amazon')
  if (admin instanceof NextResponse) return admin
  if (!hasScope(admin.role, admin.scopes, 'amazon:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  try {
    const result = await checkAmazonBrandApprovals(asin => getListingsRestrictions(asin), { brandIds: parsePushScope(body)?.brandIds })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return channelError(e, 'Connect Amazon Seller first.')
  }
}
