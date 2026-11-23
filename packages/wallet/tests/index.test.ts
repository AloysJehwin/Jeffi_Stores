import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @jeffi/tenancy's controlPlanePool. A fake client routes each SQL by a
// substring match to a programmable handler, so tests assert exact balances.
// ---------------------------------------------------------------------------

type QResult = { rows: any[]; rowCount: number }
type Handler = (sql: string, params: any[]) => QResult

// Per-test routing table: ordered [needle, handler]. First substring hit wins.
let routes: Array<[string, Handler]> = []
// Every (sql, params) seen by a client, for assertions.
const seen: Array<{ sql: string; params: any[] }> = []

function runQuery(sql: string, params: any[] = []): QResult {
  seen.push({ sql, params })
  const txWords = ['BEGIN', 'COMMIT', 'ROLLBACK']
  if (txWords.some(w => sql.trim().startsWith(w))) return { rows: [], rowCount: 0 }
  for (const [needle, h] of routes) if (sql.includes(needle)) return h(sql, params)
  throw new Error(`unrouted SQL: ${sql}`)
}

function makeClient() {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => runQuery(sql, params ?? [])),
    release: vi.fn(),
  }
}

let client = makeClient()
const connect = vi.fn(async () => client)
const poolQuery = vi.fn(async (sql: string, params?: any[]) => runQuery(sql, params ?? []))
const pool = { connect, query: poolQuery }

vi.mock('@jeffi/tenancy', () => ({
  controlPlanePool: () => pool,
}))

import {
  getBalance,
  spendSince,
  debit,
  debitIn,
  trueUp,
  trueUpIn,
  recharge,
  walletTx,
  controlPlanePool,
} from '../src/index'

const FLAGSHIP = '00000000-0000-0000-0000-000000000000'
const T = 'tenant-1'

function row(...rows: any[]): QResult {
  return { rows, rowCount: rows.length }
}

beforeEach(() => {
  routes = []
  seen.length = 0
  client = makeClient()
  connect.mockClear()
  poolQuery.mockClear()
  connect.mockResolvedValue(client)
})

// lock() does an INSERT ... ON CONFLICT then a SELECT ... FOR UPDATE.
// Helper to set the balance/floor returned by that SELECT.
function setWallet(balance: number, floor = 0) {
  routes.push(['INSERT INTO tenant_wallets', () => row()])
  routes.push(['SELECT balance, min_balance FROM tenant_wallets', () => row({ balance, min_balance: floor })])
}
// move() UPDATE ... RETURNING balance. Returns the given post-move balance.
function setMove(newBalance: number) {
  routes.push(['UPDATE tenant_wallets SET balance', () => row({ balance: newBalance })])
}

describe('re-export', () => {
  it('re-exports controlPlanePool', () => {
    expect(controlPlanePool()).toBe(pool)
  })
})

describe('getBalance', () => {
  it('returns the stored balance', async () => {
    routes.push(['SELECT balance FROM tenant_wallets', () => row({ balance: '42.5' })])
    expect(await getBalance(T)).toBe(42.5)
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })
  it('defaults to 0 when no wallet row exists', async () => {
    routes.push(['SELECT balance FROM tenant_wallets', () => row()])
    expect(await getBalance(T)).toBe(0)
  })
})

describe('spendSince', () => {
  it('returns the summed debit magnitude', async () => {
    const since = new Date('2026-01-01T00:00:00Z')
    routes.push(['FROM wallet_ledger', (_s, p) => {
      expect(p[0]).toBe(T)
      expect(p[1]).toBe(since)
      return row({ s: '13.37' })
    }])
    expect(await spendSince(T, since)).toBe(13.37)
  })
  it('defaults to 0 when the sum is null/absent', async () => {
    routes.push(['FROM wallet_ledger', () => row({ s: null })])
    expect(await spendSince(T, new Date())).toBe(0)
  })
})

