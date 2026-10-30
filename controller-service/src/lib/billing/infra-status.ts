import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { computeSpecEnabled } from '@controller/lib/compute/catalog'
import { catalogOrDefault } from '@controller/lib/compute/resolve'

export interface ServersBilling {
  /** What the wallet is charged a day now: storage only while paused. */
  dailyInr: number
  balance: number
  /** Whole days the balance covers; 0 below zero. */
  daysLeft: number
  paused: boolean
  /** The balance a paused store needs before it starts again: a day at its running rate. */
  resumeAtInr: number
  /** When a store below zero pauses (ISO), unless topped up first. */
  pauseOn: string | null
}

const DAY_MS = 86_400_000

/** The store's server charges against its wallet, for the owner's pages; null when servers aren't billed. */
export async function serversBilling(tenantId: string): Promise<ServersBilling | null> {
  if (!computeSpecEnabled() || isFlagshipTenant(tenantId)) return null
  const r = await controlPlanePool().query<{ status: string; low_balance_since: Date | null; rate: number | null; running: number | null }>(
    `SELECT c.status, c.low_balance_since, c.rate_inr_hour::float AS running,
            COALESCE(CASE WHEN p.paused THEN p.storage_inr_hour ELSE p.rate_inr_hour END, c.rate_inr_hour)::float AS rate
       FROM tenant_compute c
       LEFT JOIN tenant_compute_periods p ON p.tenant_id = c.tenant_id AND p.ended_at IS NULL
      WHERE c.tenant_id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  if (!row || row.rate == null) return null
  const [{ balance }, { settings }] = await Promise.all([getWalletBalance(tenantId), catalogOrDefault()])
  const dailyInr = Math.round(row.rate * 24 * 100) / 100
  const paused = row.status === 'paused'
  const since = row.low_balance_since ? new Date(row.low_balance_since).getTime() : null
  return {
    dailyInr,
    balance,
    daysLeft: dailyInr > 0 ? Math.max(0, Math.floor(balance / dailyInr)) : 0,
    paused,
    resumeAtInr: Math.round((row.running ?? 0) * 24 * 100) / 100,
    pauseOn: !paused && since != null ? new Date(since + settings.graceDays * DAY_MS).toISOString() : null,
  }
}
