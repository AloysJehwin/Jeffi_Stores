import { describe, it, expect, vi } from 'vitest'

// withTransaction runs the callback with a fake client.
const db = vi.hoisted(() => {
  const client = { query: vi.fn() }
  return {
    client,
    withTransaction: vi.fn(async (fn: (c: any) => any) => fn(client)),
  }
})
vi.mock('@/lib/shared/db', () => ({ withTransaction: db.withTransaction }))

import { setVariantActive, setSubVariantActive } from '@/lib/orders/variant-status'

describe('setVariantActive', () => {
  it('updates the variant and patches both drafts, returning true', async () => {
    db.client.query
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] }) // UPDATE product_variants
      .mockResolvedValueOnce({ rows: [] }) // patchDraft: variants column
      .mockResolvedValueOnce({ rows: [] }) // patchDraft: base
    const ok = await setVariantActive('p1', 'v1', false)
    expect(ok).toBe(true)

    const [sql, params] = db.client.query.mock.calls[0]
    expect(sql).toContain('UPDATE product_variants SET is_active = $1')
    expect(params).toEqual([false, 'v1', 'p1'])

    // patchDraft operates on the 'variants' column with (productId, rowId, active)
    expect(db.client.query.mock.calls[1][0]).toContain('UPDATE product_drafts')
    expect(db.client.query.mock.calls[1][0]).toContain('variants')
    expect(db.client.query.mock.calls[1][1]).toEqual(['p1', 'v1', false])
    expect(db.client.query.mock.calls[2][0]).toContain("base = jsonb_set(base, ARRAY['variants']")
    expect(db.client.query).toHaveBeenCalledTimes(3)
  })

  it('returns false and does not patch when the variant is missing', async () => {
    db.client.query.mockResolvedValueOnce({ rows: [] })
    const ok = await setVariantActive('p1', 'missing', true)
    expect(ok).toBe(false)
    expect(db.client.query).toHaveBeenCalledTimes(1)
  })
})

describe('setSubVariantActive', () => {
  it('updates the sub-variant and patches both drafts, returning true', async () => {
    db.client.query
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const ok = await setSubVariantActive('p1', 'v1', 's1', true)
    expect(ok).toBe(true)

    const [sql, params] = db.client.query.mock.calls[0]
    expect(sql).toContain('UPDATE product_sub_variants SET is_active = $1')
    expect(params).toEqual([true, 's1', 'v1', 'p1'])

    expect(db.client.query.mock.calls[1][0]).toContain('sub_variants')
    expect(db.client.query.mock.calls[1][1]).toEqual(['p1', 's1', true])
    expect(db.client.query.mock.calls[2][0]).toContain("base = jsonb_set(base, ARRAY['sub_variants']")
    expect(db.client.query).toHaveBeenCalledTimes(3)
  })

  it('returns false when the sub-variant is missing', async () => {
    db.client.query.mockResolvedValueOnce({ rows: [] })
    expect(await setSubVariantActive('p1', 'v1', 'missing', false)).toBe(false)
    expect(db.client.query).toHaveBeenCalledTimes(1)
  })
})
