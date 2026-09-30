import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isPaymentBypassed } from '@/lib/ecom-payment-bypass'

const ORIGINAL = process.env.ECOM_PAYMENT_BYPASS_EMAILS

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ECOM_PAYMENT_BYPASS_EMAILS
  else process.env.ECOM_PAYMENT_BYPASS_EMAILS = ORIGINAL
})

describe('payment bypass allow-list (TEMPORARY)', () => {
  beforeEach(() => {
    delete process.env.ECOM_PAYMENT_BYPASS_EMAILS
  })

  it('bypasses only the default internal address', () => {
    expect(isPaymentBypassed('aloysjehwin@gmail.com')).toBe(true)
    expect(isPaymentBypassed('someone@else.com')).toBe(false)
  })

  it('is case and whitespace insensitive', () => {
    expect(isPaymentBypassed('  AloysJehwin@Gmail.com ')).toBe(true)
  })

  it('never bypasses an empty or missing email', () => {
    expect(isPaymentBypassed(null)).toBe(false)
    expect(isPaymentBypassed(undefined)).toBe(false)
    expect(isPaymentBypassed('')).toBe(false)
    expect(isPaymentBypassed('   ')).toBe(false)
  })

  it('honours an env override, including a comma-separated list', () => {
    process.env.ECOM_PAYMENT_BYPASS_EMAILS = 'a@x.com, B@Y.com'
    expect(isPaymentBypassed('a@x.com')).toBe(true)
    expect(isPaymentBypassed('b@y.com')).toBe(true)
    // the default address no longer applies once overridden
    expect(isPaymentBypassed('aloysjehwin@gmail.com')).toBe(false)
  })

  it('can be disabled entirely by setting the env var empty', () => {
    process.env.ECOM_PAYMENT_BYPASS_EMAILS = ''
    expect(isPaymentBypassed('aloysjehwin@gmail.com')).toBe(false)
  })
})
