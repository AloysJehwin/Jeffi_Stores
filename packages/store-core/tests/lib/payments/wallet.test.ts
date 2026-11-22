import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake control-plane client whose query() is programmed per test.
const clientQuery = vi.fn()
const poolQuery = vi.fn()
const release = vi.fn()
const client = { query: clientQuery, release }
const pool = { query: poolQuery, connect: vi.fn(async () => client) }

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))

const dbQuery = vi.fn(async (..._a: any[]) => ({ rows: [] as any[] }))
vi.mock('@/lib/shared/db', () => ({ query: (...a: any[]) => dbQuery(...a) }))
vi.mock('@/lib/shared/messaging/pricing', () => ({ MESSAGING_ESTIMATE_INR: { sms: 0.5, whatsapp: 1 } }))

import {
  isFlagshipTenant,
  FLAGSHIP_TENANT_ID,
  WALLET_PICKUP_MIN_FLOOR_INR,
  getTenantWallet,
  getWalletBalance,
  tenantShipsOnPlatform,
  walletBlocksShipment,
  checkWalletForShipment,
  rechargeWallet,
  chargeDeliveryEstimate,
  debitWallet,
  creditWallet,
  debitMessaging,
  getMessagingSpend,
  refundEstimateForAwbs,
  correctWalletDebitForAwb,
  settleDelhiveryCostToWallet,
  reconcileDelhiveryBilling,
} from '@/lib/payments/wallet'

const T = '11111111-1111-4111-8111-111111111111'

// Helper: drive withWalletTx — BEGIN, <body queries>, COMMIT.
// bodyQueries is a list of results returned in order for client.query after BEGIN.
function txScript(results: any[]) {
  let i = 0
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
    const r = results[i++]
    if (r === undefined) return { rows: [], rowCount: 0 }
    return r
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  poolQuery.mockResolvedValue({ rows: [] })
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
  dbQuery.mockResolvedValue({ rows: [] })
})

describe('constants + isFlagshipTenant', () => {
  it('exposes the floor and flagship id', () => {
    expect(WALLET_PICKUP_MIN_FLOOR_INR).toBe(500)
    expect(FLAGSHIP_TENANT_ID).toBe('00000000-0000-0000-0000-000000000000')
  })
  it('treats nullish and the NIL id as the flagship', () => {
    expect(isFlagshipTenant(null)).toBe(true)
    expect(isFlagshipTenant(undefined)).toBe(true)
    expect(isFlagshipTenant(FLAGSHIP_TENANT_ID)).toBe(true)
    expect(isFlagshipTenant(T)).toBe(false)
  })
})

describe('getTenantWallet', () => {
  it('returns balance/min/currency + ledger rows', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ balance: '1200.50', min_balance: '500', currency: 'INR ' }] })
      .mockResolvedValueOnce({ rows: [{ entry_type: 'recharge', amount: '1000' }] })
    const w = await getTenantWallet(T, 10)
    expect(w).toEqual({ balance: 1200.5, minBalance: 500, currency: 'INR', ledger: [{ entry_type: 'recharge', amount: '1000' }] })
    expect(poolQuery.mock.calls[1][1]).toEqual([T, 10])
  })
  it('defaults when the wallet row is missing', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    const w = await getTenantWallet(T)
    expect(w).toEqual({ balance: 0, minBalance: 0, currency: 'INR', ledger: [] })
  })
})

describe('getWalletBalance', () => {
  it('returns row values', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ balance: '300', min_balance: '500', currency: 'INR' }] })
    expect(await getWalletBalance(T)).toEqual({ balance: 300, minBalance: 500, currency: 'INR' })
  })
  it('defaults on a read error', async () => {
    poolQuery.mockRejectedValueOnce(new Error('down'))
    expect(await getWalletBalance(T)).toEqual({ balance: 0, minBalance: 0, currency: 'INR' })
  })
})

describe('tenantShipsOnPlatform', () => {
  it('is false for the flagship', async () => {
    expect(await tenantShipsOnPlatform(null)).toBe(false)
  })
  it('is true for a platform-mode tenant, false for own', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    expect(await tenantShipsOnPlatform(T)).toBe(true)
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: true }] })
    expect(await tenantShipsOnPlatform(T)).toBe(false)
  })
  it('is null when the control plane is unreadable', async () => {
    poolQuery.mockRejectedValueOnce(new Error('down'))
    expect(await tenantShipsOnPlatform(T)).toBeNull()
  })
})

