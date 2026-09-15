import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { reverseTransfersForRefund } from '@/lib/razorpay-route'

export const dynamic = 'force-dynamic'

/**
 * Retry Route reversals that could not be recovered at refund time.
 *
 * Razorpay hard-fails a reversal when the linked account has no floating balance, which is
 * common right after the tenant's payout settles. The refund path never blocks the buyer on
 * that — it records the shortfall as a `refund` row noting the amount is owed — and this job
 * re-attempts it once balance is available again.
 *
 * Matching is by the order ref embedded in the note, so a row is only retried while it still
 * reads as unrecovered; a successful retry rewrites it and the row stops matching.
 */
const UNRECOVERED_NOTE = 'Refund NOT reversed (owed by tenant)%'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pool = controlPlanePool()
  // Only rows still carrying a debt, newest first, bounded so one slow run cannot stall the tick.
  const owed = await pool.query<{
    id: string; tenant_id: string; amount: string; note: string
  }>(
    `SELECT id, tenant_id, amount, note
       FROM settlement_ledger
      WHERE entry_type = 'refund'
        AND note LIKE $1
        AND occurred_at > now() - interval '90 days'
      ORDER BY occurred_at DESC
      LIMIT 50`,
    [UNRECOVERED_NOTE]
  ).catch(() => null)

  if (!owed?.rows.length) return NextResponse.json({ retried: 0, recovered: 0 })

  let retried = 0
  let recovered = 0

  for (const row of owed.rows) {
    // The payment id is not on the ledger row, so resolve it from the tenant transaction that
    // the refund was recorded against.
    const txn = await pool.query<{ gateway_txn_id: string | null }>(
      `SELECT t.gateway_txn_id
         FROM tenant_transactions t
        WHERE t.tenant_id = $1
          AND $2 LIKE '%' || t.order_ref || '%'
        LIMIT 1`,
      [row.tenant_id, row.note]
    ).catch(() => null)

    const paymentId = txn?.rows[0]?.gateway_txn_id
    if (!paymentId || !paymentId.startsWith('pay_')) continue

    const owedPaise = Math.round(Math.abs(parseFloat(row.amount)) * 100)
    if (!(owedPaise > 0)) continue

    retried++
    const outcome = await reverseTransfersForRefund(paymentId, owedPaise)
    if (outcome.reversedPaise <= 0) continue

    recovered += outcome.reversedPaise
    // Rewrite the row to what was actually recovered so it stops matching the debt filter.
    await pool.query(
      `UPDATE settlement_ledger
          SET amount = $2,
              note = replace(note, 'Refund NOT reversed (owed by tenant)', 'Refund reversed (recovered on retry)')
        WHERE id = $1`,
      [row.id, -(outcome.reversedPaise / 100)]
    ).catch(() => {})

    // A partial recovery leaves the remainder owed, as its own row.
    const stillOwedPaise = owedPaise - outcome.reversedPaise
    if (stillOwedPaise > 0) {
      await pool.query(
        `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, note, occurred_at)
         VALUES ($1, 'refund', $2, $3, now())`,
        [row.tenant_id, -(stillOwedPaise / 100), row.note]
      ).catch(() => {})
    }
  }

  return NextResponse.json({ retried, recovered: recovered / 100 })
}
