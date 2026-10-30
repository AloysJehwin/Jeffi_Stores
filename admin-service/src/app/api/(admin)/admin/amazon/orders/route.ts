import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { loadAmazonOrders } from '@/lib/amazon/orders'
import { loadStock } from '@/lib/amazon/stock'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon:read'), 'amazon:read', 'The Amazon console')
  if (admin instanceof NextResponse) return admin
  try {
    const [orders, stock] = await Promise.all([loadAmazonOrders(), loadStock()])
    return NextResponse.json({ orders, stock })
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
