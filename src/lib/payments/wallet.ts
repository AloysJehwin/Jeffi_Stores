import type { PoolClient } from 'pg'
import { controlPlanePool } from '@/lib/tenant-registry'

// Prepaid shipping wallet for tenants on the PLATFORM Delhivery account.
//
// Model: every AWB's wallet effect is the SUM of its 'debit' + 'adjustment' rows (its "net"). A
// shipment is charged an estimate when the AWB is created (one 'debit' row, unique per tenant+awb),
// then netted to Delhivery's real figure (delivery/RTO invoice, admin correction, billing CSV) with
// 'adjustment' rows. Netting is naturally idempotent: re-applying the same target posts nothing.
// Every mutation locks the tenant_wallets row (FOR UPDATE) so concurrent syncs/retries serialise.
//
// Who pays: the flagship (no tenant / NIL id) never does. An AWB that already has ledger rows was
// shipped on the platform account and stays wallet-billed even if the tenant later switched to its
// own account; an AWB with no rows follows the tenant's current own_delhivery flag.

export const FLAGSHIP_TENANT_ID = '00000000-0000-0000-0000-000000000000'
export const WALLET_PICKUP_MIN_FLOOR_INR = 500 // balance must stay at/above this after a shipment charge

export function isFlagshipTenant(tenantId: string | null | undefined): boolean {
  return !tenantId || tenantId === FLAGSHIP_TENANT_ID
}

export interface WalletLedgerEntry {
  entry_type: 'recharge' | 'debit' | 'adjustment'
  category: string | null
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}

/** What a wallet movement was (independent of entry_type's +/- direction). */
export type WalletCategory =
  | 'shipping_forward'
  | 'shipping_rvp'
  | 'shipping_correction'
  | 'shipping_cancel_credit'
  | 'recharge'
  | 'goodwill_credit'
  | 'campaign'
  | 'ai'
  | 'sms'
  | 'whatsapp'
  | 'email'
  | 'adjustment'

