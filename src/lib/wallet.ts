import { controlPlanePool } from './tenant-registry'

export interface WalletLedgerEntry {
  entry_type: 'recharge' | 'debit' | 'adjustment'
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}

export interface TenantWallet {
  balance: number
  minBalance: number
  currency: string
  ledger: WalletLedgerEntry[]
}

async function ensureWalletRow(tenantId: string): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  )
}

export async function getTenantWallet(tenantId: string, ledgerLimit = 50): Promise<TenantWallet> {
  const pool = controlPlanePool()
  const w = await pool.query(
    `SELECT balance, min_balance, currency FROM tenant_wallets WHERE tenant_id = $1`,
    [tenantId],
  )
  const row = w.rows[0]
  const ledger = await pool.query(
    `SELECT entry_type, amount, order_ref, awb, note, occurred_at
       FROM wallet_ledger WHERE tenant_id = $1
      ORDER BY occurred_at DESC LIMIT $2`,
    [tenantId, ledgerLimit],
  )
  return {
    balance: row ? Number(row.balance) : 0,
    minBalance: row ? Number(row.min_balance) : 0,
    currency: row ? row.currency.trim() : 'INR',
    ledger: ledger.rows,
  }
}

export async function walletBelowMinimum(tenantId: string): Promise<boolean> {
  const res = await controlPlanePool().query(
    `SELECT balance < min_balance AS below FROM tenant_wallets WHERE tenant_id = $1`,
    [tenantId],
  )
  return !!res.rows[0]?.below
}

/**
 * Should shipment creation be blocked for insufficient wallet balance? own_delhivery tenants
 * ship on their own Delhivery account and are billed directly, so they are never gated. Everyone
 * else is blocked when the wallet is below its minimum ("like Delhivery does"). A missing wallet
 * row means no balance yet — treat as below minimum only if a positive minimum is configured.
 */
export async function walletBlocksShipment(tenantId: string): Promise<boolean> {
  const res = await controlPlanePool().query(
    `SELECT t.own_delhivery,
            COALESCE(w.balance, 0) < COALESCE(w.min_balance, 0) AS below,
            w.tenant_id IS NULL AS no_wallet
       FROM tenants t
       LEFT JOIN tenant_wallets w ON w.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  ).catch(() => null)
  const row = res?.rows[0]
  if (!row || row.own_delhivery) return false
  return !!row.below
}

/**
 * Gate an RVP (reverse pickup) on wallet balance: a platform-Delhivery tenant must hold at least
 * WALLET_PICKUP_MIN_FLOOR_INR (Rs 500) before we create the return shipment, because the reverse leg
 * has no customer-quoted shipping and its charge is debited from the wallet once the admin sets it.
 * own_delhivery tenants ship on their own account and are exempt. Returns null when allowed, else a
 * user-facing reason.
 */
export async function assertWalletCanCreateRvp(tenantId: string): Promise<string | null> {
  const res = await controlPlanePool().query(
    `SELECT t.own_delhivery, COALESCE(w.balance, 0) AS balance
       FROM tenants t LEFT JOIN tenant_wallets w ON w.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  ).catch(() => null)
  const row = res?.rows[0]
  if (!row || row.own_delhivery) return null
  const balance = Number(row.balance) || 0
  if (balance < WALLET_PICKUP_MIN_FLOOR_INR) {
    return `Insufficient wallet balance to create a return pickup. A minimum of Rs ${WALLET_PICKUP_MIN_FLOOR_INR} is required; current balance is Rs ${balance.toFixed(2)}. Please recharge.`
  }
  return null
}

/**
 * Record a wallet recharge. Ledger row + balance bump happen in one control-plane
 * transaction so the running balance can never drift from the ledger.
 */
