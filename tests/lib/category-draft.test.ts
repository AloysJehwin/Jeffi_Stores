import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockWithTransaction = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: (...a: any[]) => mockWithTransaction(...a),
}))
vi.mock('@/lib/admin/draft-locks', () => ({
  assertDraftHolder: vi.fn().mockResolvedValue(undefined),
  closeDraftLockTx: vi.fn().mockResolvedValue(null),
  announceDraftClosed: vi.fn().mockResolvedValue(undefined),
  withDraftCreate: vi.fn(),
  DRAFT_RESOURCES: { category: { label: 'Category', editHref: (id: string) => `/admin/categories/${id}/edit` } },
}))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn() }))

import { applyCategoryContent, publishCategoryDraft } from '@/lib/catalog/category-draft'
import { DraftConflictError } from '@/lib/admin/draft-branches'

const fakeDb = (rows: (sql: string) => any[] = () => []) => {
  const q = vi.fn(async (sql: string) => ({ rows: rows(sql), rowCount: 1 }))
  return { query: q } as any
}

describe('applyCategoryContent', () => {
  it('writes a null slug when name is missing', async () => {
    const db = fakeDb()
    await applyCategoryContent(db, 'cat-1', { is_active: true }, true)
    expect(db.query.mock.calls[0][1][2]).toBeNull()
  })

  it('parses display_order and keeps sku_prefix', async () => {
    const db = fakeDb()
    await applyCategoryContent(db, 'cat-1', { name: 'Cat', display_order: '5', sku_prefix: 'CA' }, true)
    const args = db.query.mock.calls[0][1]
    expect(args).toContain(5)
    expect(args).toContain('CA')
  })

  it('cascades an is_active change to products and subcategories', async () => {
    const db = fakeDb(sql => (sql.startsWith('SELECT id FROM categories') ? [{ id: 'sub-1' }] : []))
    await applyCategoryContent(db, 'cat-1', { name: 'Cat', is_active: false }, true)
    const products = db.query.mock.calls.filter(([sql]: [string]) => sql.includes('UPDATE products'))
    expect(products).toHaveLength(2)
  })

  it('skips the cascade when is_active is unchanged or absent', async () => {
    for (const f of [{ is_active: true }, {}]) {
      const db = fakeDb()
      await applyCategoryContent(db, 'cat-1', { name: 'Cat', ...f }, true)
      expect(db.query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE products'))).toBe(false)
    }
  })
})

describe('publishCategoryDraft', () => {
  const live = { name: 'Phones', description: 'By user 1', is_active: true }
  const base = { name: 'Phones', description: 'Old', is_active: true }

  function run(draftFields: Record<string, unknown>) {
    const calls: string[] = []
    mockWithTransaction.mockImplementation(async (fn: any) =>
      fn({
        query: async (sql: string) => {
          calls.push(sql)
          if (sql.includes('FROM category_drafts WHERE id')) return { rows: [{ id: 'd-2', category_id: 'cat-1', fields: draftFields, base, base_revision: 1 }] }
          if (sql.includes('FROM categories WHERE id') && sql.includes('name, description')) return { rows: [live] }
          if (sql.includes('FROM entity_revisions') && sql.includes('revision >'))
            return { rows: [{ revision: 2, actor_name: 'User 1', source: 'publish', changes: { description: { from: 'Old', to: 'By user 1' } }, created_at: 'now' }] }
          if (sql.includes('INSERT INTO entity_revisions')) return { rows: [{ revision: 3 }] }
          return { rows: [] }
        },
      })
    )
    return { calls, p: publishCategoryDraft('d-2') }
  }

  beforeEach(() => vi.clearAllMocks())

  it('keeps the other admin’s published edit for fields this draft never touched', async () => {
    const { calls, p } = run({ name: 'Mobiles', description: 'Old', is_active: true })
    await p
    const update = calls.find(s => s.startsWith('UPDATE categories SET'))
    expect(update).toBeDefined()
    expect(calls.some(s => s.startsWith('DELETE FROM category_drafts'))).toBe(true)
  })

  it('refuses to overwrite a field both sides changed, naming who changed it', async () => {
    const { calls, p } = run({ name: 'Phones', description: 'By user 2', is_active: true })
    const err = await p.catch(e => e)
    expect(err).toBeInstanceOf(DraftConflictError)
    expect(err.conflicts[0]).toMatchObject({ path: 'description', theirs: 'By user 1', mine: 'By user 2', theirsBy: 'User 1' })
    expect(calls.some(s => s.startsWith('UPDATE categories SET'))).toBe(false)
  })
})