describe('walletBlocksShipment', () => {
  it('never blocks the flagship', async () => {
    expect(await walletBlocksShipment(FLAGSHIP_TENANT_ID)).toBe(false)
  })
  it('does not block own-Delhivery tenants', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: true, below: true }] })
    expect(await walletBlocksShipment(T)).toBe(false)
  })
  it('blocks a platform tenant below its minimum', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false, below: true }] })
    expect(await walletBlocksShipment(T)).toBe(true)
  })
  it('does not block when above the minimum', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false, below: false }] })
    expect(await walletBlocksShipment(T)).toBe(false)
  })
  it('fails open (no block) when the row is missing or query errors', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    expect(await walletBlocksShipment(T)).toBe(false)
    poolQuery.mockRejectedValueOnce(new Error('x'))
    expect(await walletBlocksShipment(T)).toBe(false)
  })
})

describe('checkWalletForShipment', () => {
  it('is exempt for the flagship', async () => {
    expect(await checkWalletForShipment({ tenantId: null, estimateInr: 100 })).toEqual({ ok: true, exempt: true, balance: 0, floor: 0 })
  })
  it('fails closed when the row cannot be read', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    const r = await checkWalletForShipment({ tenantId: T, estimateInr: 100 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Could not read/)
  })
  it('is exempt for own-Delhivery tenants', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: true, balance: '0', min_balance: '0' }] })
    expect(await checkWalletForShipment({ tenantId: T, estimateInr: 100 })).toEqual({ ok: true, exempt: true, balance: 0, floor: 0 })
  })
  it('passes when balance - estimate stays at/above the floor (max of 500/min)', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false, balance: '700', min_balance: '0' }] })
    // 700 - 100 = 600 >= 500 floor
    const r = await checkWalletForShipment({ tenantId: T, estimateInr: 100 })
    expect(r).toEqual({ ok: true, exempt: false, balance: 700, floor: 500 })
  })
  it('fails when the charge would drop below the floor, reporting the shortfall', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false, balance: '550', min_balance: '0' }] })
    // 550 - 100 = 450 < 500 floor
    const r = await checkWalletForShipment({ tenantId: T, estimateInr: 100, what: 'pickup' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.neededInr).toBe(100)
      expect(r.balanceInr).toBe(550)
      expect(r.floorInr).toBe(500)
      expect(r.error).toContain('pickup')
    }
  })
  it('honours a configured minimum above 500', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false, balance: '1200', min_balance: '1000' }] })
    // floor = max(500,1000)=1000; 1200-100=1100 >= 1000 ok
    const r = await checkWalletForShipment({ tenantId: T, estimateInr: 100 })
    expect(r).toMatchObject({ ok: true, floor: 1000 })
  })
})

describe('rechargeWallet', () => {
  it('rejects a missing tenant or non-positive amount', async () => {
    expect(await rechargeWallet({ tenantId: '', amountInr: 100 })).toEqual({ ok: false, error: 'tenantId is required.' })
    expect(await rechargeWallet({ tenantId: T, amountInr: 0 })).toEqual({ ok: false, error: 'Recharge amount must be positive.' })
  })
  it('credits and bumps the balance when the ledger insert is new', async () => {
    // lockWallet: insert(no-op), select FOR UPDATE -> balance 100 ; insert ledger rowCount 1 ; moveBalance -> 1100
    txScript([
      { rowCount: 0 }, // INSERT tenant_wallets ON CONFLICT
      { rows: [{ balance: '100', min_balance: '0' }] }, // SELECT FOR UPDATE
      { rowCount: 1 }, // INSERT ledger
      { rows: [{ balance: '1100' }] }, // moveBalance
    ])
    const r = await rechargeWallet({ tenantId: T, amountInr: 1000, externalRef: 'pay_1' })
    expect(r).toEqual({ ok: true, balance: 1100 })
  })
  it('is idempotent — already-credited returns the existing balance', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '1100', min_balance: '0' }] },
      { rowCount: 0 }, // ledger ON CONFLICT DO NOTHING -> no row
    ])
    const r = await rechargeWallet({ tenantId: T, amountInr: 1000, externalRef: 'pay_1' })
    expect(r).toEqual({ ok: true, balance: 1100, alreadyCredited: true })
  })
  it('returns an error when the transaction throws', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {}
      throw new Error('boom')
    })
    const r = await rechargeWallet({ tenantId: T, amountInr: 10 })
    expect(r).toEqual({ ok: false, error: 'boom' })
  })
})

