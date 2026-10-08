import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: async (fn: any) => fn({ query: mockClientQuery }),
}))
vi.mock('@/lib/orders/inventory', () => ({ recomputeStockStatusForProduct: vi.fn() }))

import { publishProductDraft } from '@/lib/catalog/product-draft'
import { ProductValidationError } from '@/lib/catalog/product-validation'

const fields = (over: Record<string, unknown> = {}) => ({
  name: 'P',
  sku: 'S',
  slug: 's',
  base_price: '10',
  has_variants: false,
  is_digital: false,
  perishable: false,
  serialized: false,
  ...over,
})

function setup(
  draft: Record<string, unknown>,
  live = { sku: 'LIVE', perishable: false, serialized: false, has_variants: false }
) {
  mockQueryOne.mockImplementation(async (sql: string) =>
    String(sql).includes('FROM product_drafts')
      ? { product_id: 'p1', variants: [], sub_variants: [], units: [], ...draft }
      : live
  )
}

const productUpdate = () =>
  mockClientQuery.mock.calls.find(c => String(c[0]).trimStart().startsWith('UPDATE products SET'))!

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [] })
  mockQueryMany.mockResolvedValue([])
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('publishProductDraft guards', () => {
  it('activates only when asked (or for a create-draft), keeping imports unchanged', async () => {
    setup({ fields: fields() })
    await publishProductDraft('p1', { activate: true })
    const [sql, params] = productUpdate()
    expect(String(sql)).toContain(
      'is_active                = CASE WHEN $3::boolean OR is_draft THEN true ELSE is_active END'
    )
    expect(params[2]).toBe(true)

    mockClientQuery.mockClear()
    await publishProductDraft('p1')
    expect(productUpdate()[1][2]).toBe(false)
  })

  it('keeps the live SKU when the draft cleared it', async () => {
    setup({ fields: fields({ sku: '' }) })
    await publishProductDraft('p1')
    const [sql, params] = productUpdate()
    expect(String(sql)).toContain("COALESCE(NULLIF(($2::jsonb)->>'sku', ''), sku)")
    expect(JSON.parse(params[1]).sku).toBe('LIVE')
  })

  it('gives SKU-less named variants a generated SKU instead of dropping them', async () => {
    setup({ fields: fields({ has_variants: true }), variants: [{ variant_name: 'Red' }] })
    await publishProductDraft('p1')
    const upsert = mockClientQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO product_variants'))!
    expect(JSON.parse(upsert[1][1])[0].sku).toBe('S-RED')
  })

  it('refuses duplicate variant SKUs before writing', async () => {
    setup({
      fields: fields({ has_variants: true }),
      variants: [
        { variant_name: 'A', sku: 'X' },
        { variant_name: 'B', sku: 'x' },
      ],
    })
    await expect(publishProductDraft('p1')).rejects.toBeInstanceOf(ProductValidationError)
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it("refuses a variant SKU owned by another product (the upsert would rewrite that product's row)", async () => {
    setup({ fields: fields({ has_variants: true }), variants: [{ variant_name: 'A', sku: 'TAKEN' }] })
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("'product' AS kind")
        ? { rows: [{ kind: 'variant', sku: 'TAKEN', name: 'Other' }] }
        : { rows: [] }
    )
    await expect(publishProductDraft('p1')).rejects.toThrow(/SKU "TAKEN" is already used by a variant of "Other"/)
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('de-duplicates a staged slug against other products', async () => {
    setup({ fields: fields({ slug: 'drill' }) })
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).startsWith('SELECT slug FROM products') ? { rows: [{ slug: 'drill' }] } : { rows: [] }
    )
    await publishProductDraft('p1')
    expect(JSON.parse(productUpdate()[1][1]).slug).toBe('drill-2')
  })

  it('maps a unique violation inside the transaction to a friendly validation error', async () => {
    setup({ fields: fields() })
    mockClientQuery.mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: '23505',
        constraint: 'products_sku_key',
        detail: 'Key (sku)=(S) already exists.',
      })
    )
    const err = await publishProductDraft('p1').catch(e => e)
    expect(err).toBeInstanceOf(ProductValidationError)
    expect(err.message).toBe('A product with SKU "S" already exists. Use a different SKU.')
  })
})
