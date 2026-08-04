import { describe, it, expect } from 'vitest'
import {
  serializeSignals,
  buildRecapPrompt,
  buildCartInsightPrompt,
  buildProductPitchPrompt,
  buildAffirmationPrompt,
  RECAP_INSTRUCTION,
  type SessionSignals,
  type CartLine,
} from '@/lib/on-device/prompt'
import type { UserProfile } from '@/lib/on-device/user-profile'

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    topCategories: [],
    topBrands: [],
    priceRange: null,
    purchaseCount: 0,
    lastPurchaseDate: null,
    preferredBuyMode: null,
    sessionCount: 0,
    ...over,
  }
}

describe('serializeSignals — cart section', () => {
  it('renders (empty) when cart is empty', () => {
    const out = serializeSignals({ cart: [] })
    expect(out).toContain('### Cart')
    expect(out).toContain('(empty)')
    expect(out.trimEnd().endsWith('### Recap')).toBe(true)
  })

  it('treats a missing cart array as empty (|| [] guard)', () => {
    // deliberately omit cart to exercise the `sig.cart || []` fallback
    const out = serializeSignals({} as unknown as SessionSignals)
    expect(out).toContain('(empty)')
  })

  it('renders cart lines with qty and name only when no brand/category', () => {
    const cart: CartLine[] = [{ name: 'Hex Bolt M8', qty: 3 }]
    const out = serializeSignals({ cart })
    expect(out).toContain('- 3x Hex Bolt M8')
    // no parenthesised meta
    expect(out).not.toContain('Hex Bolt M8 (')
  })

  it('appends brand and category meta joined by comma', () => {
    const cart: CartLine[] = [
      { name: 'Hex Bolt M8', qty: 2, brand: 'Unbrako', category: 'Fasteners' },
    ]
    const out = serializeSignals({ cart })
    expect(out).toContain('- 2x Hex Bolt M8 (Unbrako, Fasteners)')
  })

  it('renders only brand when category is null', () => {
    const cart: CartLine[] = [{ name: 'Washer', qty: 1, brand: 'Unbrako', category: null }]
    const out = serializeSignals({ cart })
    expect(out).toContain('- 1x Washer (Unbrako)')
  })

  it('renders only category when brand is missing', () => {
    const cart: CartLine[] = [{ name: 'Washer', qty: 1, category: 'Fasteners' }]
    const out = serializeSignals({ cart })
    expect(out).toContain('- 1x Washer (Fasteners)')
  })

  it('clamps cart to MAX_CART (12) lines', () => {
    const cart: CartLine[] = Array.from({ length: 20 }, (_, i) => ({
      name: `Item${i}`,
      qty: 1,
    }))
    const out = serializeSignals({ cart })
    const rendered = out.split('\n').filter(l => l.startsWith('- '))
    expect(rendered).toHaveLength(12)
    expect(out).toContain('- 1x Item11')
    expect(out).not.toContain('- 1x Item12')
  })
})

describe('serializeSignals — summary line', () => {
  it('renders both itemCount and total', () => {
    const out = serializeSignals({ cart: [], itemCount: 4, total: 199.5 })
    expect(out).toContain('Summary: 4 items, total Rs.199.50')
  })

  it('renders only itemCount when total is null', () => {
    const out = serializeSignals({ cart: [], itemCount: 4, total: null })
    expect(out).toContain('Summary: 4 items')
    expect(out).not.toContain('total Rs.')
  })

  it('renders only total when itemCount is null', () => {
    const out = serializeSignals({ cart: [], itemCount: null, total: 50 })
    expect(out).toContain('Summary: total Rs.50.00')
    expect(out).not.toContain('items')
  })

  it('omits summary entirely when both itemCount and total are null', () => {
    const out = serializeSignals({ cart: [], itemCount: null, total: null })
    expect(out).not.toContain('Summary:')
  })

  it('omits summary when itemCount and total are absent', () => {
    const out = serializeSignals({ cart: [] })
    expect(out).not.toContain('Summary:')
  })

  it('treats itemCount 0 as present (uses != null not falsy)', () => {
    const out = serializeSignals({ cart: [], itemCount: 0 })
    expect(out).toContain('Summary: 0 items')
  })
})