export async function rechargeWallet(opts: {
  tenantId: string
  amountInr: number
  note?: string
  /**
   * Gateway reference (e.g. a Razorpay payment id) that makes this credit idempotent.
   * Guarded by uq_wallet_ledger_tenant_external_ref, so a concurrent retry of the SAME payment
   * inserts nothing rather than crediting twice. Omit for manual admin credits.
   */
  externalRef?: string
}): Promise<{ ok: true; balance: number; alreadyCredited?: boolean } | { ok: false; error: string }> {
  if (!opts.tenantId) return { ok: false, error: 'tenantId is required.' }
  if (!(opts.amountInr > 0)) return { ok: false, error: 'Recharge amount must be positive.' }

  const pool = controlPlanePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [opts.tenantId],
    )
    // ON CONFLICT DO NOTHING + rowCount is the whole guard: the loser of a concurrent race
    // inserts nothing and must NOT move the balance. A check-then-insert cannot do this.
    const ins = await client.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, external_ref, note)
       VALUES ($1, 'recharge', $2, $3, $4)
       ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
      [opts.tenantId, opts.amountInr, opts.externalRef ?? null, opts.note ?? 'Wallet recharge'],
    )
    if (ins.rowCount === 0) {
      // Already credited for this reference — return the current balance untouched.
      const cur = await client.query(
        `SELECT balance FROM tenant_wallets WHERE tenant_id = $1`, [opts.tenantId],
      )
      await client.query('COMMIT')
      return { ok: true, balance: Number(cur.rows[0]?.balance ?? 0), alreadyCredited: true }
    }
    const upd = await client.query(
      `UPDATE tenant_wallets SET balance = balance + $2, updated_at = now()
        WHERE tenant_id = $1 RETURNING balance`,
      [opts.tenantId, opts.amountInr],
    )
    await client.query('COMMIT')
    return { ok: true, balance: Number(upd.rows[0].balance) }
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    return { ok: false, error: e?.message || 'Failed to recharge wallet.' }
  } finally {
    client.release()
  }
}

export const WALLET_PICKUP_MIN_FLOOR_INR = 500 // balance must stay at/above this after a pickup

export interface PickupEstimateItem { awb: string; orderRef?: string | null; estimateInr: number }

/**
 * Charge the estimated Delhivery cost for one or more AWBs (platform-Delhivery tenants only). Called
 * when the AWB is CREATED (forward shipment) or when a reverse/RVP charge is set, NOT at pickup —
 * pickup only checks the balance. Rules:
 *   - own_delhivery tenants ship on their own account → { ok:true, skipped:true }, no movement.
 *   - the balance must stay >= WALLET_PICKUP_MIN_FLOOR_INR AFTER covering the sum of the (not yet
 *     charged) estimates → else { ok:false } with the shortfall and NO movement.
 *   - each AWB's estimate is a per-AWB 'debit' (same one-shot (tenant,awb) index), so an AWB already
 *     charged (re-submit, or added earlier) is not double-charged and is excluded from the required sum.
 * The real invoiced amount is reconciled at delivery via correctWalletDebitForAwb, which nets the
 * AWB to the actual — so the estimate here is a hold, not the final charge.
 * One control-plane transaction: balance and ledger never drift.
 */
