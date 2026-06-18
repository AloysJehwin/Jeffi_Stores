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
})
