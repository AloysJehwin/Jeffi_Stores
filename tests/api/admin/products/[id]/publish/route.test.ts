import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(() => true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/catalog/product-draft', () => {
  class OpenOrdersBlockError extends Error {}
  class UnitChangeBlockedError extends Error {}
  return {
    publishProductDraft: vi.fn(async () => {}),
    openOrdersForProduct: vi.fn(async () => []),
    OpenOrdersBlockError,
    UnitChangeBlockedError,
  }
})

import { POST } from '@/app/api/(admin)/admin/products/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne, query } from '@/lib/shared/db'
import { publishProductDraft, UnitChangeBlockedError } from '@/lib/catalog/product-draft'
import { ProductValidationError } from '@/lib/catalog/product-validation'

const ID = 'p1'
const call = () =>
  POST(new NextRequest(`http://localhost/api/admin/products/${ID}/publish`, { method: 'POST' }), {
    params: Promise.resolve({ id: ID }),
  })

const product = {
  name: 'Drill',
  category_id: 'c1',
  base_price: '100',
  mrp: '120',
  gst_percentage: '18',
  has_variants: false,
  is_digital: false,
  weight_grams: 200,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a', role: 'admin', scopes: [] } as any)
})

describe('POST /api/admin/products/[id]/publish — create-draft', () => {
  beforeEach(() => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      String(sql).includes('FROM product_drafts') ? null : { id: ID }) as any)
  })

  it('blocks an incomplete draft with the same rules as the form', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      String(sql).includes('FROM products')
        ? { rows: [{ ...product, category_id: null, weight_grams: null }] }
        : { rows: [] }) as any)
    const res = await call()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/^Cannot publish yet: Category is required\./)
    expect(body.details).toContain('Shipping weight is required and must be greater than 0.')
    expect(vi.mocked(query).mock.calls.some(c => String(c[0]).startsWith('UPDATE products'))).toBe(false)
  })

  it('publishes a complete draft: is_draft=false, is_active=true', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      String(sql).includes('FROM products') ? { rows: [product] } : { rows: [] }) as any)
    const res = await call()
    expect(res.status).toBe(200)
    expect(vi.mocked(query).mock.calls.some(c => String(c[0]).includes('SET is_draft = false, is_active = true'))).toBe(
      true
    )
  })
})

describe('POST /api/admin/products/[id]/publish — edit-draft', () => {
  beforeEach(() => {
    vi.mocked(queryOne).mockResolvedValue({ product_id: ID } as any)
  })

  it('publishes and activates', async () => {
    expect((await call()).status).toBe(200)
    expect(publishProductDraft).toHaveBeenCalledWith(ID, { activate: true })
  })

  it('maps fixable problems to 400 and unit blocks to 409', async () => {
    vi.mocked(publishProductDraft).mockRejectedValueOnce(new ProductValidationError('SKU "X" is already used'))
    let res = await call()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('SKU "X" is already used')

    vi.mocked(publishProductDraft).mockRejectedValueOnce(new (UnitChangeBlockedError as any)('stock exists'))
    res = await call()
    expect(res.status).toBe(409)

    vi.mocked(publishProductDraft).mockRejectedValueOnce(new Error('db down'))
    res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