export async function chargeDeliveryEstimate(opts: {
  tenantId: string
  items: PickupEstimateItem[]
  minFloorInr?: number
}): Promise<{ ok: true; skipped?: boolean; chargedInr: number; balance: number } | { ok: false; error: string }> {
  const floor = opts.minFloorInr ?? WALLET_PICKUP_MIN_FLOOR_INR
  if (!opts.tenantId) return { ok: false, error: 'tenantId is required.' }
  const items = (opts.items || []).filter(i => i.awb && i.estimateInr > 0)

  const pool = controlPlanePool()
  const flag = await pool.query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [opts.tenantId]).catch(() => null)
  if (!flag) return { ok: false, error: 'Failed to read tenant delivery mode.' }
  if (flag.rows[0]?.own_delhivery) return { ok: true, skipped: true, chargedInr: 0, balance: 0 }

  const client = await pool.connect().catch(() => null)
  if (!client) return { ok: false, error: 'Failed to open wallet transaction.' }
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [opts.tenantId])

    // AWBs that already carry a debit are not re-charged and don't count toward the required sum.
    const awbs = items.map(i => i.awb)
    const existing = await client.query(
      `SELECT awb FROM wallet_ledger WHERE tenant_id = $1 AND entry_type = 'debit' AND awb = ANY($2::text[])`,
      [opts.tenantId, awbs],
    )
    const already = new Set(existing.rows.map((r: any) => r.awb))
    const toCharge = items.filter(i => !already.has(i.awb))
    const sum = Math.round(toCharge.reduce((s, i) => s + Math.abs(i.estimateInr), 0) * 100) / 100

    const balRow = await client.query(`SELECT balance FROM tenant_wallets WHERE tenant_id = $1`, [opts.tenantId])
    const balance = Number(balRow.rows[0]?.balance ?? 0)

    if (sum === 0) { await client.query('COMMIT'); return { ok: true, chargedInr: 0, balance } }

    if (balance - sum < floor) {
      await client.query('ROLLBACK')
      return {
        ok: false,
        error: `Insufficient wallet balance. This pickup needs Rs ${sum.toFixed(2)} and your balance must stay at or above Rs ${floor.toFixed(0)} after. Current balance: Rs ${balance.toFixed(2)}. Please recharge.`,
      }
    }

    for (const i of toCharge) {
      await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, order_ref, awb, note)
         VALUES ($1, 'debit', $2, $3, $4, $5)
         ON CONFLICT (tenant_id, awb) WHERE awb IS NOT NULL AND entry_type = 'debit' DO NOTHING`,
        [opts.tenantId, -Math.abs(i.estimateInr), i.orderRef ?? null, i.awb, `Pickup estimate — AWB ${i.awb}`],
      )
    }
    const upd = await client.query(
      `UPDATE tenant_wallets SET balance = balance - $2, updated_at = now() WHERE tenant_id = $1 RETURNING balance`,
      [opts.tenantId, sum],
    )
    await client.query('COMMIT')
    return { ok: true, chargedInr: sum, balance: Number(upd.rows[0].balance) }
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return { ok: false, error: 'Wallet charge failed.' }
  } finally {
    client.release()
  }
}

/**
 * Refund pickup estimate debits for the given AWBs when the pickup itself failed (Delhivery
 * rejected it after we charged). Posts a positive 'adjustment' that nets the AWB back to zero and
 * credits the balance, only for AWBs that currently carry a net debit. Idempotent: an AWB already
 * netted to zero is skipped. own_delhivery tenants never had a debit → no-op.
 */
export async function refundEstimateForAwbs(opts: {
  tenantId: string
  awbs: string[]
}): Promise<{ ok: boolean; refundedInr: number }> {
  const awbs = (opts.awbs || []).filter(Boolean)
  if (!opts.tenantId || awbs.length === 0) return { ok: true, refundedInr: 0 }
  const pool = controlPlanePool()
  const client = await pool.connect().catch(() => null)
  if (!client) return { ok: false, refundedInr: 0 }
  try {
    await client.query('BEGIN')
    let refunded = 0
    for (const awb of awbs) {
      const net = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS net FROM wallet_ledger
          WHERE tenant_id = $1 AND awb = $2 AND entry_type IN ('debit', 'adjustment')`,
        [opts.tenantId, awb],
      )
      const currentNet = Number(net.rows[0]?.net ?? 0)
      if (currentNet >= 0) continue // nothing owed for this AWB
      const credit = -currentNet // positive, brings net to 0
      await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, awb, note)
         VALUES ($1, 'adjustment', $2, $3, $4)`,
        [opts.tenantId, credit, awb, `Pickup estimate refund — AWB ${awb} (pickup failed)`],
      )
      refunded += credit
    }
    if (refunded > 0) {
      await client.query(
        `UPDATE tenant_wallets SET balance = balance + $2, updated_at = now() WHERE tenant_id = $1`,
        [opts.tenantId, refunded],
      )
    }
    await client.query('COMMIT')
    return { ok: true, refundedInr: refunded }
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return { ok: false, refundedInr: 0 }
  } finally {
    client.release()
  }
}

/**
 * Debit the real Delhivery cost for a shipment, keyed to its AWB. The partial-unique index
 * (tenant_id, awb) WHERE entry_type='debit' makes this idempotent: a repeat for the same AWB
 * inserts nothing and leaves the balance untouched. Returns whether the charge is durably settled
 * (a fresh debit committed, or one already existed for this AWB) so the caller can gate
 * delhivery_billed_at on it — a transient DB failure returns false so the next sync retries instead
 * of silently losing the charge.
 */
export async function debitWalletForAwb(opts: {
  tenantId: string
  awb: string
  orderRef?: string | null
  amountInr: number
  note?: string
}): Promise<boolean> {
  if (!opts.tenantId || !opts.awb || !(opts.amountInr > 0)) return false
  const pool = controlPlanePool()
  const client = await pool.connect().catch(() => null)
  if (!client) return false
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [opts.tenantId],
    )
    const ins = await client.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, order_ref, awb, note)
       VALUES ($1, 'debit', $2, $3, $4, $5)
       ON CONFLICT (tenant_id, awb) WHERE awb IS NOT NULL AND entry_type = 'debit' DO NOTHING`,
      [opts.tenantId, -Math.abs(opts.amountInr), opts.orderRef ?? null, opts.awb,
       opts.note ?? `Delhivery charge — AWB ${opts.awb}`],
    )
    if (ins.rowCount && ins.rowCount > 0) {
      await client.query(
        `UPDATE tenant_wallets SET balance = balance - $2, updated_at = now() WHERE tenant_id = $1`,
        [opts.tenantId, Math.abs(opts.amountInr)],
      )
    }
    await client.query('COMMIT')
    // Either branch is durably settled: a fresh debit committed, or the AWB was already charged
    // (ON CONFLICT no-op). Both mean the charge is on the books — safe to stamp billed_at.
    return true
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    return false
  } finally {
    client.release()
  }
}

