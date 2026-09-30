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

// Control the razorpay feature flag directly. isRazorpayEnabled() now reads
// from getFeatureFlags() (site-controls) rather than the raw ENABLE_RAZORPAY env.
const mockGetFeatureFlags = vi.fn()
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: mockGetFeatureFlags,
}))

beforeEach(() => {
  vi.resetModules()
  // Clear relevant env vars before each test so tests are independent
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  delete process.env.ENABLE_RAZORPAY
  mockGetFeatureFlags.mockReset()
})

describe('razorpay.ts module-level guard', () => {
  // The guard lives inside getRazorpayInstance(), not at module-load time.
  // The module always loads successfully; the error is thrown on first call.

  it('throws when RAZORPAY_KEY_ID is missing', async () => {
    process.env.RAZORPAY_KEY_SECRET = 'secret'
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
    expect(() => getRazorpayInstance()).toThrow('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  })

  it('throws when RAZORPAY_KEY_SECRET is missing', async () => {
    process.env.RAZORPAY_KEY_ID = 'key'
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
    expect(() => getRazorpayInstance()).toThrow('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  })

  it('throws when both env vars are missing', async () => {
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
    expect(() => getRazorpayInstance()).toThrow('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  })

  it('loads without error when both env vars are present', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret'
    await expect(import('@/lib/payments/razorpay')).resolves.toBeDefined()
  })
})

describe('getRazorpayInstance()', () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret'
  })

  it('returns a Razorpay instance', async () => {
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
    const instance = getRazorpayInstance()
    expect(instance).toBeDefined()
  })

  it('constructs instance with the correct key_id and key_secret', async () => {
    const { default: Razorpay } = await import('razorpay')
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
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

  it('returns false when razorpay feature flag is disabled', async () => {
    mockGetFeatureFlags.mockResolvedValue({ razorpayEnabled: false })
    const { isRazorpayEnabled } = await import('@/lib/payments/razorpay')
    expect(await isRazorpayEnabled()).toBe(false)
  })

  it('returns true when razorpay feature flag is enabled', async () => {
    mockGetFeatureFlags.mockResolvedValue({ razorpayEnabled: true })
    const { isRazorpayEnabled } = await import('@/lib/payments/razorpay')
    expect(await isRazorpayEnabled()).toBe(true)
  })

  it('delegates the enabled decision to getFeatureFlags', async () => {
    mockGetFeatureFlags.mockResolvedValue({ razorpayEnabled: true })
    const { isRazorpayEnabled } = await import('@/lib/payments/razorpay')
    await isRazorpayEnabled()
    expect(mockGetFeatureFlags).toHaveBeenCalledTimes(1)
  })
})
