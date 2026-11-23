import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctor = vi.fn()
let nextInstance: any = { paymentLink: {}, qrCode: {} }
vi.mock('razorpay', () => ({
  default: vi.fn(function (this: any, opts: any) {
    ctor(opts)
    return nextInstance
  }),
}))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn() }))

import { getRazorpayInstance, getRazorpayInstanceFor, isRazorpayEnabled, cancelInvoicePaymentArtifacts } from '@/lib/payments/razorpay'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'

const OLD = process.env

beforeEach(() => {
  vi.clearAllMocks()
  ctor.mockClear()
  process.env = { ...OLD }
})

describe('getRazorpayInstance', () => {
  it('throws when env keys are missing', () => {
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    expect(() => getRazorpayInstance()).toThrow(/must be set/)
  })

  it('constructs with the env keys', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_1'
    process.env.RAZORPAY_KEY_SECRET = 'sec'
    getRazorpayInstance()
    expect(ctor).toHaveBeenCalledWith({ key_id: 'rzp_test_1', key_secret: 'sec' })
  })
})

describe('getRazorpayInstanceFor', () => {
  it('throws when resolved creds lack a key', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: '', key_secret: '' } as any)
    await expect(getRazorpayInstanceFor('t1')).rejects.toThrow(/must be set/)
  })

  it('constructs with the resolved tenant creds and returns them', async () => {
    const creds = { key_id: 'rzp_live_x', key_secret: 'ss', isOwn: true }
    vi.mocked(resolveRazorpayCreds).mockResolvedValue(creds as any)
    const r = await getRazorpayInstanceFor('t1')
    expect(resolveRazorpayCreds).toHaveBeenCalledWith('t1')
    expect(ctor).toHaveBeenCalledWith({ key_id: 'rzp_live_x', key_secret: 'ss' })
    expect(r.creds).toBe(creds)
  })
})

describe('isRazorpayEnabled', () => {
  it('reflects the feature flag', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ razorpayEnabled: true } as any)
    expect(await isRazorpayEnabled()).toBe(true)
    vi.mocked(getFeatureFlags).mockResolvedValue({ razorpayEnabled: false } as any)
    expect(await isRazorpayEnabled()).toBe(false)
  })
})

describe('cancelInvoicePaymentArtifacts', () => {
  const withInstance = (overrides: any = {}) => {
    const instance = { paymentLink: { cancel: vi.fn(async () => {}) }, qrCode: { close: vi.fn(async () => {}) }, ...overrides }
    nextInstance = instance
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: 'rzp_live', key_secret: 's' } as any)
    return instance
  }

  it('returns none/none when no keys are configured', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: '', key_secret: '' } as any)
    const r = await cancelInvoicePaymentArtifacts({ paymentLinkId: 'pl', qrId: 'qr' })
    expect(r).toEqual({ paymentLink: 'none', qr: 'none' })
  })

  it('skips an already paid/cancelled/expired link', async () => {
    withInstance()
    const r = await cancelInvoicePaymentArtifacts({ paymentLinkId: 'pl', paymentLinkStatus: 'paid' })
    expect(r.paymentLink).toBe('skipped')
  })

  it('cancels an open link', async () => {
    const inst = withInstance()
    const r = await cancelInvoicePaymentArtifacts({ paymentLinkId: 'pl', paymentLinkStatus: 'created' })
    expect(inst.paymentLink.cancel).toHaveBeenCalledWith('pl')
    expect(r.paymentLink).toBe('cancelled')
  })

  it('treats a "cannot be cancelled" gateway error as skipped', async () => {
    const inst = withInstance({ paymentLink: { cancel: vi.fn(async () => { throw { error: { description: 'Link cannot be cancelled' } } }) } })
    const r = await cancelInvoicePaymentArtifacts({ paymentLinkId: 'pl' })
    expect(r.paymentLink).toBe('skipped')
    expect(inst.paymentLink.cancel).toHaveBeenCalled()
  })

  it('reports error on an unexpected link cancel failure', async () => {
    withInstance({ paymentLink: { cancel: vi.fn(async () => { throw new Error('500 server') }) } })
    const r = await cancelInvoicePaymentArtifacts({ paymentLinkId: 'pl' })
    expect(r.paymentLink).toBe('error')
  })

  it('closes a QR', async () => {
    const inst = withInstance()
    const r = await cancelInvoicePaymentArtifacts({ qrId: 'qr' })
    expect(inst.qrCode.close).toHaveBeenCalledWith('qr')
    expect(r.qr).toBe('closed')
  })

  it('treats "already closed" as skipped and other errors as error', async () => {
    withInstance({ qrCode: { close: vi.fn(async () => { throw { message: 'QR already closed' } }) } })
    expect((await cancelInvoicePaymentArtifacts({ qrId: 'qr' })).qr).toBe('skipped')
    withInstance({ qrCode: { close: vi.fn(async () => { throw new Error('boom') }) } })
    expect((await cancelInvoicePaymentArtifacts({ qrId: 'qr' })).qr).toBe('error')
  })
})
