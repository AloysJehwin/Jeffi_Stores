import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/payments/route-settlement', () => ({
  applySettlementProcessed: vi.fn(() => Promise.resolve()),
  applyTransferState: vi.fn(() => Promise.resolve()),
  recordLinkedSettlement: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  flagshipScope: vi.fn(() => ({ tenantId: '0', slug: 'platform', ctx: null })),
  runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/payments/rzp-settlements', () => ({ syncRazorpaySettlements: vi.fn(() => Promise.resolve()) }))

import { onTransfer, onSettlementProcessed } from '@/lib/payments/razorpay-events/settlements'
import { applySettlementProcessed, applyTransferState, recordLinkedSettlement } from '@/lib/payments/route-settlement'
import { controlPlanePool } from '@/lib/tenant-registry'
import { flagshipScope, runInTenant } from '@/lib/payments/webhook-tenant'
import { syncRazorpaySettlements } from '@/lib/payments/rzp-settlements'

const store = { tenantId: 't1', slug: 'acme', ctx: null }
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any
const tick = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => ({ rowCount: 0 })) } as any)
})

describe('onTransfer', () => {
  it('ignores a non-platform source', async () => {
    await onTransfer({ id: 'trf' }, ctx({ source: 'own', store }))
    expect(applyTransferState).not.toHaveBeenCalled()
  })

  it('advances the transfer state on the platform account', async () => {
    await onTransfer({ id: 'trf' }, ctx())
    expect(applyTransferState).toHaveBeenCalledWith({ id: 'trf' })
    expect(recordLinkedSettlement).not.toHaveBeenCalled()
  })

  it('records the linked settlement when the transfer names one', async () => {
    await onTransfer({ id: 'trf', recipient_settlement_id: 'setl_9' }, ctx())
    expect(recordLinkedSettlement).toHaveBeenCalledWith({ settlementId: 'setl_9' })
  })

  it('swallows an applyTransferState failure', async () => {
    vi.mocked(applyTransferState).mockRejectedValue(new Error('x'))
    await expect(onTransfer({ id: 'trf' }, ctx())).resolves.toBeUndefined()
  })
})

describe('onSettlementProcessed', () => {
  it('returns when the settlement has no id', async () => {
    await onSettlementProcessed({}, ctx())
    expect(applySettlementProcessed).not.toHaveBeenCalled()
  })

  it('own account with a store: syncs that day in the store, no platform work', async () => {
    await onSettlementProcessed({ id: 's', created_at: 1_700_000_000 }, ctx({ source: 'own', store }))
    await tick()
    expect(applySettlementProcessed).not.toHaveBeenCalled()
    expect(runInTenant).toHaveBeenCalledWith(store, expect.any(Function))
    expect(syncRazorpaySettlements).toHaveBeenCalled()
  })

  it('own account without a store: does nothing further', async () => {
    await onSettlementProcessed({ id: 's' }, ctx({ source: 'own', store: null }))
    expect(runInTenant).not.toHaveBeenCalled()
  })

  it('platform + linked account: applies and records a linked settlement', async () => {
    vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => ({ rowCount: 1 })) } as any)
    await onSettlementProcessed({ id: 's' }, ctx({ accountId: 'acc_la' }))
    expect(applySettlementProcessed).toHaveBeenCalledWith({ id: 's' })
    expect(recordLinkedSettlement).toHaveBeenCalledWith({ settlement: { id: 's' }, linkedAccountId: 'acc_la' })
  })

  it("platform + not a linked account: syncs the flagship's own day", async () => {
    vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => ({ rowCount: 0 })) } as any)
    await onSettlementProcessed({ id: 's', created_at: 1_700_000_000 }, ctx({ accountId: 'acc_x' }))
    await tick()
    expect(flagshipScope).toHaveBeenCalled()
    expect(recordLinkedSettlement).not.toHaveBeenCalled()
    expect(syncRazorpaySettlements).toHaveBeenCalled()
  })

  it('platform with no accountId: treated as not linked', async () => {
    await onSettlementProcessed({ id: 's' }, ctx({ accountId: null }))
    await tick()
    expect(recordLinkedSettlement).not.toHaveBeenCalled()
    expect(flagshipScope).toHaveBeenCalled()
  })

  it('treats a control-plane query error as not a linked account', async () => {
    vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => { throw new Error('cp') }) } as any)
    await onSettlementProcessed({ id: 's' }, ctx({ accountId: 'acc_x' }))
    await tick()
    expect(flagshipScope).toHaveBeenCalled()
  })

  it('swallows an applySettlementProcessed failure on the platform account', async () => {
    vi.mocked(applySettlementProcessed).mockRejectedValue(new Error('settle db'))
    vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => ({ rowCount: 1 })) } as any)
    await expect(onSettlementProcessed({ id: 's' }, ctx({ accountId: 'acc_la' }))).resolves.toBeUndefined()
  })

  it('swallows a failed day-sync (fire-and-forget)', async () => {
    vi.mocked(runInTenant).mockRejectedValue(new Error('sync down'))
    await onSettlementProcessed({ id: 's', created_at: 1_700_000_000 }, ctx({ source: 'own', store }))
    await tick()
    expect(runInTenant).toHaveBeenCalled()
  })
})
