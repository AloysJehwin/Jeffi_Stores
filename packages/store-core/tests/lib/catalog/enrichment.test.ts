import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  queryOne: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/shared/rag', () => ({ embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn().mockResolvedValue('tenant-x') }))

import {
  enrichmentSystemPrompt,
  buildEnrichmentPrompt,
  cleanArr,
  parseEnrichment,
  insertEnrichmentProposal,
  promoteEnrichment,
  reEmbedProduct,
  type EnrichSource,
  type Enrichment,
} from '@/lib/catalog/enrichment'
import { query, queryOne } from '@/lib/shared/db'
import { embed } from '@/lib/shared/rag'

function source(over: Partial<EnrichSource> = {}): EnrichSource {
  return {
    id: 'p1',
    name: 'Bolt',
    description: null,
    sku: null,
    material: null,
    size: null,
    category_name: null,
    brand_name: null,
    ...over,
  }
}

const goodJson = {
  ai_description: 'A sturdy steel bolt for general construction use.',
  ai_use_cases: ['fastening', 'framing'],
  ai_keywords: ['bolt', 'fastener'],
  ai_who_uses_it: 'builders',
  ai_application: 'used to join beams',
  ai_product_type: 'bolt',
  ai_features: ['steel', 'zinc coated'],
  ai_search_tags: ['hardware', 'construction'],
  short_description: 'Steel bolt',
  usage_instructions: 'Tighten with a wrench',
  care_instructions: 'Keep dry',
  safety_warnings: 'Wear gloves',
  meta_title: 'Steel Bolt',
  meta_description: 'A steel bolt',
  faqs: [{ question: 'Is it rustproof?', answer: 'Zinc coated.' }],
}

describe('enrichmentSystemPrompt', () => {
  it('interpolates the store name', () => {
    expect(enrichmentSystemPrompt('Jeffi')).toContain('product intelligence data for Jeffi')
  })
})

describe('buildEnrichmentPrompt', () => {
  it('includes the name and marks an empty description', () => {
    const out = buildEnrichmentPrompt(source())
    expect(out).toContain('Name: Bolt')
    expect(out).toContain('Existing description: (empty)')
  })

  it('includes optional fields only when present', () => {
    const out = buildEnrichmentPrompt(
      source({ category_name: 'Hardware', brand_name: 'Acme', sku: 'B1', in_the_box: 'bolt\n nut', certifications: ['ISO'], target_audience: [] })
    )
    expect(out).toContain('Category: Hardware')
    expect(out).toContain('Brand: Acme')
    expect(out).toContain('In the box: bolt; nut')
    expect(out).toContain('Certifications: ISO')
    expect(out).not.toContain('Audience:')
  })

  it('renders object and array specifications', () => {
    const obj = buildEnrichmentPrompt(source({ specifications: { Weight: '2kg', Empty: '' } }))
    expect(obj).toContain('Specifications: Weight: 2kg')
    const arr = buildEnrichmentPrompt(source({ specifications: [{ label: 'Length', value: '10mm' }, { value: 'plain' }] }))
    expect(arr).toContain('Length: 10mm')
    expect(arr).toContain('plain')
  })

  it('marks already-set content fields and FAQ presence', () => {
    const out = buildEnrichmentPrompt(source({ short_description: 'present' }), true)
    expect(out).toContain('Short description (already set): present')
    expect(out).toContain('FAQs already exist.')
  })
})

describe('cleanArr', () => {
  it('lowercases, trims, dedupes, drops long items and caps count', () => {
    expect(cleanArr(['A', 'a ', 'b', 'toolong'], 3, 2)).toEqual(['a', 'b'])
  })
  it('returns [] for non-arrays', () => {
    expect(cleanArr('x')).toEqual([])
    expect(cleanArr(null)).toEqual([])
  })
})

describe('parseEnrichment', () => {
  it('parses a clean JSON object', () => {
    const e = parseEnrichment(JSON.stringify(goodJson))
    expect(e.ai_description).toBe(goodJson.ai_description)
    expect(e.ai_use_cases).toEqual(['fastening', 'framing'])
    expect(e.short_description).toBe('Steel bolt')
    expect(e.faqs).toHaveLength(1)
  })

  it('recovers JSON embedded in prose', () => {
    const e = parseEnrichment('Here you go:\n' + JSON.stringify(goodJson) + '\nThanks')
    expect(e.ai_product_type).toBe('bolt')
  })

  it('throws when no JSON is present', () => {
    expect(() => parseEnrichment('no json here')).toThrow(/No JSON/)
  })

  it('throws on a too-short description', () => {
    expect(() => parseEnrichment(JSON.stringify({ ...goodJson, ai_description: 'short' }))).toThrow(/too short/)
  })

  it('throws when too few use cases', () => {
    expect(() => parseEnrichment(JSON.stringify({ ...goodJson, ai_use_cases: ['only'] }))).toThrow(/use cases/)
  })

  it('dedupes faqs by question and drops incomplete ones', () => {
    const e = parseEnrichment(
      JSON.stringify({
        ...goodJson,
        faqs: [
          { question: 'Q', answer: 'A' },
          { question: 'q', answer: 'B' }, // dup case-insensitive
          { question: 'X', answer: '' }, // no answer
        ],
      })
    )
    expect(e.faqs).toEqual([{ question: 'Q', answer: 'A' }])
  })
})

