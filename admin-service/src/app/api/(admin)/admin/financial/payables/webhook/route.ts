import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/shared/db'
import { runInTenant, scopeForTenantId } from '@/lib/payments/webhook-tenant'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Fail-closed: a missing secret, missing header, or mismatch all reject. The webhook is
// reachable unauthenticated via the middleware public-path allowlist, so the HMAC is the
// only proof the caller is RazorpayX — never proceed without it.
function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAYX_WEBHOOK_SECRET || ''
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature') || ''

    if (!verifySignature(rawBody, signature)) {
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

    if (
      ['payout.processed', 'payout.failed', 'payout.reversed', 'payout.queued', 'payout.initiated'].includes(eventType)
    ) {
      // A store's payout carries its tenant in notes (set by the payout route); the rest are the flagship's.
      const store = payout.notes?.tenant_id ? await scopeForTenantId(payout.notes.tenant_id) : null
      if (payout.notes?.tenant_id && !store) return NextResponse.json({ ok: true })
      const apply = () => applyPayoutStatus(payoutId, payoutStatus)
      await (store ? runInTenant(store, apply) : apply())
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

async function applyPayoutStatus(payoutId: string, payoutStatus: string) {
  await query(`UPDATE expense_payments SET payout_status = $1 WHERE payout_id = $2`, [payoutStatus, payoutId])
  if (payoutStatus !== 'failed' && payoutStatus !== 'reversed') return
  const row = await queryOne<{ expense_id: string }>(`SELECT expense_id FROM expense_payments WHERE payout_id = $1 LIMIT 1`, [payoutId])
  if (!row?.expense_id) return
  // Manual payments have no payout status; they still count as paid.
  const paid = await queryOne<{ paid: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments
      WHERE expense_id = $1 AND COALESCE(payout_status, '') NOT IN ('failed','reversed')`,
    [row.expense_id]
  )
  const total = await queryOne<{ total_amount: string }>(`SELECT total_amount FROM expenses WHERE id = $1`, [row.expense_id])
  const p = parseFloat(paid?.paid || '0')
  const t = parseFloat(total?.total_amount || '0')
  const newStatus = p <= 0 ? 'unpaid' : p >= t ? 'paid' : 'partial'
  await query(`UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, row.expense_id])
}
