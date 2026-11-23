import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/draft-branches', () => ({
  mergeAndPublish: vi.fn().mockResolvedValue('merged'),
}))

import {
  applyReviewFormContent,
  reviewFormContentOf,
  liveReviewFormContent,
  reviewFormDrafts,
  publishReviewFormDraft,
} from '@/lib/catalog/review-form-draft'
import { mergeAndPublish } from '@/lib/admin/draft-branches'

function fakeDb() {
  const query = vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] as any[] }))
  return { query }
}

describe('applyReviewFormContent', () => {
  it('issues the UPDATE with the mapped params', async () => {
    const db = fakeDb()
    await applyReviewFormContent(db as any, 'f1', {
      title: 'T',
      slug: '',
      coupon_id: 'c1',
      description: 'd',
      is_active: false,
      custom_fields: [{ id: '1' }],
    })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('UPDATE review_forms SET')
    expect(params[0]).toBe('f1')
    expect(params[1]).toBe('T')
    expect(params[2]).toBeNull() // blank slug → null
    expect(params[5]).toBe('c1') // coupon_id
    expect(params[6]).toBe('d') // description
    expect(params[7]).toBe(false) // is_active present
    expect(params[8]).toBe(JSON.stringify([{ id: '1' }]))
  })

  it('nulls optional fields when absent', async () => {
    const db = fakeDb()
    await applyReviewFormContent(db as any, 'f1', {})
    const [, params] = db.query.mock.calls[0]
    expect(params.slice(1)).toEqual([null, null, null, null, null, null, null, null])
  })
})

describe('reviewFormContentOf', () => {
  it('reads the content cols, custom_fields default []', () => {
    const c = reviewFormContentOf({ title: 'T', slug: 's' })
    expect(c.title).toBe('T')
    expect(c.slug).toBe('s')
    expect(c.custom_fields).toEqual([])
    expect(c.description).toBeNull()
  })
})

describe('liveReviewFormContent', () => {
  it('returns normalised content when a row exists', async () => {
    const db = { query: vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [{ title: 'T' }] })) }
    const out = await liveReviewFormContent(db as any, 'f1')
    expect(out?.title).toBe('T')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('FROM review_forms WHERE id = $1')
    expect(params).toEqual(['f1'])
  })

  it('null when no row', async () => {
    const db = { query: vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] })) }
    expect(await liveReviewFormContent(db as any, 'f1')).toBeNull()
  })
})

describe('reviewFormDrafts adapter', () => {
  it('has the expected shape', () => {
    expect(reviewFormDrafts.type).toBe('review_form')
    expect(reviewFormDrafts.table).toBe('review_form_drafts')
    expect(reviewFormDrafts.entityKey).toBe('form_id')
    expect(reviewFormDrafts.arrayKeys).toEqual({ custom_fields: 'id' })
  })

  it('toContent keeps only form fields present in fields', () => {
    const c = reviewFormDrafts.toContent!({ fields: { title: 'T', submissions_count: 9 } } as any)
    expect(c).toEqual({ title: 'T' })
    expect(reviewFormDrafts.toContent!({} as any)).toEqual({})
  })

  it('toColumns wraps content under fields', () => {
    expect(reviewFormDrafts.toColumns!({ title: 'T' })).toEqual({ fields: { title: 'T' } })
  })

  it('lockLive issues FOR UPDATE', async () => {
    const db = fakeDb()
    await reviewFormDrafts.lockLive!(db as any, 'f1')
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE')
    expect(db.query.mock.calls[0][1]).toEqual(['f1'])
  })

  it('apply delegates to applyReviewFormContent', async () => {
    const db = fakeDb()
    await reviewFormDrafts.apply!(db as any, 'f1', { title: 'T' }, {} as any, {} as any)
    expect(db.query.mock.calls[0][0]).toContain('UPDATE review_forms SET')
  })
})

describe('publishReviewFormDraft', () => {
  it('forwards to mergeAndPublish', async () => {
    const actor = { id: 'a' } as any
    await publishReviewFormDraft('d1', { actor })
    expect(mergeAndPublish).toHaveBeenCalledWith(reviewFormDrafts, 'd1', actor, { actor })
  })

  it('defaults opts to {}', async () => {
    await publishReviewFormDraft('d2')
    expect(mergeAndPublish).toHaveBeenCalledWith(reviewFormDrafts, 'd2', undefined, {})
  })
})
