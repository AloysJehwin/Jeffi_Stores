import type pg from 'pg'
import { mainPool } from '@jeffi/tenancy'

// Standalone control-plane wallet client for the services. Same tables + idempotency rules as
// src/lib/payments/wallet.ts in the monolith (external_ref unique per tenant).
export type WalletCategory = 'sms' | 'whatsapp' | 'email' | 'document' | 'campaign' | 'ai' | 'recharge' | 'adjustment'
const FLAGSHIP_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const round2 = (n: number) => Math.round(n * 100) / 100

let pool: pg.Pool | undefined
export function controlPlanePool(): pg.Pool {
  if (pool) return pool
  const url = process.env.CONTROL_PLANE_DATABASE_URL
  if (!url) throw new Error('CONTROL_PLANE_DATABASE_URL is not set')
  pool = mainPool(url, 5)
  return pool
}

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await controlPlanePool().connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

async function lock(c: pg.PoolClient, tenantId: string) {
  await c.query(`INSERT INTO tenant_wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId])
  const r = await c.query(`SELECT balance, min_balance FROM tenant_wallets WHERE tenant_id = $1 FOR UPDATE`, [tenantId])
  return { balance: Number(r.rows[0]?.balance ?? 0), floor: Number(r.rows[0]?.min_balance ?? 0) }
}
async function move(c: pg.PoolClient, tenantId: string, delta: number) {
  const r = await c.query(`UPDATE tenant_wallets SET balance = balance + $2, updated_at = now() WHERE tenant_id = $1 RETURNING balance`, [tenantId, delta])
  return Number(r.rows[0]?.balance ?? 0)
}

export async function getBalance(tenantId: string): Promise<number> {
  const r = await controlPlanePool().query(`SELECT balance FROM tenant_wallets WHERE tenant_id = $1`, [tenantId])
  return Number(r.rows[0]?.balance ?? 0)
}

export async function spendSince(tenantId: string, since: Date): Promise<number> {
  const r = await controlPlanePool().query(
    `SELECT COALESCE(-SUM(amount),0) AS s FROM wallet_ledger WHERE tenant_id=$1 AND entry_type='debit' AND occurred_at >= $2`,
    [tenantId, since]
  )
  return Number(r.rows[0]?.s ?? 0)
}

/** Debit once per externalRef. Returns ok:false (nothing written) when the balance can't cover it. */
export async function debit(opts: { tenantId: string; amountInr: number; category: WalletCategory; externalRef: string; note: string }) {
  if (opts.tenantId === FLAGSHIP_TENANT_ID) return { ok: true as const, charged: false, balance: 0 }
  const amount = round2(opts.amountInr)
  if (!(amount > 0)) return { ok: true as const, charged: false, balance: await getBalance(opts.tenantId) }
  return tx(async c => {
    const { balance, floor } = await lock(c, opts.tenantId)
    const dup = await c.query(`SELECT 1 FROM wallet_ledger WHERE tenant_id=$1 AND external_ref=$2 LIMIT 1`, [opts.tenantId, opts.externalRef])
    if (dup.rowCount) return { ok: true as const, charged: false, balance }
    if (balance - amount < floor) return { ok: false as const, error: 'insufficient_balance', balance, needed: round2(amount + floor - balance) }
    await c.query(`INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note) VALUES ($1,'debit',$2,$3,$4,$5)`,
      [opts.tenantId, opts.category, -amount, opts.externalRef, opts.note])
    return { ok: true as const, charged: true, balance: await move(c, opts.tenantId, -amount) }
  })
}

/** Adjust an existing debit to the provider's exact price (never blocks; delta may be ±). */
export async function trueUp(opts: { tenantId: string; amountInr: number; externalRef: string; note: string }) {
  if (opts.tenantId === FLAGSHIP_TENANT_ID) return
  const amount = round2(opts.amountInr)
  await tx(async c => {
    await lock(c, opts.tenantId)
    const r = await c.query(`SELECT amount FROM wallet_ledger WHERE tenant_id=$1 AND external_ref=$2 LIMIT 1`, [opts.tenantId, opts.externalRef])
    if (!r.rowCount) return
    const delta = round2(amount - Math.abs(Number(r.rows[0].amount)))
    if (delta === 0) return
    await c.query(`UPDATE wallet_ledger SET amount=$3, note=$4 WHERE tenant_id=$1 AND external_ref=$2`, [opts.tenantId, opts.externalRef, -amount, opts.note])
    await move(c, opts.tenantId, -delta)
  })
}

export async function recharge(opts: { tenantId: string; amountInr: number; externalRef: string; note?: string }) {
  const amount = round2(opts.amountInr)
  if (!(amount > 0)) throw new Error('amount must be positive')
  return tx(async c => {
    const { balance } = await lock(c, opts.tenantId)
    const ins = await c.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note) VALUES ($1,'recharge','recharge',$2,$3,$4)
       ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
      [opts.tenantId, amount, opts.externalRef, opts.note ?? 'Wallet recharge']
    )
    if (!ins.rowCount) return { balance, alreadyCredited: true }
    return { balance: await move(c, opts.tenantId, amount), alreadyCredited: false }
  })
}
