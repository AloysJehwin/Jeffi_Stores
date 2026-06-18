import { describe, it, expect } from 'vitest'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'

// ---------------------------------------------------------------------------
// Helpers — minimal valid templates for each kind
// ---------------------------------------------------------------------------

const BODY_WITH_PRODUCT_CARD = '<p>Hi {firstName}!</p>{productCard}<p>Buy now</p>'
const BODY_WITH_ITEMS_HTML   = '<p>Hi {firstName}!</p>{itemsHtml}<p>Check out</p>'
const BODY_GENERIC           = '<p>Hello {firstName}, thanks for shopping with us.</p>'

// ---------------------------------------------------------------------------
// 1. Input validation
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — input validation', () => {
  it('rejects undefined / null body', () => {
    // @ts-expect-error intentional wrong type
    expect(validateCampaignBodyTemplate(undefined).ok).toBe(false)
    // @ts-expect-error intentional wrong type
    expect(validateCampaignBodyTemplate(null).ok).toBe(false)
  })

  it('rejects non-string body', () => {
    // @ts-expect-error intentional wrong type
    const result = validateCampaignBodyTemplate(42)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/required/)
  })

  it('rejects empty string', () => {
    const result = validateCampaignBodyTemplate('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/required/)
  })

  it('rejects whitespace-only string', () => {
    const result = validateCampaignBodyTemplate('   \n  ')
    expect(result.ok).toBe(false)
  })

  it('rejects body exceeding 50 000 characters', () => {
    const big = '<p>' + 'x'.repeat(50_001) + '</p>'
    const result = validateCampaignBodyTemplate(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/50,000/)
  })

  it('accepts body at exactly 50 000 characters', () => {
    // 50 000 chars of generic content with no product tokens
    const body = 'A'.repeat(50_000)
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Single-product scenarios (restock, price_drop) — require {productCard}
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — single-product scenarios', () => {
  for (const kind of ['restock', 'price_drop']) {
    describe(`kind=${kind}`, () => {
      it('passes when {productCard} is present', () => {
        const result = validateCampaignBodyTemplate(BODY_WITH_PRODUCT_CARD, { kind })
        expect(result.ok).toBe(true)
      })

      it('fails when {productCard} is absent', () => {
        const result = validateCampaignBodyTemplate(BODY_GENERIC, { kind })
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.reason).toMatch(/productCard/)
          expect(result.hint).toBeTruthy()
        }
      })

      it('fails with {itemsHtml} instead of {productCard}', () => {
        const result = validateCampaignBodyTemplate(BODY_WITH_ITEMS_HTML, { kind })
        expect(result.ok).toBe(false)
      })

      it('uses scenarioKind when both opts provided — scenarioKind wins', () => {
        const result = validateCampaignBodyTemplate(BODY_WITH_PRODUCT_CARD, {
          kind: 'something_else',
          scenarioKind: kind,
        })
        expect(result.ok).toBe(true)
      })
    })
  }
})

// ---------------------------------------------------------------------------
// 3. Multi-product scenarios — require {itemsHtml} or {cartItems}
// ---------------------------------------------------------------------------
const MULTI_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'post_purchase',
  'review_reminder',
  'winback_90',
  'winback_180',
]

describe('validateCampaignBodyTemplate — multi-product scenarios', () => {
  for (const kind of MULTI_KINDS) {
    describe(`kind=${kind}`, () => {
      it('passes with {itemsHtml}', () => {
        const result = validateCampaignBodyTemplate(BODY_WITH_ITEMS_HTML, { kind })
        expect(result.ok).toBe(true)
      })

      it('passes with {cartItems}', () => {
        const body = '<p>Hi!</p>{cartItems}<p>Done</p>'
        const result = validateCampaignBodyTemplate(body, { kind })
        expect(result.ok).toBe(true)
      })

      it('fails without any items token', () => {
        const result = validateCampaignBodyTemplate(BODY_GENERIC, { kind })
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.reason).toMatch(/itemsHtml/)
          expect(result.hint).toBeTruthy()
        }
      })

      it('fails with only {productCard} (wrong token for multi)', () => {
        const result = validateCampaignBodyTemplate(BODY_WITH_PRODUCT_CARD, { kind })
        expect(result.ok).toBe(false)
      })
    })
  }
})

