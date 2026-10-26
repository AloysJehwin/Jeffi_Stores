import { buildWhere, type FilterQuery } from '@jeffi/list-filters'
import { controlPlanePool } from '@/lib/tenant-registry'
import { WALLET_ENTITY } from '@/lib/filters/entities/wallet'

// This store's wallet ledger (control-plane DB), one page over the list's filters, newest first,
// with the credit / debit totals of every matching entry.

export interface LedgerRow {
  id: string
  entry_type: 'recharge' | 'debit' | 'adjustment'
  category: string | null
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}

export async function listWalletLedger(q: FilterQuery, page: number, pageSize: number) {
  const ctx = (await WALLET_ENTITY.context?.(q)) ?? {}
  const w = buildWhere(WALLET_ENTITY, q, 1, { ctx })
  const pool = controlPlanePool()
  const [rows, sums] = await Promise.all([
    pool.query<LedgerRow>(
      `SELECT wl.id, wl.entry_type, wl.category, wl.amount, wl.order_ref, wl.awb, wl.note, wl.occurred_at
         FROM wallet_ledger wl ${w.where}
        ORDER BY wl.occurred_at DESC, wl.id DESC
        LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, pageSize, (Math.max(1, page) - 1) * pageSize]
    ),
    pool.query<{ total: number; credit: string; debit: string }>(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(wl.amount) FILTER (WHERE wl.amount >= 0), 0) AS credit,
              COALESCE(-SUM(wl.amount) FILTER (WHERE wl.amount < 0), 0) AS debit
         FROM wallet_ledger wl ${w.where}`,
      w.params
    ),
  ])
  const s = sums.rows[0]
  return {
    rows: rows.rows,
    total: s?.total ?? 0,
    credit: Number(s?.credit ?? 0),
    debit: Number(s?.debit ?? 0),
  }
}
