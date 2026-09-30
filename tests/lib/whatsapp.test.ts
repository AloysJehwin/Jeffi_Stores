import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const messagesCreate = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('@/lib/message-log', () => ({
  logMessage: vi.fn(),
}))

import { logMessage } from '@/lib/message-log'

const mockLog = vi.mocked(logMessage)

async function loadWa(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  const base: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'tok_test',
    TWILIO_WHATSAPP_FROM: '+18722179910',
    WHATSAPP_DISABLED: undefined,
    TWILIO_WA_PAYMENT_FAILED_SID: undefined,
  }
  const merged = { ...base, ...env }
  for (const [k, v] of Object.entries(merged)) {
    vi.stubEnv(k, v === undefined ? '' : v)
  }
  return import('@/lib/whatsapp')
}

beforeEach(() => {
  vi.clearAllMocks()
  messagesCreate.mockResolvedValue({ sid: 'WA1' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sendTemplate path', () => {
  it('sendOTPWhatsApp sends contentSid + contentVariables with whatsapp: prefix', async () => {
    const wa = await loadWa()
    const ok = await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(true)
    const arg = messagesCreate.mock.calls[0][0]
    expect(arg.from).toBe('whatsapp:+18722179910')
    expect(arg.to).toBe('whatsapp:+919876543210')
    expect(arg.contentSid).toBeTruthy()
    expect(JSON.parse(arg.contentVariables)).toEqual({ '1': '123456' })
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp', status: 'sent', providerSid: 'WA1' })
    )
  })

  it('sendOrderConfirmedWhatsApp passes order + amount vars', async () => {
    const wa = await loadWa()
    const ok = await wa.sendOrderConfirmedWhatsApp({ phone: '9876543210', orderNumber: 'ORD1', total: 999 })
    expect(ok).toBe(true)
    const vars = JSON.parse(messagesCreate.mock.calls[0][0].contentVariables)
    expect(vars['1']).toBe('ORD1')
  })

  it('sendOrderShippedWhatsApp fills courier + tracking defaults', async () => {
    const wa = await loadWa()
    await wa.sendOrderShippedWhatsApp({ phone: '9876543210', orderNumber: 'ORD2' })
    const vars = JSON.parse(messagesCreate.mock.calls[0][0].contentVariables)
    expect(vars['1']).toBe('ORD2')
    expect(vars['2']).toBe('courier')
    expect(vars['3']).toBe('jeffistores.in/orders')
  })

  it('sendOrderDeliveredWhatsApp / Cancelled / OutForDelivery return true', async () => {
    const wa = await loadWa()
    expect(await wa.sendOrderDeliveredWhatsApp({ phone: '9876543210', orderNumber: 'A' })).toBe(true)
    expect(await wa.sendOrderCancelledWhatsApp({ phone: '9876543210', orderNumber: 'B' })).toBe(true)
    expect(await wa.sendOutForDeliveryWhatsApp({ phone: '9876543210', orderNumber: 'C' })).toBe(true)
  })

  it('marketing + support senders return true', async () => {
    const wa = await loadWa()
    expect(await wa.sendPromoOfferWhatsApp({ phone: '9876543210', headline: 'Sale', code: 'X', discount: '10%' })).toBe(
      true
    )
    expect(await wa.sendNewArrivalsWhatsApp({ phone: '9876543210', items: 'bolts' })).toBe(true)
    expect(await wa.sendAbandonedCartWhatsApp({ phone: '9876543210', items: 'nuts' })).toBe(true)
    expect(await wa.sendBackInStockWhatsApp({ phone: '9876543210', product: 'washer' })).toBe(true)
    expect(await wa.sendFestiveGreetingWhatsApp({ phone: '9876543210', festival: 'Diwali', discount: '20%' })).toBe(
      true
    )
    expect(await wa.sendReorderReminderWhatsApp({ phone: '9876543210', product: 'screw' })).toBe(true)
    expect(await wa.sendSupportAckWhatsApp({ phone: '9876543210' })).toBe(true)
    expect(await wa.sendSupportTicketCreatedWhatsApp({ phone: '9876543210', ticket: 'T1' })).toBe(true)
    expect(await wa.sendSupportReplyWhatsApp({ phone: '9876543210', message: 'hi' })).toBe(true)
    expect(await wa.sendSupportResolvedWhatsApp({ phone: '9876543210', ticket: 'T1' })).toBe(true)
    expect(await wa.sendReturnInitiatedWhatsApp({ phone: '9876543210', orderNumber: 'O' })).toBe(true)
    expect(await wa.sendRefundProcessedWhatsApp({ phone: '9876543210', amount: '100', orderNumber: 'O' })).toBe(true)
    expect(await wa.sendFeedbackRequestWhatsApp({ phone: '9876543210', orderNumber: 'O', url: 'u' })).toBe(true)
  })

  it('sendPaymentFailedWhatsApp returns false when no template configured', async () => {
    const wa = await loadWa()
    expect(await wa.sendPaymentFailedWhatsApp({ phone: '9876543210', orderNumber: 'O' })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('sendPaymentFailedWhatsApp sends when template SID configured', async () => {
    const wa = await loadWa({ TWILIO_WA_PAYMENT_FAILED_SID: 'HXpay' })
    expect(await wa.sendPaymentFailedWhatsApp({ phone: '9876543210', orderNumber: 'O' })).toBe(true)
    expect(messagesCreate.mock.calls[0][0].contentSid).toBe('HXpay')
  })

  it('logs failure and returns false when create rejects', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('meta reject'))
    const wa = await loadWa()
    expect(await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '1' })).toBe(false)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'meta reject' }))
  })
})

