import { describe, it, expect } from 'vitest'

import { signDraftToken, verifyDraftToken, hashCartItems, type DraftPayload, type DraftCartItem } from '@/lib/orders/order-draft'

// The root vitest config injects JWT_SECRET; the module captured it at import. Reuse the same value.
const SECRET = () => new TextEncoder().encode(process.env.JWT_SECRET!)

const base: DraftPayload = {
  userId: 'u-1',
  mode: 'cart',
  addressId: 'a-1',
  couponId: 'c-1',
  shippingAmount: 50,
  codFeeAmount: 20,
  cartHash: 'h1',
  cartItemIds: ['ci-1', 'ci-2'],
  buyNowItem: null,
  notes: 'leave at door',
  paymentMethod: 'razorpay',
  businessDiscountAmount: 10,
}

describe('draft token round-trip', () => {
  it('signs and verifies a full cart draft', async () => {
    const r = await verifyDraftToken(await signDraftToken(base))
    expect(r).toEqual(base)
  })

  it('fills defaults when optional fields are absent', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const token = await new SignJWT({ userId: 'u-2', mode: 'buyNow', addressId: 'a-2' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret)
    const r = await verifyDraftToken(token)
    expect(r).toEqual({
      userId: 'u-2',
      mode: 'buyNow',
      addressId: 'a-2',
      couponId: null,
      shippingAmount: 0,
      codFeeAmount: 0,
      cartHash: null,
      cartItemIds: null,
      buyNowItem: null,
      notes: null,
      paymentMethod: 'razorpay',
      businessDiscountAmount: 0,
    })
  })

  it('rejects a payload with a bad mode', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const token = await new SignJWT({ userId: 'u', mode: 'weird', addressId: 'a' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret)
    expect(await verifyDraftToken(token)).toBeNull()
  })

  it('rejects a payload missing userId/addressId', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const token = await new SignJWT({ mode: 'cart' }).setProtectedHeader({ alg: 'HS256' }).sign(secret)
    expect(await verifyDraftToken(token)).toBeNull()
  })

  it('returns null for garbage and for a wrong key', async () => {
    expect(await verifyDraftToken('xxx')).toBeNull()
    const { SignJWT } = await import('jose')
    const other = new TextEncoder().encode('some-other-secret-value-for-draft-99')
    const forged = await new SignJWT({ userId: 'u', mode: 'cart', addressId: 'a' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(other)
    expect(await verifyDraftToken(forged)).toBeNull()
  })

  it('rejects an expired token but accepts it with ignoreExpiry', async () => {
    const { SignJWT } = await import('jose')
    const secret = SECRET()
    const expired = await new SignJWT({ userId: 'u', mode: 'cart', addressId: 'a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 5000)
      .sign(secret)
    expect(await verifyDraftToken(expired)).toBeNull()
    const r = await verifyDraftToken(expired, { ignoreExpiry: true })
    expect(r?.userId).toBe('u')
  })
})

describe('hashCartItems', () => {
  const item = (over: Partial<DraftCartItem> = {}): DraftCartItem => ({
    productId: 'p1',
    variantId: null,
    subVariantId: null,
    quantity: 1,
    buyMode: 'unit',
    buyUnit: null,
    priceAtAddition: 100,
    ...over,
  })

  it('is stable regardless of input order', () => {
    const a = item({ productId: 'p1' })
    const b = item({ productId: 'p2' })
    expect(hashCartItems([a, b])).toBe(hashCartItems([b, a]))
  })

  it('changes when quantity or price changes', () => {
    expect(hashCartItems([item({ quantity: 1 })])).not.toBe(hashCartItems([item({ quantity: 2 })]))
    expect(hashCartItems([item({ priceAtAddition: 100 })])).not.toBe(hashCartItems([item({ priceAtAddition: 101 })]))
  })

  it('is a base-36 string', () => {
    expect(hashCartItems([item()])).toMatch(/^[0-9a-z]+$/)
  })

  it('distinguishes different variants', () => {
    expect(hashCartItems([item({ variantId: 'v1' })])).not.toBe(hashCartItems([item({ variantId: 'v2' })]))
  })
})
