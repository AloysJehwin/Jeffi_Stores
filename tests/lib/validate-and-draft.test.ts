// JWT_SECRET is injected by vitest.config.ts test.env — no manual stubbing needed.
// The module-level `new TextEncoder().encode(process.env.JWT_SECRET ?? throw)` in
// order-draft.ts will see the value from vitest config before any import runs.

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { zUuid, zEmail, zIndianPin, zPositiveInt, zNonEmpty, zCurrency, zPhone, parseBody } from '@/lib/validate'
import {
  signDraftToken,
  verifyDraftToken,
  hashCartItems,
  type DraftPayload,
  type DraftCartItem,
} from '@/lib/order-draft'

// ─────────────────────────────────────────────────────────────────────────────
// validate.ts — schemas
// ─────────────────────────────────────────────────────────────────────────────

describe('zUuid', () => {
  it('accepts a valid RFC 4122 UUID', () => {
    expect(zUuid.safeParse('550e8400-e29b-41d4-a716-446655440001').success).toBe(true)
  })

  it('rejects a short string', () => {
    expect(zUuid.safeParse('not-a-uuid').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zUuid.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zUuid.safeParse(null).success).toBe(false)
  })

  it('rejects a number', () => {
    expect(zUuid.safeParse(123).success).toBe(false)
  })
})

describe('zEmail', () => {
  it('accepts a valid email', () => {
    expect(zEmail.safeParse('user@example.com').success).toBe(true)
  })

  it('lowercases the email via transform', () => {
    const r = zEmail.safeParse('User@EXAMPLE.COM')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe('user@example.com')
  })

  it('rejects string without @', () => {
    expect(zEmail.safeParse('notanemail').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zEmail.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zEmail.safeParse(null).success).toBe(false)
  })
})

describe('zIndianPin', () => {
  it('accepts exactly 6 digits', () => {
    expect(zIndianPin.safeParse('560001').success).toBe(true)
  })

  it('rejects 5 digits', () => {
    expect(zIndianPin.safeParse('56000').success).toBe(false)
  })

  it('rejects 7 digits', () => {
    expect(zIndianPin.safeParse('5600011').success).toBe(false)
  })

  it('rejects letters', () => {
    expect(zIndianPin.safeParse('56000A').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zIndianPin.safeParse('').success).toBe(false)
  })
})

