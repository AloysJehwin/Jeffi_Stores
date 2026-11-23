import { describe, it, expect, vi, beforeEach } from 'vitest'

const accessToken = vi.fn<(...a: any[]) => Promise<string>>(async () => 'TOKEN')
const clearPhonePeTokenCache = vi.fn()

vi.mock('@/lib/payments/upi/phonepe', () => {
  class PhonePeError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string, readonly data?: unknown) {
      super(message)
      this.name = 'PhonePeError'
    }
  }
  return {
    PHONEPE_API_BASE: { sandbox: 'https://sandbox.phonepe', production: 'https://api.phonepe' },
    PhonePeError,
    accessToken: (c: any) => accessToken(c),
    clearPhonePeTokenCache: () => clearPhonePeTokenCache(),
  }
})
vi.mock('@/lib/payments/upi/creds', () => ({ resolveUpiProvider: vi.fn(), upiAvailable: vi.fn() }))

import {
  AUTOPAY_MAX_AMOUNT_PAISE, setupMandate, parseAutopayOrder, completedAutopayPayment, autopayOrderStatus,
  parseMandate, mandateStatus, notifyRedemption, executeRedemption, cancelMandate, autopayCreds, autopaySignupCreds,
} from '@/lib/payments/upi/autopay'
import { resolveUpiProvider, upiAvailable } from '@/lib/payments/upi/creds'
import { PhonePeError } from '@/lib/payments/upi/phonepe'

const creds = { env: 'sandbox', clientId: 'c', clientSecret: 's', clientVersion: '1' } as any
const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  accessToken.mockResolvedValue('TOKEN')
})

describe('setupMandate', () => {
  it('opens the hosted page, capping maxAmount to the NPCI limit', async () => {
    const fetchMock = vi.fn(async () => ok({ orderId: 'O1', state: 'pending', redirectUrl: 'https://pay' })) as any
    vi.stubGlobal('fetch', fetchMock)
    const r = await setupMandate(creds, {
      merchantOrderId: 'JSm', merchantSubscriptionId: 'sub1', amountPaise: 10000,
      maxAmountPaise: 9_999_999, frequency: 'MONTHLY', expireAt: new Date('2027-01-01T00:00:00Z'), redirectUrl: 'https://back',
    })
    expect(r).toEqual({ orderId: 'O1', state: 'PENDING', redirectUrl: 'https://pay' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://sandbox.phonepe/checkout/v2/pay')
    expect(init.headers.Authorization).toBe('O-Bearer TOKEN')
    const sent = JSON.parse(init.body)
    expect(sent.paymentFlow.subscriptionDetails.maxAmount).toBe(AUTOPAY_MAX_AMOUNT_PAISE)
    expect(sent.expireAfter).toBe(1200) // default
  })
  it('throws when no redirectUrl is returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ orderId: 'O', state: 'PENDING' })))
    await expect(setupMandate(creds, { merchantOrderId: 'm', merchantSubscriptionId: 's', amountPaise: 100, maxAmountPaise: 100, frequency: 'DAILY', expireAt: new Date(), redirectUrl: 'r' })).rejects.toBeInstanceOf(PhonePeError)
  })
})

describe('call error handling (via autopayOrderStatus)', () => {
  it('clears the token cache on 401 and throws PhonePeError with the code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ code: 'UNAUTHORIZED', message: 'nope' }) })))
    await expect(autopayOrderStatus(creds, 'm')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
    expect(clearPhonePeTokenCache).toHaveBeenCalled()
  })
  it('tolerates a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'oops' })))
    await expect(autopayOrderStatus(creds, 'm')).rejects.toMatchObject({ status: 500 })
  })
})

describe('parseAutopayOrder', () => {
  it('parses flow, payments, epochs and error code', () => {
    const o = parseAutopayOrder({
      orderId: 'O', state: 'completed', amount: 5000, expireAt: 1700000000000, detailedErrorCode: 'E1',
      paymentFlow: { type: 'SUBSCRIPTION_CHECKOUT_SETUP', merchantSubscriptionId: 'msid', subscriptionId: 'sid', validAfter: 1, validUpto: 2, notifiedAt: 3 },
      paymentDetails: [{ transactionId: 'T', state: 'completed', amount: 5000, rail: { utr: 'U', umn: 'UMN' }, detailedErrorCode: 'PE', timestamp: 1700000000000 }],
    })
    expect(o).toMatchObject({ orderId: 'O', state: 'COMPLETED', amountPaise: 5000, flowType: 'SUBSCRIPTION_CHECKOUT_SETUP', merchantSubscriptionId: 'msid', subscriptionId: 'sid', errorCode: 'E1' })
    expect(o.validAfter).toBeInstanceOf(Date)
    expect(o.payments[0]).toMatchObject({ transactionId: 'T', state: 'COMPLETED', amountPaise: 5000, utr: 'U', umn: 'UMN', errorCode: 'PE' })
  })
  it('defaults state, zeroes amount, empty payments, non-finite epochs to null', () => {
    const o = parseAutopayOrder({})
    expect(o).toMatchObject({ orderId: '', state: 'PENDING', amountPaise: 0, payments: [] })
    expect(o.validAfter).toBeNull()
    expect(o.expireAt).toBeNull()
  })
  it('falls back to errorCode when detailedErrorCode is absent', () => {
    const o = parseAutopayOrder({ errorCode: 'E2', paymentDetails: [{ errorCode: 'PE2' }] })
    expect(o.errorCode).toBe('E2')
    expect(o.payments[0].errorCode).toBe('PE2')
  })
})

