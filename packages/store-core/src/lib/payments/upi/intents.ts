import { randomUUID } from 'crypto'
import { query } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'

/**
 * upi_payment_intents (database/payments.sql): one UPI payment attempt and what it pays for. Lives in
 * the collecting merchant's DB: a store's for its orders, the flagship DB for everything paid to the
 * platform (flagship orders, wallet top-ups), so one queue serves the platform's UPI ID.
 */

/** Where an intent lives. storeDb is the request's store (or the flagship); platformDb is always the flagship DB. */
export interface UpiDb {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  platform?: boolean
}
export const storeDb: UpiDb = { query: (t, p) => query(t, p) }
export const platformDb: UpiDb = { query: (t, p) => controlPlanePool().query(t, p), platform: true }
const one = async (db: UpiDb, t: string, p?: any[]) => (await db.query(t, p)).rows[0] ?? null
const many = async (db: UpiDb, t: string, p?: any[]) => (await db.query(t, p)).rows

export type UpiPurpose = 'order_draft' | 'order' | 'order_adjustment' | 'variant_change' | 'wallet_topup' | 'ecom_wallet_topup'
export const UPI_PURPOSES: UpiPurpose[] = ['order_draft', 'order', 'order_adjustment', 'variant_change', 'wallet_topup', 'ecom_wallet_topup']
export type UpiProvider = 'phonepe' | 'upg'
/** PhonePe: pending → completed | failed | expired. UPG: queued → active → processing → completed, see upg.ts. */
export type UpiIntentStatus = 'pending' | 'queued' | 'active' | 'processing' | 'awaiting_confirmation' | 'completed' | 'failed' | 'expired' | 'cancelled' | 'rejected'
export const UPI_INTENT_STATUSES: UpiIntentStatus[] = ['pending', 'queued', 'active', 'processing', 'awaiting_confirmation', 'completed', 'failed', 'expired', 'cancelled', 'rejected']
export const WALLET_PURPOSES: UpiPurpose[] = ['wallet_topup', 'ecom_wallet_topup']

export interface UpiRefs {
  draftToken?: string
  orderId?: string
  adjustmentId?: string
  requestId?: string
  userId?: string
  adminId?: string
  ownerId?: string
  /** UPG: who the payer sees and the reference in the UPI note. */
  payeeName?: string
  reference?: string
  notes?: Record<string, unknown> | null
}

export interface UpiResult {
  orderId?: string
  orderNumber?: string
  balance?: number
  settlement?: string
  needsAction?: string
}

