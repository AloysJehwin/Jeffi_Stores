import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// twilio default export is a factory: twilio(sid, token) => client
const messagesCreate = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('@/lib/shared/message-log', () => ({
  logMessage: vi.fn(),
}))

import { logMessage } from '@/lib/shared/message-log'

const mockLog = vi.mocked(logMessage)

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
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sms senders (happy path)', () => {
  it('sendOrderConfirmedSMS returns true and normalizes to +91', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'ORD1', total: 1500 })
    expect(ok).toBe(true)
    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210', from: '+18722179910' }))
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', kind: 'order_confirmed', providerSid: 'SM1' })
    )
  })

  it('sendOrderShippedSMS returns true with tracking + courier in body', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderShippedSMS({
      phone: '9876543210',
      orderNumber: 'ORD2',
      trackingId: 'TRK',
      courier: 'Delhivery',
    })
    expect(ok).toBe(true)
    const body = messagesCreate.mock.calls[0][0].body
    expect(body).toContain('TRK')
    expect(body).toContain('Delhivery')
  })

  it('sendOrderDeliveredSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: '9876543210', orderNumber: 'ORD3' })).toBe(true)
  })

  it('sendOrderCancelledSMS returns true and includes reason', async () => {
    const sms = await loadSms()
    const ok = await sms.sendOrderCancelledSMS({ phone: '9876543210', orderNumber: 'ORD4', reason: 'OOS' })
    expect(ok).toBe(true)
    expect(messagesCreate.mock.calls[0][0].body).toContain('OOS')
  })

  it('sendOTPSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOTPSMS({ phone: '9876543210', otp: '123456' })).toBe(true)
  })

  it('sendPaymentFailedSMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendPaymentFailedSMS({ phone: '9876543210', orderNumber: 'ORD5' })).toBe(true)
  })

  it('sendOutForDeliverySMS returns true', async () => {
    const sms = await loadSms()
    expect(await sms.sendOutForDeliverySMS({ phone: '9876543210', orderNumber: 'ORD6' })).toBe(true)
  })
})

describe('normalizePhone edge cases (via senders)', () => {
  it('accepts 12-digit 91-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '919876543210', orderNumber: 'O' })
    expect(messagesCreate.mock.calls[0][0].to).toBe('+919876543210')
  })

  it('accepts 13-digit 091-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '0919876543210', orderNumber: 'O' })
    expect(messagesCreate.mock.calls[0][0].to).toBe('+919876543210')
  })

  it('normalizes an already +91-prefixed number', async () => {
    const sms = await loadSms()
    await sms.sendOrderDeliveredSMS({ phone: '+919876543210', orderNumber: 'O' })
    expect(messagesCreate.mock.calls[0][0].to).toBe('+919876543210')
  })

  it('returns false for an invalid number and never calls twilio', async () => {
    const sms = await loadSms()
    expect(await sms.sendOrderDeliveredSMS({ phone: '12345', orderNumber: 'O' })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
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
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns false when creds are missing (getClient null)', async () => {
    const sms = await loadSms({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined })
    expect(await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'O', total: 1 })).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns false and logs failure when twilio create rejects', async () => {
    messagesCreate.mockRejectedValueOnce(new Error('twilio down'))
    const sms = await loadSms()
    const ok = await sms.sendOrderConfirmedSMS({ phone: '9876543210', orderNumber: 'O', total: 1 })
    expect(ok).toBe(false)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'twilio down' }))
  })
})
