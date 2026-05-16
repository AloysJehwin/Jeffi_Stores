import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET = process.env.RAZORPAYX_WEBHOOK_SECRET || ''

function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  return expected === signature
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature') || ''

    if (WEBHOOK_SECRET && !verifySignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(rawBody)
    const eventType: string = event.event || ''
    const payout = event.payload?.payout?.entity

    if (!payout?.id) {
      return NextResponse.json({ ok: true })
    }

    const payoutId: string = payout.id
    const payoutStatus: string = payout.status

    if (['payout.processed', 'payout.failed', 'payout.reversed', 'payout.queued', 'payout.initiated'].includes(eventType)) {
      await query(
        `UPDATE expense_payments SET payout_status = $1 WHERE payout_id = $2`,
        [payoutStatus, payoutId]
      )

      if (payoutStatus === 'failed' || payoutStatus === 'reversed') {
        const row = await query(
          `SELECT expense_id FROM expense_payments WHERE payout_id = $1 LIMIT 1`,
          [payoutId]
        )
        const expenseId = (row as any)?.[0]?.expense_id
        if (expenseId) {
          const paidResult = await query(
            `SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments WHERE expense_id = $1 AND payout_status NOT IN ('failed','reversed')`,
            [expenseId]
          )
          const paid = parseFloat((paidResult as any)?.[0]?.paid || '0')
          const totalResult = await query(
            `SELECT total_amount FROM expenses WHERE id = $1`,
            [expenseId]
          )
          const total = parseFloat((totalResult as any)?.[0]?.total_amount || '0')
          const newStatus = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial'
          await query(`UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, expenseId])
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