describe('serializeSignals — viewed / past / searches (clampList)', () => {
  it('renders viewed section as dash list', () => {
    const out = serializeSignals({ cart: [], viewed: ['A', 'B'] })
    expect(out).toContain('### Also viewed')
    expect(out).toContain('- A\n- B')
  })

  it('omits viewed section when empty after clamp', () => {
    const out = serializeSignals({ cart: [], viewed: ['', '   '] })
    expect(out).not.toContain('### Also viewed')
  })

  it('dedupes case-insensitively and trims in clampList', () => {
    const out = serializeSignals({ cart: [], viewed: [' Bolt ', 'bolt', 'BOLT', 'Nut'] })
    // only 'Bolt' (trimmed) and 'Nut' survive
    expect(out).toContain('- Bolt\n- Nut')
  })

  it('clamps viewed to MAX_VIEWED (8)', () => {
    const viewed = Array.from({ length: 12 }, (_, i) => `V${i}`)
    const out = serializeSignals({ cart: [], viewed })
    expect(out).toContain('- V7')
    expect(out).not.toContain('- V8')
  })

  it('renders previously-bought categories joined by comma', () => {
    const out = serializeSignals({ cart: [], pastCategories: ['Fasteners', 'Tools'] })
    expect(out).toContain('### Previously bought categories')
    expect(out).toContain('Fasteners, Tools')
  })

  it('renders searches joined by comma', () => {
    const out = serializeSignals({ cart: [], searches: ['m8 bolt', 'washer'] })
    expect(out).toContain('### Searched for')
    expect(out).toContain('m8 bolt, washer')
  })

  it('handles null/undefined entries inside clampList (?? guard)', () => {
    const out = serializeSignals({
      cart: [],
      searches: [null as unknown as string, undefined as unknown as string, 'ok'],
    })
    expect(out).toContain('### Searched for')
    expect(out).toContain('ok')
  })
})

describe('serializeSignals — user profile section', () => {
  it('renders all profile bits when present', () => {
    const out = serializeSignals({
      cart: [],
      userProfile: profile({
        topCategories: ['Fasteners', 'Tools', 'Adhesives', 'Extra'],
        topBrands: ['Unbrako', 'Bosch', 'TVS', 'Extra'],
        priceRange: { min: 100.4, max: 999.6 },
        purchaseCount: 5,
      }),
    })
    expect(out).toContain('### Profile')
    expect(out).toContain('Frequent: Fasteners, Tools, Adhesives')
    expect(out).toContain('Brands: Unbrako, Bosch, TVS')
    // Math.round applied to price range
    expect(out).toContain('Budget: Rs.100–Rs.1000')
    expect(out).toContain('Orders: 5')
  })

  it('omits profile section when profile is null', () => {
    const out = serializeSignals({ cart: [], userProfile: null })
    expect(out).not.toContain('### Profile')
  })

  it('omits profile section when profile is empty (no cats/brands/purchases)', () => {
    const out = serializeSignals({ cart: [], userProfile: profile() })
    expect(out).not.toContain('### Profile')
  })

  it('renders profile with only purchaseCount > 0', () => {
    const out = serializeSignals({ cart: [], userProfile: profile({ purchaseCount: 2 }) })
    expect(out).toContain('### Profile')
    expect(out).toContain('Orders: 2')
    expect(out).not.toContain('Frequent:')
    expect(out).not.toContain('Budget:')
  })

  it('renders profile with only topCategories, no priceRange or purchases', () => {
    const out = serializeSignals({
      cart: [],
      userProfile: profile({ topCategories: ['Fasteners'] }),
    })
    expect(out).toContain('Frequent: Fasteners')
    expect(out).not.toContain('Brands:')
    expect(out).not.toContain('Budget:')
    expect(out).not.toContain('Orders:')
  })
})

