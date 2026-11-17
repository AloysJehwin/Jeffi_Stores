import { controlPlanePool, debitIn, trueUpIn, walletTx } from '@jeffi/wallet'

// A paid generation's hold on its tenant's AI wallet (control-plane ai_wallet_holds). The cap's debit and the hold's row
// commit together; the run checkpoints its provider cost on the row. Settling locks the row and, unless it is settled
// already, marks it and trues the debit up in the same transaction, so a hold is settled once: by its run or, when the
// run died, by the controller's ai_hold_sweep cron (sweepStaleHolds in ./paid-generation.ts).

/** Where the run logs its ai_usage rows: the store's own database, or the platform's. */
export type UsageDb = 'store' | 'platform'
export type SettledBy = 'run' | 'sweep'

export interface HoldTerms {
  capInr: number
  margin: number
  costInr: number
}

export interface Settlement {
  chargedInr: number
  costInr: number
  by: SettledBy
  /** This call settled it; false when it already was (by `by`). */
  now: boolean
}

export interface OpenHold extends HoldTerms {
  tenantId: string
  walletRef: string
  feature: string
  usageDb: UsageDb
  startedAt: string
  lastError: string | null
}

const round4 = (n: number) => Math.round(n * 10000) / 10000
const cost = (n: unknown) => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? round4(v) : 0
}

/** Debits the cap and records the hold, in one transaction; the debit's result (nothing recorded unless charged). */
export function openHold(h: { tenantId: string; capInr: number; walletRef: string; note: string; margin: number; feature: string; usageDb: UsageDb }) {
  return walletTx(async c => {
    const r = await debitIn(c, { tenantId: h.tenantId, amountInr: h.capInr, category: 'ai', externalRef: h.walletRef, note: h.note })
    if (r.ok && r.charged) {
      await c.query(`INSERT INTO ai_wallet_holds (tenant_id, external_ref, cap_inr, margin, feature, usage_db) VALUES ($1, $2, $3, $4, $5, $6)`,
        [h.tenantId, h.walletRef, h.capInr, h.margin, h.feature, h.usageDb])
    }
    return r
  })
}

/** The run's provider cost so far, for the sweep if the run dies. Never lowers it; a no-op once settled. */
export async function recordHoldCost(tenantId: string, walletRef: string, costInr: number): Promise<void> {
  await controlPlanePool().query(
    `UPDATE ai_wallet_holds SET cost_inr = GREATEST(cost_inr, $3), cost_at = now() WHERE tenant_id = $1 AND external_ref = $2 AND settled_at IS NULL`,
    [tenantId, walletRef, cost(costInr)]
  )
}

/**
 * Settles a hold once. Locks its row; unless it is settled already, charges charge(terms) on the larger of the recorded
 * cost and `costInr`, and trues the debit up to it, in one transaction. A concurrent settle waits on the row lock, then
 * finds it settled. null when there is no such hold.
 */
export function settleHold(tenantId: string, walletRef: string, by: SettledBy, charge: (t: HoldTerms) => number, costInr = 0): Promise<Settlement | null> {
  return walletTx(async c => {
    const r = await c.query<{ cap_inr: string; margin: string; cost_inr: string; settled_by: SettledBy | null; charged_inr: string | null }>(
      `SELECT cap_inr, margin, cost_inr, settled_by, charged_inr FROM ai_wallet_holds WHERE tenant_id = $1 AND external_ref = $2 FOR UPDATE`,
      [tenantId, walletRef]
    )
    const h = r.rows[0]
    if (!h) return null
    if (h.settled_by) return { chargedInr: Number(h.charged_inr), costInr: Number(h.cost_inr), by: h.settled_by, now: false }
    const terms: HoldTerms = { capInr: Number(h.cap_inr), margin: Number(h.margin), costInr: Math.max(cost(h.cost_inr), cost(costInr)) }
    const chargedInr = charge(terms)
    await c.query(
      `UPDATE ai_wallet_holds SET settled_at = now(), settled_by = $3, charged_inr = $4, cost_inr = $5, cost_at = now() WHERE tenant_id = $1 AND external_ref = $2`,
      [tenantId, walletRef, by, chargedInr, terms.costInr]
    )
    await trueUpIn(c, { tenantId, amountInr: chargedInr, externalRef: walletRef })
    return { chargedInr, costInr: terms.costInr, by, now: true }
  })
}

/** Holds still open `olderThanMs` after they were taken, oldest first. */
export async function staleHolds(olderThanMs: number, limit = 100): Promise<OpenHold[]> {
  const r = await controlPlanePool().query(
    `SELECT tenant_id, external_ref, cap_inr, margin, cost_inr, feature, usage_db, started_at, last_error
       FROM ai_wallet_holds WHERE settled_at IS NULL AND started_at < now() - make_interval(secs => $1)
      ORDER BY started_at LIMIT $2`,
    [Math.round(olderThanMs / 1000), limit]
  )
  return r.rows.map(h => ({
    tenantId: h.tenant_id,
    walletRef: h.external_ref,
    capInr: Number(h.cap_inr),
    margin: Number(h.margin),
    costInr: Number(h.cost_inr),
    feature: h.feature,
    usageDb: h.usage_db,
    startedAt: new Date(h.started_at).toISOString(),
    lastError: h.last_error,
  }))
}

/** Why the sweep could not settle a hold (it tries again next run). */
export async function noteHoldError(tenantId: string, walletRef: string, error: string): Promise<void> {
  await controlPlanePool().query(`UPDATE ai_wallet_holds SET last_error = $3 WHERE tenant_id = $1 AND external_ref = $2 AND settled_at IS NULL`,
    [tenantId, walletRef, error.slice(0, 500)])
}
