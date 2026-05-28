import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { cancelOrder } from '@/lib/orders'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const restoreToCart = body?.restoreToCart === true
    const autoCancelUnpaid = body?.autoCancelUnpaid === true

    const result = await cancelOrder(params.id, {
      reason: autoCancelUnpaid ? 'auto_cancel_unpaid' : 'user_request',
      restoreToCart,
      expectedUserId: authUser.userId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to request cancellation' }, { status: 500 })
  }
}