export interface TenantWallet {
  balance: number
  minBalance: number
  currency: string
  ledger: WalletLedgerEntry[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function getTenantWallet(tenantId: string, ledgerLimit = 50): Promise<TenantWallet> {
  const pool = controlPlanePool()
  const w = await pool.query(`SELECT balance, min_balance, currency FROM tenant_wallets WHERE tenant_id = $1`, [
    tenantId,
  ])
  const row = w.rows[0]
  const ledger = await pool.query(
    `SELECT entry_type, category, amount, order_ref, awb, note, occurred_at
       FROM wallet_ledger WHERE tenant_id = $1
      ORDER BY occurred_at DESC LIMIT $2`,
    [tenantId, ledgerLimit]
  )
  return {
    balance: row ? Number(row.balance) : 0,
    minBalance: row ? Number(row.min_balance) : 0,
    currency: row ? row.currency.trim() : 'INR',
    ledger: ledger.rows,
  }
}

/** 'own' | 'platform', or null when the control plane can't be read (callers must fail closed). */
async function tenantMode(tenantId: string): Promise<'own' | 'platform' | null> {
  const res = await controlPlanePool()
    .query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [tenantId])
    .catch(() => null)
  if (!res) return null
  return res.rows[0]?.own_delhivery ? 'own' : 'platform'
}

/** True when this tenant's new shipments are paid from the wallet; null when unreadable. */
export async function tenantShipsOnPlatform(tenantId: string | null | undefined): Promise<boolean | null> {
  if (isFlagshipTenant(tenantId)) return false
  const mode = await tenantMode(tenantId as string)
  return mode === null ? null : mode === 'platform'
}

async function lockWallet(
  client: PoolClient,
  tenantId: string,
  floorInr: number = WALLET_PICKUP_MIN_FLOOR_INR
): Promise<{ balance: number; floor: number }> {
  await client.query(`INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
    tenantId,
  ])
  const r = await client.query(`SELECT balance, min_balance FROM tenant_wallets WHERE tenant_id = $1 FOR UPDATE`, [
    tenantId,
  ])
  const balance = Number(r.rows[0]?.balance ?? 0)
  const floor = Math.max(floorInr, Number(r.rows[0]?.min_balance ?? 0))
  return { balance, floor }
}

async function awbNet(client: PoolClient, tenantId: string, awb: string): Promise<{ net: number; rows: number }> {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS net, COUNT(*)::int AS n FROM wallet_ledger
      WHERE tenant_id = $1 AND awb = $2 AND entry_type IN ('debit', 'adjustment')`,
    [tenantId, awb]
  )
  return { net: Number(r.rows[0]?.net ?? 0), rows: Number(r.rows[0]?.n ?? 0) }
}

async function moveBalance(client: PoolClient, tenantId: string, delta: number): Promise<number> {
  const r = await client.query(
    `UPDATE tenant_wallets SET balance = balance + $2, updated_at = now() WHERE tenant_id = $1 RETURNING balance`,
    [tenantId, delta]
  )
  return Number(r.rows[0]?.balance ?? 0)
}

async function withWalletTx<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await controlPlanePool().connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function shortfallMessage(what: string, needed: number, balance: number, floor: number): string {
  const short = round2(needed + floor - balance)
  return `Insufficient wallet balance: ${what} needs Rs ${needed.toFixed(2)} and the wallet must keep Rs ${floor.toFixed(2)} after it (Rs ${(needed + floor).toFixed(2)} in total), but the balance is Rs ${balance.toFixed(2)}. Recharge at least Rs ${short.toFixed(2)} to continue.`
}

/**
 * Pickup-time gate: block when the balance is below the tenant's configured minimum. Charges were
 * already taken at AWB creation, so this is only a floor check. own/flagship are never blocked.
 */
export async function walletBlocksShipment(tenantId: string): Promise<boolean> {
  if (isFlagshipTenant(tenantId)) return false
  const res = await controlPlanePool()
    .query(
      `SELECT t.own_delhivery,
            COALESCE(w.balance, 0) < COALESCE(w.min_balance, 0) AS below
       FROM tenants t
       LEFT JOIN tenant_wallets w ON w.tenant_id = t.id
      WHERE t.id = $1`,
      [tenantId]
    )
    .catch(() => null)
  const row = res?.rows[0]
  if (!row || row.own_delhivery) return false
  return !!row.below
}

export type WalletCheck =
  | { ok: true; exempt: boolean; balance: number; floor: number }
  | { ok: false; error: string; neededInr: number; balanceInr: number; floorInr: number }

/**
 * Pre-flight before minting an AWB on the platform account: can the wallet pay `estimateInr` and
 * still hold max(Rs 500, min_balance)? Read-only — the actual charge happens once the AWB exists.
 * Fails closed when the control plane is unreachable (never ship unpaid).
 */
export async function checkWalletForShipment(opts: {
  tenantId: string | null | undefined
  estimateInr: number
  what?: string
}): Promise<WalletCheck> {
  if (isFlagshipTenant(opts.tenantId)) return { ok: true, exempt: true, balance: 0, floor: 0 }
  const res = await controlPlanePool()
    .query(
      `SELECT t.own_delhivery, COALESCE(w.balance, 0) AS balance, COALESCE(w.min_balance, 0) AS min_balance
       FROM tenants t LEFT JOIN tenant_wallets w ON w.tenant_id = t.id
      WHERE t.id = $1`,
      [opts.tenantId]
    )
    .catch(() => null)
  const row = res?.rows[0]
  if (!row) {
    return {
      ok: false,
      error: 'Could not read the shipping wallet. Try again shortly.',
      neededInr: 0,
      balanceInr: 0,
      floorInr: 0,
    }
  }
  if (row.own_delhivery) return { ok: true, exempt: true, balance: 0, floor: 0 }
  const balance = Number(row.balance) || 0
  const floor = Math.max(WALLET_PICKUP_MIN_FLOOR_INR, Number(row.min_balance) || 0)
  const needed = round2(Math.max(0, opts.estimateInr))
  if (balance - needed < floor) {
    return {
      ok: false,
      error: shortfallMessage(opts.what ?? 'this shipment', needed, balance, floor),
      neededInr: needed,
      balanceInr: balance,
      floorInr: floor,
    }
  }
  return { ok: true, exempt: false, balance, floor }
}

/**
 * Record a wallet recharge. Ledger row + balance bump happen in one control-plane transaction.
 * `externalRef` (e.g. a Razorpay payment id) makes the credit idempotent via
 * uq_wallet_ledger_tenant_external_ref; omit it for manual platform-admin credits.
 */
export async function rechargeWallet(opts: {
  tenantId: string
  amountInr: number
  note?: string
  externalRef?: string
}): Promise<{ ok: true; balance: number; alreadyCredited?: boolean } | { ok: false; error: string }> {
  if (!opts.tenantId) return { ok: false, error: 'tenantId is required.' }
  if (!(opts.amountInr > 0)) return { ok: false, error: 'Recharge amount must be positive.' }

  try {
    return await withWalletTx(opts.tenantId, async client => {
      const { balance } = await lockWallet(client, opts.tenantId)
      const ins = await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note)
         VALUES ($1, 'recharge', 'recharge', $2, $3, $4)
         ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
        [opts.tenantId, opts.amountInr, opts.externalRef ?? null, opts.note ?? 'Wallet recharge']
      )
      if (!ins.rowCount) return { ok: true as const, balance, alreadyCredited: true }
      return { ok: true as const, balance: await moveBalance(client, opts.tenantId, opts.amountInr) }
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to recharge wallet.' }
  }
}

export interface PickupEstimateItem {
  awb: string
  orderRef?: string | null
  estimateInr: number
}

/**
 * Charge the estimated Delhivery cost for one or more freshly created AWBs (forward or RVP) as one
 * 'debit' per AWB. AWBs already carrying ledger rows are skipped (retry / label regeneration /
 * re-submit). The balance must stay >= max(Rs 500, min_balance) after the sum, else nothing moves.
 * The estimate is a hold: settle/correct/reconcile later net the AWB to the real charge.
 */
export async function chargeDeliveryEstimate(opts: {
  tenantId: string
  items: PickupEstimateItem[]
  kind?: 'forward' | 'rvp'
}): Promise<{ ok: true; skipped?: boolean; chargedInr: number; balance: number } | { ok: false; error: string }> {
  if (isFlagshipTenant(opts.tenantId)) return { ok: true, skipped: true, chargedInr: 0, balance: 0 }
  const items = (opts.items || []).filter(i => i.awb && i.estimateInr > 0)

  const mode = await tenantMode(opts.tenantId)
  if (!mode) return { ok: false, error: 'Failed to read tenant delivery mode.' }
  if (mode === 'own') return { ok: true, skipped: true, chargedInr: 0, balance: 0 }

  const label = opts.kind === 'rvp' ? 'Return pickup (RVP) estimate' : 'Shipment estimate'
  try {
    return await withWalletTx(opts.tenantId, async client => {
      const { balance, floor } = await lockWallet(client, opts.tenantId)
      const existing = await client.query(
        `SELECT DISTINCT awb FROM wallet_ledger WHERE tenant_id = $1 AND awb = ANY($2::text[])`,
        [opts.tenantId, items.map(i => i.awb)]
      )
      const already = new Set(existing.rows.map((r: any) => r.awb))
      const toCharge = items.filter(i => !already.has(i.awb))
      const sum = round2(toCharge.reduce((s, i) => s + Math.abs(i.estimateInr), 0))
      if (sum === 0) return { ok: true as const, chargedInr: 0, balance }
      if (balance - sum < floor) {
        return { ok: false as const, error: shortfallMessage('this shipment', sum, balance, floor) }
      }
      let charged = 0
      for (const i of toCharge) {
        const ins = await client.query(
          `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, order_ref, awb, note)
           VALUES ($1, 'debit', $6, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, awb) WHERE awb IS NOT NULL AND entry_type = 'debit' DO NOTHING`,
          [
            opts.tenantId,
            -Math.abs(i.estimateInr),
            i.orderRef ?? null,
            i.awb,
            `${label} — AWB ${i.awb}`,
            opts.kind === 'rvp' ? 'shipping_rvp' : 'shipping_forward',
          ]
        )
        if (ins.rowCount) charged += Math.abs(i.estimateInr)
      }
      charged = round2(charged)
      const after = charged > 0 ? await moveBalance(client, opts.tenantId, -charged) : balance
      return { ok: true as const, chargedInr: charged, balance: after }
    })
  } catch {
    return { ok: false, error: 'Wallet charge failed.' }
  }
}

/**
 * Credit back whatever an AWB currently nets to, bringing it to zero — used when the AWB is
 * cancelled before pickup or Delhivery rejects it. Idempotent: an AWB already at zero is skipped.
 */
export async function refundEstimateForAwbs(opts: {
  tenantId: string
  awbs: string[]
  reason?: string
}): Promise<{ ok: boolean; refundedInr: number }> {
  const awbs = [...new Set((opts.awbs || []).filter(Boolean))]
  if (isFlagshipTenant(opts.tenantId) || awbs.length === 0) return { ok: true, refundedInr: 0 }
  try {
    return await withWalletTx(opts.tenantId, async client => {
      await lockWallet(client, opts.tenantId)
      let refunded = 0
      for (const awb of awbs) {
        const { net } = await awbNet(client, opts.tenantId, awb)
        if (net >= 0) continue
        const credit = round2(-net)
        await client.query(
          `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, awb, note)
           VALUES ($1, 'adjustment', 'shipping_cancel_credit', $2, $3, $4)`,
          [opts.tenantId, credit, awb, `Refund — AWB ${awb} ${opts.reason ?? 'cancelled before pickup'}`]
        )
        refunded += credit
      }
      refunded = round2(refunded)
      if (refunded > 0) await moveBalance(client, opts.tenantId, refunded)
      return { ok: true, refundedInr: refunded }
    })
  } catch {
    return { ok: false, refundedInr: 0 }
  }
}

/**
 * Net one AWB to exactly -newAmountInr with a single 'adjustment' (debit kept as audit trail). Used
 * for invoice settlement, admin re-pricing, RVP charge entry. Exempt when the AWB has no ledger rows
 * and the tenant ships on its own account, or for the flagship.
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
  if (isFlagshipTenant(opts.tenantId)) return { ok: true, outcome: 'exempt', delta: 0 }

  const mode = await tenantMode(opts.tenantId)
  if (!mode) return { ok: false, error: 'Failed to read tenant delivery mode.' }

  try {
    return await withWalletTx(opts.tenantId, async client => {
      await lockWallet(client, opts.tenantId)
      const { net, rows } = await awbNet(client, opts.tenantId, opts.awb)
      if (rows === 0 && mode === 'own') return { ok: true as const, outcome: 'exempt' as const, delta: 0 }
      const delta = round2(-Math.abs(opts.newAmountInr) - net)
      if (Math.abs(delta) < 0.01) return { ok: true as const, outcome: 'noop' as const, delta: 0 }
      // First movement on an AWB is its debit row (keeps the one-debit-per-AWB index meaningful).
      const entryType = rows === 0 ? 'debit' : 'adjustment'
      await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, order_ref, awb, note)
         VALUES ($1, $2, 'shipping_correction', $3, $4, $5, $6)`,
        [
          opts.tenantId,
          entryType,
          delta,
          opts.orderRef ?? null,
          opts.awb,
          opts.note ?? `Delhivery charge correction — AWB ${opts.awb}`,
        ]
      )
      await moveBalance(client, opts.tenantId, delta)
      return { ok: true as const, outcome: 'adjusted' as const, delta }
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to correct wallet debit.' }
  }
}

/**
 * Settle Delhivery's real invoiced cost for an AWB (delivery / RTO). Nets the AWB to the real amount
 * (refunding the estimate hold and debiting the actual in one movement). Returns true when durably
 * settled or exempt, false on a transient failure so the caller retries.
 */
export async function settleDelhiveryCostToWallet(opts: {
  tenantId: string
  awb: string
  orderRef?: string | null
  amountInr: number
  note?: string
}): Promise<boolean> {
  if (!opts.tenantId || !opts.awb || !(opts.amountInr > 0)) return false
  if (isFlagshipTenant(opts.tenantId)) return true
  const res = await correctWalletDebitForAwb({
    tenantId: opts.tenantId,
    awb: opts.awb,
    orderRef: opts.orderRef,
    newAmountInr: opts.amountInr,
    note: opts.note ?? `Delhivery invoiced charge — AWB ${opts.awb}`,
  }).catch(() => ({ ok: false as const, error: 'settle failed' }))
  return res.ok
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
 * True up AWBs against Delhivery's billing export (platform admin only). Each row's billed amount is
 * treated as the AWB's total charge: the AWB is netted to it. Idempotent per (awb, period) via an
 * external_ref key, and per value via netting. An AWB with no ledger rows is 'unmatched' — ledger
 * presence is the only proof it belongs to this tenant, so it is never debited blind.
 */
export async function reconcileDelhiveryBilling(
  rows: BillingReconcileRow[],
  tenantId: string,
  period: string
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = []
  if (!tenantId || !period || rows.length === 0) return results
  if (isFlagshipTenant(tenantId)) return rows.map(r => ({ awb: r.awb, outcome: 'exempt' as const }))
  const mode = await tenantMode(tenantId)
  if (!mode) return rows.map(r => ({ awb: r.awb, outcome: 'error' as const }))

  for (const row of rows) {
    const awb = String(row.awb || '').trim()
    const billed = Number(row.billedAmount)
    if (!awb || !Number.isFinite(billed) || billed < 0) {
      results.push({ awb, outcome: 'error' })
      continue
    }
    const key = `dlvbill:${awb}:${period}`.slice(0, 64)
    try {
      const r = await withWalletTx(tenantId, async client => {
        await lockWallet(client, tenantId)
        const dup = await client.query(
          `SELECT 1 FROM wallet_ledger
            WHERE tenant_id = $1 AND (external_ref = $2 OR (awb = $3 AND note LIKE $4)) LIMIT 1`,
          [tenantId, key, awb, `adj:${awb}:${period}%`]
        )
        if (dup.rowCount) return { awb, outcome: 'skipped' as const }
        const { net, rows: n } = await awbNet(client, tenantId, awb)
        if (n === 0) return { awb, outcome: mode === 'own' ? ('exempt' as const) : ('unmatched' as const) }
        const delta = round2(-billed - net)
        if (Math.abs(delta) < 0.01) return { awb, outcome: 'skipped' as const, delta: 0 }
        const ins = await client.query(
          `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, awb, external_ref, note)
           VALUES ($1, 'adjustment', 'shipping_correction', $2, $3, $4, $5)
           ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
          [tenantId, delta, awb, key, `Delhivery billing true-up (${period}) — AWB ${awb}`]
        )
        if (!ins.rowCount) return { awb, outcome: 'skipped' as const }
        await moveBalance(client, tenantId, delta)
        return { awb, outcome: 'adjusted' as const, delta: -delta }
      })
      results.push(r)
    } catch {
      results.push({ awb, outcome: 'error' })
    }
  }
  return results
}

/** Balance + floor only (no ledger) — for the top-nav badge. */
export async function getWalletBalance(
  tenantId: string
): Promise<{ balance: number; minBalance: number; currency: string }> {
  const pool = controlPlanePool()
  const r = await pool
    .query(`SELECT balance, min_balance, currency FROM tenant_wallets WHERE tenant_id = $1`, [tenantId])
    .catch(() => null)
  const row = r?.rows[0]
  return {
    balance: row ? Number(row.balance) : 0,
    minBalance: row ? Number(row.min_balance) : 0,
    currency: row ? String(row.currency).trim() : 'INR',
  }
}

/**
 * Generic categorised debit for future paid features (campaigns, AI, …). Not wired to any caller
 * yet — the one call those features make. Idempotent on externalRef. Blocks when the balance would
 * drop below max(Rs 500, min_balance). Flagship exempt; own-Delhivery tenants have no platform
 * wallet, but a non-shipping charge still applies (the exemption is shipping-specific), so this does
 * not gate on delivery mode.
 */
export async function debitWallet(opts: {
  tenantId: string
  amountInr: number
  category: WalletCategory
  externalRef: string
  note: string
  // Minimum balance to leave after the charge. Defaults to the Rs 500 shipping floor; messaging passes 0.
  floorInr?: number
}): Promise<{ ok: true; charged: boolean; balance: number } | { ok: false; error: string }> {
  if (isFlagshipTenant(opts.tenantId)) return { ok: true, charged: false, balance: 0 }
  if (!(opts.amountInr > 0)) return { ok: false, error: 'Debit amount must be positive.' }
  try {
    return await withWalletTx(opts.tenantId, async client => {
      const { balance, floor } = await lockWallet(client, opts.tenantId, opts.floorInr)
      const amount = round2(opts.amountInr)
      const dup = await client.query(`SELECT 1 FROM wallet_ledger WHERE tenant_id = $1 AND external_ref = $2 LIMIT 1`, [
        opts.tenantId,
        opts.externalRef,
      ])
      if (dup.rowCount) return { ok: true as const, charged: false, balance }
      if (balance - amount < floor) {
        return { ok: false as const, error: shortfallMessage(opts.note, amount, balance, floor) }
      }
      await client.query(
        `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note)
         VALUES ($1, 'debit', $2, $3, $4, $5)`,
        [opts.tenantId, opts.category, -amount, opts.externalRef, opts.note]
      )
      return { ok: true as const, charged: true, balance: await moveBalance(client, opts.tenantId, -amount) }
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Wallet debit failed.' }
  }
}