describe('chargeDeliveryEstimate', () => {
  it('skips the flagship', async () => {
    expect(await chargeDeliveryEstimate({ tenantId: FLAGSHIP_TENANT_ID, items: [] })).toEqual({ ok: true, skipped: true, chargedInr: 0, balance: 0 })
  })
  it('fails when the delivery mode cannot be read', async () => {
    poolQuery.mockRejectedValueOnce(new Error('down')) // tenantMode
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }] })
    expect(r).toEqual({ ok: false, error: 'Failed to read tenant delivery mode.' })
  })
  it('skips own-Delhivery tenants', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: true }] }) // tenantMode = own
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }] })
    expect(r).toEqual({ ok: true, skipped: true, chargedInr: 0, balance: 0 })
  })
  it('charges each new AWB and debits the sum', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] }) // tenantMode = platform
    txScript([
      { rowCount: 0 }, // lock insert
      { rows: [{ balance: '1000', min_balance: '0' }] }, // lock select
      { rows: [] }, // existing AWBs (none)
      { rowCount: 1 }, // insert AWB A1 debit
      { rowCount: 1 }, // insert AWB A2 debit
      { rows: [{ balance: '700' }] }, // moveBalance after -300
    ])
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }, { awb: 'A2', estimateInr: 200 }] })
    expect(r).toEqual({ ok: true, chargedInr: 300, balance: 700 })
  })
  it('returns chargedInr 0 when all AWBs already exist', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '1000', min_balance: '0' }] },
      { rows: [{ awb: 'A1' }] }, // A1 already present
    ])
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }] })
    expect(r).toEqual({ ok: true, chargedInr: 0, balance: 1000 })
  })
  it('blocks when the sum would drop below the floor', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '550', min_balance: '0' }] }, // floor 500
      { rows: [] },
    ])
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }] })
    expect(r.ok).toBe(false)
  })
  it('wraps a thrown error', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ own_delhivery: false }] })
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {}
      throw new Error('x')
    })
    const r = await chargeDeliveryEstimate({ tenantId: T, items: [{ awb: 'A1', estimateInr: 100 }] })
    expect(r).toEqual({ ok: false, error: 'Wallet charge failed.' })
  })
})

describe('debitWallet', () => {
  it('is a no-op for the flagship', async () => {
    expect(await debitWallet({ tenantId: FLAGSHIP_TENANT_ID, amountInr: 10, category: 'ai', externalRef: 'r', note: 'n' })).toEqual({ ok: true, charged: false, balance: 0 })
  })
  it('rejects a non-positive amount', async () => {
    expect(await debitWallet({ tenantId: T, amountInr: 0, category: 'ai', externalRef: 'r', note: 'n' })).toEqual({ ok: false, error: 'Debit amount must be positive.' })
  })
  it('skips a duplicate externalRef', async () => {
    txScript([
      { rowCount: 0 }, // lock insert
      { rows: [{ balance: '1000', min_balance: '0' }] }, // lock select
      { rowCount: 1 }, // dup check -> found
    ])
    const r = await debitWallet({ tenantId: T, amountInr: 50, category: 'ai', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: true, charged: false, balance: 1000 })
  })
  it('charges and runs onCharged in the same transaction', async () => {
    const onCharged = vi.fn(async () => {})
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '1000', min_balance: '0' }] },
      { rowCount: 0 }, // dup check none
      { rowCount: 1 }, // insert ledger debit
      { rows: [{ balance: '950' }] }, // moveBalance
    ])
    const r = await debitWallet({ tenantId: T, amountInr: 50, category: 'ai', externalRef: 'r', note: 'n', onCharged })
    expect(r).toEqual({ ok: true, charged: true, balance: 950 })
    expect(onCharged).toHaveBeenCalledWith(client)
  })
  it('blocks below the floor unless allowNegative', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '520', min_balance: '0' }] }, // floor 500
      { rowCount: 0 },
    ])
    const r = await debitWallet({ tenantId: T, amountInr: 50, category: 'ai', externalRef: 'r', note: 'need' })
    expect(r.ok).toBe(false)
  })
  it('allows a negative balance with allowNegative + a custom floor', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '10', min_balance: '0' }] },
      { rowCount: 0 },
      { rowCount: 1 },
      { rows: [{ balance: '-40' }] },
    ])
    const r = await debitWallet({ tenantId: T, amountInr: 50, category: 'infra', externalRef: 'r', note: 'server', floorInr: 0, allowNegative: true })
    expect(r).toEqual({ ok: true, charged: true, balance: -40 })
  })
  it('wraps a thrown error', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {}
      throw new Error('kaput')
    })
    const r = await debitWallet({ tenantId: T, amountInr: 50, category: 'ai', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: false, error: 'kaput' })
  })
})