describe('sendFreeTextWhatsApp', () => {
  it('uses body not contentSid', async () => {
    const wa = await loadWa()
    const ok = await wa.sendFreeTextWhatsApp({ phone: '9876543210', body: 'hello there' })
    expect(ok).toBe(true)
    const arg = messagesCreate.mock.calls[0][0]
    expect(arg.body).toBe('hello there')
    expect(arg.contentSid).toBeUndefined()
    expect(arg.to).toBe('whatsapp:+919876543210')
  })

  it('returns false for invalid phone', async () => {
    const wa = await loadWa()
    expect(await wa.sendFreeTextWhatsApp({ phone: 'bad', body: 'x' })).toBe(false)
  })

  it('logs failure when create rejects', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('window closed'))
    const wa = await loadWa()
    expect(await wa.sendFreeTextWhatsApp({ phone: '9876543210', body: 'x', kind: 'support_reply' })).toBe(false)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'window closed' }))
  })
})

describe('sendTemplateByKey', () => {
  it('dispatches each known key and returns true', async () => {
    const wa = await loadWa()
    const cases: Array<[string, Record<string, string>]> = [
      ['promo_offer', { headline: 'h', code: 'c', discount: 'd' }],
      ['new_arrivals', { items: 'i' }],
      ['abandoned_cart', { items: 'i' }],
      ['back_in_stock', { product: 'p' }],
      ['festive_greeting', { festival: 'f', discount: 'd' }],
      ['reorder_reminder', { product: 'p' }],
      ['support_ticket_created', { ticket: 't' }],
      ['support_reply', { message: 'm' }],
      ['support_resolved', { ticket: 't' }],
      ['return_initiated', { orderNumber: 'o' }],
      ['refund_processed', { amount: 'a', orderNumber: 'o' }],
      ['feedback_request', { orderNumber: 'o', url: 'u' }],
    ]
    for (const [key, vars] of cases) {
      expect(await wa.sendTemplateByKey('9876543210', key, vars)).toBe(true)
    }
    expect(messagesCreate).toHaveBeenCalledTimes(cases.length)
  })

  it('returns false for an unknown key', async () => {
    const wa = await loadWa()
    expect(await wa.sendTemplateByKey('9876543210', 'nope', {})).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })
})

describe('WA_TEMPLATE_REGISTRY shape', () => {
  it('every entry has label, category and fields[]', async () => {
    const wa = await loadWa()
    for (const [, entry] of Object.entries(wa.WA_TEMPLATE_REGISTRY)) {
      expect(typeof entry.label).toBe('string')
      expect(['marketing', 'support']).toContain(entry.category)
      expect(Array.isArray(entry.fields)).toBe(true)
    }
  })
})

describe('guards', () => {
  it('short-circuits when WHATSAPP_DISABLED=true', async () => {
    const wa = await loadWa({ WHATSAPP_DISABLED: 'true' })
    expect(await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '1' })).toBe(false)
    expect(await wa.sendFreeTextWhatsApp({ phone: '9876543210', body: 'x' })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns false when creds missing', async () => {
    const wa = await loadWa({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined })
    expect(await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '1' })).toBe(false)
    expect(await wa.sendFreeTextWhatsApp({ phone: '9876543210', body: 'x' })).toBe(false)
  })
})
