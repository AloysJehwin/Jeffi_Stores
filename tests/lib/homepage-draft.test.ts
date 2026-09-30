import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockClientQuery = vi.fn()
const tx = { rollbacks: 0 }
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  withTransaction: async (fn: any) => {
    try {
      return await fn({ query: (...a: any[]) => mockClientQuery(...a) })
    } catch (err) {
      tx.rollbacks++
      throw err
    }
  },
}))

import {
  applyDraftOrder,
  applyDraftPatch,
  discardHomepageDraft,
  endsBeforeStart,
  getEditableHomepage,
  getHomepageDraftSummary,
  nextDisplayOrder,
  publishHomepageDraft,
  withHomepageDraft,
} from '@/lib/catalog/homepage-draft'

const ADMIN_ID = '44444444-4444-4444-8444-444444444444'
const T0 = '2026-09-01T00:00:00.000Z'
const section = (id: string, display_order: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'promo_banner',
  title: id,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: {},
  display_order,
  is_active: true,
  starts_at: null,
  ends_at: null,
  created_at: T0,
  updated_at: T0,
  ...extra,
})
const slide = (id: string, display_order: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  subtitle: null,
  badge_text: null,
  badge_color: 'bg-primary-500',
  image_url: null,
  image_url_mobile: null,
  blurhash: null,
  blurhash_mobile: null,
  cta_label: null,
  cta_url: null,
  filter_category: null,
  filter_brand: null,
  filter_grade: null,
  filter_material: null,
  filter_min_price: null,
  filter_max_price: null,
  filter_in_stock: false,
  filter_on_sale: false,
  display_order,
  is_active: true,
  created_at: T0,
  updated_at: T0,
  ...extra,
})

function lockReturns(...rows: unknown[][]) {
  const queue = [...rows]
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) {
      const next = queue.length > 1 ? queue.shift()! : queue[0]
      return { rows: next, rowCount: next.length }
    }
    if (sql.includes('RETURNING')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  })
}
const sqlCalls = () => mockClientQuery.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  vi.clearAllMocks()
  tx.rollbacks = 0
})

describe('withHomepageDraft', () => {
  it('copies live into the draft on first use, locks it, and writes the mutated arrays back', async () => {
    lockReturns([{ sections: [section('a', 0)], hero_slides: [slide('s', 0)] }])
    const result = await withHomepageDraft(ADMIN_ID, draft => {
      draft.sections[0].title = 'Changed'
      return 'done'
    })
    expect(result).toBe('done')

    const [ensureSql, ensureParams] = mockClientQuery.mock.calls[0]
    expect(ensureSql).toContain('INSERT INTO homepage_drafts (id, sections, hero_slides, updated_by)')
    expect(ensureSql).toContain(
      'jsonb_agg(to_jsonb(t) ORDER BY t.display_order, t.created_at) FROM homepage_sections t'
    )
    expect(ensureSql).toContain('jsonb_agg(to_jsonb(t) ORDER BY t.display_order, t.created_at) FROM hero_slides t')
    expect(ensureSql).toContain('ON CONFLICT (id) DO NOTHING')
    expect(ensureParams).toEqual([ADMIN_ID])
    expect(mockClientQuery.mock.calls[1][0]).toContain('FROM homepage_drafts WHERE id = true FOR UPDATE')

    const [writeSql, writeParams] = mockClientQuery.mock.calls[2]
    expect(writeSql).toContain('UPDATE homepage_drafts')
    expect(JSON.parse(writeParams[0])[0].title).toBe('Changed')
    expect(JSON.parse(writeParams[1])).toEqual([slide('s', 0)])
    expect(writeParams[2]).toBe(ADMIN_ID)
    expect(sqlCalls().some(s => /^(INSERT INTO|UPDATE|DELETE FROM) (homepage_sections|hero_slides)\b/.test(s))).toBe(
      false
    )
  })

  it('rolls back without writing when the mutation changes nothing', async () => {
    lockReturns([{ sections: [section('a', 0)], hero_slides: [] }])
    const result = await withHomepageDraft(ADMIN_ID, draft => draft.sections.find(s => s.id === 'missing') ?? null)
    expect(result).toBeNull()
    expect(sqlCalls().some(s => s.startsWith('UPDATE homepage_drafts'))).toBe(false)
    expect(tx.rollbacks).toBe(1)
  })

  it('re-copies live and retries when a concurrent publish deleted the draft', async () => {
    lockReturns([], [{ sections: [], hero_slides: [] }])
    await withHomepageDraft(ADMIN_ID, draft => {
      draft.sections.push(section('n', 0) as any)
    })
    expect(sqlCalls().filter(s => s.startsWith('INSERT INTO homepage_drafts'))).toHaveLength(2)
    expect(sqlCalls().filter(s => s.startsWith('UPDATE homepage_drafts'))).toHaveLength(1)
  })

  it('records a null editor for a non-uuid admin id', async () => {
    lockReturns([{ sections: [], hero_slides: [] }])
    await withHomepageDraft('not-a-uuid', draft => {
      draft.sections.push(section('n', 0) as any)
    })
    expect(mockClientQuery.mock.calls[0][1]).toEqual([null])
    expect(mockClientQuery.mock.calls[2][1][2]).toBeNull()
  })
})