describe('creditWallet', () => {
  it('is a no-op for the flagship', async () => {
    expect(await creditWallet({ tenantId: FLAGSHIP_TENANT_ID, amountInr: 10, category: 'ai', externalRef: 'r', note: 'n' })).toEqual({ ok: true, credited: false, balance: 0 })
  })
  it('rejects a non-positive amount', async () => {
    expect(await creditWallet({ tenantId: T, amountInr: -1, category: 'ai', externalRef: 'r', note: 'n' })).toEqual({ ok: false, error: 'Credit amount must be positive.' })
  })
  it('credits a new externalRef', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '100', min_balance: '0' }] },
      { rowCount: 1 }, // insert adjustment
      { rows: [{ balance: '150' }] }, // moveBalance
    ])
    const r = await creditWallet({ tenantId: T, amountInr: 50, category: 'goodwill_credit', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: true, credited: true, balance: 150 })
  })
  it('is idempotent on a duplicate externalRef', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '150', min_balance: '0' }] },
      { rowCount: 0 }, // insert ON CONFLICT no row
    ])
    const r = await creditWallet({ tenantId: T, amountInr: 50, category: 'goodwill_credit', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: true, credited: false, balance: 150 })
  })
  it('wraps a thrown error', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return {}
      throw new Error('err')
    })
    const r = await creditWallet({ tenantId: T, amountInr: 50, category: 'ai', externalRef: 'r', note: 'n' })
    expect(r).toEqual({ ok: false, error: 'err' })
  })
})

describe('debitMessaging', () => {
  it('returns early for flagship, negative amount, and 0 without trueUp', async () => {
    await debitMessaging({ tenantId: FLAGSHIP_TENANT_ID, category: 'sms', amountInr: 5, externalRef: 'm', note: 'n' })
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: -1, externalRef: 'm', note: 'n' })
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 0, externalRef: 'm', note: 'n' })
    expect(pool.connect).not.toHaveBeenCalled()
  })
  it('inserts a debit at send time when no row exists', async () => {
    txScript([
      { rowCount: 0 }, // lock insert
      { rows: [{ balance: '100', min_balance: '0' }] }, // lock select
      { rowCount: 0 }, // existing lookup none
      { rowCount: 1 }, // insert debit
      { rows: [{ balance: '99' }] }, // moveBalance
    ])
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 1, externalRef: 'msg:1', note: 'n' })
    // insert debit happened (4th query is the INSERT)
    const insert = clientQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO wallet_ledger'))
    expect(insert).toBeTruthy()
    expect(insert![1]).toEqual([T, 'sms', -1, 'msg:1', 'n'])
  })
  it('skips a send-time call of amount 0 with no existing row', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '100', min_balance: '0' }] },
      { rowCount: 0 }, // no existing
    ])
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 0, externalRef: 'msg:1', note: 'n', trueUp: true })
    const insert = clientQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO wallet_ledger'))
    expect(insert).toBeFalsy()
  })
  it('trues up an existing row by the delta (charge more)', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '100', min_balance: '0' }] },
      { rows: [{ amount: '-1' }], rowCount: 1 }, // existing estimate = 1
      { rowCount: 1 }, // UPDATE row
      { rows: [{ balance: '99.5' }] }, // moveBalance by -(1.5-1)=-0.5
    ])
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 1.5, externalRef: 'msg:1', note: 'final', trueUp: true })
    const upd = clientQuery.mock.calls.find(c => String(c[0]).includes('UPDATE wallet_ledger'))
    expect(upd).toBeTruthy()
    expect(upd![1]).toEqual([T, 'msg:1', -1.5, 'final'])
  })
  it('is a no-op on a duplicate send-time call (existing row, no trueUp)', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '100', min_balance: '0' }] },
      { rows: [{ amount: '-1' }], rowCount: 1 }, // existing
    ])
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 1, externalRef: 'msg:1', note: 'n' })
    const upd = clientQuery.mock.calls.find(c => String(c[0]).includes('UPDATE wallet_ledger'))
    expect(upd).toBeFalsy()
  })
  it('does nothing when the true-up delta is zero', async () => {
    txScript([
      { rowCount: 0 },
      { rows: [{ balance: '100', min_balance: '0' }] },
      { rows: [{ amount: '-2' }], rowCount: 1 }, // existing 2
    ])
    await debitMessaging({ tenantId: T, category: 'sms', amountInr: 2, externalRef: 'msg:1', note: 'n', trueUp: true })
    const upd = clientQuery.mock.calls.find(c => String(c[0]).includes('UPDATE wallet_ledger'))
    expect(upd).toBeFalsy()
  })
})

describe('getMessagingSpend (tenant path)', () => {
  it('aggregates wallet_ledger debits per channel/month with totals', async () => {
    const now = new Date().toISOString().slice(0, 7)
    poolQuery.mockResolvedValueOnce({
      rows: [
        { channel: 'sms', month: now, spent: '10' },
        { channel: 'whatsapp', month: '2026-01', spent: '20' },
      ],
    })
    const r = await getMessagingSpend(T)
    expect(r.total).toBe(30)
    expect(r.byChannel).toEqual({ sms: 10, whatsapp: 20 })
    expect(r.thisMonth).toBe(10)
  })
  it('handles a control-plane read error (empty)', async () => {
    poolQuery.mockRejectedValueOnce(new Error('down'))
    const r = await getMessagingSpend(T)
    expect(r).toEqual({ rows: [], total: 0, thisMonth: 0, byChannel: {} })
  })
})
