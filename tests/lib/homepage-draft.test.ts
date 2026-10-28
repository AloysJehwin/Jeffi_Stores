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
  copySurfaceLayout,
  SurfaceNotEmpty,
  discardHomepageDraft,
  endsBeforeStart,
  getEditableHomepage,
  getHomepageDraftSummary,
  homepageDrafts,
  nextDisplayOrder,
  withHomepageDraft,
} from '@/lib/catalog/homepage-draft'
import { DraftNotFoundError } from '@/lib/admin/draft-branches'
import { project, threeWayMerge, type Content } from '@/lib/admin/draft-merge'

const ADMIN_ID = '44444444-4444-4444-8444-444444444444'
const DRAFT_ID = '55555555-5555-4555-8555-555555555555'
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

function lockReturns(rows: unknown[]) {
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) return { rows, rowCount: rows.length }
    return { rows: [], rowCount: 1 }
  })
}
const sqlCalls = () => mockClientQuery.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  vi.clearAllMocks()
  tx.rollbacks = 0
})

describe('withHomepageDraft', () => {
  it('locks the named draft and writes the mutated arrays back to it', async () => {
    lockReturns([{ sections: [section('a', 0)], hero_slides: [slide('s', 0)] }])
    const result = await withHomepageDraft(DRAFT_ID, ADMIN_ID, draft => {
      draft.sections[0].title = 'Changed'
      return 'done'
    })
    expect(result).toBe('done')

    const [lockSql, lockParams] = mockClientQuery.mock.calls[0]
    expect(lockSql).toContain('FROM homepage_draft_branches WHERE id = $1 FOR UPDATE')
    expect(lockParams).toEqual([DRAFT_ID])

    const [writeSql, writeParams] = mockClientQuery.mock.calls[1]
    expect(writeSql).toContain('UPDATE homepage_draft_branches')
    expect(JSON.parse(writeParams[0])[0].title).toBe('Changed')
    expect(JSON.parse(writeParams[1])).toEqual([slide('s', 0, { surface: 'web', audience: 'store' })])
    expect(writeParams.slice(2)).toEqual([ADMIN_ID, DRAFT_ID])
    expect(sqlCalls().some(s => /^(INSERT INTO|UPDATE|DELETE FROM) (homepage_sections|hero_slides)\b/.test(s))).toBe(
      false
    )
  })

  it('rolls back without writing when the mutation changes nothing', async () => {
    lockReturns([{ sections: [section('a', 0)], hero_slides: [] }])
    const result = await withHomepageDraft(DRAFT_ID, ADMIN_ID, draft => draft.sections.find(s => s.id === 'missing') ?? null)
    expect(result).toBeNull()
    expect(sqlCalls().some(s => s.startsWith('UPDATE homepage_draft_branches'))).toBe(false)
    expect(tx.rollbacks).toBe(1)
  })

  it('refuses a draft that was published or discarded meanwhile', async () => {
    lockReturns([])
    await expect(withHomepageDraft(DRAFT_ID, ADMIN_ID, () => 1)).rejects.toBeInstanceOf(DraftNotFoundError)
    expect(sqlCalls()).toHaveLength(1)
  })

  it('records a null editor for a non-uuid admin id', async () => {
    lockReturns([{ sections: [], hero_slides: [] }])
    await withHomepageDraft(DRAFT_ID, 'not-a-uuid', draft => {
      draft.sections.push(section('n', 0) as any)
    })
    expect(mockClientQuery.mock.calls[1][1][2]).toBeNull()
  })
})