describe('zPositiveInt', () => {
  it('accepts 1 (boundary)', () => {
    expect(zPositiveInt.safeParse(1).success).toBe(true)
  })

  it('accepts large integer', () => {
    expect(zPositiveInt.safeParse(9999999).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(zPositiveInt.safeParse(0).success).toBe(false)
  })

  it('rejects negative', () => {
    expect(zPositiveInt.safeParse(-5).success).toBe(false)
  })

  it('rejects float', () => {
    expect(zPositiveInt.safeParse(1.5).success).toBe(false)
  })

  it('rejects string', () => {
    expect(zPositiveInt.safeParse('1').success).toBe(false)
  })
})

describe('zNonEmpty', () => {
  it('accepts non-empty string', () => {
    expect(zNonEmpty.safeParse('hello').success).toBe(true)
  })

  it('trims before checking', () => {
    const r = zNonEmpty.safeParse('  hi  ')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe('hi')
  })

  it('rejects empty string', () => {
    expect(zNonEmpty.safeParse('').success).toBe(false)
  })

  it('rejects whitespace-only', () => {
    expect(zNonEmpty.safeParse('   ').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zNonEmpty.safeParse(null).success).toBe(false)
  })
})

describe('zCurrency', () => {
  it('accepts 0 (boundary)', () => {
    expect(zCurrency.safeParse(0).success).toBe(true)
  })

  it('accepts positive decimal', () => {
    expect(zCurrency.safeParse(199.99).success).toBe(true)
  })

  it('coerces numeric string', () => {
    const r = zCurrency.safeParse('50.5')
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe(50.5)
  })

  it('rejects negative', () => {
    expect(zCurrency.safeParse(-0.01).success).toBe(false)
  })

  it('rejects non-numeric string', () => {
    expect(zCurrency.safeParse('abc').success).toBe(false)
  })
})

describe('zPhone', () => {
  it('accepts valid 10-digit starting with 9', () => {
    expect(zPhone.safeParse('9876543210').success).toBe(true)
  })

  it('accepts starting digits 6, 7, 8', () => {
    expect(zPhone.safeParse('6123456789').success).toBe(true)
    expect(zPhone.safeParse('7123456789').success).toBe(true)
    expect(zPhone.safeParse('8123456789').success).toBe(true)
  })

  it('rejects starting with 5', () => {
    expect(zPhone.safeParse('5123456789').success).toBe(false)
  })

  it('rejects 9 digits', () => {
    expect(zPhone.safeParse('987654321').success).toBe(false)
  })

  it('rejects 11 digits', () => {
    expect(zPhone.safeParse('98765432101').success).toBe(false)
  })

  it('rejects +91 prefix', () => {
    expect(zPhone.safeParse('+919876543210').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(zPhone.safeParse('').success).toBe(false)
  })

  it('rejects null', () => {
    expect(zPhone.safeParse(null).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate.ts — parseBody
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  })

  it('returns ok:true with typed data on valid input', () => {
    const r = parseBody(schema, { name: 'Alice', age: 25 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.name).toBe('Alice')
      expect(r.data.age).toBe(25)
    }
  })

  it('returns ok:false with 400 response on invalid input', () => {
    const r = parseBody(schema, { name: '', age: -1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
    }
  })

  it('returns ok:false when a required field is missing', () => {
    const r = parseBody(schema, { name: 'Bob' })
    expect(r.ok).toBe(false)
  })

  it('includes field errors in response body when paths exist', async () => {
    const r = parseBody(schema, { name: '', age: -3 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const body = await r.response.json()
      expect(body.error).toBe('Validation failed')
      expect(body.fields).toBeDefined()
      expect(typeof body.fields).toBe('object')
    }
  })

  it('omits fields key when schema errors have no path (top-level errors)', async () => {
    // A top-level string schema has no path on its error
    const strSchema = z.string().min(5)
    const r = parseBody(strSchema, 'hi')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const body = await r.response.json()
      expect(body.error).toBe('Validation failed')
      // path is empty array, so key is '' — fields should NOT be set
      expect(body.fields).toBeUndefined()
    }
  })

  it('handles null input', () => {
    const r = parseBody(schema, null)
    expect(r.ok).toBe(false)
  })

  it('handles completely wrong type', () => {
    const r = parseBody(schema, 'a string')
    expect(r.ok).toBe(false)
  })

  it('handles empty object', () => {
    const r = parseBody(schema, {})
    expect(r.ok).toBe(false)
  })

  it('does not throw when optional context label is provided', () => {
    expect(() => parseBody(schema, { bad: true }, 'ctx-label')).not.toThrow()
  })

  it('works with a flat string schema', () => {
    const flat = z.string().min(3)
    expect(parseBody(flat, 'hello').ok).toBe(true)
    expect(parseBody(flat, 'hi').ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// order-draft.ts — helpers
// ─────────────────────────────────────────────────────────────────────────────

const BASE_PAYLOAD: DraftPayload = {
  userId: 'user-123',
  mode: 'cart',
  addressId: 'addr-456',
  couponId: null,
  shippingAmount: 0,
  codFeeAmount: 0,
  businessDiscountAmount: 0,
  cartHash: 'abc123',
  cartItemIds: ['item-1', 'item-2'],
  buyNowItem: null,
  notes: null,
  paymentMethod: 'razorpay',
}

describe('signDraftToken + verifyDraftToken — round-trip', () => {
  it('signs and verifies a cart payload', async () => {
    const token = await signDraftToken(BASE_PAYLOAD)
    expect(typeof token).toBe('string')
    expect(token.split('.').length).toBe(3) // JWT has 3 parts

    const decoded = await verifyDraftToken(token)
    expect(decoded).not.toBeNull()
    if (decoded) {
      expect(decoded.userId).toBe('user-123')
      expect(decoded.mode).toBe('cart')
      expect(decoded.addressId).toBe('addr-456')
      expect(decoded.paymentMethod).toBe('razorpay')
    }
  })

  it('preserves all payload fields after round-trip', async () => {
    const payload: DraftPayload = {
      ...BASE_PAYLOAD,
      mode: 'buyNow',
      couponId: 'SAVE10',
      shippingAmount: 49,
      codFeeAmount: 15,
      notes: 'leave at door',
      cartHash: null,
      cartItemIds: null,
      buyNowItem: {
        productId: 'prod-1',
        variantId: 'var-1',
        subVariantId: null,
        qty: 2,
        buyMode: 'retail',
        buyUnit: 'pcs',
        price: 199,
      },
    }
    const token = await signDraftToken(payload)
    const decoded = await verifyDraftToken(token)

    expect(decoded).not.toBeNull()
    if (decoded) {
      expect(decoded.mode).toBe('buyNow')
      expect(decoded.couponId).toBe('SAVE10')
      expect(decoded.shippingAmount).toBe(49)
      expect(decoded.codFeeAmount).toBe(15)
      expect(decoded.notes).toBe('leave at door')
      expect(decoded.cartItemIds).toBeNull()
      expect(decoded.buyNowItem?.productId).toBe('prod-1')
      expect(decoded.buyNowItem?.qty).toBe(2)
      expect(decoded.buyNowItem?.price).toBe(199)
    }
  })

  it('returns null for a tampered token (modified payload segment)', async () => {
    const token = await signDraftToken(BASE_PAYLOAD)
    const parts = token.split('.')
    // Replace payload with a different base64 string
    const fakeParts = [parts[0], btoa(JSON.stringify({ userId: 'hacker' })), parts[2]]
    const tampered = fakeParts.join('.')
    const result = await verifyDraftToken(tampered)
    expect(result).toBeNull()
  })

  it('returns null for a completely invalid token string', async () => {
    const result = await verifyDraftToken('not.a.token')
    expect(result).toBeNull()
  })

  it('returns null for an empty string', async () => {
    expect(await verifyDraftToken('')).toBeNull()
  })

  it('returns null for a token with wrong userId type (manual JWT build would fail verification)', async () => {
    // We test the guard inside verifyDraftToken by crafting a payload where
    // the structural guard catches a wrong-type userId field.
    // Simplest approach: verify that a legitimately signed token with non-string
    // userId (forced via any cast) is rejected.
    // Since signDraftToken spreads the payload, we can pass a mutated object.
    const badPayload = { ...BASE_PAYLOAD, userId: 999 as unknown as string }
    const token = await signDraftToken(badPayload)
    const result = await verifyDraftToken(token)
    // The guard `typeof payload.userId !== 'string'` catches number → null
    expect(result).toBeNull()
  })

  it('returns null for a token with an invalid mode value', async () => {
    const badPayload = { ...BASE_PAYLOAD, mode: 'wholesale' as unknown as 'cart' }
    const token = await signDraftToken(badPayload)
    const result = await verifyDraftToken(token)
    expect(result).toBeNull()
  })

  it('returns null for a token with non-string addressId', async () => {
    const badPayload = { ...BASE_PAYLOAD, addressId: 42 as unknown as string }
    const token = await signDraftToken(badPayload)
    const result = await verifyDraftToken(token)
    expect(result).toBeNull()
  })

  it('handles null couponId — maps to null in decoded output', async () => {
    const token = await signDraftToken({ ...BASE_PAYLOAD, couponId: null })
    const decoded = await verifyDraftToken(token)
    expect(decoded?.couponId).toBeNull()
  })

  it('handles zero shippingAmount', async () => {
    const token = await signDraftToken({ ...BASE_PAYLOAD, shippingAmount: 0 })
    const decoded = await verifyDraftToken(token)
    expect(decoded?.shippingAmount).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// order-draft.ts — hashCartItems
// ─────────────────────────────────────────────────────────────────────────────

describe('hashCartItems', () => {
  const item1: DraftCartItem = {
    productId: 'p1',
    variantId: 'v1',
    subVariantId: null,
    quantity: 2,
    buyMode: 'retail',
    buyUnit: 'pcs',
    priceAtAddition: 100,
  }

  const item2: DraftCartItem = {
    productId: 'p2',
    variantId: null,
    subVariantId: null,
    quantity: 1,
    buyMode: 'wholesale',
    buyUnit: null,
    priceAtAddition: 250,
  }

  it('returns a non-empty string', () => {
    const h = hashCartItems([item1])
    expect(typeof h).toBe('string')
    expect(h.length).toBeGreaterThan(0)
  })

  it('is deterministic — same call returns same hash', () => {
    expect(hashCartItems([item1, item2])).toBe(hashCartItems([item1, item2]))
  })

  it('is order-independent — items in different order produce the same hash', () => {
    expect(hashCartItems([item1, item2])).toBe(hashCartItems([item2, item1]))
  })

  it('produces different hashes for different quantities', () => {
    const modified = { ...item1, quantity: 5 }
    expect(hashCartItems([item1])).not.toBe(hashCartItems([modified]))
  })

  it('produces different hashes for different prices', () => {
    const modified = { ...item1, priceAtAddition: 999 }
    expect(hashCartItems([item1])).not.toBe(hashCartItems([modified]))
  })

  it('produces different hashes for different productIds', () => {
    const modified = { ...item1, productId: 'p-other' }
    expect(hashCartItems([item1])).not.toBe(hashCartItems([modified]))
  })

  it('handles an empty array without throwing', () => {
    expect(() => hashCartItems([])).not.toThrow()
    expect(typeof hashCartItems([])).toBe('string')
  })

  it('handles items with null variantId and subVariantId', () => {
    const minimal: DraftCartItem = {
      productId: 'p3',
      variantId: null,
      subVariantId: null,
      quantity: 1,
      buyMode: 'retail',
      buyUnit: null,
      priceAtAddition: 50,
    }
    expect(() => hashCartItems([minimal])).not.toThrow()
  })

  it('does not mutate the original array', () => {
    const original = [item2, item1]
    const originalCopy = [...original]
    hashCartItems(original)
    expect(original[0].productId).toBe(originalCopy[0].productId)
    expect(original[1].productId).toBe(originalCopy[1].productId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate.ts — dev-mode logging branch (lines 51-53)
// These tests flip NODE_ENV to 'development' so the stdout.write path executes,
// covering the two uncovered branches. The write is a no-op for test output.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBody dev-mode logging branch', () => {
  const schema = z.object({ name: z.string().min(1) })

  it('executes the dev log path on failure when NODE_ENV=development (no context)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    try {
      const r = parseBody(schema, { name: '' })
      expect(r.ok).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('executes the dev log path on failure when NODE_ENV=development (with context)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    try {
      const r = parseBody(schema, { name: '' }, 'dev-ctx')
      expect(r.ok).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
