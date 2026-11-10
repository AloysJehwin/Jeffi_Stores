import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })), queryOne: vi.fn(async () => null) }))
vi.mock('@/lib/payments/capture', () => ({ commitDraftFromCapture: vi.fn(), markOrderPaid: vi.fn(async () => 'paid') }))
vi.mock('@/lib/payments/route-settlement', () => ({ recordCapturedPayment: vi.fn(async () => 'captured') }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/orders/variant-change', () => ({ settleVariantChangePayment: vi.fn(async () => ({ applied: true })) }))
vi.mock('@/lib/orders/adjustments', () => ({ settleAdjustmentPayment: vi.fn(async () => ({ applied: true })) }))
vi.mock('@/lib/billing/topup', () => ({ creditTopup: vi.fn(async () => ({ ok: true, balance: 1500 })) }))
vi.mock('@/lib/payments/upi/phonepe', () => ({ orderStatus: vi.fn(), refundStatus: vi.fn(), completedPayment: (s: any) => s.paymentDetails?.[0] ?? null }))
vi.mock('@/lib/payments/upi/creds', () => ({
  platformPhonePeCreds: vi.fn(async () => ({ env: 'sandbox', clientId: 'c', clientSecret: 's', clientVersion: '1' })),
  resolvePhonePeCreds: vi.fn(async () => ({ env: 'sandbox', clientId: 'c', clientSecret: 's', clientVersion: '1' })),
}))
vi.mock('@/lib/payments/upi/upg', () => ({
  advanceVpa: vi.fn(async () => null),
  alertCandidates: vi.fn(async () => []),
  awaitingIntentByUtr: vi.fn(async () => null),
  claimObservation: vi.fn(async () => true),
  releaseObservation: vi.fn(async () => {}),
  trustedObservationByUtr: vi.fn(async () => null),
  expireStaleQueued: vi.fn(async () => 0),
  openVpas: vi.fn(async () => []),
  unappliedUpgIntents: vi.fn(async () => []),
}))
vi.mock('@/lib/payments/upi/intents', () => ({
  findUpiIntent: vi.fn(),
  claimIntentStatus: vi.fn(),
  updateUpiIntent: vi.fn(async (_id: string, patch: any) => ({ ...intent(), status: 'completed', ...patch })),
  pendingPhonePeIntents: vi.fn(async () => []),
  expireStalePhonePeIntents: vi.fn(async () => 0),
  storeDb: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}))

import { applyUpiPayment, completeUpgIntent, confirmUpgUtr, matchObservation, recordUpiCapturedPayment, settleUpiIntent } from '@/lib/payments/upi/settle'
import { advanceVpa, alertCandidates, claimObservation, releaseObservation, trustedObservationByUtr } from '@/lib/payments/upi/upg'
import { commitDraftFromCapture } from '@/lib/payments/capture'
import { recordCapturedPayment } from '@/lib/payments/route-settlement'
import { settleVariantChangePayment } from '@/lib/orders/variant-change'
import { settleAdjustmentPayment } from '@/lib/orders/adjustments'
import { creditTopup } from '@/lib/billing/topup'
import { orderStatus } from '@/lib/payments/upi/phonepe'
import { claimIntentStatus, findUpiIntent } from '@/lib/payments/upi/intents'

const T = '11111111-1111-4111-8111-111111111111'
function intent(over: Record<string, unknown> = {}): any {
  return { id: 'i1', tenant_id: T, provider: 'phonepe', purpose: 'order_draft', amount_paise: 5000, merchant_order_id: 'JSabc', status: 'pending', refs: {}, result: null, expires_at: null, ...over }
}
const txn = { transactionId: 'T2', utr: '4123', vpa: 'a@ybl' }

beforeEach(() => vi.clearAllMocks())

describe('applyUpiPayment', () => {
  it('commits a checkout draft on the phonepe gateway', async () => {
    vi.mocked(commitDraftFromCapture).mockResolvedValue({ status: 'committed', order: { id: 'o1', order_number: 'ORD-1', total_amount: '50' } })
    const r = await applyUpiPayment(intent({ refs: { draftToken: 'd', userId: 'u' } }), txn)
    expect(r).toEqual({ orderId: 'o1', orderNumber: 'ORD-1' })
    const [moid, payment, , opts] = vi.mocked(commitDraftFromCapture).mock.calls[0]
    expect(moid).toBe('JSabc')
    expect(payment).toEqual({ id: 'T2', amount: 5000 })
    expect(opts?.gw).toMatchObject({ gateway: 'phonepe', method: 'upi', vpa: 'a@ybl' })
  })

  it('settles adjustments and variant changes by the merchant order id', async () => {
    await applyUpiPayment(intent({ purpose: 'order_adjustment', refs: { adjustmentId: 'a1', orderId: 'o1' } }), txn)
    expect(vi.mocked(settleAdjustmentPayment).mock.calls[0][0]).toMatchObject({ razorpayOrderId: 'JSabc', razorpayPaymentId: 'T2', amountPaise: 5000 })
    const r = await applyUpiPayment(intent({ purpose: 'variant_change', refs: { requestId: 'v1', orderId: 'o1' } }), txn)
    expect(vi.mocked(settleVariantChangePayment).mock.calls[0][0]).toMatchObject({ razorpayOrderId: 'JSabc', razorpayPaymentId: 'T2' })
    expect(r.settlement).toBe('variant_change_applied')
  })

  it('credits a wallet top-up with its notes', async () => {
    const notes = { purpose: 'wallet_topup', credit_inr: '1000' }
    const r = await applyUpiPayment(intent({ purpose: 'ecom_wallet_topup', amount_paise: 118000, refs: { notes } }), txn)
    expect(creditTopup).toHaveBeenCalledWith({ tenantId: T, paymentId: 'T2', paidPaise: 118000, notes })
    expect(r).toEqual({ balance: 1500 })
  })
})

describe('recordUpiCapturedPayment', () => {
  const base = { store: { tenantId: T, slug: 'acme' }, paymentId: 'T2', totalAmountInr: 50, orderId: 'o1', orderRef: 'ORD-1' }
  it('books a store sale on its own account under the gateway that confirmed it', async () => {
    await recordUpiCapturedPayment({ ...base, intent: intent() })
    await recordUpiCapturedPayment({ ...base, intent: intent({ provider: 'upg' }) })
    await recordUpiCapturedPayment({ ...base, intent: intent({ provider: 'upg' }), via: 'manual' })
    expect(vi.mocked(recordCapturedPayment).mock.calls.map(c => [c[0].collectedOn, c[0].gateway])).toEqual([
      ['own', 'upi_phonepe'],
      ['own', 'upi_upg'],
      ['own', 'upi_manual'],
    ])
  })
  it('books nothing for the flagship or a wallet top-up', async () => {
    await recordUpiCapturedPayment({ ...base, store: null, intent: intent() })
    await recordUpiCapturedPayment({ ...base, intent: intent({ purpose: 'wallet_topup' }) })
    expect(recordCapturedPayment).not.toHaveBeenCalled()
  })
})

describe('settleUpiIntent', () => {
  it('applies a completed payment once and leaves a lost claim alone', async () => {
    vi.mocked(findUpiIntent).mockResolvedValue(intent({ purpose: 'wallet_topup' }))
    vi.mocked(orderStatus).mockResolvedValue({ orderId: 'OMO1', state: 'COMPLETED', amount: 5000, paymentDetails: [{ transactionId: 'T2', state: 'COMPLETED', rail: { utr: '4123' } }] } as any)
    vi.mocked(claimIntentStatus).mockResolvedValueOnce(intent({ purpose: 'wallet_topup', status: 'completed' })).mockResolvedValueOnce(null)
    const r = await settleUpiIntent('i1')
    expect(r?.status).toBe('completed')
    expect(creditTopup).toHaveBeenCalledTimes(1)
    await settleUpiIntent('i1') // another settle already claimed it
    expect(creditTopup).toHaveBeenCalledTimes(1)
  })

  it('marks failed and mismatched amounts failed, and skips settled intents', async () => {
    vi.mocked(findUpiIntent).mockResolvedValue(intent())
    vi.mocked(claimIntentStatus).mockImplementation(async (_id, _from, to, patch) => intent({ status: to, ...patch }))
    vi.mocked(orderStatus).mockResolvedValueOnce({ orderId: 'O', state: 'FAILED', amount: 5000, paymentDetails: [], errorCode: 'TXN_DECLINED' } as any)
    expect((await settleUpiIntent('i1'))?.status).toBe('failed')
    vi.mocked(orderStatus).mockResolvedValueOnce({ orderId: 'O', state: 'COMPLETED', amount: 100, paymentDetails: [{ transactionId: 'T9' }] } as any)
    const r = await settleUpiIntent('i1')
    expect(r?.status).toBe('failed')
    expect(commitDraftFromCapture).not.toHaveBeenCalled()
    vi.mocked(findUpiIntent).mockResolvedValue(intent({ status: 'completed' }))
    await settleUpiIntent('i1')
    expect(orderStatus).toHaveBeenCalledTimes(2)
  })
})

describe('UPG completion', () => {
  const upg = (over: Record<string, unknown> = {}) => intent({ provider: 'upg', purpose: 'wallet_topup', status: 'active', receiving_vpa: 'shop@okhdfc', ...over })
  const obs = (over: Record<string, unknown> = {}): any => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'credit', trusted: true, receiving_vpa: 'shop@okhdfc', amount_paise: 5000, utr: '431234567890', sender_vpa: 'a@ybl', observed_at: new Date().toISOString(), matched_intent_id: null, ...over })

  it('completes on a trusted credit of the exact amount, applies it once and frees the UPI ID', async () => {
    vi.mocked(claimIntentStatus).mockImplementation(async (_id, _from, to, patch) => upg({ status: to, ...patch }))
    const r = await completeUpgIntent(upg(), obs())
    expect(r?.status).toBe('completed')
    expect(vi.mocked(claimIntentStatus).mock.calls[0][3]).toMatchObject({ provider_txn_id: '431234567890', utr: '431234567890', payer_vpa: 'a@ybl', observation_id: obs().id })
    expect(creditTopup).toHaveBeenCalledWith(expect.objectContaining({ paymentId: '431234567890', paidPaise: 5000 }))
    expect(advanceVpa).toHaveBeenCalledWith('shop@okhdfc', expect.anything())
  })

  it('never completes on an untrusted credit, a different amount, or an observation already used', async () => {
    expect(await completeUpgIntent(upg(), obs({ trusted: false }))).toBeNull()
    expect(await completeUpgIntent(upg(), obs({ amount_paise: 4999 }))).toBeNull()
    vi.mocked(claimObservation).mockResolvedValueOnce(false)
    expect(await completeUpgIntent(upg(), obs())).toBeNull()
    expect(claimIntentStatus).not.toHaveBeenCalled()
    // the intent was settled by someone else meanwhile: the observation is handed back
    vi.mocked(claimIntentStatus).mockResolvedValueOnce(null)
    expect(await completeUpgIntent(upg(), obs())).toBeNull()
    expect(releaseObservation).toHaveBeenCalled()
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('matches an alert to the intent holding the UPI ID', async () => {
    vi.mocked(alertCandidates).mockResolvedValue([{ id: 'i1', status: 'processing', amount_paise: 5000, receiving_vpa: 'shop@okhdfc', created_at: new Date().toISOString() }])
    vi.mocked(findUpiIntent).mockResolvedValue(upg({ status: 'processing' }))
    vi.mocked(claimIntentStatus).mockImplementation(async (_id, _from, to, patch) => upg({ status: to, ...patch }))
    expect((await matchObservation(obs()))?.status).toBe('completed')
    expect(await matchObservation(obs({ amount_paise: 100 }))).toBeNull()
  })

  it('UTR fallback: only after failed / expired, completing at once when the bank already reported that UTR', async () => {
    vi.mocked(findUpiIntent).mockResolvedValue(upg({ status: 'active' }))
    await expect(confirmUpgUtr('i1', '431234567890')).rejects.toMatchObject({ status: 409 })
    vi.mocked(findUpiIntent).mockResolvedValue(upg({ status: 'failed' }))
    vi.mocked(claimIntentStatus).mockImplementation(async (_id, _from, to, patch) => upg({ status: to, ...patch }))
    expect((await confirmUpgUtr('i1', '431234567890')).status).toBe('awaiting_confirmation')
    expect(creditTopup).not.toHaveBeenCalled()
    vi.mocked(trustedObservationByUtr).mockResolvedValueOnce(obs())
    expect((await confirmUpgUtr('i1', '431234567890')).status).toBe('completed')
    expect(creditTopup).toHaveBeenCalledTimes(1)
  })
})