describe('getEditableHomepage', () => {
  it('returns the draft, ordered, with its title and editor', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: DRAFT_ID,
      title: 'Diwali',
      author_admin_id: ADMIN_ID,
      sections: [section('b', 1), section('a', 0)],
      hero_slides: [slide('s2', 1), slide('s1', 0)],
      updated_at: new Date('2026-09-26T10:00:00Z'),
      updated_by_name: 'Aloys Jehwin',
    })
    const editable = await getEditableHomepage(DRAFT_ID)
    expect(editable.sections.map(s => s.id)).toEqual(['a', 'b'])
    expect(editable.heroSlides.map(s => s.id)).toEqual(['s1', 's2'])
    expect(editable.draft).toEqual({
      id: DRAFT_ID,
      title: 'Diwali',
      authorId: ADMIN_ID,
      updatedAt: '2026-09-26T10:00:00.000Z',
      updatedBy: 'Aloys Jehwin',
    })
    expect(mockQueryOne.mock.calls[0][1]).toEqual([DRAFT_ID])
  })

  it('shows the live rows without a draft id', async () => {
    mockQueryOne.mockResolvedValueOnce({ sections: [section('a', 0)], hero_slides: [slide('s', 0)] })
    const editable = await getEditableHomepage()
    // Rows from before the surface / page / audience columns existed read as web / home / store.
    expect(editable).toEqual({
      sections: [section('a', 0, { surface: 'web', page: 'home', audience: 'store' })],
      heroSlides: [slide('s', 0, { surface: 'web', audience: 'store' })],
      draft: null,
    })
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
    expect(mockQueryOne.mock.calls[0][0]).toContain('FROM homepage_sections t')
  })

  it('falls back to live when the draft is gone', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ sections: [], hero_slides: [] })
    expect((await getEditableHomepage(DRAFT_ID)).draft).toBeNull()
  })
})

describe('publishing a draft', () => {
  const content = (sections: unknown[], slides: unknown[] = []) =>
    homepageDrafts.toContent({ sections, hero_slides: slides })
  const merge = (base: Content, mine: Content, live: Content) => {
    const shape = [mine, base]
    return threeWayMerge(project(base, shape), mine, project(live, shape), { arrayKeys: homepageDrafts.arrayKeys })
  }

  it('keeps edits two drafts made to different sections', () => {
    const base = content([section('a', 0), section('b', 1)])
    const live = content([section('a', 0), section('b', 1, { title: 'Theirs' })])
    const mine = content([section('a', 0, { title: 'Mine' }), section('b', 1)])
    const r = merge(base, mine, live)
    expect(r.conflicts).toEqual([])
    expect((r.merged.sections as any[]).map(s => [s.id, s.title])).toEqual([
      ['a', 'Mine'],
      ['b', 'Theirs'],
    ])
  })

  it('asks when both drafts changed the same section setting', () => {
    const base = content([section('a', 0, { config: { limit: 4 } })])
    const live = content([section('a', 0, { config: { limit: 8 } })])
    const mine = content([section('a', 0, { config: { limit: 12 } })])
    expect(merge(base, mine, live).conflicts.map(c => c.path)).toEqual(['sections[a].config'])
  })

  it('settles position clashes for the draft being published', () => {
    const conflict = (path: string) => ({ path, label: '', base: 0, theirs: 1, mine: 2 })
    expect(homepageDrafts.autoResolve!(conflict('sections[a].display_order'))).toBe('mine')
    expect(homepageDrafts.autoResolve!(conflict('sections[a].config'))).toBeNull()
  })

  it('leaves updated_at out and reads times as ISO so untouched rows never clash', () => {
    const [row] = content([section('a', 0, { starts_at: '2026-10-01T05:30:00+05:30' })]).sections as any[]
    expect(row).not.toHaveProperty('updated_at')
    expect(row.starts_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('upserts both live tables and prunes rows the merge dropped', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO homepage_sections')) return { rows: [{ inserted: false }, { inserted: true }], rowCount: 2 }
      return { rows: [], rowCount: 0 }
    })
    const merged = { sections: [section('a', 0), section('n', 1)], hero_slides: [slide('s', 0)] }
    await homepageDrafts.apply({ query: mockClientQuery } as any, DRAFT_ID, merged, {}, null)

    const calls = mockClientQuery.mock.calls
    expect(calls.map(c => (c[0] as string).split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'INSERT INTO homepage_sections',
      'DELETE FROM homepage_sections',
      'INSERT INTO hero_slides',
      'DELETE FROM hero_slides',
    ])
    const [upsertSql, upsertParams] = calls[0]
    expect(upsertSql).toContain('FROM jsonb_populate_recordset(NULL::homepage_sections, $1::jsonb) AS d')
    expect(upsertSql).toContain(`COALESCE(d.config, '{}'::jsonb)`)
    expect(upsertSql).toContain('COALESCE(d.is_active, true)')
    expect(upsertSql).toContain('ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type')
    expect(upsertSql).toContain('IS DISTINCT FROM')
    expect(JSON.parse(upsertParams[0])).toEqual(merged.sections)
    expect(calls[1]).toEqual(['DELETE FROM homepage_sections WHERE NOT (id = ANY($1::uuid[]))', [['a', 'n']]])
    expect(calls[2][0]).toContain('COALESCE(d.filter_in_stock, false)')
    expect(calls[3][1]).toEqual([['s']])
  })
})

