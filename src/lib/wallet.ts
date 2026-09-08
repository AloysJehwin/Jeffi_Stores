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
 * Record a wallet recharge. Ledger row + balance bump happen in one control-plane
 * transaction so the running balance can never drift from the ledger.
 */
export async function rechargeWallet(opts: {
  tenantId: string
  amountInr: number
  note?: string
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
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
    await client.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, amount, note)
       VALUES ($1, 'recharge', $2, $3)`,
      [opts.tenantId, opts.amountInr, opts.note ?? 'Wallet recharge'],
    )
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
  return debitWalletForAwb(opts)
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