describe('getEditableHomepage', () => {
  it('returns the draft, ordered, with its editor', async () => {
    mockQueryOne.mockResolvedValueOnce({
      sections: [section('b', 1), section('a', 0)],
      hero_slides: [slide('s2', 1), slide('s1', 0)],
      updated_at: new Date('2026-09-26T10:00:00Z'),
      updated_by_name: 'Aloys Jehwin',
    })
    const editable = await getEditableHomepage()
    expect(editable.sections.map(s => s.id)).toEqual(['a', 'b'])
    expect(editable.heroSlides.map(s => s.id)).toEqual(['s1', 's2'])
    expect(editable.draft).toEqual({ updatedAt: '2026-09-26T10:00:00.000Z', updatedBy: 'Aloys Jehwin' })
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('falls back to the live rows when there is no draft', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sections: [section('a', 0)], hero_slides: [slide('s', 0)] })
    const editable = await getEditableHomepage()
    expect(editable).toEqual({ sections: [section('a', 0)], heroSlides: [slide('s', 0)], draft: null })
    expect(mockQueryOne.mock.calls[1][0]).toContain('FROM homepage_sections t')
  })

  it('treats a missing homepage_drafts table as no draft', async () => {
    mockQueryOne
      .mockRejectedValueOnce(Object.assign(new Error('relation "homepage_drafts" does not exist'), { code: '42P01' }))
      .mockResolvedValueOnce({ sections: [], hero_slides: [] })
    expect((await getEditableHomepage()).draft).toBeNull()
  })
})

describe('publishHomepageDraft', () => {
  it('returns null and touches nothing when there is no draft', async () => {
    lockReturns([])
    expect(await publishHomepageDraft()).toBeNull()
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
  })

  it('upserts both tables, prunes rows missing from the draft, then deletes the draft', async () => {
    const draftSections = [section('a', 0), section('n', 1)]
    const draftSlides = [slide('s', 0)]
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE'))
        return { rows: [{ sections: draftSections, hero_slides: draftSlides }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO homepage_sections'))
        return { rows: [{ inserted: false }, { inserted: true }], rowCount: 2 }
      if (sql.startsWith('INSERT INTO hero_slides')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('DELETE FROM homepage_sections')) return { rows: [], rowCount: 2 }
      return { rows: [], rowCount: 0 }
    })

    const result = await publishHomepageDraft()
    expect(result).toEqual({
      sections: { inserted: 1, updated: 1, deleted: 2 },
      heroSlides: { inserted: 0, updated: 0, deleted: 0 },
    })

    const calls = mockClientQuery.mock.calls
    expect(calls.map(c => (c[0] as string).split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'SELECT sections, hero_slides',
      'INSERT INTO homepage_sections',
      'DELETE FROM homepage_sections',
      'INSERT INTO hero_slides',
      'DELETE FROM hero_slides',
      'DELETE FROM homepage_drafts',
    ])
    const [upsertSql, upsertParams] = calls[1]
    expect(upsertSql).toContain('FROM jsonb_populate_recordset(NULL::homepage_sections, $1::jsonb) AS d')
    expect(upsertSql).toContain(`COALESCE(d.config, '{}'::jsonb)`)
    expect(upsertSql).toContain('COALESCE(d.is_active, true)')
    expect(upsertSql).toContain('ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type')
    expect(upsertSql).toContain('IS DISTINCT FROM')
    expect(JSON.parse(upsertParams[0])).toEqual(draftSections)
    expect(calls[2]).toEqual(['DELETE FROM homepage_sections WHERE NOT (id = ANY($1::uuid[]))', [['a', 'n']]])
    expect(calls[3][0]).toContain('COALESCE(d.filter_in_stock, false)')
    expect(calls[4][1]).toEqual([['s']])
  })

  it('propagates a failing statement so the transaction rolls back', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ sections: [section('a', 0)], hero_slides: [] }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO homepage_sections')) throw new Error('check violation')
      return { rows: [], rowCount: 0 }
    })
    await expect(publishHomepageDraft()).rejects.toThrow('check violation')
    expect(tx.rollbacks).toBe(1)
    expect(sqlCalls().some(s => s.startsWith('DELETE FROM homepage_drafts'))).toBe(false)
  })
})