describe('walletTx', () => {
  it('wraps the callback in BEGIN/COMMIT and releases', async () => {
    routes.push(['SELECT 1', () => row()])
    const out = await walletTx(async c => {
      await c.query('SELECT 1')
      return 'done'
    })
    expect(out).toBe('done')
    const kinds = seen.map(s => s.sql.trim())
    expect(kinds[0]).toBe('BEGIN')
    expect(kinds).toContain('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
  it('ROLLBACKs and rethrows on error, still releasing', async () => {
    const boom = new Error('boom')
    await expect(walletTx(async () => { throw boom })).rejects.toBe(boom)
    const kinds = seen.map(s => s.sql.trim())
    expect(kinds).toContain('ROLLBACK')
    expect(kinds).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe('debit (standalone)', () => {
  it('no-ops for the flagship tenant without touching the pool', async () => {
    const r = await debit({ tenantId: FLAGSHIP, amountInr: 10, category: 'sms', externalRef: 'x', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 0 })
    expect(connect).not.toHaveBeenCalled()
    expect(poolQuery).not.toHaveBeenCalled()
  })
  it('returns current balance uncharged when amount rounds to zero', async () => {
    routes.push(['SELECT balance FROM tenant_wallets', () => row({ balance: 100 })])
    const r = await debit({ tenantId: T, amountInr: 0.004, category: 'sms', externalRef: 'x', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 100 })
    expect(connect).not.toHaveBeenCalled() // no tx opened
  })
  it('returns current balance uncharged for a negative amount', async () => {
    routes.push(['SELECT balance FROM tenant_wallets', () => row({ balance: 55 })])
    const r = await debit({ tenantId: T, amountInr: -5, category: 'sms', externalRef: 'x', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 55 })
  })
  it('opens a tx and charges a positive amount', async () => {
    setWallet(100, 0)
    routes.push(['SELECT 1 FROM wallet_ledger', () => row()]) // no dup
    routes.push(['INSERT INTO wallet_ledger', () => row()])
    setMove(90)
    const r = await debit({ tenantId: T, amountInr: 10, category: 'sms', externalRef: 'ref-1', note: 'n' })
    expect(r).toEqual({ ok: true, charged: true, balance: 90 })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(seen.map(s => s.sql.trim())).toContain('COMMIT')
  })
})

describe('debitIn', () => {
  it('throws for the flagship tenant', async () => {
    await expect(debitIn(client as any, { tenantId: FLAGSHIP, amountInr: 10, category: 'sms', externalRef: 'x', note: 'n' }))
      .rejects.toThrow('positive amount from a paying tenant')
  })
  it('throws for a non-positive amount', async () => {
    await expect(debitIn(client as any, { tenantId: T, amountInr: 0, category: 'sms', externalRef: 'x', note: 'n' }))
      .rejects.toThrow('positive amount from a paying tenant')
  })
  it('skips (charged:false) when the externalRef already has a ledger row', async () => {
    setWallet(100, 0)
    routes.push(['SELECT 1 FROM wallet_ledger', () => row({ exists: 1 })]) // dup
    const r = await debitIn(client as any, { tenantId: T, amountInr: 10, category: 'sms', externalRef: 'dup', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 100 })
  })
  it('rejects with insufficient_balance and computes needed when below floor', async () => {
    setWallet(5, 0) // balance 5, floor 0, amount 10 -> 5-10 < 0
    routes.push(['SELECT 1 FROM wallet_ledger', () => row()])
    const r = await debitIn(client as any, { tenantId: T, amountInr: 10, category: 'sms', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: false, error: 'insufficient_balance', balance: 5, needed: 5 })
  })
  it('honours a non-zero floor when checking sufficiency', async () => {
    setWallet(20, 15) // 20-10=10 < floor 15 -> insufficient, needed = 10+15-20 = 5
    routes.push(['SELECT 1 FROM wallet_ledger', () => row()])
    const r = await debitIn(client as any, { tenantId: T, amountInr: 10, category: 'sms', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: false, error: 'insufficient_balance', balance: 20, needed: 5 })
  })
  it('charges and inserts the negated rounded amount on success', async () => {
    setWallet(100, 0)
    routes.push(['SELECT 1 FROM wallet_ledger', () => row()])
    let inserted: any[] | null = null
    routes.push(['INSERT INTO wallet_ledger', (_s, p) => { inserted = p; return row() }])
    setMove(89.5)
    const r = await debitIn(client as any, { tenantId: T, amountInr: 10.504, category: 'whatsapp', externalRef: 'r', note: 'hi' })
    expect(r).toEqual({ ok: true, charged: true, balance: 89.5 })
    // round2(10.504) = 10.5, inserted negated: [tenant, category, -10.5, ref, note]
    expect(inserted).toEqual([T, 'whatsapp', -10.5, 'r', 'hi'])
  })
})

describe('trueUp (standalone)', () => {
  it('no-ops for the flagship without opening a tx', async () => {
    await trueUp({ tenantId: FLAGSHIP, amountInr: 10, externalRef: 'x', note: 'n' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('delegates into a tx for a paying tenant', async () => {
    setWallet(100, 0)
    routes.push(['SELECT amount FROM wallet_ledger', () => row()]) // no existing debit -> early return
    await trueUp({ tenantId: T, amountInr: 10, externalRef: 'x', note: 'n' })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(seen.map(s => s.sql.trim())).toContain('COMMIT')
  })
})

describe('trueUpIn', () => {
  it('no-ops for the flagship', async () => {
    await trueUpIn(client as any, { tenantId: FLAGSHIP, amountInr: 10, externalRef: 'x' })
    expect(client.query).not.toHaveBeenCalled()
  })
  it('returns early when no ledger row matches the externalRef', async () => {
    setWallet(100, 0)
    routes.push(['SELECT amount FROM wallet_ledger', () => row()])
    await trueUpIn(client as any, { tenantId: T, amountInr: 10, externalRef: 'none' })
    // no UPDATE wallet_ledger issued
    expect(seen.some(s => s.sql.includes('UPDATE wallet_ledger'))).toBe(false)
  })
  it('returns early when the delta is zero', async () => {
    setWallet(100, 0)
    // existing amount -10 (abs 10), new amount 10 -> delta 0
    routes.push(['SELECT amount FROM wallet_ledger', () => row({ amount: -10 })])
    await trueUpIn(client as any, { tenantId: T, amountInr: 10, externalRef: 'r' })
    expect(seen.some(s => s.sql.includes('UPDATE wallet_ledger'))).toBe(false)
  })
  it('updates the ledger and moves the balance by the delta (true-up higher)', async () => {
    setWallet(100, 0)
    routes.push(['SELECT amount FROM wallet_ledger', () => row({ amount: -10 })]) // charged 10
    let upd: any[] | null = null
    routes.push(['UPDATE wallet_ledger SET amount', (_s, p) => { upd = p; return row() }])
    let moveParams: any[] | null = null
    routes.push(['UPDATE tenant_wallets SET balance', (_s, p) => { moveParams = p; return row({ balance: 88 }) }])
    await trueUpIn(client as any, { tenantId: T, amountInr: 12, externalRef: 'r', note: 'fix' })
    // new amount stored negated: -12; note passed through
    expect(upd).toEqual([T, 'r', -12, 'fix'])
    // delta = round2(12 - 10) = 2 ; move by -delta = -2
    expect(moveParams).toEqual([T, -2])
  })
  it('passes null note so the ledger keeps its own (true-up lower)', async () => {
    setWallet(100, 0)
    routes.push(['SELECT amount FROM wallet_ledger', () => row({ amount: -10 })])
    let upd: any[] | null = null
    routes.push(['UPDATE wallet_ledger SET amount', (_s, p) => { upd = p; return row() }])
    let moveParams: any[] | null = null
    routes.push(['UPDATE tenant_wallets SET balance', (_s, p) => { moveParams = p; return row({ balance: 103 }) }])
    await trueUpIn(client as any, { tenantId: T, amountInr: 7, externalRef: 'r' })
    expect(upd).toEqual([T, 'r', -7, null])
    // delta = round2(7 - 10) = -3 ; move by -delta = +3 (refund)
    expect(moveParams).toEqual([T, 3])
  })
})

describe('recharge', () => {
  it('throws for a non-positive amount', async () => {
    await expect(recharge({ tenantId: T, amountInr: 0, externalRef: 'x' })).rejects.toThrow('amount must be positive')
    expect(connect).not.toHaveBeenCalled()
  })
  it('credits a fresh recharge and returns the new balance', async () => {
    setWallet(50, 0)
    let ins: any[] | null = null
    routes.push(['INSERT INTO wallet_ledger', (_s, p) => { ins = p; return row({ id: 1 }) }])
    setMove(150)
    const r = await recharge({ tenantId: T, amountInr: 100, externalRef: 'topup-1', note: 'card' })
    expect(r).toEqual({ balance: 150, alreadyCredited: false })
    expect(ins).toEqual([T, 100, 'topup-1', 'card'])
  })
  it('defaults the note when none is given', async () => {
    setWallet(50, 0)
    let ins: any[] | null = null
    routes.push(['INSERT INTO wallet_ledger', (_s, p) => { ins = p; return row({ id: 1 }) }])
    setMove(60)
    await recharge({ tenantId: T, amountInr: 10, externalRef: 'topup-2' })
    expect(ins![3]).toBe('Wallet recharge')
  })
  it('is idempotent: on conflict returns the existing balance uncredited', async () => {
    setWallet(75, 0)
    routes.push(['INSERT INTO wallet_ledger', () => row()]) // rowCount 0 => conflict
    const r = await recharge({ tenantId: T, amountInr: 100, externalRef: 'dup', note: 'x' })
    expect(r).toEqual({ balance: 75, alreadyCredited: true })
    expect(seen.some(s => s.sql.includes('UPDATE tenant_wallets SET balance'))).toBe(false)
  })
  it('rounds the amount before crediting', async () => {
    setWallet(0, 0)
    let ins: any[] | null = null
    routes.push(['INSERT INTO wallet_ledger', (_s, p) => { ins = p; return row({ id: 1 }) }])
    setMove(9.99)
    await recharge({ tenantId: T, amountInr: 9.994, externalRef: 'r' })
    expect(ins![1]).toBe(9.99)
  })
})