describe('discardHomepageDraft', () => {
  it('deletes the named draft and reports whether there was one', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 })
    expect(await discardHomepageDraft(DRAFT_ID)).toBe(true)
    expect(await discardHomepageDraft(DRAFT_ID)).toBe(false)
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM homepage_draft_branches WHERE id = $1', [DRAFT_ID])
  })
})

describe('getHomepageDraftSummary', () => {
  const draftRow = (extra: Record<string, unknown>) => ({
    id: DRAFT_ID,
    title: null,
    author_admin_id: null,
    base: null,
    updated_at: '2026-09-26T10:00:00Z',
    updated_by_name: null,
    ...extra,
  })

  it('reports no draft', async () => {
    const summary = await getHomepageDraftSummary(null)
    expect(summary.hasDraft).toBe(false)
    expect(summary.sections).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('counts added, removed, edited and reordered rows by id, overall and per surface', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        draftRow({
          sections: [
            section('c', 0, { title: 'Edited' }),
            section('a', 1),
            section('n', 2),
            section('m', 3, { surface: 'app' }),
          ],
          hero_slides: [slide('s1', 0, { image_url: 'https://cdn/new.png' }), slide('s2', 1)],
        })
      )
      .mockResolvedValueOnce({
        sections: [section('a', 0), section('b', 1), section('c', 2)],
        hero_slides: [slide('s1', 0), slide('s2', 1)],
      })
    const none = { added: 0, removed: 0, edited: 0, reordered: false }
    const bySurface = {
      web: {
        sections: { added: 1, removed: 1, edited: 1, reordered: true },
        slides: { added: 0, removed: 0, edited: 1, reordered: false },
      },
      web_mobile: { sections: none, slides: none },
      app: { sections: { ...none, added: 1 }, slides: none },
    }
    const empty = { web: { sections: none, slides: none }, web_mobile: { sections: none, slides: none }, app: { sections: none, slides: none } }
    expect(await getHomepageDraftSummary(DRAFT_ID)).toEqual({
      hasDraft: true,
      title: null,
      updatedAt: '2026-09-26T10:00:00.000Z',
      updatedBy: null,
      sections: { added: 2, removed: 1, edited: 1, reordered: true },
      slides: { added: 0, removed: 0, edited: 1, reordered: false },
      bySurface,
      byPage: { home: bySurface, products: empty, category: empty, brand: empty },
      business: empty,
    })
  })

  it("diffs against the live the draft started from, so others' publishes don't count", async () => {
    mockQueryOne.mockResolvedValueOnce(
      draftRow({
        base: { sections: [section('a', 0)], hero_slides: [] },
        sections: [section('a', 0, { title: 'Mine' })],
        hero_slides: [],
      })
    )
    const summary = await getHomepageDraftSummary(DRAFT_ID)
    expect(summary.sections).toEqual({ added: 0, removed: 0, edited: 1, reordered: false })
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('ignores representation-only differences', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        draftRow({
          sections: [
            section('a', 5, {
              starts_at: '2026-10-01T00:00:00.000Z',
              config: { b: 1, a: [1, 2] },
              subtitle: '',
              updated_at: '2026-09-20T00:00:00Z',
            }),
          ],
          hero_slides: [slide('s', 0, { filter_min_price: 10 })],
          updated_by_name: 'Aloys Jehwin',
        })
      )
      .mockResolvedValueOnce({
        sections: [section('a', 0, { starts_at: '2026-10-01T05:30:00+05:30', config: { a: [1, 2], b: 1 } })],
        hero_slides: [slide('s', 0, { filter_min_price: 10.0 })],
      })
    const summary = await getHomepageDraftSummary(DRAFT_ID)
    expect(summary.sections).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(summary.slides).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(summary.updatedBy).toBe('Aloys Jehwin')
  })
})

