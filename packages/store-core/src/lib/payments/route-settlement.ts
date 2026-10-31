import { getRazorpayInstance } from '@/lib/payments/razorpay'
import {
  commissionPct,
  fetchTransfer,
  fetchTransfersForPayment,
  fetchLinkedSettlement,
  fetchTransfersForSettlement,
  reverseTransfer,
  transferToLinkedAccount,
} from '@/lib/payments/razorpay-route'

/**
 * Control-plane money bookkeeping for tenant payments (tenant_transactions + settlement_ledger).
 *
 * Collection modes:
 *  - 'platform': collected on the platform Razorpay account. The tenant's share is Route-transferred
 *    to its linked account; the platform keeps commission + Razorpay's fees.
 *  - 'own': collected on the tenant's own Razorpay account. No transfer, no commission, no ledger.
 *
 * tenant_transactions.status: captured -> split (transferred, on hold) -> settled (linked account paid
 * out), or partially_refunded / refunded / failed (transfer failed).
 *
 * settlement_ledger balance = what the platform owes the tenant (negative = tenant owes the platform).
 * A Route sale nets to zero: +order_capture(gross) -commission -gateway_fee -payout(share transferred).
 * Every row carries an external_ref so webhook redeliveries and racing paths write it once.
 *
 * Refund policy: a refund reverses the transfer PROPORTIONALLY (share x refunded/gross, cumulative
 * across partial refunds) and refunds the platform commission in the same proportion. Razorpay keeps
 * its gateway/transfer fee on a refund; the platform absorbs the refunded portion of it.
 */

export type CollectedOn = 'own' | 'platform'
export const NIL_TENANT_ID = '00000000-0000-0000-0000-000000000000'

const toPaise = (v: unknown) => Math.round((Number(v) || 0) * 100)
const toInr = (p: number) => Math.round(p) / 100

async function cpPool() {
  const { controlPlanePool } = await import('@/lib/tenant-registry')
  return controlPlanePool()
}

export interface TxnRow {
  id: string
  tenant_id: string
  order_ref: string | null
  gross_amount: string | number
  tenant_share: string | number
  platform_commission: string | number
  gateway_fee: string | number
  is_cod: boolean
  gateway: string
  gateway_txn_id: string | null
  status: string
  payment_id: string | null
  transfer_id: string | null
  refunded_amount: string | number
  reversed_amount: string | number
}

const TXN_COLS = `id, tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, is_cod,
  gateway, gateway_txn_id, status, payment_id, transfer_id, refunded_amount, reversed_amount`

/** Legacy rows kept only one id in gateway_txn_id (the trf_ when split, else the pay_). */
export const transferIdOf = (r: Pick<TxnRow, 'transfer_id' | 'gateway_txn_id'>) =>
  r.transfer_id || (r.gateway_txn_id?.startsWith('trf_') ? r.gateway_txn_id : null)
export const paymentIdOf = (r: Pick<TxnRow, 'payment_id' | 'gateway_txn_id'>) =>
  r.payment_id || (r.gateway_txn_id?.startsWith('pay_') ? r.gateway_txn_id : null)

export async function findTenantTransaction(q: {
  tenantId?: string | null
  paymentId?: string | null
  transferId?: string | null
  orderRef?: string | null
}): Promise<TxnRow | null> {
  const pool = await cpPool()
  const one = (sql: string, args: any[]) =>
    pool
      .query(sql, args)
      .then((r: any) => (r.rows?.[0] as TxnRow) ?? null)
      .catch(() => null)
  const scope = q.tenantId ? ' AND tenant_id = $2' : ''
  const scoped = (v: string) => (q.tenantId ? [v, q.tenantId] : [v])
  if (q.paymentId) {
    const r = await one(
      `SELECT ${TXN_COLS} FROM tenant_transactions WHERE (payment_id = $1 OR gateway_txn_id = $1)${scope} LIMIT 1`,
      scoped(q.paymentId)
    )
    if (r) return r
  }
  if (q.transferId) {
    const r = await one(
      `SELECT ${TXN_COLS} FROM tenant_transactions WHERE (transfer_id = $1 OR gateway_txn_id = $1)${scope} LIMIT 1`,
      scoped(q.transferId)
    )
    if (r) return r
  }
  if (q.tenantId && q.orderRef) {
    return one(`SELECT ${TXN_COLS} FROM tenant_transactions WHERE tenant_id = $1 AND order_ref = $2 LIMIT 1`, [
      q.tenantId,
      q.orderRef,
    ])
  }
  return null
}

export interface PayoutTarget {
  active: boolean
  linkedAccountId: string | null
  dailyPayout: boolean
  ownDelhivery: boolean
}

/**
 * The tenant's Route destination. A re-provisioned tenant's acc_xxx lives on the owner-scoped
 * tenant_bank_accounts row, not the tenant row, so both are consulted (same as billing).
 */
