import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export interface DisputeListRow {
  id: string
  razorpay_dispute_id: string
  razorpay_payment_id: string
  order_id: string | null
  order_number: string | null
  amount: number
  amount_deducted: number
  reason_code: string | null
  reason_description: string | null
  phase: string | null
  status: 'open' | 'under_review' | 'won' | 'lost' | 'closed'
  respond_by: string | null
  created_at: string
  closed_at: string | null
}

export interface DisputesResponse {
  totals: { open_count: number; open_amount: number; due_soon: number; lost_amount: number; won_count: number }
  rows: DisputeListRow[]
}

// GET — this store's chargebacks, open ones first by deadline.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const status = request.nextUrl.searchParams.get('status') || 'all'
  const where = status === 'open' ? `WHERE d.status IN ('open','under_review')` : status === 'closed' ? `WHERE d.status IN ('won','lost','closed')` : ''

  const [t, rows] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('open','under_review')) AS open_count,
              COALESCE(SUM(amount) FILTER (WHERE status IN ('open','under_review')), 0) AS open_amount,
              COUNT(*) FILTER (WHERE status = 'open' AND respond_by < NOW() + INTERVAL '3 days') AS due_soon,
              COALESCE(SUM(COALESCE(NULLIF(amount_deducted, 0), amount)) FILTER (WHERE status = 'lost'), 0) AS lost_amount,
              COUNT(*) FILTER (WHERE status = 'won') AS won_count
         FROM payment_disputes`
    ),
    queryMany<DisputeListRow>(
      `SELECT d.id, d.razorpay_dispute_id, d.razorpay_payment_id, d.order_id, o.order_number,
              d.amount::float AS amount, d.amount_deducted::float AS amount_deducted, d.reason_code, d.reason_description,
              d.phase, d.status, d.respond_by, d.created_at, d.closed_at
         FROM payment_disputes d LEFT JOIN orders o ON o.id = d.order_id
         ${where}
        ORDER BY (d.status IN ('open','under_review')) DESC, d.respond_by ASC NULLS LAST, d.created_at DESC
        LIMIT 500`
    ),
  ])
  const n = (k: string) => Number(t?.[k]) || 0
  const body: DisputesResponse = {
    totals: { open_count: n('open_count'), open_amount: n('open_amount'), due_soon: n('due_soon'), lost_amount: n('lost_amount'), won_count: n('won_count') },
    rows,
  }
  return NextResponse.json(body)
}
