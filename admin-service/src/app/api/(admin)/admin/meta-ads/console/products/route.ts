import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { searchAdProducts } from '@/lib/meta-ads/creative'

export const dynamic = 'force-dynamic'

// GET ?q=: catalogue search for the New ad dialog (link, headline, text and photos).
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:read'), 'meta_ads:read', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q.length < 2) return NextResponse.json({ products: [] })
  try {
    return NextResponse.json({ products: await searchAdProducts(q) })
  } catch (e) {
    return channelError(e)
  }
}
