import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ parseAiJson: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import {
  GOOGLE_TAXONOMY_VERSION,
  findGoogleCategory,
  searchGoogleTaxonomy,
  suggestGoogleCategory,
  resolveGoogleCategory,
  resolveCategoryGoogleCategory,
} from '@/lib/catalog/google-taxonomy'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { queryOne } from '@/lib/shared/db'

const mockAiChat = vi.mocked(aiChat)
const mockParse = vi.mocked(parseAiJson)
const mockQueryOne = vi.mocked(queryOne)

// Known real entries from the snapshot.
const PETS_ID = 1
const PETS_PATH = 'Animals & Pet Supplies'
const PET_SUPPLIES_PATH = 'Animals & Pet Supplies > Pet Supplies'

beforeEach(() => {
  mockAiChat.mockReset()
  mockParse.mockReset()
  mockQueryOne.mockReset()
})

describe('GOOGLE_TAXONOMY_VERSION', () => {
  it('exposes the snapshot version', () => {
    expect(typeof GOOGLE_TAXONOMY_VERSION).toBe('string')
    expect(GOOGLE_TAXONOMY_VERSION.length).toBeGreaterThan(0)
  })
})

describe('findGoogleCategory', () => {
  it('null for empty/blank', () => {
    expect(findGoogleCategory(null)).toBeNull()
    expect(findGoogleCategory('')).toBeNull()
    expect(findGoogleCategory('   ')).toBeNull()
  })
  it('matches a numeric id', () => {
    expect(findGoogleCategory(String(PETS_ID))?.path).toBe(PETS_PATH)
  })
  it('matches "id - path" form', () => {
    expect(findGoogleCategory(`${PETS_ID} - whatever`)?.id).toBe(PETS_ID)
  })
  it('unknown id → null', () => {
    expect(findGoogleCategory('99999999')).toBeNull()
  })
  it('matches an exact path case-insensitively, normalizing separators', () => {
    expect(findGoogleCategory(PETS_PATH.toUpperCase())?.id).toBe(PETS_ID)
    expect(findGoogleCategory('Animals & Pet Supplies>Pet Supplies')?.path).toBe(PET_SUPPLIES_PATH)
  })
  it('unknown path → null', () => {
    expect(findGoogleCategory('No Such Category Path')).toBeNull()
  })
})

describe('searchGoogleTaxonomy', () => {
  it('puts an exact id/path hit first and de-dups it from the ranked list', () => {
    const out = searchGoogleTaxonomy(String(PETS_ID), 5)
    expect(out[0].id).toBe(PETS_ID)
    expect(out.filter(e => e.id === PETS_ID)).toHaveLength(1)
  })
  it('keyword search returns ranked entries', () => {
    const out = searchGoogleTaxonomy('pet supplies', 5)
    expect(out.length).toBeGreaterThan(0)
    expect(out.some(e => /Pet Supplies/.test(e.path))).toBe(true)
  })
  it('empty query yields nothing', () => {
    expect(searchGoogleTaxonomy('   ')).toEqual([])
  })
})

describe('suggestGoogleCategory', () => {
  it('AI off (ai !== true): returns the top keyword candidate without calling AI', async () => {
    const out = await suggestGoogleCategory({ name: 'Pet Supplies' })
    expect(out?.path).toMatch(/Pet Supplies/)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('no candidates → falls back to the parent', async () => {
    const out = await suggestGoogleCategory({ name: 'zzzxqynotaword', parentGoogleCategory: String(PETS_ID) })
    expect(out?.id).toBe(PETS_ID)
  })

  it('AI on: expands terms, then AI picks an id from the shortlist', async () => {
    // expandTerms call → terms; suggest call → id pick
    mockAiChat.mockResolvedValue({ content: '{}' } as any)
    mockParse
      .mockReturnValueOnce({ terms: ['pet supplies'] } as any) // expandTerms
      .mockReturnValueOnce({ id: PETS_ID } as any) // final pick
    const out = await suggestGoogleCategory({ name: 'Pet Supplies', ai: true })
    expect(out?.id).toBe(PETS_ID)
    expect(mockAiChat).toHaveBeenCalledTimes(2)
  })

  it('AI on but pick id not in shortlist → keyword top', async () => {
    mockAiChat.mockResolvedValue({ content: '{}' } as any)
    mockParse
      .mockReturnValueOnce({ terms: [] } as any)
      .mockReturnValueOnce({ id: 99999999 } as any)
    const out = await suggestGoogleCategory({ name: 'Pet Supplies', ai: true })
    expect(out).not.toBeNull()
    expect(out?.id).not.toBe(99999999)
  })

  it('AI on but the pick call throws → keyword top', async () => {
    mockAiChat
      .mockResolvedValueOnce({ content: '{}' } as any) // expandTerms ok
      .mockRejectedValueOnce(new Error('gateway down')) // pick throws
    mockParse.mockReturnValueOnce({ terms: ['pet'] } as any)
    const out = await suggestGoogleCategory({ name: 'Pet Supplies', ai: true })
    expect(out).not.toBeNull()
  })
})

describe('resolveGoogleCategory', () => {
  it('returns the official path when the input is valid', async () => {
    expect(await resolveGoogleCategory(String(PETS_ID), { name: 'anything' })).toBe(PETS_PATH)
    expect(mockAiChat).not.toHaveBeenCalled()
  })
  it('null when input invalid and no name', async () => {
    expect(await resolveGoogleCategory('garbage', { name: '  ' })).toBeNull()
  })
  it('suggests when input invalid but a name is present', async () => {
    const out = await resolveGoogleCategory('garbage', { name: 'Pet Supplies' })
    expect(out).toMatch(/Pet Supplies/)
  })
})

describe('resolveCategoryGoogleCategory', () => {
  it('looks up the parent and resolves with its fields', async () => {
    mockQueryOne.mockResolvedValue({ name: 'Animals', google_product_category: String(PETS_ID) } as any)
    const out = await resolveCategoryGoogleCategory(String(PETS_ID), {
      name: 'Pet Supplies',
      parentId: 'parent1',
    })
    expect(out).toBe(PETS_PATH)
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['parent1'])
  })

  it('no parentId → skips the lookup', async () => {
    const out = await resolveCategoryGoogleCategory(String(PETS_ID), { name: 'Pet Supplies' })
    expect(out).toBe(PETS_PATH)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('tolerates a failing parent lookup', async () => {
    mockQueryOne.mockRejectedValue(new Error('db down'))
    const out = await resolveCategoryGoogleCategory(String(PETS_ID), { name: 'Pet Supplies', parentId: 'p' })
    expect(out).toBe(PETS_PATH)
  })
})