describe('insertEnrichmentProposal', () => {
  beforeEach(() => vi.mocked(query).mockReset().mockResolvedValue({ rows: [] } as any))

  it('keeps content for empty product fields, drops it for filled ones, and serializes faqs', async () => {
    const e = parseEnrichment(JSON.stringify(goodJson))
    await insertEnrichmentProposal(source({ short_description: 'already here' }), e, 'gpt-x')
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO product_ai_enrichment_log')
    // short_description already set on product -> null kept (param 13)
    expect(params![12]).toBeNull()
    // usage_instructions empty on product -> enrichment value kept (param 14)
    expect(params![13]).toBe('Tighten with a wrench')
    // model and name
    expect(params![11]).toBe('gpt-x')
    expect(params![1]).toBe('Bolt')
    // faqs serialized
    expect(params![18]).toContain('rustproof')
  })

  it('passes null faqs when there are none', async () => {
    const e: Enrichment = { ...parseEnrichment(JSON.stringify(goodJson)), faqs: [] }
    await insertEnrichmentProposal(source(), e, 'm')
    expect(vi.mocked(query).mock.calls[0][1]![18]).toBeNull()
  })
})

describe('promoteEnrichment', () => {
  beforeEach(() => vi.mocked(query).mockReset().mockResolvedValue({ rows: [] } as any))

  it('updates the product and inserts faqs when present', async () => {
    await promoteEnrichment({
      id: 'log1',
      product_id: 'p1',
      ai_description: 'd',
      ai_use_cases: ['u'],
      ai_keywords: ['k'],
      ai_who_uses_it: 'w',
      ai_application: 'a',
      ai_product_type: 't',
      ai_features: ['f'],
      ai_search_tags: ['s'],
      faqs: [{ question: 'Q', answer: 'A' }],
    })
    expect(vi.mocked(query).mock.calls[0][0]).toContain('UPDATE products')
    const faqCall = vi.mocked(query).mock.calls[1]
    expect(String(faqCall[0])).toContain('INSERT INTO product_faqs')
    expect(faqCall[1]).toEqual(['p1', JSON.stringify([{ question: 'Q', answer: 'A' }])])
  })

  it('skips the faq insert when there are none', async () => {
    await promoteEnrichment({
      id: 'log1',
      product_id: 'p1',
      ai_description: 'd',
      ai_use_cases: ['u'],
      ai_keywords: null,
      ai_who_uses_it: null,
      ai_application: null,
      ai_product_type: null,
      ai_features: null,
      ai_search_tags: null,
      faqs: null,
    })
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1)
  })
})

describe('reEmbedProduct', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset().mockResolvedValue({ rows: [] } as any)
    vi.mocked(queryOne).mockReset()
    vi.mocked(embed).mockReset().mockResolvedValue([0.1, 0.2])
  })

  it('returns not-found when the product is missing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect(await reEmbedProduct('p1')).toEqual({ ok: false, error: 'product not found for embed' })
  })

  it('embeds assembled content and upserts with the tenant id', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      name: 'Bolt',
      sku: 'B1',
      ai_description: 'desc',
      description: null,
      ai_use_cases: ['fastening'],
      ai_keywords: ['bolt'],
      ai_who_uses_it: 'builders',
      ai_application: 'joining',
      ai_product_type: 'bolt',
      ai_features: ['steel'],
      ai_search_tags: ['hardware'],
      short_description: 'short',
      usage_instructions: 'tighten',
    } as any)
    const res = await reEmbedProduct('p1')
    expect(res).toEqual({ ok: true })
    const content = vi.mocked(embed).mock.calls[0][0]
    expect(content).toContain('Bolt')
    expect(content).toContain('SKU: B1')
    expect(content).toContain('Use cases: fastening')
    const insert = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO embeddings'))!
    expect(insert[1]![4]).toBe('tenant-x') // tenant id bound at $5
    expect(insert[1]![0]).toBe('p1')
  })

  it('returns the error message when embedding throws', async () => {
    vi.mocked(queryOne).mockResolvedValue({ name: 'Bolt', description: 'd' } as any)
    vi.mocked(embed).mockImplementationOnce(() => Promise.reject(new Error('embed down')))
    await expect(reEmbedProduct('p1')).resolves.toEqual({ ok: false, error: 'embed down' })
  })
})