describe('copySurfaceLayout', () => {
  // Loosely typed: the helpers above build rows without the optional `surface` key.
  type Draft = { sections: any[]; heroSlides: any[] }
  const T1 = '2026-10-24T00:00:00.000Z'
  let n = 0
  const newId = () => `new-${++n}`
  beforeEach(() => {
    n = 0
  })

  it('copies the source rows onto the target with fresh ids, renumbered, leaving the source alone', () => {
    const draft: Draft = {
      sections: [section('b', 5, { surface: 'web' }), section('a', 2, { surface: 'web', config: { source: 'featured' } })],
      heroSlides: [slide('s', 3, { surface: 'web' })],
    }
    const result = copySurfaceLayout(draft, 'web', 'app', { now: T1, newId })
    expect(result).toEqual({ sections: 2, slides: 1, replaced: 0 })
    const app = draft.sections.filter(r => r.surface === 'app')
    expect(app.map(r => [r.id, r.title, r.display_order, r.created_at])).toEqual([
      ['new-1', 'a', 0, T1],
      ['new-2', 'b', 1, T1],
    ])
    expect(app[0].config).toEqual({ source: 'featured' })
    expect(draft.sections.filter(r => r.surface === 'web').map(r => r.id)).toEqual(['b', 'a'])
    expect(draft.heroSlides.map(r => [r.id, r.surface, r.display_order])).toEqual([
      ['s', 'web', 3],
      ['new-3', 'app', 0],
    ])
  })

  it('refuses a target that already has rows unless asked to replace them', () => {
    const draft: Draft = {
      sections: [section('w', 0, { surface: 'web' }), section('old', 0, { surface: 'app' })],
      heroSlides: [slide('os', 0, { surface: 'app' })],
    }
    expect(() => copySurfaceLayout(draft, 'web', 'app', { now: T1, newId })).toThrow(SurfaceNotEmpty)
    expect(draft.sections.map(r => r.id)).toEqual(['w', 'old'])
    const result = copySurfaceLayout(draft, 'web', 'app', { now: T1, newId, replace: true })
    expect(result).toEqual({ sections: 1, slides: 0, replaced: 2 })
    expect(draft.sections.map(r => [r.id, r.surface])).toEqual([
      ['w', 'web'],
      ['new-1', 'app'],
    ])
    expect(draft.heroSlides).toEqual([])
  })

  it('materialises the built-in default layout when the source has no sections', () => {
    const draft: Draft = { sections: [], heroSlides: [] }
    const result = copySurfaceLayout(draft, 'web', 'app', { now: T1, newId })
    expect(result.sections).toBeGreaterThan(5)
    expect(draft.sections.every(r => r.surface === 'app' && r.id.startsWith('new-') && r.is_active)).toBe(true)
    expect(draft.sections[0].type).toBe('hero')
  })

  it('rejects copying a surface onto itself', () => {
    expect(() => copySurfaceLayout({ sections: [], heroSlides: [] }, 'web', 'web')).toThrow(/same/)
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
