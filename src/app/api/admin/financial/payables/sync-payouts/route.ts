import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const RZP_KEY = process.env.RAZORPAYX_KEY_ID!
const RZP_SECRET = process.env.RAZORPAYX_KEY_SECRET!
const RZP_AUTH = 'Basic ' + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString('base64')

const TERMINAL_STATUSES = ['processed', 'failed', 'reversed', 'cancelled']

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!RZP_KEY || !RZP_SECRET) {
      return NextResponse.json({ synced: 0 })
    }

    const pending = await queryMany<{ id: string; payout_id: string; expense_id: string }>(
      `SELECT id, payout_id, expense_id FROM expense_payments
       WHERE payout_id IS NOT NULL AND payout_status NOT IN ('processed','failed','reversed','cancelled')`,
      []
    )

    if (!pending?.length) return NextResponse.json({ synced: 0 })

    let synced = 0

    for (const row of pending) {
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payouts/${row.payout_id}`, {
          headers: { Authorization: RZP_AUTH },
        })
        if (!res.ok) continue
        const data = await res.json()
        const newStatus: string = data.status

        await query(
          `UPDATE expense_payments SET payout_status = $1 WHERE payout_id = $2`,
          [newStatus, row.payout_id]
        )

        if (TERMINAL_STATUSES.includes(newStatus)) {
          const paidRows = await queryMany<{ amount: string }>(
            `SELECT amount FROM expense_payments WHERE expense_id = $1 AND payout_status NOT IN ('failed','reversed','cancelled')`,
            [row.expense_id]
          )
          const paid = (paidRows || []).reduce((s, r) => s + parseFloat(r.amount), 0)
          const expRow = await queryMany<{ total_amount: string }>(
            `SELECT total_amount FROM expenses WHERE id = $1`,
            [row.expense_id]
          )
          const total = parseFloat(expRow?.[0]?.total_amount || '0')
          const expStatus = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial'
          await query(`UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2`, [expStatus, row.expense_id])
        }

        synced++
      } catch {
        void 0
      }
    }

    return NextResponse.json({ synced })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
