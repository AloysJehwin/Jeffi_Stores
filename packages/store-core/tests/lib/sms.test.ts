import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// twilio default export is a factory: twilio(sid, token) => client (campaign SMS still sends inline)
const messagesCreate = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('@/lib/shared/message-log', () => ({
  logMessage: vi.fn(),
}))

// Transactional wrappers dispatch a library slug through messaging-service.
const sendByTemplate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate }))

vi.mock('@/lib/catalog/brand', () => ({
  storeBaseUrlAsync: vi.fn(async () => 'https://acme.jeffistores.in'),
  storeSignature: vi.fn(async () => ({ name: 'Acme' })),
}))

// Order links resolve to the exact order page on the customer's store.
vi.mock('@/lib/shared/customer-links', () => ({
  orderUrlByNumber: vi.fn(async (n: string) => (n === 'UNKNOWN' ? null : `https://acme.jeffistores.in/account/orders/id-${n}`)),
}))

import { logMessage } from '@/lib/shared/message-log'

const mockLog = vi.mocked(logMessage)
const sent = (i = 0) => sendByTemplate.mock.calls[i][0]

// Import fresh copies of the module under a given env so the module-level
// const guards (ACCOUNT_SID / AUTH_TOKEN / DISABLED) pick up the values.
async function loadSms(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  const base: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'tok_test',
    TWILIO_FROM_NUMBER: '+18722179910',
    SMS_DISABLED: undefined,
  }
  const merged = { ...base, ...env }
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
  return import('@/lib/shared/sms')
}

beforeEach(() => {
  vi.clearAllMocks()
  messagesCreate.mockResolvedValue({ sid: 'SM1' })
  sendByTemplate.mockResolvedValue({ id: 'm1', status: 'sent' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sms senders (happy path)', () => {
  it('sendOrderConfirmedSMS returns true and normalizes to +91', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'ORD1', total: 1500 })
    expect(ok).toBe(true)
    expect(sendByTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        slug: 'order/confirmed',
        to: '+919876543210',
        variables: expect.objectContaining({ store_name: 'Acme', order_number: 'ORD1' }),
      })
    )
  })

  it('sendOrderShippedSMS returns true with tracking + courier vars', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderShippedSMS({
      phone: '9876543210',
      orderNumber: 'ORD2',
      trackingId: 'TRK',
      courier: 'Delhivery',
    })
    expect(ok).toBe(true)
    expect(sent().slug).toBe('order/shipped')
    expect(sent().variables).toMatchObject({ awb: 'TRK', courier: 'Delhivery' })
  })

  it('sendOrderDeliveredSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: '9876543210', orderNumber: 'ORD3' })).toBe(true)
    expect(sent().slug).toBe('order/delivered')
  })

  it('sendOrderCancelledSMS returns true and includes reason', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderCancelledSMS({ phone: '9876543210', orderNumber: 'ORD4', reason: 'OOS' })
    expect(ok).toBe(true)
    expect(sent().slug).toBe('order/cancelled')
    expect(sent().variables.reason).toBe('OOS')
  })

  it('links every order SMS to that exact order page, with the scheme so it is tappable', async () => {
    const sms = await loadSms()
    await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'A1', total: 100 })
    await sms.sendOrderShippedSMS({ phone: '9876543210', orderNumber: 'A2' })
    await sms.sendOrderDeliveredSMS({ phone: '9876543210', orderNumber: 'A3' })
    await sms.sendPaymentFailedSMS({ phone: '9876543210', orderNumber: 'A4' })
    const links = sendByTemplate.mock.calls.map(c => String(c[0].variables.short_url))
    expect(links).toHaveLength(4)
    links.forEach((link, i) => expect(link).toBe(`https://acme.jeffistores.in/account/orders/id-A${i + 1}`))
  })

  it('falls back to the order list when the order number is unknown', async () => {
    const sms = await loadSms()
    await sms.sendPaymentFailedSMS({ phone: '9876543210', orderNumber: 'UNKNOWN' })
    expect(sent().variables.short_url).toBe('https://acme.jeffistores.in/account/orders')
  })

  it('sendOTPSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOTPSMS({ phone: '9876543210', otp: '123456' })).toBe(true)
    expect(sent().slug).toBe('otp/verify')
    expect(sent().variables.code).toBe('123456')
  })

  it('sendPaymentFailedSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendPaymentFailedSMS({ phone: '9876543210', orderNumber: 'ORD5' })).toBe(true)
    expect(sent().slug).toBe('order/payment-failed')
  })

  it('sendOutForDeliverySMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOutForDeliverySMS({ phone: '9876543210', orderNumber: 'ORD6' })).toBe(true)
    expect(sent().slug).toBe('order/out-for-delivery')
  })

  it('returns false when messaging-service reports a failed send', async () => {
    sendByTemplate.mockResolvedValueOnce({ status: 'failed', error: 'down' })
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: '9876543210', orderNumber: 'ORD7' })).toBe(false)
  })
})

describe('normalizePhone edge cases (via senders)', () => {
  it('accepts 12-digit 91-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '919876543210', orderNumber: 'O' })
    expect(sent().to).toBe('+919876543210')
  })

  it('accepts 13-digit 091-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '0919876543210', orderNumber: 'O' })
    expect(sent().to).toBe('+919876543210')
  })

  it('normalizes an already +91-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '+919876543210', orderNumber: 'O' })
    expect(sent().to).toBe('+919876543210')
  })

  it('returns false for an invalid number and never sends', async () => {
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: '12345', orderNumber: 'O' })).toBe(false)
    expect(sendByTemplate).not.toHaveBeenCalled()
  })

  it('returns false for a null phone', async () => {
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: null, orderNumber: 'O' })).toBe(false)
  })
})

describe('guards', () => {
  it('short-circuits to false when SMS_DISABLED=true', async () => {
    const sms = await loadSms({ SMS_DISABLED: 'true' })
    expect(await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'O', total: 1 })).toBe(false)
    expect(sendByTemplate).not.toHaveBeenCalled()
    expect(await sms.sendCampaignSMS({ phone: '9876543210', body: 'Sale!', kind: 'promo_offer' })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('campaign SMS returns false when creds are missing (provider not configured)', async () => {
    const sms = await loadSms({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined })
    expect(await sms.sendCampaignSMS({ phone: '9876543210', body: 'Sale!', kind: 'promo_offer' })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('campaign SMS sends inline and logs the send', async () => {
    const sms = await loadSms()
    const ok = await sms.sendCampaignSMS({ phone: '9876543210', body: 'Sale!', kind: 'promo_offer', userId: 'u1' })
    expect(ok).toBe(true)
    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210', from: '+18722179910', body: 'Sale!' }))
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', kind: 'promo_offer', providerSid: 'SM1', entityType: 'campaign', entityId: 'promo_offer' })
    )
  })

  it('campaign SMS returns false and logs failure when twilio create rejects', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('twilio down'))
    const sms = await loadSms()
    const ok = await sms.sendCampaignSMS({ phone: '9876543210', body: 'Sale!', kind: 'promo_offer' })
    expect(ok).toBe(false)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'twilio down' }))
  })
})