export async function resolvePayoutTarget(tenantId: string): Promise<PayoutTarget | null> {
  const pool = await cpPool()
  const row = await pool
    .query(
      `SELECT COALESCE(
              (SELECT b.linked_account_id FROM tenant_bank_accounts b
                 JOIN owner_tenants ot ON ot.owner_id = b.owner_id
                WHERE ot.tenant_id = t.id AND b.linked_account_id IS NOT NULL
                ORDER BY b.created_at DESC LIMIT 1),
              t.razorpay_linked_account_id
            ) AS razorpay_linked_account_id,
            t.daily_payout, t.own_delhivery, t.status
       FROM tenants t WHERE t.id = $1`,
      [tenantId]
    )
    .then((r: any) => r.rows?.[0])
    .catch(() => null)
  if (!row) return null
  return {
    // Razorpay cannot suspend a linked account, so a non-active store's account must stay inert.
    active: row.status === 'active',
    linkedAccountId: row.razorpay_linked_account_id || null,
    dailyPayout: row.daily_payout === true,
    ownDelhivery: row.own_delhivery === true,
  }
}

async function insertLedger(
  pool: any,
  rows: { tenantId: string; type: string; amountInr: number; txnId?: string | null; note: string; ref: string }[]
): Promise<void> {
  const live = rows.filter(r => Math.abs(r.amountInr) >= 0.005)
  if (!live.length) return
  const args: any[] = []
  const values = live.map(r => {
    args.push(r.tenantId, r.type, r.amountInr, r.txnId ?? null, r.note.slice(0, 255), r.ref)
    const b = args.length - 6
    return `($${b + 1}::uuid, $${b + 2}, $${b + 3}::numeric, $${b + 4}::uuid, $${b + 5}, $${b + 6}, now())`
  })
  await pool
    .query(
      `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, txn_id, note, external_ref, occurred_at)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      args
    )
    .catch((e: any) => console.error('[route-settlement] ledger insert failed', e?.message))
}

/** Capture-time ledger of a transferred sale; nets to zero. Written once per payment/transfer. */
async function writeCaptureLedger(pool: any, row: TxnRow): Promise<void> {
  const trf = transferIdOf(row)
  if (!trf) return
  const ref = row.order_ref || ''
  const cap = `cap:${paymentIdOf(row) || trf}`
  // Pre-external_ref rows (old settle path) already carry an order_capture for this txn.
  const legacy = await pool
    .query(
      `SELECT 1 FROM settlement_ledger WHERE txn_id = $1 AND entry_type = 'order_capture' AND external_ref IS NULL LIMIT 1`,
      [row.id]
    )
    .then((r: any) => (r.rows?.length ?? 0) > 0)
    .catch(() => false)
  if (legacy) return
  await insertLedger(pool, [
    { tenantId: row.tenant_id, type: 'order_capture', amountInr: Number(row.gross_amount), txnId: row.id, note: `Payment captured — order ${ref}`, ref: cap },
    { tenantId: row.tenant_id, type: 'commission', amountInr: -Number(row.platform_commission), txnId: row.id, note: `Platform commission — order ${ref}`, ref: cap },
    { tenantId: row.tenant_id, type: 'gateway_fee', amountInr: -Number(row.gateway_fee), txnId: row.id, note: `Razorpay gateway + transfer fee — order ${ref}`, ref: cap },
    { tenantId: row.tenant_id, type: 'payout', amountInr: -Number(row.tenant_share), txnId: row.id, note: `Route transfer ${trf} — order ${ref}`, ref: `trf:${trf}` },
  ])
}

/**
 * Create (or adopt) the Route transfer for a captured row and mark it split. Adoption first: the
 * transfer API is not idempotent, so a payment that already has a live transfer is never sent another.
 */
async function transferForTxn(
  pool: any,
  row: TxnRow,
  opts: { linkedAccountId: string; dailyPayout: boolean; tenantSlug?: string; orderId?: string }
): Promise<boolean> {
  const paymentId = paymentIdOf(row)
  if (!paymentId) return false
  const fail = (reason: string) =>
    pool
      .query(`UPDATE tenant_transactions SET failure_reason = $2 WHERE id = $1`, [row.id, reason.slice(0, 255)])
      .catch(() => {})

  const existing = await fetchTransfersForPayment(paymentId)
  if (!existing.ok) {
    await fail(`transfer lookup failed: ${existing.error}`)
    return false
  }
  const live = existing.transfers.find(t => t.status !== 'failed' && t.status !== 'reversed')
  let split: { transferId: string; sharePaise: number; commissionPaise: number; feesPaise: number }
  if (live) {
    const n = live.notes ?? {}
    split = {
      transferId: live.id,
      sharePaise: live.amount,
      commissionPaise: Number(n.platform_commission) || 0,
      feesPaise: (Number(n.gateway_fee) || 0) + (Number(n.transfer_fee) || 0),
    }
  } else {
    try {
      const r = await transferToLinkedAccount({
        paymentId,
        grossAmountPaise: toPaise(row.gross_amount),
        linkedAccountId: opts.linkedAccountId,
        orderId: opts.orderId ?? row.order_ref ?? '',
        tenantSlug: opts.tenantSlug ?? '',
        dailyPayout: opts.dailyPayout,
      })
      if (!r.transferId) throw new Error('Razorpay returned no transfer id')
      split = {
        transferId: r.transferId,
        sharePaise: r.amount,
        commissionPaise: r.platformCommissionPaise,
        feesPaise: r.gatewayFeePaise + r.transferFeePaise,
      }
    } catch (e: any) {
      await fail(`transfer failed: ${e?.error?.description ?? e?.message ?? 'unknown'}`)
      return false
    }
  }

  const upd = await pool
    .query(
      `UPDATE tenant_transactions
          SET tenant_share = $2, platform_commission = $3, gateway_fee = $4, transfer_id = $5, gateway_txn_id = $5,
              payment_id = COALESCE(payment_id, $6),
              status = CASE WHEN status = 'captured' THEN 'split' ELSE status END,
              transferred_at = COALESCE(transferred_at, now()), failure_reason = NULL
        WHERE id = $1
        RETURNING ${TXN_COLS}`,
      [row.id, toInr(split.sharePaise), toInr(split.commissionPaise), toInr(split.feesPaise), split.transferId, paymentId]
    )
    .catch(() => null)
  const updated = upd?.rows?.[0] as TxnRow | undefined
  if (updated) await writeCaptureLedger(pool, updated)
  return !!updated
}

export type RecordOutcome = 'skipped' | 'own' | 'captured' | 'split' | 'duplicate'

/**
 * Record a captured online payment and, for platform collection, split it via Route. The single
 * entry point for verify, the webhooks, product-subscription cycles and variant-change top-ups.
 *
 * The row is inserted FIRST, keyed (tenant_id, payment_id) and (tenant_id, order_ref): whichever path
 * wins the insert is the only one that moves money, so verify/webhook/reconcile racing can never
 * double-transfer. A transfer that fails leaves the row 'captured' for reconcile-settlements to retry.
 * Never throws.
 */
export async function recordCapturedPayment(opts: {
  tenantId?: string | null
  tenantSlug?: string
  orderRef: string
  orderId?: string
  paymentId: string
  grossInr: number
  collectedOn: CollectedOn
  isCod?: boolean
  /** Snapshot taken at subscription creation; otherwise resolved from the control plane. */
  linkedAccountId?: string | null
}): Promise<RecordOutcome> {
  try {
    if (!opts.tenantId || opts.tenantId === NIL_TENANT_ID || !opts.orderRef || !opts.paymentId) return 'skipped'
    const pool = await cpPool()
    const own = opts.collectedOn === 'own'
    const ins = await pool.query(
      `INSERT INTO tenant_transactions
         (tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, gateway, is_cod,
          gateway_txn_id, payment_id, status, occurred_at)
       VALUES ($1, $2, $3, $3, 0, 0, $4, $5, $6, $6, 'captured', now())
       ON CONFLICT DO NOTHING
       RETURNING ${TXN_COLS}`,
      [opts.tenantId, opts.orderRef, opts.grossInr, own ? 'razorpay_own' : 'razorpay_route', !!opts.isCod, opts.paymentId]
    )
    const row = ins.rows?.[0] as TxnRow | undefined
    if (!row) return 'duplicate'
    if (own) return 'own'

    const target = await resolvePayoutTarget(opts.tenantId)
    const linkedAccountId = opts.linkedAccountId || target?.linkedAccountId
    if (!target?.active || !linkedAccountId) return 'captured'
    const ok = await transferForTxn(pool, row, {
      linkedAccountId,
      dailyPayout: target.dailyPayout,
      tenantSlug: opts.tenantSlug,
      orderId: opts.orderId,
    })
    return ok ? 'split' : 'captured'
  } catch (e: any) {
    console.error('[route-settlement] recordCapturedPayment failed', opts.orderRef, e?.message)
    return 'skipped'
  }
}

export type TransferOutcome = 'noop' | 'split' | 'settled' | 'failed'

/**
 * Advance a row from a Route transfer entity (webhook payload or a live fetch). Never regresses:
 * captured -> split on processed, -> settled once the linked account's settlement covers it, ->
 * failed on transfer.failed. Refund statuses are kept; the settlement timestamp is still recorded.
 */
export async function applyTransferState(transfer: any): Promise<TransferOutcome> {
  const id = (transfer?.id ?? '').toString().trim()
  if (!id) return 'noop'
  const pool = await cpPool()
  const source = typeof transfer?.source === 'string' && transfer.source.startsWith('pay_') ? transfer.source : null
  let row = await findTenantTransaction({ transferId: id })
  if (!row && source) {
    // Transfer created outside our split path (adoption race / dashboard): attach it to the payment row.
    row = await findTenantTransaction({ paymentId: source })
    if (row && !transferIdOf(row)) {
      await pool
        .query(`UPDATE tenant_transactions SET transfer_id = $2, gateway_txn_id = $2 WHERE id = $1 AND transfer_id IS NULL`, [
          row.id,
          id,
        ])
        .catch(() => {})
      row = { ...row, transfer_id: id, gateway_txn_id: id }
    } else if (row && transferIdOf(row) !== id) {
      return 'noop'
    }
  }
  if (!row || row.is_cod) return 'noop'
  if (source && !row.payment_id) {
    await pool.query(`UPDATE tenant_transactions SET payment_id = $2 WHERE id = $1 AND payment_id IS NULL`, [row.id, source]).catch(() => {})
    row = { ...row, payment_id: source }
  }

  const reversedPaise = Number(transfer?.amount_reversed) || 0
  if (reversedPaise > 0) {
    await pool
      .query(`UPDATE tenant_transactions SET reversed_amount = GREATEST(reversed_amount, $2) WHERE id = $1`, [
        row.id,
        toInr(reversedPaise),
      ])
      .catch(() => {})
  }

  if (transfer?.status === 'failed') {
    const reason = transfer?.error?.description || transfer?.error?.reason || 'transfer failed'
    const f = await pool
      .query(
        `UPDATE tenant_transactions SET status = 'failed', failure_reason = $2
          WHERE id = $1 AND status IN ('captured', 'split') RETURNING id`,
        [row.id, String(reason).slice(0, 255)]
      )
      .catch(() => null)
    if (!f?.rows?.length) return 'noop'
    // The payout ledger row assumed money left the platform; it did not, so the tenant is owed it.
    const paidOut = await pool
      .query(`SELECT 1 FROM settlement_ledger WHERE tenant_id = $1 AND entry_type = 'payout' AND external_ref = $2 LIMIT 1`, [
        row.tenant_id,
        `trf:${id}`,
      ])
      .then((r: any) => (r.rows?.length ?? 0) > 0)
      .catch(() => false)
    if (paidOut) {
      await insertLedger(pool, [
        { tenantId: row.tenant_id, type: 'adjustment', amountInr: Number(row.tenant_share), txnId: row.id, note: `Route transfer ${id} failed — share still owed (order ${row.order_ref ?? ''})`, ref: `trf_failed:${id}` },
      ])
    }
    return 'failed'
  }

  let outcome: TransferOutcome = 'noop'
  const settlementId = transfer?.recipient_settlement_id ? String(transfer.recipient_settlement_id) : null
  const settled = transfer?.settlement_status === 'settled' || !!settlementId
  if (transfer?.status === 'processed' || settled) {
    const s = await pool
      .query(
        `UPDATE tenant_transactions SET status = 'split', transferred_at = COALESCE(transferred_at, now())
          WHERE id = $1 AND status = 'captured' RETURNING ${TXN_COLS}`,
        [row.id]
      )
      .catch(() => null)
    const flipped = s?.rows?.[0] as TxnRow | undefined
    if (flipped) {
      await writeCaptureLedger(pool, flipped)
      outcome = 'split'
    }
  }
  if (settled) {
    const s = await pool
      .query(
        `UPDATE tenant_transactions
            SET status = CASE WHEN status IN ('captured', 'split') THEN 'settled' ELSE status END,
                settled_at = now(), recipient_settlement_id = COALESCE($2, recipient_settlement_id),
                transferred_at = COALESCE(transferred_at, now())
          WHERE id = $1 AND settled_at IS NULL RETURNING id`,
        [row.id, settlementId]
      )
      .catch(() => null)
    if (s?.rows?.length) outcome = 'settled'
  }
  return outcome
}

/**
 * settlement.processed: the payload has only the setl_ id, so look up the transfers it paid out
 * and settle each. Returns null when the lookup failed (reconcile-settlements catches up).
 */
export async function applySettlementProcessed(settlement: any): Promise<number | null> {
  const id = (settlement?.id ?? '').toString().trim()
  if (!id) return 0
  const transfers = await fetchTransfersForSettlement(id)
  if (!transfers) return null
  let n = 0
  for (const t of transfers) {
    const out = await applyTransferState({ ...t, settlement_status: 'settled', recipient_settlement_id: t.recipient_settlement_id || id })
    if (out === 'settled') n++
  }
  return n
}

async function withPaymentLock<T>(pool: any, key: string, fn: () => Promise<T>): Promise<T> {
  if (typeof pool?.connect !== 'function') return fn()
  const client = await pool.connect().catch(() => null)
  if (!client) return fn()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key])
    return await fn()
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {})
    client.release()
  }
}

export interface ReversalSync {
  reversedPaise: number
  unrecoveredPaise: number
  lookupError?: string
}

/**
 * Bring a payment's Route reversals up to the proportional target for everything refunded so far:
 * each transfer is reversed to round(amount x refunded / gross). Cumulative and idempotent: re-running
 * (retry job, duplicate webhook, app path + webhook) only reverses the outstanding delta. Serialised
 * per payment with an advisory lock so concurrent callers cannot both reverse the same delta.
 */
export async function syncRouteReversals(txnId: string): Promise<ReversalSync> {
  const pool = await cpPool()
  const read = () =>
    pool
      .query(`SELECT ${TXN_COLS} FROM tenant_transactions WHERE id = $1`, [txnId])
      .then((r: any) => (r.rows?.[0] as TxnRow) ?? null)
      .catch(() => null)
  const first = await read()
  const paymentId = first ? paymentIdOf(first) : null
  if (!first || !paymentId || first.gateway !== 'razorpay_route') return { reversedPaise: 0, unrecoveredPaise: 0 }

  return withPaymentLock(pool, `rzp-reversal:${paymentId}`, async () => {
    const row = (await read()) ?? first
    const gross = toPaise(row.gross_amount)
    const refunded = Math.min(gross, toPaise(row.refunded_amount))
    const out: ReversalSync = { reversedPaise: 0, unrecoveredPaise: 0 }
    if (!(gross > 0) || !(refunded > 0)) return out

    const lookup = await fetchTransfersForPayment(paymentId)
    if (!lookup.ok) {
      const target = Math.round((toPaise(row.tenant_share) * refunded) / gross)
      out.unrecoveredPaise = Math.max(0, target - toPaise(row.reversed_amount))
      out.lookupError = lookup.error
      return out
    }
    let totalReversed = 0
    for (const t of lookup.transfers) {
      if (t.status === 'failed') continue
      const target = Math.round((t.amount * refunded) / gross)
      const delta = Math.min(Math.max(0, target - t.amountReversed), Math.max(0, t.amount - t.amountReversed))
      totalReversed += t.amountReversed
      if (delta <= 0) continue
      try {
        const rev: any = await reverseTransfer(t.id, delta)
        out.reversedPaise += delta
        totalReversed += delta
        await insertLedger(pool, [
          { tenantId: row.tenant_id, type: 'payout', amountInr: toInr(delta), txnId: row.id, note: `Route reversal ${t.id} — order ${row.order_ref ?? ''}`, ref: rev?.id ? String(rev.id) : `rvr:${t.id}:${t.amountReversed + delta}` },
        ])
      } catch (e: any) {
        // Razorpay hard-fails when the linked account has no balance; retry-reversals revisits it.
        out.unrecoveredPaise += delta
        console.error('[route-settlement] reversal failed', t.id, delta, e?.error?.description ?? e?.message)
      }
    }
    await pool
      .query(`UPDATE tenant_transactions SET reversed_amount = $2 WHERE id = $1`, [row.id, toInr(totalReversed)])
      .catch(() => {})
    return out
  })
}

export interface RefundOutcome extends ReversalSync {
  status: 'no_txn' | 'duplicate' | 'recorded'
}

/**
 * Account for one Razorpay refund. Safe to call from every refund path and the refund webhooks:
 * the refund id is recorded on the row, so it counts once however many times it arrives.
 *  - own: refunded_amount/status only (no platform money involved)
 *  - platform, transferred: ledger -refund +commission +fee (proportional) and reversal sync
 *  - platform, not transferred: refunded_amount/status only (no capture ledger was written)
 */
export async function applyRouteRefund(opts: {
  tenantId?: string | null
  paymentId: string
  refundId: string
  refundPaise: number
  orderRef?: string | null
}): Promise<RefundOutcome> {
  const none: RefundOutcome = { status: 'no_txn', reversedPaise: 0, unrecoveredPaise: 0 }
  try {
    if (!opts.paymentId || !opts.refundId || !(opts.refundPaise > 0)) return none
    const pool = await cpPool()
    const row = await findTenantTransaction({ tenantId: opts.tenantId, paymentId: opts.paymentId, orderRef: opts.orderRef })
    if (!row || row.is_cod) return none
    if (!row.payment_id) {
      await pool.query(`UPDATE tenant_transactions SET payment_id = $2 WHERE id = $1 AND payment_id IS NULL`, [row.id, opts.paymentId]).catch(() => {})
    }

    const upd = await pool
      .query(
        `UPDATE tenant_transactions
            SET refunded_amount = LEAST(gross_amount, refunded_amount + $2),
                refund_ids = array_append(refund_ids, $3::text),
                status = CASE WHEN LEAST(gross_amount, refunded_amount + $2) >= gross_amount THEN 'refunded'
                              ELSE 'partially_refunded' END
          WHERE id = $1 AND NOT ($3::text = ANY(refund_ids))
          RETURNING refunded_amount`,
        [row.id, toInr(opts.refundPaise), opts.refundId]
      )
      .catch(() => null)
    const after = upd?.rows?.[0]
    const routed = row.gateway === 'razorpay_route' && !!transferIdOf(row)

    if (after && routed) {
      const gross = toPaise(row.gross_amount)
      const now = Math.min(gross, toPaise(after.refunded_amount))
      const prev = Math.max(0, now - opts.refundPaise)
      const share = (total: number, p: number) => Math.round((total * p) / gross)
      const c = toPaise(row.platform_commission)
      const f = toPaise(row.gateway_fee)
      const ref = row.order_ref ?? ''
      await insertLedger(pool, [
        { tenantId: row.tenant_id, type: 'refund', amountInr: -toInr(opts.refundPaise), txnId: row.id, note: `Refund ${opts.refundId} — order ${ref}`, ref: opts.refundId },
        { tenantId: row.tenant_id, type: 'commission', amountInr: toInr(share(c, now) - share(c, prev)), txnId: row.id, note: `Commission refunded (proportional) — order ${ref}`, ref: opts.refundId },
        { tenantId: row.tenant_id, type: 'gateway_fee', amountInr: toInr(share(f, now) - share(f, prev)), txnId: row.id, note: `Fee on refunded share absorbed by platform — order ${ref}`, ref: opts.refundId },
      ])
    }

    const sync = routed && row.status !== 'failed' ? await syncRouteReversals(row.id) : { reversedPaise: 0, unrecoveredPaise: 0 }
    return { status: after ? 'recorded' : 'duplicate', ...sync }
  } catch (e: any) {
    console.error('[route-settlement] applyRouteRefund failed', opts.paymentId, e?.message)
    return none
  }
}

/**
 * The bank rejected a refund: the money is back in the account, so its booking is undone. The transfer
 * reversal stays — a retried refund books against it without reversing the store's share again.
 * Idempotent: only a refund id still on the row is undone.
 */
export async function applyRouteRefundFailed(opts: {
  tenantId?: string | null
  paymentId: string
  refundId: string
  refundPaise: number
  orderRef?: string | null
}): Promise<boolean> {
  try {
    if (!opts.paymentId || !opts.refundId || !(opts.refundPaise > 0)) return false
    const pool = await cpPool()
    const row = await findTenantTransaction({ tenantId: opts.tenantId, paymentId: opts.paymentId, orderRef: opts.orderRef })
    if (!row || row.is_cod) return false
    const upd = await pool.query(
      `UPDATE tenant_transactions
          SET refunded_amount = GREATEST(0, refunded_amount - $2),
              refund_ids = array_remove(refund_ids, $3::text),
              status = CASE WHEN GREATEST(0, refunded_amount - $2) > 0 THEN 'partially_refunded'
                            WHEN recipient_settlement_id IS NOT NULL THEN 'settled'
                            WHEN transfer_id IS NOT NULL OR gateway_txn_id LIKE 'trf\\_%' THEN 'split'
                            ELSE 'captured' END
        WHERE id = $1 AND $3::text = ANY(refund_ids)
        RETURNING refunded_amount`,
      [row.id, toInr(opts.refundPaise), opts.refundId]
    )
    const after = upd?.rows?.[0]
    if (!after) return false

    if (row.gateway === 'razorpay_route' && transferIdOf(row)) {
      // The reverse of applyRouteRefund's entries for this refund.
      const gross = toPaise(row.gross_amount)
      const now = Math.min(gross, toPaise(after.refunded_amount))
      const before = Math.min(gross, now + opts.refundPaise)
      const share = (total: number, p: number) => Math.round((total * p) / gross)
      const c = toPaise(row.platform_commission)
      const f = toPaise(row.gateway_fee)
      const ref = row.order_ref ?? ''
      const key = `${opts.refundId}:failed`
      await insertLedger(pool, [
        { tenantId: row.tenant_id, type: 'refund', amountInr: toInr(before - now), txnId: row.id, note: `Refund ${opts.refundId} failed — order ${ref}`, ref: key },
        { tenantId: row.tenant_id, type: 'commission', amountInr: -toInr(share(c, before) - share(c, now)), txnId: row.id, note: `Commission refund undone — order ${ref}`, ref: key },
        { tenantId: row.tenant_id, type: 'gateway_fee', amountInr: -toInr(share(f, before) - share(f, now)), txnId: row.id, note: `Fee refund undone — order ${ref}`, ref: key },
      ])
    }
    return true
  } catch (e: any) {
    console.error('[route-settlement] applyRouteRefundFailed failed', opts.paymentId, e?.message)
    return false
  }
}

/** Retry reversals still short of their proportional target (empty linked-account balance). */
export async function retryPendingReversals(limit = 50): Promise<{ retried: number; recoveredPaise: number; stillOwedPaise: number }> {
  const pool = await cpPool()
  const rows = await pool
    .query(
      `SELECT id FROM tenant_transactions
        WHERE gateway = 'razorpay_route' AND is_cod = false AND status <> 'failed' AND refunded_amount > 0
          AND (transfer_id IS NOT NULL OR gateway_txn_id LIKE 'trf\\_%')
          AND reversed_amount + 0.01 < ROUND(tenant_share * LEAST(refunded_amount, gross_amount) / NULLIF(gross_amount, 0), 2)
          AND occurred_at > now() - interval '180 days'
        ORDER BY occurred_at DESC LIMIT $1`,
      [limit]
    )
    .then((r: any) => r.rows ?? [])
    .catch(() => [])
  let recoveredPaise = 0
  let stillOwedPaise = 0
  for (const r of rows) {
    const out = await syncRouteReversals(r.id).catch(() => null)
    if (!out) continue
    recoveredPaise += out.reversedPaise
    stillOwedPaise += out.unrecoveredPaise
  }
  return { retried: rows.length, recoveredPaise, stillOwedPaise }
}

/**
 * Safety net for every transfer/settlement webhook: polls Razorpay for open rows and advances them.
 *  1. split/captured rows with a transfer: live status -> split / settled / failed
 *  2. platform rows captured with no transfer (transfer errored, or Route onboarding finished later):
 *     adopt an existing transfer or create one, once the payment is still fully captured
 */
export async function reconcileSettlements(opts?: {
  tenantId?: string
  olderThanMinutes?: number
  limit?: number
}): Promise<{ scanned: number; split: number; settled: number; failed: number; transferred: number }> {
  const pool = await cpPool()
  const age = Math.max(0, opts?.olderThanMinutes ?? 2)
  const limit = opts?.limit ?? 200
  const res = { scanned: 0, split: 0, settled: 0, failed: 0, transferred: 0 }
  const scopeArgs = opts?.tenantId ? [opts.tenantId] : []
  const scope = opts?.tenantId ? `AND tenant_id = $3` : ''

  const open = await pool
    .query(
      `SELECT ${TXN_COLS} FROM tenant_transactions
        WHERE status IN ('captured', 'split') AND is_cod = false AND gateway = 'razorpay_route'
          AND (transfer_id IS NOT NULL OR gateway_txn_id LIKE 'trf\\_%')
          AND occurred_at < now() - make_interval(mins => $1::int) ${scope}
        ORDER BY occurred_at ASC LIMIT $2`,
      [age, limit, ...scopeArgs]
    )
    .then((r: any) => (r.rows ?? []) as TxnRow[])
    .catch(() => [] as TxnRow[])
  for (const row of open) {
    res.scanned++
    const live = await fetchTransfer(transferIdOf(row)!)
    if (!live) continue
    const out = await applyTransferState(live).catch(() => 'noop' as const)
    if (out === 'split') res.split++
    else if (out === 'settled') res.settled++
    else if (out === 'failed') res.failed++
  }

  // Floor of 5 minutes: never race the inline split that is still running for a fresh capture.
  const untransferred = await pool
    .query(
      `SELECT ${TXN_COLS} FROM tenant_transactions
        WHERE status = 'captured' AND is_cod = false AND gateway = 'razorpay_route'
          AND transfer_id IS NULL AND COALESCE(gateway_txn_id, '') NOT LIKE 'trf\\_%'
          AND COALESCE(payment_id, gateway_txn_id) LIKE 'pay\\_%' AND refunded_amount = 0
          AND occurred_at < now() - make_interval(mins => GREATEST($1::int, 5))
          AND occurred_at > now() - interval '30 days' ${scope}
        ORDER BY occurred_at ASC LIMIT $2`,
      [age, limit, ...scopeArgs]
    )
    .then((r: any) => (r.rows ?? []) as TxnRow[])
    .catch(() => [] as TxnRow[])
  const targets = new Map<string, PayoutTarget | null>()
  for (const row of untransferred) {
    res.scanned++
    if (!targets.has(row.tenant_id)) targets.set(row.tenant_id, await resolvePayoutTarget(row.tenant_id))
    const target = targets.get(row.tenant_id)
    if (!target?.active || !target.linkedAccountId) continue
    const payment = await Promise.resolve()
      .then(() => (getRazorpayInstance().payments as any).fetch(paymentIdOf(row)))
      .catch(() => null)
    if (!payment || payment.status !== 'captured' || Number(payment.amount_refunded) > 0) continue
    const ok = await transferForTxn(pool, row, { linkedAccountId: target.linkedAccountId, dailyPayout: target.dailyPayout })
    if (ok) res.transferred++
  }

  // Payouts whose bank date and UTR were never read (webhook missed, or rows settled before this existed).
  const unread = await pool
    .query(
      `SELECT DISTINCT t.recipient_settlement_id AS id, t.tenant_id FROM tenant_transactions t
        WHERE t.recipient_settlement_id IS NOT NULL AND t.settled_at > now() - interval '60 days' ${scope.replace('tenant_id', 't.tenant_id').replace('$3', '$1')}
          AND NOT EXISTS (SELECT 1 FROM linked_account_settlements s WHERE s.id = t.recipient_settlement_id)
        LIMIT 20`,
      opts?.tenantId ? [opts.tenantId] : []
    )
    .then((r: any) => (r.rows ?? []) as { id: string; tenant_id: string }[])
    .catch(() => [])
  for (const u of unread) await recordLinkedSettlement({ settlementId: u.id, tenantId: u.tenant_id })
  return res
}

/** For a Route store's order page: where each payment's share stands, and its payout to the bank. */
export async function routePayoutsFor(tenantId: string, paymentIds: string[]) {
  if (!paymentIds.length) return []
  const pool = await cpPool()
  const r = await pool
    .query(
      `SELECT t.payment_id, t.status, t.tenant_share, t.transferred_at, s.settled_at AS payout_at, s.utr AS payout_utr
         FROM tenant_transactions t LEFT JOIN linked_account_settlements s ON s.id = t.recipient_settlement_id
        WHERE t.tenant_id = $1 AND t.payment_id = ANY($2)`,
      [tenantId, paymentIds]
    )
    .catch(() => null)
  return (r?.rows ?? []) as {
    payment_id: string
    status: string
    tenant_share: string
    transferred_at: string | null
    payout_at: string | null
    payout_utr: string | null
  }[]
}

/**
 * A Route store's payout from its linked account to its bank: amount, fees, UTR and when. From the
 * linked account's settlement.processed entity when we have it, else read through a transfer it paid.
 */
export async function recordLinkedSettlement(opts: {
  settlementId?: string
  settlement?: any
  tenantId?: string | null
  linkedAccountId?: string | null
}): Promise<boolean> {
  try {
    const pool = await cpPool()
    let s = opts.settlement
    let linked = opts.linkedAccountId ?? null
    let transferId: string | null = null
    if (!s) {
      const known = await pool.query(`SELECT 1 FROM linked_account_settlements WHERE id = $1 AND utr IS NOT NULL`, [opts.settlementId])
      if (known.rows?.length) return true
      const found = await fetchLinkedSettlement(String(opts.settlementId))
      if (!found) return false
      s = found.settlement
      linked = linked ?? found.linkedAccountId
      transferId = found.transferId
    }
    if (!s?.id) return false
    let tenantId = opts.tenantId ?? null
    if (!tenantId) {
      const r = await pool.query(
        `SELECT tenant_id FROM tenant_transactions WHERE recipient_settlement_id = $1 OR transfer_id = $2
         UNION ALL SELECT id FROM tenants WHERE razorpay_linked_account_id = $3
         UNION ALL SELECT ot.tenant_id FROM tenant_bank_accounts b JOIN owner_tenants ot ON ot.owner_id = b.owner_id WHERE b.linked_account_id = $3
         LIMIT 1`,
        [s.id, transferId, linked]
      )
      tenantId = r.rows?.[0]?.tenant_id ?? null
    }
    if (!tenantId) return false
    await pool.query(
      `INSERT INTO linked_account_settlements (id, tenant_id, linked_account_id, amount, fees, tax, utr, status, settled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET utr = COALESCE(EXCLUDED.utr, linked_account_settlements.utr), status = EXCLUDED.status,
         amount = EXCLUDED.amount, fees = EXCLUDED.fees, tax = EXCLUDED.tax,
         settled_at = COALESCE(EXCLUDED.settled_at, linked_account_settlements.settled_at), fetched_at = now()`,
      [
        s.id,
        tenantId,
        linked ?? '',
        toInr(Number(s.amount) || 0),
        toInr(Number(s.fees) || 0),
        toInr(Number(s.tax) || 0),
        s.utr || null,
        s.status || null,
        Number(s.created_at) > 0 ? new Date(Number(s.created_at) * 1000).toISOString() : null,
      ]
    )
    return true
  } catch {
    return false
  }
}

/**
 * Record a COD order once Delhivery's remittance reaches the platform. The platform holds the cash
 * (unless the tenant ships on its own Delhivery account, which remits to the tenant directly), so the
 * ledger credits the gross and debits commission (platform mode only) and any shipping not already
 * charged to the wallet. Idempotent per order.
 */
export async function recordCodSettlement(opts: {
  tenantId: string
  tenantSlug: string
  orderRef: string
  grossAmountInr: number
  actualDelhiveryChargeInr: number
  dailyPayout?: boolean
  /** True when the wallet already debited this AWB — do not deduct shipping a second time. */
  walletBilled?: boolean
  collectedOn?: CollectedOn
  /** The tenant's own Delhivery account collected the cash and billed shipping directly. */
  ownDelhivery?: boolean
}): Promise<void> {
  try {
    const pool = await cpPool()
    const grossPaise = toPaise(opts.grossAmountInr)
    const rate = opts.collectedOn === 'own' ? 0 : commissionPct(opts.dailyPayout)
    const commissionPaise = Math.round(grossPaise * rate)
    const delhiveryPaise = opts.walletBilled || opts.ownDelhivery ? 0 : toPaise(opts.actualDelhiveryChargeInr)
    const sharePaise = Math.max(0, grossPaise - commissionPaise - delhiveryPaise)

    const ins = await pool.query(
      `INSERT INTO tenant_transactions
         (tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, gateway, is_cod, status, settled_at, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'cod_remittance', true, 'settled', now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [opts.tenantId, opts.orderRef, opts.grossAmountInr, toInr(sharePaise), toInr(commissionPaise)]
    )
    const txnId = ins.rows?.[0]?.id ?? null
    const ref = `cod:${opts.orderRef}`
    await insertLedger(pool, [
      ...(opts.ownDelhivery
        ? []
        : [{ tenantId: opts.tenantId, type: 'cod_remittance', amountInr: opts.grossAmountInr, txnId, note: `COD collected — order ${opts.orderRef}`, ref }]),
      { tenantId: opts.tenantId, type: 'commission', amountInr: -toInr(commissionPaise), txnId, note: `Platform commission (${(rate * 100).toFixed(1)}%) — order ${opts.orderRef}`, ref },
      { tenantId: opts.tenantId, type: 'delhivery_correction', amountInr: -toInr(delhiveryPaise), txnId, note: `Delhivery charge (actual) — order ${opts.orderRef}`, ref },
    ])
  } catch (e: any) {
    console.error('[route-settlement] recordCodSettlement failed', opts.orderRef, e?.message)
  }
}

/** @deprecated name kept for the admin reconcile button and older callers. */
export const reconcileCapturedTransactions = reconcileSettlements
