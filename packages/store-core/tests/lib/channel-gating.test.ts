import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Twilio factory → client with a messages.create spy.
const messagesCreate = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))
vi.mock('@/lib/shared/message-log', () => ({ logMessage: vi.fn() }))
// Template wrappers dispatch a library slug through messaging-service; free-text WA stays inline.
const sendByTemplate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/shared/send-by-template', () => ({ sendByTemplate }))
vi.mock('@/lib/shared/customer-links', () => ({ orderUrlByNumber: vi.fn(async () => null) }))
vi.mock('@/lib/catalog/brand', () => ({
  storeBaseUrlAsync: vi.fn(async () => 'https://acme.jeffistores.in'),
  storeSignature: vi.fn(async () => ({ name: 'Acme' })),
}))

// The gate under test: both channels resolve enabled-ness from getFeatureFlags().
const getFeatureFlags = vi.hoisted(() => vi.fn())
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags }))

async function loadSms() {
  vi.resetModules()
  for (const [k, v] of Object.entries({
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'tok_test',
    TWILIO_FROM_NUMBER: '+18722179910',
  })) {
    vi.stubEnv(k, v)
  }
  return import('@/lib/shared/sms')
}
async function loadWhatsApp() {
  vi.resetModules()
  for (const [k, v] of Object.entries({
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'tok_test',
    TWILIO_WHATSAPP_FROM: '+18722179910',
  })) {
    vi.stubEnv(k, v)
  }
  return import('@/lib/shared/whatsapp')
}

beforeEach(() => {
  vi.clearAllMocks()
  messagesCreate.mockResolvedValue({ sid: 'SM1' })
  sendByTemplate.mockResolvedValue({ id: 'm1', status: 'sent' })
})
afterEach(() => vi.unstubAllEnvs())

describe('Site Controls gating — SMS', () => {
  it('does NOT send when smsEnabled is false, even with valid number + creds', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: false, whatsappEnabled: true })
    const sms = await loadSms()
    const ok = await sms.sendOTPSMS({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(false)
    expect(sendByTemplate).not.toHaveBeenCalled()
  })

  it('sends when smsEnabled is true', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: true })
    const sms = await loadSms()
    const ok = await sms.sendOTPSMS({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(true)
    expect(sendByTemplate).toHaveBeenCalledOnce()
  })

  it('gates sendCampaignSMS on smsEnabled too', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: false, whatsappEnabled: true })
    const sms = await loadSms()
    const ok = await sms.sendCampaignSMS({ phone: '9876543210', body: 'Sale!', kind: 'promo_offer' })
    expect(ok).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('falls back to the env default when the flags resolver throws', async () => {
    getFeatureFlags.mockRejectedValue(new Error('resolver down'))
    vi.stubEnv('SMS_DISABLED', '') // env default → enabled
    const sms = await loadSms()
    const ok = await sms.sendOTPSMS({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(true)
  })
})

describe('Site Controls gating — WhatsApp', () => {
  it('does NOT send a template when whatsappEnabled is false', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: false })
    const wa = await loadWhatsApp()
    const ok = await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(false)
    expect(sendByTemplate).not.toHaveBeenCalled()
  })

  it('does NOT send free-text when whatsappEnabled is false', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: false })
    const wa = await loadWhatsApp()
    const ok = await wa.sendFreeTextWhatsApp({ phone: '9876543210', body: 'hi' })
    expect(ok).toBe(false)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('sends a template when whatsappEnabled is true', async () => {
    getFeatureFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: true })
    const wa = await loadWhatsApp()
    const ok = await wa.sendOTPWhatsApp({ phone: '9876543210', otp: '123456' })
    expect(ok).toBe(true)
    expect(sendByTemplate).toHaveBeenCalledOnce()
  })
})
