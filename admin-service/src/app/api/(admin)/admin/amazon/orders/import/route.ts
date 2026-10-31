import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { importAmazonOrders, ordersEnabled } from '@/lib/amazon/orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_orders:write'), 'amazon_orders:write', 'Amazon orders')
  if (admin instanceof NextResponse) return admin
  if (!(await ordersEnabled())) return NextResponse.json({ error: 'Turn on Amazon order import first.' }, { status: 409 })
  try {
    return NextResponse.json(await importAmazonOrders())
  } catch (e) {
    return channelError(e, 'Connect Amazon first.')
  }
}
