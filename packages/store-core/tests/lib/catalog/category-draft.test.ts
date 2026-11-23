import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/draft-branches', () => ({
  mergeAndPublish: vi.fn().mockResolvedValue('merged'),
}))

import {
  reorderIntervalDays,
  applyCategoryProfile,
  applyCategoryContent,
  categoryContentOf,
  liveCategoryContent,
  categoryDrafts,
  publishCategoryDraft,
} from '@/lib/catalog/category-draft'
import { mergeAndPublish } from '@/lib/admin/draft-branches'

function fakeDb(subcatRows: any[] = []) {
  const query = vi.fn(async (...args: any[]) => {
    const sql = args[0] as string
    if (/SELECT id FROM categories WHERE parent_category_id/.test(sql)) return { rows: subcatRows }
    return { rows: [] as any[] }
  })
  return { query }
}

describe('reorderIntervalDays', () => {
  it('keeps 1–365, clears anything else', () => {
    expect(reorderIntervalDays('30')).toBe(30)
    expect(reorderIntervalDays(1)).toBe(1)
    expect(reorderIntervalDays(365)).toBe(365)
    expect(reorderIntervalDays(0)).toBeNull()
    expect(reorderIntervalDays(366)).toBeNull()
    expect(reorderIntervalDays('')).toBeNull()
    expect(reorderIntervalDays('abc')).toBeNull()
  })
})

describe('applyCategoryProfile', () => {
  it('writes profile columns present in f', async () => {
    const db = fakeDb()
    await applyCategoryProfile(db as any, 'cat1', { short_name: 'Nuts' })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('UPDATE categories SET')
    expect(sql).toContain('short_name = $2::text')
    expect(params).toEqual(['cat1', 'Nuts'])
  })

  it('does nothing when no profile field is present', async () => {
    const db = fakeDb()
    await applyCategoryProfile(db as any, 'cat1', { random: 'x' })
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('applyCategoryContent', () => {
  it('maps the base columns and derived slug', async () => {
    const db = fakeDb()
    await applyCategoryContent(db as any, 'cat1', { name: 'Power Tools', display_order: '2', image_url: 'u' }, false)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('UPDATE categories SET')
    expect(params[0]).toBe('cat1')
    expect(params[1]).toBe('Power Tools')
    expect(params[2]).toBe('power-tools') // slugOf
    expect(params[5]).toBe(2) // display_order parsed
    expect(params[14]).toBe(true) // 'image_url' in f
    expect(params[15]).toBe('u')
  })

  it('slug null when name missing; flags false for absent image fields', async () => {
    const db = fakeDb()
    await applyCategoryContent(db as any, 'cat1', {}, null)
    const [, params] = db.query.mock.calls[0]
    expect(params[1]).toBeNull()
    expect(params[2]).toBeNull()
    expect(params[14]).toBe(false)
    expect(params[16]).toBe(false)
    expect(params[18]).toBe(false)
    expect(params[20]).toBe(false)
  })

  it('does not cascade is_active when unchanged', async () => {
    const db = fakeDb()
    await applyCategoryContent(db as any, 'cat1', { is_active: true }, true)
    const cascades = db.query.mock.calls.filter(c => /UPDATE products SET is_active/.test(String(c[0])))
    expect(cascades).toHaveLength(0)
  })

  it('cascades is_active to products and subcategories (and their products) when changed', async () => {
    const db = fakeDb([{ id: 'sub1' }])
    await applyCategoryContent(db as any, 'cat1', { is_active: false }, true)
    const sqls = db.query.mock.calls.map(c => String(c[0]))
    // products of this category, then subcats query, then sub's category + sub's products
    expect(sqls.some(s => /UPDATE products SET is_active = \$1 WHERE category_id = \$2/.test(s))).toBe(true)
    expect(sqls.some(s => /SELECT id FROM categories WHERE parent_category_id/.test(s))).toBe(true)
    expect(sqls.some(s => /UPDATE categories SET is_active = \$1, updated_at = NOW\(\) WHERE id = \$2/.test(s))).toBe(true)
    const subProdCall = db.query.mock.calls.find(c => /UPDATE products SET is_active/.test(String(c[0])) && (c[1] as any[])[1] === 'sub1')
    expect(subProdCall).toBeTruthy()
  })
})

describe('categoryContentOf', () => {
  it('reads base + profile cols and derives policy_override', () => {
    const c = categoryContentOf({ name: 'Nuts', return_allowed: true, short_name: 'N' })
    expect(c.name).toBe('Nuts')
    expect(c.short_name).toBe('N')
    expect(c.policy_override).toBe(true)
    expect(categoryContentOf({ name: 'X' }).policy_override).toBe(false)
  })
})

describe('liveCategoryContent', () => {
  it('returns content when a row exists else null', async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ name: 'Nuts' }] })) }
    expect((await liveCategoryContent(db as any, 'c'))?.name).toBe('Nuts')
    const empty = { query: vi.fn(async () => ({ rows: [] })) }
    expect(await liveCategoryContent(empty as any, 'c')).toBeNull()
  })
})

describe('categoryDrafts adapter', () => {
  it('identity and labels', () => {
    expect(categoryDrafts.type).toBe('category')
    expect(categoryDrafts.entityKey).toBe('category_id')
    expect(categoryDrafts.labels?.parent_category_id).toBe('Parent category')
    expect(categoryDrafts.labels?.policy_override).toBe('Own return policy')
  })

  it('toContent strips slug from fields', () => {
    expect(categoryDrafts.toContent!({ fields: { name: 'N', slug: 's' } } as any)).toEqual({ name: 'N' })
    expect(categoryDrafts.toContent!({} as any)).toEqual({})
  })

  it('toColumns wraps under fields', () => {
    expect(categoryDrafts.toColumns!({ name: 'N' })).toEqual({ fields: { name: 'N' } })
  })

  it('lockLive issues FOR UPDATE', async () => {
    const db = fakeDb()
    await categoryDrafts.lockLive!(db as any, 'c1')
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE')
  })

  it('apply passes live.is_active through to applyCategoryContent', async () => {
    const db = fakeDb()
    await categoryDrafts.apply!(db as any, 'c1', { name: 'N' }, { is_active: true } as any, {} as any)
    expect(db.query.mock.calls[0][0]).toContain('UPDATE categories SET')
  })
})

describe('publishCategoryDraft', () => {
  it('forwards to mergeAndPublish', async () => {
    await publishCategoryDraft('d1')
    expect(mergeAndPublish).toHaveBeenCalledWith(categoryDrafts, 'd1', undefined, {})
  })
})
