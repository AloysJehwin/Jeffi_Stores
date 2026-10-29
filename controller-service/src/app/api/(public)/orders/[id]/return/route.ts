import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne, queryMany } from '@/lib/shared/db'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { createReturnRequest } from '@/lib/orders/returns'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const returnRequest = await queryOne(
      `SELECT * FROM return_requests WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [id, authUser.userId]
    )

    let returnItems = null
    if (returnRequest) {
      returnItems = await queryMany(
        `SELECT * FROM return_request_items WHERE return_request_id = $1 ORDER BY created_at`,
        [returnRequest.id]
      )
    }

    const monthlyCount = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE o.user_id = $1
         AND rr.status NOT IN ('rejected')
         AND DATE_TRUNC('month', rr.created_at) = DATE_TRUNC('month', NOW())`,
      [authUser.userId]
    )
    const monthlyLimitReached =
      parseInt(monthlyCount?.cnt || '0', 10) >= parseInt(process.env.MONTHLY_RETURN_LIMIT || '1', 10)

    // Refund breakdown so the customer sees the actual amount and, when the return charge covers
    // it, an explanation instead of a bare "refund processed".
    let refundBreakdown: { grossRefund: number; charge: number; netRefund: number } | null = null
    if (returnRequest?.type === 'refund' && Array.isArray(returnItems) && returnItems.length > 0) {
      const grossRefund = returnItems.reduce((s: number, i: any) => s + (parseFloat(i.refund_amount) || 0), 0)
      const returnStandardCharge = (await getBusinessValues().catch(() => null))?.returnStandardCharge ?? 0
      const charge = Math.min(returnStandardCharge, grossRefund)
      const netRefund = Math.max(0, Math.round((grossRefund - returnStandardCharge) * 100) / 100)
      refundBreakdown = { grossRefund, charge, netRefund }
    }

    return NextResponse.json({
      returnRequest: returnRequest || null,
      returnItems: returnItems || [],
      monthlyLimitReached,
      refundBreakdown,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const r = await createReturnRequest(authUser.userId, id, await request.json())
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ returnRequest: r.returnRequest }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create return request' }, { status: 500 })
  }
}
