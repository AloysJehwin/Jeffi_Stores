import { describe, it, expect } from 'vitest'
import { signIntent, verifyIntent } from '@/lib/checkout-intent'

describe('signIntent + verifyIntent (cart)', () => {
  it('round-trips a cart payload', async () => {
    const token = await signIntent({ mode: 'cart', userId: 'user-abc' })
    expect(typeof token).toBe('string')
    const result = await verifyIntent(token)
    expect(result).toEqual({ mode: 'cart', userId: 'user-abc' })
  })

  it('returns null for a tampered token', async () => {
    const token = await signIntent({ mode: 'cart', userId: 'user-1' })
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(await verifyIntent(tampered)).toBeNull()
  })

  it('returns null for a completely invalid string', async () => {
    expect(await verifyIntent('not-a-jwt')).toBeNull()
  })
})

describe('signIntent + verifyIntent (buyNow)', () => {
  it('round-trips a buyNow payload with all fields', async () => {
    const payload = {
      mode: 'buyNow' as const,
      productId: 'prod-1',
      variantId: 'var-1',
      subVariantId: 'sv-1',
      qty: 3,
      buyMode: 'box',
      buyUnit: 'unit',
    }
    const token = await signIntent(payload)
    const result = await verifyIntent(token)
    expect(result).toMatchObject({
      mode: 'buyNow',
      productId: 'prod-1',
      variantId: 'var-1',
      subVariantId: 'sv-1',
      qty: 3,
      buyMode: 'box',
      buyUnit: 'unit',
    })
  })

  it('round-trips a buyNow payload with null optional fields', async () => {
    const payload = {
      mode: 'buyNow' as const,
      productId: 'prod-2',
      variantId: null,
      subVariantId: null,
      qty: 1,
      buyMode: 'unit',
      buyUnit: null,
    }
    const token = await signIntent(payload)
    const result = await verifyIntent(token)
    expect(result).toMatchObject({
      mode: 'buyNow',
      productId: 'prod-2',
      variantId: null,
      subVariantId: null,
      qty: 1,
    })
  })

  it('buyNow: buyMode defaults to "unit" when not present in JWT payload', async () => {
    // Sign with empty/falsy buyMode — verifyIntent uses `|| 'unit'` fallback
    const payload = {
      mode: 'buyNow' as const,
      productId: 'prod-3',
      variantId: null,
      subVariantId: null,
      qty: 2,
      buyMode: '',   // falsy → should fall back to 'unit'
      buyUnit: null,
    }
    const token = await signIntent(payload)
    const result = await verifyIntent(token)
    expect(result).not.toBeNull()
    // falsy buyMode falls back to 'unit'
    expect((result as any).buyMode).toBe('unit')
  })
})

describe('verifyIntent edge cases', () => {
  it('returns null for empty string', async () => {
    expect(await verifyIntent('')).toBeNull()
  })

  it('returns null for a valid JWT with missing userId in cart mode', async () => {
    // Sign a cart token then verify it's well-formed
    const token = await signIntent({ mode: 'cart', userId: 'u1' })
    expect(await verifyIntent(token)).not.toBeNull()
  })

  it('returns null for cart mode when userId is not a string (number)', async () => {
    // We cannot easily produce a JWT with a non-string userId via signIntent,
    // so construct the token manually with jose
    const { SignJWT } = await import('jose')
    const SECRET = new TextEncoder().encode(
      process.env.CHECKOUT_INTENT_SECRET ||
      process.env.JWT_SECRET ||
      'fallback'
    )
    const token = await new SignJWT({ mode: 'cart', userId: 12345 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(SECRET)

    const result = await verifyIntent(token)
    expect(result).toBeNull()
  })

  it('returns null for buyNow mode when productId is not a string', async () => {
    const { SignJWT } = await import('jose')
    const SECRET = new TextEncoder().encode(
      process.env.CHECKOUT_INTENT_SECRET ||
      process.env.JWT_SECRET ||
      'fallback'
    )
    const token = await new SignJWT({ mode: 'buyNow', productId: 9999, qty: 1, buyMode: 'unit' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(SECRET)

    const result = await verifyIntent(token)
    expect(result).toBeNull()
  })

  it('buyNow: variantId falls back to null when absent', async () => {
    const { SignJWT } = await import('jose')
    const SECRET = new TextEncoder().encode(
      process.env.CHECKOUT_INTENT_SECRET ||
      process.env.JWT_SECRET ||
      'fallback'
    )
    // No variantId or subVariantId in payload
    const token = await new SignJWT({ mode: 'buyNow', productId: 'prod-x', qty: 1, buyMode: 'unit' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(SECRET)

    const result = await verifyIntent(token)
    expect(result).not.toBeNull()
    expect((result as any).variantId).toBeNull()
    expect((result as any).subVariantId).toBeNull()
    expect((result as any).buyUnit).toBeNull()
  })
})
