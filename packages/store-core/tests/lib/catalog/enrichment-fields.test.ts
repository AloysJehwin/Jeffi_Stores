import { describe, it, expect } from 'vitest'
import { ENRICH_CONTENT_FIELDS } from '@/lib/catalog/enrichment-fields'

describe('ENRICH_CONTENT_FIELDS', () => {
  it('lists the six shopper-facing fill fields with keys, labels and max lengths', () => {
    expect(ENRICH_CONTENT_FIELDS.map(f => f.key)).toEqual([
      'short_description',
      'usage_instructions',
      'care_instructions',
      'safety_warnings',
      'meta_title',
      'meta_description',
    ])
    for (const f of ENRICH_CONTENT_FIELDS) {
      expect(typeof f.label).toBe('string')
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.max).toBeGreaterThan(0)
    }
  })

  it('caps the SEO fields tightest', () => {
    const byKey = Object.fromEntries(ENRICH_CONTENT_FIELDS.map(f => [f.key, f.max]))
    expect(byKey.meta_title).toBe(160)
    expect(byKey.meta_description).toBe(320)
    expect(byKey.short_description).toBe(500)
  })
})