// ---------------------------------------------------------------------------
// 4. Generic body (no kind) — single-product token rules
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — generic body, no kind', () => {
  it('passes with a plain marketing body that has no product tokens', () => {
    const result = validateCampaignBodyTemplate(BODY_GENERIC)
    expect(result.ok).toBe(true)
  })

  it('passes with {productCard} in a generic body', () => {
    const result = validateCampaignBodyTemplate(BODY_WITH_PRODUCT_CARD)
    expect(result.ok).toBe(true)
  })

  it('fails when body uses {productName} without {productCard}', () => {
    const body = '<p>Check out {productName} — great price!</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/productCard/)
      expect(result.hint).toBeTruthy()
    }
  })

  it('fails when body uses {productImageUrl} without {productCard}', () => {
    const body = '<img src="{productImageUrl}" />'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
  })

  it('fails when body uses {oldPrice} without {productCard}', () => {
    const body = '<p>Was {oldPrice}, now {newPrice}</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
  })

  it('passes when {productName} and {productCard} are both present', () => {
    const body = '<p>{productName}</p>{productCard}'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })

  it('fails when {itemCount} used but neither {productCard} nor {itemsHtml} present', () => {
    const body = '<p>You have {itemCount} items waiting</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/productCard|itemsHtml/)
  })
})

// ---------------------------------------------------------------------------
// 5. Product copy triggers validation (no kind)
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — product copy phrases', () => {
  const phrases = [
    'your items',
    'the items',
    'your cart',
    'your favourites',
    'your wishlist',
    'back in stock',
    'price drop',
    'featured products',
    'recommendations',
    'recommended products',
    'these products',
  ]

  for (const phrase of phrases) {
    it(`fails when body mentions "${phrase}" without a product token`, () => {
      const body = `<p>Hi, ${phrase} are here for you.</p>`
      const result = validateCampaignBodyTemplate(body)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toMatch(/products|product/)
        expect(result.hint).toBeTruthy()
      }
    })
  }

  it('passes when product copy phrase is paired with {productCard}', () => {
    const body = '<p>back in stock!</p>{productCard}'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })

  it('passes when product copy phrase is paired with {itemsHtml}', () => {
    const body = '<p>your items are waiting</p>{itemsHtml}'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Token casing — case-insensitive matching for product tokens
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — token casing', () => {
  it('detects {PRODUCTNAME} as a single-product token (case-insensitive)', () => {
    // PRODUCT_TOKEN_RE is case-insensitive, so this should be flagged
    const body = '<p>{PRODUCTNAME}</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
  })

  it('detects {ProductCard} as the product-card token (case-sensitive in source)', () => {
    // HAS_PRODUCT_CARD_RE is NOT case-insensitive in the source — test exact casing
    const body = '<p>{productCard}</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. XSS — raw user values should not affect validation outcome
//    (validation does not sanitize, it just checks structure)
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — XSS in template content', () => {
  it('passes structural validation for body containing HTML entities', () => {
    const body = `<p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>{productCard}`
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(true)
  })

  it('accepts body with raw angle brackets in text (validator is structural, not a sanitizer)', () => {
    // The validator checks token presence, not HTML hygiene
    const body = `<p>Hello</p>{itemsHtml}<script>alert(1)</script>`
    const result = validateCampaignBodyTemplate(body)
    // Structural check: itemsHtml is present → ok: true
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. Return shape contract
// ---------------------------------------------------------------------------
describe('validateCampaignBodyTemplate — return shape', () => {
  it('ok result has only ok: true', () => {
    const result = validateCampaignBodyTemplate(BODY_GENERIC)
    expect(result.ok).toBe(true)
    // Should not have extra keys that belong to the error shape
    expect((result as any).reason).toBeUndefined()
  })

  it('err result always has reason string', () => {
    const result = validateCampaignBodyTemplate('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.reason).toBe('string')
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('err result for token misuse includes a hint', () => {
    const body = '<p>{productName}</p>'
    const result = validateCampaignBodyTemplate(body)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.hint).toBe('string')
    }
  })
})