/**
 * Single chokepoint after an order's real Delhivery cost (delhivery_billed_amount) is written.
 * own_delhivery tenants ship on their own account and are billed directly by Delhivery, so we
 * skip the wallet debit for them. Cross-DB and best-effort: the caller runs in tenant ALS context,
 * the wallet is control-plane. Returns true when the charge is durably settled (debit recorded or
 * already present, or the tenant is exempt) so callers gate delhivery_billed_at on it; false on a
 * transient failure so the next sync retries.
 */
export async function settleDelhiveryCostToWallet(opts: {
  tenantId: string
  awb: string
  orderRef?: string | null
  amountInr: number
}): Promise<boolean> {
  if (!opts.tenantId || !opts.awb || !(opts.amountInr > 0)) return false
  const pool = controlPlanePool()
  const flag = await pool.query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [opts.tenantId]).catch(() => null)
  if (!flag) return false
  if (flag.rows[0]?.own_delhivery) return true

  // If this AWB was already charged at pickup (a debit exists), the one-shot debitWalletForAwb
  // would no-op and leave the ESTIMATE on the books forever. Reconcile instead: net the AWB to the
  // real invoiced amount (refund estimate, debit actual) in one movement. Fresh AWBs (no prior
  // debit — e.g. own historical flows) take the plain idempotent debit.
  const existing = await pool.query(
    `SELECT 1 FROM wallet_ledger WHERE tenant_id = $1 AND awb = $2 AND entry_type = 'debit' LIMIT 1`,
    [opts.tenantId, opts.awb],
  ).catch(() => null)
  if (existing && (existing.rowCount ?? 0) > 0) {
    const res = await correctWalletDebitForAwb({
      tenantId: opts.tenantId,
      awb: opts.awb,
      orderRef: opts.orderRef,
      newAmountInr: opts.amountInr,
    }).catch(() => ({ ok: false as const, error: 'reconcile failed' }))
    return res.ok
  }
  return debitWalletForAwb(opts)
}

/**
 * Correct an already-settled Delhivery charge for one AWB, netting the wallet to exactly
 * -newAmountInr. Unlike debitWalletForAwb (one-shot per AWB), this is used when the platform admin
 * re-prices a shipment post-pickup: it sums the existing debit + any prior adjustment rows for the
 * AWB and posts a single 'adjustment' row for the delta needed to reach -newAmountInr, preserving the
 * original debit as an audit trail (the initial amount debited is refunded and the actual amount is
 * debited, as a net movement). own_delhivery tenants are billed directly by Delhivery and are exempt.
 * Balance + ledger move in one control-plane transaction. Returns the outcome and the applied delta.
 */
export async function correctWalletDebitForAwb(opts: {
  tenantId: string
  awb: string
  orderRef?: string | null
  newAmountInr: number
  note?: string
}): Promise<{ ok: true; outcome: 'adjusted' | 'noop' | 'exempt'; delta: number } | { ok: false; error: string }> {
  if (!opts.tenantId || !opts.awb) return { ok: false, error: 'tenantId and awb are required.' }
  if (!(opts.newAmountInr >= 0)) return { ok: false, error: 'Corrected amount must be zero or positive.' }

  const pool = controlPlanePool()
  const flag = await pool.query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [opts.tenantId]).catch(() => null)
  if (!flag) return { ok: false, error: 'Failed to read tenant delivery mode.' }
  if (flag.rows[0]?.own_delhivery) return { ok: true, outcome: 'exempt', delta: 0 }

  const client = await pool.connect().catch(() => null)
  if (!client) return { ok: false, error: 'Failed to open wallet transaction.' }
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [opts.tenantId],
    )
    const net = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS net FROM wallet_ledger
        WHERE tenant_id = $1 AND awb = $2 AND entry_type IN ('debit', 'adjustment')`,
      [opts.tenantId, opts.awb],
    )
    const currentNet = Number(net.rows[0]?.net ?? 0)
    const target = -Math.abs(opts.newAmountInr)
    const delta = Math.round((target - currentNet) * 100) / 100
    if (Math.abs(delta) < 0.01) {
      await client.query('COMMIT')
      return { ok: true, outcome: 'noop', delta: 0 }
    }
    await client.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, order_ref, awb, note)
       VALUES ($1, 'adjustment', $2, $3, $4, $5)`,
      [opts.tenantId, delta, opts.orderRef ?? null, opts.awb,
       opts.note ?? `Delhivery charge correction — AWB ${opts.awb}`],
    )
    await client.query(
      `UPDATE tenant_wallets SET balance = balance + $2, updated_at = now() WHERE tenant_id = $1`,
      [opts.tenantId, delta],
    )
    await client.query('COMMIT')
    return { ok: true, outcome: 'adjusted', delta }
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    return { ok: false, error: e?.message || 'Failed to correct wallet debit.' }
  } finally {
    client.release()
  }
}

