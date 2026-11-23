import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { factory, create, fetchFn } = vi.hoisted(() => {
  // twilio.ts reads these module-level at import, so set them before the import below.
  process.env.TWILIO_ACCOUNT_SID = 'ACx'
  process.env.TWILIO_AUTH_TOKEN = 'tok'
  process.env.TWILIO_FROM_NUMBER = '+1222'
  process.env.TWILIO_WHATSAPP_FROM = '+1333'
  const create = vi.fn(async () => ({ sid: 'SM1' }))
  const fetchFn = vi.fn(async () => ({ status: 'delivered', errorCode: 30007, errorMessage: 'blocked' }))
  const messages: any = vi.fn(() => ({ fetch: fetchFn }))
  messages.create = create
  return { create, fetchFn, factory: vi.fn(() => ({ messages })) }
})
vi.mock('twilio', () => ({ default: Object.assign(factory, { validateRequest: vi.fn(() => true) }) }))

import {
  normalizePhone, statusCallbackUrl, callbacksEnabled, priceUsd, twilioConfigured,
  twilioSignatureValid, sendSms, sendWhatsApp, fetchStatus,
} from '../src/providers/twilio'

describe('twilio helpers', () => {
  it('normalizePhone adds +91 for 10-digit, + for 12-digit 91…, keeps a leading +', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210')
    expect(normalizePhone('919876543210')).toBe('+919876543210')
    expect(normalizePhone('+14155550123')).toBe('+14155550123')
    expect(normalizePhone('12345')).toBe('+12345')
  })

  it('priceUsd takes the absolute value, null for blank/non-numeric', () => {
    expect(priceUsd('-0.05')).toBe(0.05)
    expect(priceUsd(undefined)).toBeNull()
    expect(priceUsd('abc')).toBeNull()
  })
})

describe('statusCallbackUrl / callbacksEnabled', () => {
  afterEach(() => { delete process.env.PUBLIC_BASE_URL })
  it('is undefined without a public https base, set with one', () => {
    delete process.env.PUBLIC_BASE_URL
    expect(statusCallbackUrl('m1')).toBeUndefined()
    expect(callbacksEnabled()).toBe(false)
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000'
    expect(statusCallbackUrl('m1')).toBeUndefined() // localhost rejected
    process.env.PUBLIC_BASE_URL = 'https://pub.test/'
    expect(statusCallbackUrl('m1')).toBe('https://pub.test/webhooks/twilio/status?m=m1')
    expect(callbacksEnabled()).toBe(true)
  })
})

describe('twilioSignatureValid', () => {
  it('needs a token, a url and a signature, and delegates to validateRequest', async () => {
    process.env.PUBLIC_BASE_URL = 'https://pub.test'
    expect(twilioSignatureValid('sig', 'm1', {}, 'tok')).toBe(true)
    expect(twilioSignatureValid('', 'm1', {}, 'tok')).toBe(false) // no signature
    // No public callback URL → nothing to validate against.
    delete process.env.PUBLIC_BASE_URL
    expect(twilioSignatureValid('sig', 'm1', {}, 'tok')).toBe(false)
  })
})

describe('twilio send', () => {
  beforeEach(() => { factory.mockClear(); create.mockClear(); fetchFn.mockClear() })

  it('twilioConfigured reflects the env credentials', async () => {
    expect(twilioConfigured()).toBe(true)
  })

  it('sends a WhatsApp body and a content template', async () => {
    await sendWhatsApp({ to: '9876543210', body: 'hi', messageId: 'm1' })
    expect(create.mock.calls[0][0]).toMatchObject({ from: 'whatsapp:+1333', to: 'whatsapp:+919876543210', body: 'hi' })
    await sendWhatsApp({ to: '9876543210', contentSid: 'HX1', variables: { 1: 'A' }, messageId: 'm2' })
    expect(create.mock.calls[1][0]).toMatchObject({ contentSid: 'HX1', contentVariables: JSON.stringify({ 1: 'A' }) })
  })

  it('throws when the override account has no usable credentials', async () => {
    // An override with an account_sid but neither key pair nor token builds no client.
    await expect(sendWhatsApp({ to: '9876543210', body: 'x', messageId: 'm' }, { sender: '+1', config: { account_sid: 'ACt' } }))
      .rejects.toThrow(/not configured/)
    await expect(sendSms({ to: '9876543210', body: 'x', messageId: 'm' }, { sender: '', config: { account_sid: 'ACt', auth_token: 't' } }))
      .rejects.toThrow(/not configured/)
  })

  it('fetchStatus maps a Twilio message to our status shape', async () => {
    const s = await fetchStatus('SM1')
    expect(s).toEqual({ status: 'delivered', code: '30007', message: 'blocked' })
  })

  it('fetchStatus throws when the override cannot build a client', async () => {
    await expect(fetchStatus('SM1', { sender: '+1', config: { account_sid: 'ACt' } })).rejects.toThrow(/not configured/)
  })
})