export interface UpiIntent {
  id: string
  tenant_id: string | null
  provider: UpiProvider
  purpose: UpiPurpose
  amount_paise: number
  currency: string
  merchant_order_id: string
  provider_order_id: string | null
  provider_txn_id: string | null
  utr: string | null
  payer_vpa: string | null
  status: UpiIntentStatus
  redirect_url: string | null
  return_to: string | null
  refs: UpiRefs
  result: UpiResult | null
  error_code: string | null
  expires_at: string | null
  confirmed_at: string | null
  decided_by: string | null
  decided_at: string | null
  receiving_vpa: string | null
  active_at: string | null
  pay_expires_at: string | null
  processing_at: string | null
  verify_expires_at: string | null
  observation_id: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export const merchantOrderIdFor = (id: string) => `JS${id.replace(/-/g, '')}`
export const isMerchantOrderId = (v: string) => /^JS[0-9a-f]{32}$/i.test(v)

export const INTENT_COLS = `id, tenant_id, provider, purpose, amount_paise::bigint AS amount_paise, currency, merchant_order_id, provider_order_id,
  provider_txn_id, utr, payer_vpa, status, redirect_url, return_to, refs, result, error_code, expires_at, confirmed_at, decided_by,
  decided_at, receiving_vpa, active_at, pay_expires_at, processing_at, verify_expires_at, observation_id, cancelled_at, created_at, updated_at`
const COLS = INTENT_COLS

export const normIntent = (r: any): UpiIntent | null =>
  r ? { ...r, amount_paise: Number(r.amount_paise), refs: r.refs ?? {}, result: r.result ?? null } : null

export async function createUpiIntent(input: {
  tenantId: string | null
  provider: UpiProvider
  purpose: UpiPurpose
  amountPaise: number
  refs: UpiRefs
  returnTo: string | null
  expiresAt?: Date | null
  /** UPG: the UPI ID it is paid on; the intent starts queued. */
  receivingVpa?: string | null
}, db: UpiDb = storeDb): Promise<UpiIntent> {
  const id = randomUUID()
  const row = await one(db,
    `INSERT INTO upi_payment_intents (id, tenant_id, provider, purpose, amount_paise, merchant_order_id, refs, return_to, expires_at, receiving_vpa, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLS}`,
    [id, input.tenantId, input.provider, input.purpose, Math.round(input.amountPaise), merchantOrderIdFor(id), JSON.stringify(input.refs ?? {}), input.returnTo, input.expiresAt ?? null,
      input.receivingVpa ?? null, input.provider === 'upg' ? 'queued' : 'pending']
  )
  return normIntent(row)!
}

export async function getUpiIntent(id: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return normIntent(await one(db, `SELECT ${COLS} FROM upi_payment_intents WHERE id = $1`, [id]))
}

export async function getUpiIntentByMerchantOrderId(merchantOrderId: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return normIntent(await one(db, `SELECT ${COLS} FROM upi_payment_intents WHERE merchant_order_id = $1`, [merchantOrderId]))
}

/** By intent id or merchant order id. */
export function findUpiIntent(idOrMerchantOrderId: string, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  return isMerchantOrderId(idOrMerchantOrderId) ? getUpiIntentByMerchantOrderId(idOrMerchantOrderId, db) : getUpiIntent(idOrMerchantOrderId, db)
}

export interface IntentPatch {
  provider_order_id?: string | null
  provider_txn_id?: string | null
  utr?: string | null
  payer_vpa?: string | null
  redirect_url?: string | null
  refs?: UpiRefs
  result?: UpiResult | null
  error_code?: string | null
  expires_at?: Date | string | null
  confirmed_at?: Date | null
  decided_by?: string | null
  decided_at?: Date | null
  observation_id?: string | null
  processing_at?: Date | null
  verify_expires_at?: Date | null
  cancelled_at?: Date | null
}

const JSON_COLS = new Set(['refs', 'result'])

function setClause(patch: IntentPatch, from = 2): { sql: string; args: any[] } {
  const parts: string[] = []
  const args: any[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    args.push(JSON_COLS.has(k) ? JSON.stringify(v) : v)
    parts.push(`${k} = $${from + args.length - 1}${JSON_COLS.has(k) ? '::jsonb' : ''}`)
  }
  parts.push('updated_at = NOW()')
  return { sql: parts.join(', '), args }
}

/** Moves an intent to `to` only from one of `from` (idempotent claim); null when another caller won. */
export async function claimIntentStatus(id: string, from: UpiIntentStatus[], to: UpiIntentStatus, patch: IntentPatch = {}, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  const set = setClause({ ...patch }, 3)
  return normIntent(
    await one(db,
      `UPDATE upi_payment_intents SET status = $2, ${set.sql} WHERE id = $1 AND status = ANY($${3 + set.args.length}::text[]) RETURNING ${COLS}`,
      [id, to, ...set.args, from]
    )
  )
}

export async function updateUpiIntent(id: string, patch: IntentPatch, db: UpiDb = storeDb): Promise<UpiIntent | null> {
  const set = setClause(patch, 2)
  return normIntent(await one(db, `UPDATE upi_payment_intents SET ${set.sql} WHERE id = $1 RETURNING ${COLS}`, [id, ...set.args]))
}

export async function listUpiIntents(opts: { status?: UpiIntentStatus | null; limit?: number; offset?: number } = {}): Promise<{ items: UpiIntent[]; total: number }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  const where = opts.status ? `WHERE status = $3` : ''
  const args: any[] = [limit, offset, ...(opts.status ? [opts.status] : [])]
  const [rows, count] = await Promise.all([
    many(storeDb, `SELECT ${COLS} FROM upi_payment_intents ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, args),
    one(storeDb, `SELECT count(*)::text AS n FROM upi_payment_intents ${where.replace('$3', '$1')}`, opts.status ? [opts.status] : []),
  ])
  return { items: rows.map((r: any) => normIntent(r)!), total: Number(count?.n ?? 0) }
}

/** Pending PhonePe intents old enough for the browser to have given up on, young enough to still matter. */
export async function pendingPhonePeIntents(opts: { minAgeSec: number; maxAgeSec: number; limit?: number }): Promise<UpiIntent[]> {
  const rows = await many(storeDb,
    `SELECT ${COLS} FROM upi_payment_intents
      WHERE provider = 'phonepe' AND status = 'pending'
        AND created_at < NOW() - make_interval(secs => $1::int) AND created_at > NOW() - make_interval(secs => $2::int)
      ORDER BY created_at ASC LIMIT $3`,
    [opts.minAgeSec, opts.maxAgeSec, opts.limit ?? 200]
  )
  return rows.map((r: any) => normIntent(r)!)
}

/** Pending PhonePe intents past the sweep window are given up on. */
export async function expireStalePhonePeIntents(olderThanSec: number): Promise<number> {
  const r = await storeDb.query(
    `UPDATE upi_payment_intents SET status = 'expired', updated_at = NOW()
      WHERE provider = 'phonepe' AND status = 'pending' AND created_at < NOW() - make_interval(secs => $1::int)`,
    [olderThanSec]
  )
  return r.rowCount ?? 0
}