describe('completedAutopayPayment', () => {
  it('prefers a COMPLETED attempt, else the last, else null', () => {
    expect(completedAutopayPayment({ payments: [{ state: 'FAILED' } as any, { state: 'COMPLETED' } as any] } as any)?.state).toBe('COMPLETED')
    expect(completedAutopayPayment({ payments: [{ state: 'FAILED' } as any, { state: 'PENDING' } as any] } as any)?.state).toBe('PENDING')
    expect(completedAutopayPayment({ payments: [] } as any)).toBeNull()
  })
})

describe('autopayOrderStatus / mandateStatus use GET', () => {
  it('autopayOrderStatus hits the order status endpoint with details', async () => {
    const fetchMock = vi.fn(async () => ok({ orderId: 'O', state: 'COMPLETED' })) as any
    vi.stubGlobal('fetch', fetchMock)
    expect((await autopayOrderStatus(creds, 'JS m/1')).orderId).toBe('O')
    expect(fetchMock.mock.calls[0][0]).toBe(`https://sandbox.phonepe/checkout/v2/order/${encodeURIComponent('JS m/1')}/status?details=true`)
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })
  it('mandateStatus parses a subscription', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ merchantSubscriptionId: 'msid', subscriptionId: 'sid', state: 'active', maxAmount: 1000, frequency: 'MONTHLY', expireAt: 1700000000000 })))
    const m = await mandateStatus(creds, 'msid')
    expect(m).toMatchObject({ merchantSubscriptionId: 'msid', subscriptionId: 'sid', state: 'ACTIVE', maxAmountPaise: 1000, frequency: 'MONTHLY' })
    expect(m.expireAt).toBeInstanceOf(Date)
  })
})

describe('parseMandate defaults', () => {
  it('empty object → blanks, zero amount, null dates', () => {
    expect(parseMandate({})).toEqual({ merchantSubscriptionId: '', subscriptionId: '', state: '', maxAmountPaise: 0, frequency: undefined, expireAt: null, pauseStartDate: null, pauseEndDate: null })
  })
})

describe('notifyRedemption', () => {
  it('posts the redemption notify body (autoDebit off) and parses the response', async () => {
    const fetchMock = vi.fn(async () => ok({ orderId: 'N', state: 'notified', expireAt: 1700000000000 })) as any
    vi.stubGlobal('fetch', fetchMock)
    const r = await notifyRedemption(creds, { merchantOrderId: 'm', merchantSubscriptionId: 's', amountPaise: 999, expireAt: new Date('2027-01-01T00:00:00Z') })
    expect(r.orderId).toBe('N')
    expect(r.state).toBe('NOTIFIED')
    expect(r.expireAt).toBeInstanceOf(Date)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.paymentFlow).toMatchObject({ type: 'SUBSCRIPTION_CHECKOUT_REDEMPTION', autoDebit: false, redemptionRetryStrategy: 'STANDARD' })
    expect(sent.expireAt).toBeTypeOf('number')
  })
  it('omits expireAt and defaults state when absent', async () => {
    const fetchMock = vi.fn(async () => ok({ orderId: 'N' })) as any
    vi.stubGlobal('fetch', fetchMock)
    const r = await notifyRedemption(creds, { merchantOrderId: 'm', merchantSubscriptionId: 's', amountPaise: 1 })
    expect(r.state).toBe('NOTIFICATION_IN_PROGRESS')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expireAt).toBeUndefined()
  })
})

describe('executeRedemption / cancelMandate', () => {
  it('executeRedemption posts and parses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ transactionId: 'T', state: 'pending' })))
    expect(await executeRedemption(creds, 'm')).toEqual({ transactionId: 'T', state: 'PENDING' })
  })
  it('executeRedemption defaults when fields absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({})))
    expect(await executeRedemption(creds, 'm')).toEqual({ transactionId: '', state: 'PENDING' })
  })
  it('cancelMandate resolves on a 204-style empty body', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' })) as any
    vi.stubGlobal('fetch', fetchMock)
    await expect(cancelMandate(creds, 'msid')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toContain('/subscriptions/msid/cancel')
  })
})

describe('autopayCreds / autopaySignupCreds', () => {
  it('autopayCreds returns the creds only when the provider is phonepe', async () => {
    vi.mocked(resolveUpiProvider).mockResolvedValueOnce({ provider: 'phonepe', creds } as any)
    expect(await autopayCreds('t1')).toBe(creds)
    vi.mocked(resolveUpiProvider).mockResolvedValueOnce({ provider: 'upg', vpa: 's@ok' } as any)
    expect(await autopayCreds('t1')).toBeNull()
  })
  it('autopaySignupCreds is null when UPI is unavailable, else the creds', async () => {
    vi.mocked(upiAvailable).mockResolvedValueOnce(false)
    expect(await autopaySignupCreds('t1')).toBeNull()
    expect(resolveUpiProvider).not.toHaveBeenCalled()

    vi.mocked(upiAvailable).mockResolvedValueOnce(true)
    vi.mocked(resolveUpiProvider).mockResolvedValueOnce({ provider: 'phonepe', creds } as any)
    expect(await autopaySignupCreds('t1')).toBe(creds)
  })
  it('autopaySignupCreds treats an upiAvailable throw as unavailable', async () => {
    vi.mocked(upiAvailable).mockRejectedValueOnce(new Error('x'))
    expect(await autopaySignupCreds('t1')).toBeNull()
  })
})
