/**
 * Tests for src/lib/razorpay.ts
 *
 * razorpay.ts throws at module-load time when env vars are missing.
 * We therefore use vi.resetModules() + dynamic import in each test so
 * we can control the environment before the module is evaluated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Provide a stable mock for the razorpay package so we never hit the real SDK
vi.mock('razorpay', () => {
  const Razorpay = vi.fn().mockImplementation(function (opts: any) {
    return { _opts: opts }
  })
  return { default: Razorpay }
})

beforeEach(() => {
  vi.resetModules()
  // Clear relevant env vars before each test so tests are independent
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  delete process.env.ENABLE_RAZORPAY
})

describe('razorpay.ts module-level guard', () => {
  it('throws when RAZORPAY_KEY_ID is missing', async () => {
    process.env.RAZORPAY_KEY_SECRET = 'secret'
    await expect(import('@/lib/razorpay')).rejects.toThrow(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set'
    )
  })

  it('throws when RAZORPAY_KEY_SECRET is missing', async () => {
    process.env.RAZORPAY_KEY_ID = 'key'
    await expect(import('@/lib/razorpay')).rejects.toThrow(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set'
    )
  })

  it('throws when both env vars are missing', async () => {
    await expect(import('@/lib/razorpay')).rejects.toThrow(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set'
    )
  })

  it('loads without error when both env vars are present', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret'
    await expect(import('@/lib/razorpay')).resolves.toBeDefined()
  })
})

describe('getRazorpayInstance()', () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret'
  })

  it('returns a Razorpay instance', async () => {
    const { getRazorpayInstance } = await import('@/lib/razorpay')
    const instance = getRazorpayInstance()
    expect(instance).toBeDefined()
  })

  it('constructs instance with the correct key_id and key_secret', async () => {
    const { default: Razorpay } = await import('razorpay')
    const { getRazorpayInstance } = await import('@/lib/razorpay')
    getRazorpayInstance()
    expect(Razorpay).toHaveBeenCalledWith({
      key_id: 'rzp_test_key',
      key_secret: 'rzp_secret',
    })
  })
})

describe('isRazorpayEnabled()', () => {
  beforeEach(() => {
    // Provide valid credentials so the module loads
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret'
  })

  it('returns false when ENABLE_RAZORPAY is not set', async () => {
    const { isRazorpayEnabled } = await import('@/lib/razorpay')
    expect(isRazorpayEnabled()).toBe(false)
  })

  it('returns false when ENABLE_RAZORPAY is set to a non-true value', async () => {
    process.env.ENABLE_RAZORPAY = 'false'
    const { isRazorpayEnabled } = await import('@/lib/razorpay')
    expect(isRazorpayEnabled()).toBe(false)
  })

  it('returns false when ENABLE_RAZORPAY is "1" (not the literal string "true")', async () => {
    process.env.ENABLE_RAZORPAY = '1'
    const { isRazorpayEnabled } = await import('@/lib/razorpay')
    expect(isRazorpayEnabled()).toBe(false)
  })

  it('returns true when ENABLE_RAZORPAY is exactly "true"', async () => {
    process.env.ENABLE_RAZORPAY = 'true'
    const { isRazorpayEnabled } = await import('@/lib/razorpay')
    expect(isRazorpayEnabled()).toBe(true)
  })
})