describe('discardHomepageDraft', () => {
  it('deletes the draft row and reports whether there was one', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 })
    expect(await discardHomepageDraft()).toBe(true)
    expect(await discardHomepageDraft()).toBe(false)
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM homepage_drafts WHERE id = true')
  })
})

describe('getHomepageDraftSummary', () => {
  it('reports no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const summary = await getHomepageDraftSummary()
    expect(summary.hasDraft).toBe(false)
    expect(summary.sections).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('counts added, removed, edited and reordered rows by id', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        sections: [section('c', 0, { title: 'Edited' }), section('a', 1), section('n', 2)],
        hero_slides: [slide('s1', 0, { image_url: 'https://cdn/new.png' }), slide('s2', 1)],
        updated_at: '2026-09-26T10:00:00Z',
        updated_by_name: null,
      })
      .mockResolvedValueOnce({
        sections: [section('a', 0), section('b', 1), section('c', 2)],
        hero_slides: [slide('s1', 0), slide('s2', 1)],
      })
    expect(await getHomepageDraftSummary()).toEqual({
      hasDraft: true,
      updatedAt: '2026-09-26T10:00:00.000Z',
      updatedBy: null,
      sections: { added: 1, removed: 1, edited: 1, reordered: true },
      slides: { added: 0, removed: 0, edited: 1, reordered: false },
    })
  })

  it('ignores representation-only differences', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        sections: [
          section('a', 5, {
            starts_at: '2026-10-01T00:00:00.000Z',
            config: { b: 1, a: [1, 2] },
            subtitle: '',
            updated_at: '2026-09-20T00:00:00Z',
          }),
        ],
        hero_slides: [slide('s', 0, { filter_min_price: 10 })],
        updated_at: '2026-09-26T10:00:00Z',
        updated_by_name: 'Aloys Jehwin',
      })
      .mockResolvedValueOnce({
        sections: [section('a', 0, { starts_at: '2026-10-01T05:30:00+05:30', config: { a: [1, 2], b: 1 } })],
        hero_slides: [slide('s', 0, { filter_min_price: 10.0 })],
      })
    const summary = await getHomepageDraftSummary()
    expect(summary.sections).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(summary.slides).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(summary.updatedBy).toBe('Aloys Jehwin')
  })
})

describe('draft row helpers', () => {
  it('applyDraftOrder re-numbers listed ids, ignores unknown ones and bumps only moved rows', () => {
    const rows = [section('a', 0), section('b', 1), section('c', 2)]
    const ordered = applyDraftOrder(rows, ['c', 'ghost', 'a', 'b'])
    expect(ordered.map(r => [r.id, r.display_order])).toEqual([
      ['c', 0],
      ['a', 2],
      ['b', 3],
    ])
    expect(ordered.every(r => r.updated_at !== T0)).toBe(true)
    const same = applyDraftOrder([section('x', 0)], ['x'])
    expect(same[0].updated_at).toBe(T0)
  })

  it('applyDraftPatch assigns only differing values', () => {
    const row = section('a', 0, { config: { a: 1, b: 2 } })
    expect(applyDraftPatch(row, { config: { b: 2, a: 1 }, title: 'a' })).toBe(false)
    expect(row.updated_at).toBe(T0)
    expect(applyDraftPatch(row, { title: 'New' })).toBe(true)
    expect(row.title).toBe('New')
    expect(row.updated_at).not.toBe(T0)
  })

  it('nextDisplayOrder mirrors COALESCE(MAX(display_order), -1) + 1', () => {
    expect(nextDisplayOrder([])).toBe(0)
    expect(nextDisplayOrder([{ display_order: 0 }, { display_order: 7 }, { display_order: 3 }])).toBe(8)
  })

  it('endsBeforeStart mirrors the homepage_sections window check', () => {
    expect(endsBeforeStart(null, '2026-10-01T00:00:00Z')).toBe(false)
    expect(endsBeforeStart('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')).toBe(true)
    expect(endsBeforeStart('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')).toBe(false)
  })
})
