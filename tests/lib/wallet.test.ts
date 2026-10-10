import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client) }

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))

import { rechargeWallet, correctWalletDebitForAwb } from '@/lib/payments/wallet'

beforeEach(() => {
  vi.clearAllMocks()
  pool.connect.mockResolvedValue(client)
  client.query.mockResolvedValue({ rows: [], rowCount: 1 })
})

describe('rechargeWallet — top-up idempotency', () => {
  it('credits once and returns the new balance', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // lockWallet: ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '0', min_balance: '0' }] }) // lockWallet: SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // ledger insert (won)
      .mockResolvedValueOnce({ rows: [{ balance: '500.00' }] }) // moveBalance
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const res = await rechargeWallet({ tenantId: 't1', amountInr: 500, externalRef: 'pay_1' })
    expect(res).toEqual({ ok: true, balance: 500 })
  })

  it('does NOT move the balance when the reference was already credited', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // lockWallet: ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '500', min_balance: '0' }] }) // lockWallet: SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ledger insert -> CONFLICT
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const res = await rechargeWallet({ tenantId: 't1', amountInr: 500, externalRef: 'pay_1' })
    expect(res).toEqual({ ok: true, balance: 500, alreadyCredited: true })
    // The balance must never be incremented on the losing side of the race.
    const updates = client.query.mock.calls.filter(c => /UPDATE tenant_wallets SET balance/.test(c[0]))
    expect(updates).toHaveLength(0)
  })

  it('rejects a non-positive amount', async () => {
    expect(await rechargeWallet({ tenantId: 't1', amountInr: 0 })).toEqual({
      ok: false,
      error: 'Recharge amount must be positive.',
    })
  })
})

describe('correctWalletDebitForAwb — post-pickup reprice', () => {
  // Sequence: BEGIN, lockWallet ensure+SELECT, awbNet SELECT, adjustment insert, moveBalance, COMMIT.
  // awbNet reads SUM(amount) AS net and COUNT(*) AS n — n>0 means the AWB already has a debit row,
  // so the correction posts an 'adjustment' delta rather than a first 'debit'.
  function seedNet(netInr: number, n = 1) {
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // lockWallet: ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '1000', min_balance: '0' }] }) // lockWallet: SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ net: String(netInr), n }] }) // awbNet
      .mockResolvedValueOnce({ rows: [] }) // adjustment insert
      .mockResolvedValueOnce({ rows: [{ balance: '1000' }] }) // moveBalance
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
  }

  it('posts the delta that reaches the corrected amount (40 -> 100)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    seedNet(-40)
    const res = await correctWalletDebitForAwb({
      tenantId: 't1',
      awb: 'AWB1',
      newAmountInr: 100,
    })
    expect(res).toEqual({ ok: true, outcome: 'adjusted', delta: -60 })
  })

  it('credits back when the corrected amount is LOWER (100 -> 75)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    seedNet(-100)
    const res = await correctWalletDebitForAwb({
      tenantId: 't1',
      awb: 'AWB1',
      newAmountInr: 75,
    })
    expect(res).toEqual({ ok: true, outcome: 'adjusted', delta: 25 })
  })

  it('is a noop when re-applying the same correction', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // lockWallet: ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '1000', min_balance: '0' }] }) // lockWallet: SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ net: '-100', n: 1 }] }) // awbNet: already at target
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const res = await correctWalletDebitForAwb({
      tenantId: 't1',
      awb: 'AWB1',
      newAmountInr: 100,
    })
    expect(res).toEqual({ ok: true, outcome: 'noop', delta: 0 })
  })

  it('exempts own_delhivery tenants — they are billed by Delhivery directly', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ own_delhivery: true }] })
    const res = await correctWalletDebitForAwb({
      tenantId: 't1',
      awb: 'AWB1',
      newAmountInr: 100,
    })
    expect(res).toEqual({ ok: true, outcome: 'exempt', delta: 0 })
  })
})

describe('debitWallet — generic categorised debit (campaigns/AI)', () => {
  it('debits, is idempotent on externalRef, and blocks on insufficient balance', async () => {
    // first call: not a duplicate, balance 1000 covers 200 + floor 500
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // lockWallet: ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '1000', min_balance: '0' }] }) // lockWallet SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dup check — none
      .mockResolvedValueOnce({ rows: [] }) // ledger insert
      .mockResolvedValueOnce({ rows: [{ balance: '800' }] }) // moveBalance
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const { debitWallet } = await import('@/lib/payments/wallet')
    const r1 = await debitWallet({ tenantId: 't1', amountInr: 200, category: 'campaign', externalRef: 'c1', note: 'Campaign' })
    expect(r1).toEqual({ ok: true, charged: true, balance: 800 })

    // second call with same externalRef: dup found -> no charge, no balance move
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '800', min_balance: '0' }] }) // lockWallet
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // dup check — hit
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const r2 = await debitWallet({ tenantId: 't1', amountInr: 200, category: 'campaign', externalRef: 'c1', note: 'Campaign' })
    expect(r2).toEqual({ ok: true, charged: false, balance: 800 })

    // third call would drop below floor -> blocked
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // ensure wallet
      .mockResolvedValueOnce({ rows: [{ balance: '600', min_balance: '500' }] }) // lockWallet, floor 500
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dup check — none
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK
    const { debitWallet: dw } = await import('@/lib/payments/wallet')
    const r3 = await dw({ tenantId: 't1', amountInr: 200, category: 'ai', externalRef: 'a1', note: 'AI' })
    expect(r3.ok).toBe(false)
  })

  it('exempts the flagship', async () => {
    const { debitWallet, FLAGSHIP_TENANT_ID } = await import('@/lib/payments/wallet')
    const r = await debitWallet({ tenantId: FLAGSHIP_TENANT_ID, amountInr: 200, category: 'ai', externalRef: 'x', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 0 })
  })
})
