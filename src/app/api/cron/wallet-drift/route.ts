import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

/**
 * Detect drift between a tenant wallet's materialised balance and its ledger.
 *
 * `tenant_wallets.balance` is a running total moved in the same transaction as every
 * `wallet_ledger` insert, so the two should never disagree. If they do, something wrote outside a
 * transaction or a balance moved without a ledger row — in a prepaid system that silently either
 * blocks shipments or gives away shipping.
 *
 * Read-only by design: it reports, it does not "correct". Auto-repairing would paper over the
 * write path that caused the drift, and the ledger is the audit trail — a wrong balance is a bug
 * to investigate, not a number to overwrite.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const res = await controlPlanePool()
    .query<{
      tenant_id: string
      balance: string
      ledger_total: string
      drift: string
    }>(
      `SELECT w.tenant_id,
            w.balance,
            COALESCE(l.total, 0) AS ledger_total,
            (w.balance - COALESCE(l.total, 0)) AS drift
       FROM tenant_wallets w
       LEFT JOIN (
         SELECT tenant_id, SUM(amount) AS total
           FROM wallet_ledger
          GROUP BY tenant_id
       ) l ON l.tenant_id = w.tenant_id
      WHERE ABS(w.balance - COALESCE(l.total, 0)) >= 0.01
      ORDER BY ABS(w.balance - COALESCE(l.total, 0)) DESC`
    )
    .catch(() => null)

  if (!res) return NextResponse.json({ error: 'drift check failed' }, { status: 500 })

  const drifted = res.rows.map(r => ({
    tenantId: r.tenant_id,
    balance: Number(r.balance),
    ledgerTotal: Number(r.ledger_total),
    drift: Number(r.drift),
  }))

  if (drifted.length > 0) {
    console.error(`[wallet-drift] ${drifted.length} wallet(s) disagree with their ledger`, drifted)
  }

  return NextResponse.json({ checked: true, driftedCount: drifted.length, drifted })
}
