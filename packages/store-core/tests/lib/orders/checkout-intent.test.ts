import { describe, it, expect, vi } from 'vitest'

// The module reads CHECKOUT_INTENT_SECRET || JWT_SECRET at import; the root config injects JWT_SECRET,
// so that is the key the module captured. Reuse it for inline-signed tokens.
import { signIntent, verifyIntent, type CheckoutIntentPayload } from '@/lib/orders/checkout-intent'

const SECRET = () => new TextEncoder().encode(process.env.CHECKOUT_INTENT_SECRET || process.env.JWT_SECRET!)

describe('module secret', () => {
  it('throws at import when no secret is set', async () => {
    vi.resetModules()
    const prevJwt = process.env.JWT_SECRET
    const prevIntent = process.env.CHECKOUT_INTENT_SECRET
    delete process.env.JWT_SECRET
    delete process.env.CHECKOUT_INTENT_SECRET
    await expect(import('@/lib/orders/checkout-intent')).rejects.toThrow('CHECKOUT_INTENT_SECRET / JWT_SECRET not set')
    process.env.JWT_SECRET = prevJwt
    if (prevIntent !== undefined) process.env.CHECKOUT_INTENT_SECRET = prevIntent
    vi.resetModules()
  })
})

describe('checkout intent round-trip', () => {
  it('signs and verifies a cart intent', async () => {
    const token = await signIntent({ mode: 'cart', userId: 'u-1' })
    expect(typeof token).toBe('string')
    const r = await verifyIntent(token)
    expect(r).toEqual({ mode: 'cart', userId: 'u-1' })
  })

  it('signs and verifies a buy-now intent, coercing fields', async () => {
    const payload: CheckoutIntentPayload = {
      mode: 'buyNow',
      productId: 'p-1',
      variantId: 'v-1',
      subVariantId: 's-1',
      qty: 3,
      buyMode: 'unit',
      buyUnit: 'pack',
    }
    const r = await verifyIntent(await signIntent(payload))
    expect(r).toEqual(payload)
  })

  it('defaults null/unit fields on a buy-now with nulls', async () => {
    const token = await signIntent({
      mode: 'buyNow',
      productId: 'p-2',
      variantId: null,
      subVariantId: null,
      qty: 1,
      buyMode: '' as any, // falls back to 'unit'
      buyUnit: null,
    })
    const r = await verifyIntent(token)
    expect(r).toEqual({ mode: 'buyNow', productId: 'p-2', variantId: null, subVariantId: null, qty: 1, buyMode: 'unit', buyUnit: null })
  })

  it('returns null for a garbage token', async () => {
    expect(await verifyIntent('not-a-jwt')).toBeNull()
  })

  it('returns null for a cart token with a non-string userId', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const bad = await new SignJWT({ mode: 'cart', userId: 123 }).setProtectedHeader({ alg: 'HS256' }).sign(secret)
    expect(await verifyIntent(bad)).toBeNull()
  })

  it('returns null for a buy-now token with a non-string productId', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const bad = await new SignJWT({ mode: 'buyNow', productId: 7 }).setProtectedHeader({ alg: 'HS256' }).sign(secret)
    expect(await verifyIntent(bad)).toBeNull()
  })

  it('returns null for a token signed with another key', async () => {
    const { SignJWT } = await import('jose')
    const other = new TextEncoder().encode('a-totally-different-secret-value-abc')
    const forged = await new SignJWT({ mode: 'cart', userId: 'u' }).setProtectedHeader({ alg: 'HS256' }).sign(other)
    expect(await verifyIntent(forged)).toBeNull()
  })
})