export interface BillingReconcileRow {
  awb: string
  billedAmount: number
}

export type ReconcileOutcome = 'adjusted' | 'skipped' | 'unmatched' | 'exempt' | 'error'

export interface ReconcileResult {
  awb: string
  outcome: ReconcileOutcome
  delta?: number
}

/**
 * True up wallet debits against Delhivery's authoritative monthly billing CSV.
 *
 * The delivery-time debit (debitWalletForAwb) is only an estimate priced on our stored weight;
 * Delhivery re-weighs at the hub and the real charge is exposed nowhere in the API — only in the
 * panel's monthly billing export. For each CSV row this posts one 'adjustment' entry for
 * (realBilled - alreadyDebited): a higher real charge debits further, an over-estimate credits back.
 *
 * Idempotent per (awb, period): a deterministic marker in the note is checked before inserting, so
 * re-importing the same month's CSV is a no-op. The debit-scoped unique index does not cover
 * 'adjustment' rows, so nothing blocks the insert. own_delhivery tenants are billed directly by
 * Delhivery and are exempt. Returns a per-AWB summary; balance and ledger move in one transaction.
 */
export async function reconcileDelhiveryBilling(
  rows: BillingReconcileRow[],
  tenantId: string,
  period: string,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = []
  if (!tenantId || !period || rows.length === 0) return results

  const pool = controlPlanePool()
  const flag = await pool.query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [tenantId]).catch(() => null)
  if (!flag?.rows[0]) return rows.map((r) => ({ awb: r.awb, outcome: 'error' as const }))
  if (flag.rows[0].own_delhivery) return rows.map((r) => ({ awb: r.awb, outcome: 'exempt' as const }))

  for (const row of rows) {
    const awb = String(row.awb || '').trim()
    const billed = Number(row.billedAmount)
    if (!awb || !Number.isFinite(billed) || billed < 0) {
      results.push({ awb, outcome: 'error' })
      continue
    }

    const marker = `adj:${awb}:${period}`
    const client = await pool.connect().catch(() => null)
    if (!client) { results.push({ awb, outcome: 'error' }); continue }
    try {
      await client.query('BEGIN')

      const dup = await client.query(
        `SELECT 1 FROM wallet_ledger
          WHERE tenant_id = $1 AND awb = $2 AND entry_type = 'adjustment' AND note LIKE $3 LIMIT 1`,
        [tenantId, awb, `${marker}%`],
      )
      if (dup.rowCount && dup.rowCount > 0) {
        await client.query('ROLLBACK')
        results.push({ awb, outcome: 'skipped' })
        continue
      }

      const debitRes = await client.query(
        `SELECT amount FROM wallet_ledger
          WHERE tenant_id = $1 AND awb = $2 AND entry_type = 'debit' LIMIT 1`,
        [tenantId, awb],
      )
      if (debitRes.rowCount === 0) {
        await client.query('ROLLBACK')
        results.push({ awb, outcome: 'unmatched' })
        continue
      }

      const alreadyDebited = Math.abs(Number(debitRes.rows[0].amount))
      const delta = Math.round((billed - alreadyDebited) * 100) / 100
      if (Math.abs(delta) < 0.01) {
        await client.query('ROLLBACK')
        results.push({ awb, outcome: 'skipped', delta: 0 })
        continue
      }

      await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, awb, note)
         VALUES ($1, 'adjustment', $2, $3, $4)`,
        [tenantId, -delta, awb, `${marker} — Delhivery billing true-up (${period})`],
      )
      await client.query(
        `UPDATE tenant_wallets SET balance = balance - $2, updated_at = now() WHERE tenant_id = $1`,
        [tenantId, delta],
      )
      await client.query('COMMIT')
      results.push({ awb, outcome: 'adjusted', delta })
    } catch {
      await client.query('ROLLBACK').catch(() => {})
      results.push({ awb, outcome: 'error' })
    } finally {
      client.release()
    }
  }

  return results
}
