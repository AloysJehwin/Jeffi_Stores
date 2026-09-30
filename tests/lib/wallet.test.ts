import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client) }

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))

import { rechargeWallet, correctWalletDebitForAwb } from '@/lib/wallet'

beforeEach(() => {
  vi.clearAllMocks()
  pool.connect.mockResolvedValue(client)
  client.query.mockResolvedValue({ rows: [], rowCount: 1 })
})

describe('rechargeWallet — top-up idempotency', () => {
  it('credits once and returns the new balance', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // ledger insert (won)
      .mockResolvedValueOnce({ rows: [{ balance: '500.00' }] }) // balance update
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
    const res = await rechargeWallet({ tenantId: 't1', amountInr: 500, externalRef: 'pay_1' })
    expect(res).toEqual({ ok: true, balance: 500 })
  })

  it('does NOT move the balance when the reference was already credited', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ensure wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ledger insert -> CONFLICT
      .mockResolvedValueOnce({ rows: [{ balance: '500.00' }] }) // read current balance
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
  function seedNet(netInr: number) {
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // ensure wallet
      .mockResolvedValueOnce({ rows: [{ net: String(netInr) }] }) // current net for AWB
      .mockResolvedValueOnce({ rows: [] }) // adjustment insert
      .mockResolvedValueOnce({ rows: [] }) // balance update
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
      .mockResolvedValueOnce({ rows: [] }) // ensure wallet
      .mockResolvedValueOnce({ rows: [{ net: '-100' }] }) // already at target
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
