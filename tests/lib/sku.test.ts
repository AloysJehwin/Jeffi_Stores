import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// generateProductSku — DB-dependent, tested via withTransaction mock
// generateVariantSku — pure function, tested directly
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  withTransaction: vi.fn(),
}))

import { generateProductSku, generateVariantSku } from '@/lib/sku'
import { withTransaction } from '@/lib/db'

const mockWithTransaction = vi.mocked(withTransaction)

// ---------------------------------------------------------------------------
// generateVariantSku (pure)
// ---------------------------------------------------------------------------

describe('generateVariantSku', () => {
  it('appends upper-cased alphanumeric suffix', () => {
    expect(generateVariantSku('PRD-001', 'Red')).toBe('PRD-001-RED')
  })

  it('strips non-alphanumeric characters from variant name', () => {
    expect(generateVariantSku('PRD-001', '100mm x 50mm')).toBe('PRD-001-100MMX50MM')
  })

  it('handles variant name that is already upper-case', () => {
    expect(generateVariantSku('CAT-042', 'BLUE')).toBe('CAT-042-BLUE')
  })

  it('handles variant name with mixed case', () => {
    expect(generateVariantSku('SKU-007', 'Large Blue')).toBe('SKU-007-LARGEBLUE')
  })

  it('handles variant name with numbers only', () => {
    expect(generateVariantSku('PRD-001', '12')).toBe('PRD-001-12')
  })

  it('removes spaces, dashes, and special characters', () => {
    expect(generateVariantSku('PRD-001', 'M6 x 1.0 (DIN 912)')).toBe('PRD-001-M6X10DIN912')
  })

  it('handles an empty variant name (all chars stripped)', () => {
    expect(generateVariantSku('PRD-001', '!!!')).toBe('PRD-001-')
  })

  it('handles empty product SKU', () => {
    expect(generateVariantSku('', 'Red')).toBe('-RED')
  })

  it('handles both empty', () => {
    expect(generateVariantSku('', '')).toBe('-')
  })

  it('preserves digits in the product SKU prefix', () => {
    expect(generateVariantSku('BOLT-123', 'M10')).toBe('BOLT-123-M10')
  })

  it('handles variant name with parentheses and slashes', () => {
    expect(generateVariantSku('HW-010', 'A/B (Test)')).toBe('HW-010-ABTEST')
  })

  it('handles unicode/accented characters (strips them)', () => {
    expect(generateVariantSku('PRD-001', 'Blé')).toBe('PRD-001-BL')
  })
})

// ---------------------------------------------------------------------------
// generateProductSku (DB-dependent via withTransaction)
// ---------------------------------------------------------------------------

describe('generateProductSku', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeMockClient(catRow: any, maxSeqRow: any) {
    return {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: catRow !== null ? [catRow] : [] }) // category lookup
        .mockResolvedValueOnce({ rows: [maxSeqRow] }), // max_seq query
    }
  }

  it('uses PRD prefix when categoryId is null', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_seq: null }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku(null)
    expect(sku).toBe('PRD-001')
  })

  it('uses PRD prefix when categoryId is null and sequence is 5', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_seq: 4 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku(null)
    expect(sku).toBe('PRD-005')
  })

  it('uses sku_prefix from category when present', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ name: 'Hardware', sku_prefix: 'HW' }] })
          .mockResolvedValueOnce({ rows: [{ max_seq: 2 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku('cat-1')
    expect(sku).toBe('HW-003')
  })

  it('derives prefix from category name when sku_prefix is null', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ name: 'Bolts', sku_prefix: null }] })
          .mockResolvedValueOnce({ rows: [{ max_seq: 0 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku('cat-2')
    expect(sku).toBe('BOL-001')
  })

  it('falls back to PRD when category name yields empty prefix', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ name: '123', sku_prefix: null }] })
          .mockResolvedValueOnce({ rows: [{ max_seq: 0 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku('cat-3')
    expect(sku).toBe('PRD-001')
  })

  it('falls back to PRD when category row is not found', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] }) // no category
          .mockResolvedValueOnce({ rows: [{ max_seq: 7 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku('cat-missing')
    expect(sku).toBe('PRD-008')
  })

  it('pads sequence to 3 digits', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_seq: 9 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku(null)
    expect(sku).toBe('PRD-010')
  })

  it('handles max_seq = null (no existing products)', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ max_seq: null }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku(null)
    expect(sku).toBe('PRD-001')
  })

  it('uppercases the prefix', async () => {
    mockWithTransaction.mockImplementation(async fn => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ name: 'tools', sku_prefix: 'tls' }] })
          .mockResolvedValueOnce({ rows: [{ max_seq: 0 }] }),
      }
      return fn(client as any)
    })
    const sku = await generateProductSku('cat-4')
    expect(sku).toMatch(/^TLS-/)
  })
})
