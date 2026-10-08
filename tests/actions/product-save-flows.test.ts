import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${url}` })
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/tenancy/get-host', () => ({ getHost: vi.fn(async () => 'localhost') }))
vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))
vi.mock('@/lib/auth/admin-auth', () => ({ getAdminSession: vi.fn(async () => null) }))
vi.mock('@/lib/catalog/product-action-auth', () => ({ productsWriteError: vi.fn(async () => null) }))
vi.mock('@/lib/catalog/product-draft', () => ({
  publishProductDraft: vi.fn(async () => {}),
  openOrdersForProduct: vi.fn(async () => []),
}))
vi.mock('@/lib/catalog/sku', () => ({
  generateProductSku: vi.fn(async () => 'GEN-001'),
  generateVariantSku: (sku: string, name: string) => `${sku}-${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
}))
vi.mock('@/lib/shared/google-sheets', () => ({ syncProductToSheet: vi.fn(async () => {}) }))
vi.mock('@/lib/merchant/sync', () => ({ syncProductToMerchant: vi.fn(async () => {}) }))
vi.mock('@/lib/amazon/sync', () => ({ syncProductToAmazon: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/s3', () => ({
  deleteProductImage: vi.fn(async () => {}),
  copyGalleryImageToProduct: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
  const txQuery = vi.fn(async (...a: any[]) => (query as any)(...a))
  return {
    query,
    queryOne: vi.fn(async () => null),
    queryMany: vi.fn(async () => []),
    withTransaction: vi.fn(async (fn: any) => fn({ query: txQuery })),
  }
})

import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { createProduct } from '@/app/(admin)/admin/products/add/actions'
import { updateProduct } from '@/app/(admin)/admin/products/edit/[id]/actions'
import { publishProductDraft } from '@/lib/catalog/product-draft'
import { productsWriteError } from '@/lib/catalog/product-action-auth'
import { deleteProductImage } from '@/lib/shared/s3'

const PID = '11111111-1111-4111-8111-111111111111'
const CAT = '22222222-2222-4222-8222-222222222222'

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const insertCall = () => vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO products'))
const col = (call: any, name: string) => {
  const cols = String(call[0])
    .match(/INSERT INTO products \(([\s\S]*?)\) VALUES/)![1]
    .split(',')
    .map(s => s.trim())
  return call[1][cols.indexOf(name)]
}

const complete = {
  name: 'Bosch Drill',
  category_id: CAT,
  base_price: '100',
  mrp: '120',
  gst_percentage: '18',
  weight_grams: '500',
  package_type: 'flat_poly_m',
  product_id: PID,
}

describe('createProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockResolvedValue(null)
  })

  it('refuses without products:write', async () => {
    vi.mocked(productsWriteError).mockResolvedValueOnce('You do not have permission to create or edit products.')
    expect(await createProduct(form({ ...complete, intent: 'publish' }))).toEqual({
      error: 'You do not have permission to create or edit products.',
    })
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('Save as Draft with almost nothing lands a create-draft: is_draft=true, is_active=false', async () => {
    const r = await createProduct(form({ intent: 'draft', base_price: '', _no_redirect: '1', product_id: PID }))
    expect(r).toEqual({ ok: true, redirectTo: '/admin/products' })
    const call = insertCall()!
    expect(col(call, 'is_draft')).toBe(true)
    expect(col(call, 'is_active')).toBe(false)
    expect(col(call, 'name')).toBe('Untitled draft')
    expect(col(call, 'slug')).toBe('untitled-draft')
    expect(col(call, 'sku')).toBe('GEN-001')
    expect(col(call, 'base_price')).toBe(0)
    expect(col(call, 'id')).toBe(PID)
  })

  it('treats a missing intent (Enter-key submit) as a draft', async () => {
    await expect(createProduct(form({ ...complete }))).rejects.toThrow('NEXT_REDIRECT')
    expect(col(insertCall()!, 'is_draft')).toBe(true)
  })

  it('publish activates the product', async () => {
    await expect(createProduct(form({ ...complete, intent: 'publish' }))).rejects.toThrow('NEXT_REDIRECT')
    const call = insertCall()!
    expect(col(call, 'is_draft')).toBe(false)
    expect(col(call, 'is_active')).toBe(true)
  })

  it('publish requires name, category and a price', async () => {
    const r = await createProduct(form({ intent: 'publish', weight_grams: '10' }))
    expect(r).toMatchObject({ error: 'Product name is required.' })
    expect((r as any).details).toEqual(
      expect.arrayContaining(['Category is required.', 'Pricing: selling price is required to publish.'])
    )
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('rejects a selling price above MRP even for a draft', async () => {
    const r = await createProduct(form({ intent: 'draft', base_price: '150', mrp: '120' }))
    expect((r as any).error).toMatch(/cannot be higher than MRP/)
  })

  it('rejects negative cost and an invalid GST slab', async () => {
    const r = await createProduct(form({ intent: 'draft', cost_price: '-1', gst_percentage: '17' }))
    expect((r as any).details).toEqual(
      expect.arrayContaining(['Pricing: cost price cannot be negative.', expect.stringMatching(/GST rate/)])
    )
  })

  it('enforces publish shipping rules', async () => {
    const r = await createProduct(form({ ...complete, intent: 'publish', weight_grams: '' }))
    expect((r as any).error).toMatch(/Shipping weight is required/)
  })

  it('returns a clear error for malformed JSON instead of throwing', async () => {
    const r = await createProduct(form({ ...complete, intent: 'draft', uploaded_images: '{oops' }))
    expect((r as any).error).toMatch(/malformed data for "uploaded images"/)
  })

  it('rejects variant names that collide into one SKU', async () => {
    const r = await createProduct(
      form({
        ...complete,
        sku: 'DR',
        intent: 'draft',
        has_variants: 'true',
        variants_json: JSON.stringify([{ variant_name: '1/2' }, { variant_name: '12' }]),
      })
    )
    expect((r as any).error).toBe('Variants "1/2" and "12" both have SKU "DR-12". Rename one of them.')
  })

  it('pre-checks a SKU already used by another product', async () => {
    vi.mocked(query).mockImplementation(async (sql: string) =>
      String(sql).includes("'product' AS kind")
        ? ({ rows: [{ kind: 'product', sku: 'DR', name: 'Old drill' }] } as any)
        : ({ rows: [] } as any)
    )
    const r = await createProduct(form({ ...complete, sku: 'dr', intent: 'draft' }))
    expect((r as any).error).toBe('SKU "DR" is already used by product "Old drill". Use a different SKU.')
    vi.mocked(query).mockImplementation(async () => ({ rows: [], rowCount: 0 }) as any)
  })

  it("rolls back atomically, maps the duplicate key and removes this attempt's uploads", async () => {
    vi.mocked(withTransaction).mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: '23505',
        constraint: 'products_sku_key',
        detail: 'Key (sku)=(DR) already exists.',
      })
    )
    const r = await createProduct(
      form({
        ...complete,
        intent: 'draft',
        uploaded_images: JSON.stringify([{ s3Key: 'k1', s3ThumbnailKey: 't1' }]),
      })
    )
    expect(r).toEqual({ error: 'A product with SKU "DR" already exists. Use a different SKU.' })
    expect(deleteProductImage).toHaveBeenCalledWith('k1', 't1')
  })

  it('a retry with the same product_id after a committed save is a no-op success', async () => {
    vi.mocked(queryOne).mockImplementation(async (sql: string) =>
      String(sql).startsWith('SELECT id FROM products WHERE id') ? ({ id: PID } as any) : null
    )
    const r = await createProduct(form({ ...complete, intent: 'publish', _no_redirect: '1' }))
    expect(r).toEqual({ ok: true, redirectTo: '/admin/products' })
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('inserts product, images and variants in one transaction', async () => {
    await expect(
      createProduct(
        form({
          ...complete,
          sku: 'DR',
          intent: 'publish',
          has_variants: 'true',
          variants_json: JSON.stringify([
            { variant_name: 'Red', price: '100', mrp: '120', weight_grams: '50' },
            { variant_name: 'Gone', _isDeleted: true },
          ]),
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(withTransaction).toHaveBeenCalledTimes(1)
    const variantInserts = vi
      .mocked(query)
      .mock.calls.filter(c => String(c[0]).includes('INSERT INTO product_variants'))
    expect(variantInserts).toHaveLength(1)
    expect(variantInserts[0][1]![1]).toBe('DR-RED')
  })
})

describe('updateProduct', () => {
  const liveRow = (row: { sku: string | null; is_draft: boolean } | null, draft: boolean) => (sql: string) =>
    String(sql).includes('SELECT sku, is_draft FROM products')
      ? row
      : String(sql).includes('FROM product_drafts WHERE product_id') && draft
        ? { product_id: PID, fields: {} }
        : null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(query).mockImplementation(async () => ({ rows: [], rowCount: 0 }) as any)
  })

  const productUpdate = () =>
    vi.mocked(query).mock.calls.find(c => String(c[0]).startsWith('UPDATE products SET name'))!
  const setVal = (name: string) => {
    const [sql, params] = productUpdate()
    return (params as unknown[])[Number(String(sql).match(new RegExp(`${name} = \\$(\\d+)`))![1]) - 1]
  }

  it('create-draft publish forces is_active=true and is_draft=false', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'DR', is_draft: true }, false)(sql)) as any)
    await expect(updateProduct(PID, form({ ...complete, intent: 'publish', is_active: '' }))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(setVal('is_active')).toBe(true)
    expect(setVal('is_draft')).toBe(false)
  })

  it('create-draft save keeps it a draft and inactive, even with the Active toggle on', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'DR', is_draft: true }, false)(sql)) as any)
    await expect(updateProduct(PID, form({ name: '', intent: 'draft', is_active: 'true' }))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(setVal('is_active')).toBe(false)
    expect(setVal('is_draft')).toBe(true)
    expect(setVal('name')).toBe('Untitled draft')
    expect(setVal('sku')).toBe('DR') // empty SKU keeps the current one
  })

  it('refuses a draft save that would write straight to a live product', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'DR', is_draft: false }, false)(sql)) as any)
    const r = await updateProduct(PID, form({ ...complete, intent: 'draft' }))
    expect((r as any).error).toMatch(/live and has no pending draft/)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('edit-draft publish stores a non-null SKU and activates on publish', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'LIVE-SKU', is_draft: false }, true)(sql)) as any)
    const r = await updateProduct(PID, form({ ...complete, sku: '', intent: 'publish', _no_redirect: '1' }))
    expect(r).toEqual({ ok: true, redirectTo: `/admin/products/${PID}` })
    const draftWrite = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO product_drafts'))!
    const fields = JSON.parse(String(draftWrite[1]![1]))
    expect(fields.sku).toBe('LIVE-SKU')
    expect(fields.is_active).toBe(true)
    expect(publishProductDraft).toHaveBeenCalledWith(PID, { activate: true })
  })

  it('surfaces a publish failure after the draft was saved', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'S', is_draft: false }, true)(sql)) as any)
    vi.mocked(publishProductDraft).mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: '23505',
        constraint: 'product_variants_sku_key',
        detail: 'Key (sku)=(S-RED) already exists.',
      })
    )
    const r = await updateProduct(PID, form({ ...complete, intent: 'publish' }))
    expect((r as any).error).toMatch(/^Draft saved, but publishing failed: Variant SKU "S-RED"/)
  })

  it('deletes removed images from S3 only after the transaction commits', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'DR', is_draft: true }, false)(sql)) as any)
    const order: string[] = []
    vi.mocked(withTransaction).mockImplementationOnce(async (fn: any) => {
      const r = await fn({
        query: async (sql: string, p: unknown[]) => {
          if (String(sql).startsWith('SELECT * FROM product_images'))
            return { rows: [{ id: 'img1', s3_key: 'k', s3_thumbnail_key: 't' }] }
          if (String(sql).startsWith('DELETE FROM product_images')) order.push('db-delete')
          return query(sql, p)
        },
      })
      order.push('commit')
      return r
    })
    vi.mocked(deleteProductImage).mockImplementation(async () => {
      order.push('s3-delete')
    })
    await expect(
      updateProduct(PID, form({ ...complete, intent: 'draft', existing_images_to_keep: '[{"id":"other"}]' }))
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(order).toEqual(['db-delete', 'commit', 's3-delete'])
  })

  it('does not touch S3 when the transaction fails', async () => {
    vi.mocked(queryOne).mockImplementation((async (sql: string) =>
      liveRow({ sku: 'DR', is_draft: true }, false)(sql)) as any)
    vi.mocked(withTransaction).mockRejectedValueOnce(new Error('db down'))
    const r = await updateProduct(PID, form({ ...complete, intent: 'draft', existing_images_to_keep: '[]' }))
    expect(r).toEqual({ error: 'db down' })
    expect(deleteProductImage).not.toHaveBeenCalled()
  })

  it('rejects malformed variants JSON with a clear message', async () => {
    const r = await updateProduct(PID, form({ ...complete, intent: 'draft', variants_json: '[{' }))
    expect((r as any).error).toMatch(/malformed data for "variants"/)
  })
})
