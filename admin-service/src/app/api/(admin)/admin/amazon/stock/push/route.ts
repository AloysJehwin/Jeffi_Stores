import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { pushAmazonStock, stockSettings } from '@/lib/amazon/stock'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_orders:write'), 'amazon_orders:write', 'Amazon stock')
  if (admin instanceof NextResponse) return admin
  if (!(await stockSettings()).enabled) return NextResponse.json({ error: 'Turn on stock push first.' }, { status: 409 })
  try {
    return NextResponse.json(await pushAmazonStock())
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
