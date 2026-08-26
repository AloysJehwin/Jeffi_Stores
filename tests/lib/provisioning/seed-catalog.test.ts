import { describe, it, expect } from 'vitest'
import { SEED_CATALOGS, SEED_PROFILES, catalogFor } from '@/lib/provisioning/seed-catalog'

// The onboarding wizard's category list — every option must have a starter catalogue.
const ONBOARDING_CATEGORIES = [
  'Electronics & Gadgets', 'Fashion & Apparel', 'Home & Kitchen',
  'Health & Beauty', 'Books & Stationery', 'Sports & Fitness',
  'Toys & Games', 'Industrial & B2B', 'Food & Groceries', 'Other',
]

describe('seed catalogues', () => {
  it('covers every onboarding category', () => {
    for (const c of ONBOARDING_CATEGORIES) {
      expect(SEED_PROFILES, `missing catalogue for ${c}`).toContain(c)
    }
  })

  it('gives each catalogue exactly 10 products and 2 hero slides', () => {
    for (const [name, cat] of Object.entries(SEED_CATALOGS)) {
      expect(cat.items, `${name} products`).toHaveLength(10)
      expect(cat.hero, `${name} hero`).toHaveLength(2)
    }
  })

  it('has unique product names within each catalogue (slug/sku are derived)', () => {
    for (const [name, cat] of Object.entries(SEED_CATALOGS)) {
      const names = cat.items.map((i) => i.name)
      expect(new Set(names).size, `${name} has duplicate product names`).toBe(names.length)
    }
  })

  it('uses positive prices and non-empty copy throughout', () => {
    for (const [name, cat] of Object.entries(SEED_CATALOGS)) {
      expect(cat.category, name).toBeTruthy()
      expect(cat.categorySlug).toMatch(/^[a-z0-9-]+$/)
      for (const i of cat.items) {
        expect(i.price, `${name}/${i.name}`).toBeGreaterThan(0)
        expect(i.blurb.length, `${name}/${i.name}`).toBeGreaterThan(10)
      }
      for (const h of cat.hero) {
        expect(h.title).toBeTruthy()
        expect(h.cta).toBeTruthy()
      }
    }
  })

  it('contains no emoji anywhere', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    const blob = JSON.stringify(SEED_CATALOGS)
    expect(emoji.test(blob)).toBe(false)
  })

  it('falls back to the generic catalogue for an unknown category', () => {
    expect(catalogFor('Nonexistent Category')).toBe(SEED_CATALOGS.Other)
    expect(catalogFor('Electronics & Gadgets').categorySlug).toBe('electronics')
  })
})