describe('serializeSignals — recap style', () => {
  it('renders style section when recapStyle set', () => {
    const out = serializeSignals({ cart: [], recapStyle: 'concise' })
    expect(out).toContain('### Style')
    expect(out).toContain('concise')
  })

  it('omits style section when recapStyle is null', () => {
    const out = serializeSignals({ cart: [], recapStyle: null })
    expect(out).not.toContain('### Style')
  })
})

describe('buildRecapPrompt', () => {
  it('prepends RECAP_INSTRUCTION then the serialized signals', () => {
    const sig: SessionSignals = { cart: [{ name: 'Bolt', qty: 1 }] }
    const out = buildRecapPrompt(sig)
    expect(out.startsWith(RECAP_INSTRUCTION)).toBe(true)
    expect(out).toContain('\n\n### Cart')
    expect(out).toContain('- 1x Bolt')
    expect(out.trimEnd().endsWith('### Recap')).toBe(true)
  })
})

describe('buildCartInsightPrompt', () => {
  it('includes insight instruction and ends with ### Insight', () => {
    const out = buildCartInsightPrompt({ cart: [{ name: 'Drill', qty: 1 }] })
    expect(out).toContain('describe what the customer is building')
    expect(out).toContain('- 1x Drill')
    expect(out.endsWith('### Insight')).toBe(true)
  })
})

describe('buildProductPitchPrompt', () => {
  it('renders product with brand and category, plus profile bits', () => {
    const out = buildProductPitchPrompt(
      'Impact Driver',
      'Bosch',
      'Power Tools',
      profile({ topCategories: ['Tools', 'Fasteners', 'X', 'Y'], topBrands: ['Bosch', 'A', 'B', 'C'] }),
    )
    expect(out).toContain('### Product\nImpact Driver (Bosch) — Power Tools')
    expect(out).toContain('### Profile')
    expect(out).toContain('Frequent: Tools, Fasteners, X')
    expect(out).toContain('Brands: Bosch, A, B')
    expect(out.endsWith('### Pitch')).toBe(true)
  })

  it('omits brand and category when null', () => {
    const out = buildProductPitchPrompt('Generic Nut', null, null, null)
    expect(out).toContain('### Product\nGeneric Nut\n### Pitch')
    // product line has no brand parens or category em-dash appended
    expect(out).not.toContain('Generic Nut (')
    expect(out).not.toContain('Generic Nut —')
    expect(out).not.toContain('### Profile')
  })

  it('omits profile section when profile has no categories or brands', () => {
    const out = buildProductPitchPrompt('Bolt', 'Unbrako', 'Fasteners', profile())
    expect(out).toContain('### Product\nBolt (Unbrako) — Fasteners')
    expect(out).not.toContain('### Profile')
  })

  it('renders profile with only brands', () => {
    const out = buildProductPitchPrompt('Bolt', null, null, profile({ topBrands: ['Unbrako'] }))
    expect(out).toContain('### Profile')
    expect(out).toContain('Brands: Unbrako')
    expect(out).not.toContain('Frequent:')
  })
})

describe('buildAffirmationPrompt', () => {
  it('renders purchased items list and profile', () => {
    const out = buildAffirmationPrompt(
      ['Bolt', 'Nut', 'Washer'],
      500,
      profile({ topCategories: ['Fasteners', 'Tools', 'Glue', 'Extra'] }),
    )
    expect(out).toContain('### Purchased\n- Bolt\n- Nut\n- Washer')
    expect(out).toContain('### Profile\nFrequent: Fasteners, Tools, Glue')
    expect(out.endsWith('### Affirmation')).toBe(true)
  })

  it('clamps purchased items to 5', () => {
    const names = Array.from({ length: 8 }, (_, i) => `Item${i}`)
    const out = buildAffirmationPrompt(names, 100, null)
    expect(out).toContain('- Item4')
    expect(out).not.toContain('- Item5')
  })

  it('omits profile section when profile is null', () => {
    const out = buildAffirmationPrompt(['Bolt'], 10, null)
    expect(out).not.toContain('### Profile')
  })

  it('omits profile section when topCategories empty', () => {
    const out = buildAffirmationPrompt(['Bolt'], 10, profile())
    expect(out).not.toContain('### Profile')
  })
})
