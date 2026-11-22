import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('crypto', async orig => ({ ...(await orig<typeof import('crypto')>()), randomUUID: vi.fn(() => 'new-uuid') }))

// draft-locks / draft-branches helpers used by the DB functions.
vi.mock('@/lib/admin/draft-locks', () => ({
  HOMEPAGE_ENTITY_ID: 'homepage',
  actorOf: vi.fn((a: unknown) => a),
  announceDraftClosed: vi.fn(async () => {}),
  announceDraftLock: vi.fn(async () => {}),
  assertDraftHolder: vi.fn(async () => null),
  canDiscard: vi.fn(async () => ({ ok: true })),
  closeDraftLockTx: vi.fn(async () => null),
  epochFrom: vi.fn(() => 7),
  lockedOr: vi.fn(() => ({ status: 423 })),
}))
vi.mock('@/lib/admin/draft-branches', () => ({
  DraftNotFoundError: class DraftNotFoundError extends Error {},
  createDraft: vi.fn(async () => 'draft-created'),
  draftConflictResponse: vi.fn(() => null),
  mergeAndPublish: vi.fn(async () => ({ inserted: 1 })),
}))

import {
  homepageDraftIdFrom,
  noHomepageDraft,
  homepageLockFrom,
  nextDisplayOrder,
  applyDraftPatch,
  applyDraftOrder,
  applyDraftLayout,
  nextDisplayOrderOn,
  copySurfaceLayout,
  SurfaceNotEmpty,
  endsBeforeStart,
  withHomepageDraft,
  discardHomepageDraft,
  createHomepageDraft,
  getEditableHomepage,
  getHomepageDraftSummary,
  type HomepageDraftState,
  type DraftSection,
} from '@/lib/catalog/homepage-draft'
import { HOMEPAGE_DRAFT_HEADER } from '@/lib/catalog/homepage-sections'
import { query as _query, queryOne as _queryOne, withTransaction as _withTransaction } from '@/lib/shared/db'
import { canDiscard as _canDiscard } from '@/lib/admin/draft-locks'
import { createDraft as _createDraft, mergeAndPublish as _mergeAndPublish } from '@/lib/admin/draft-branches'

const query = vi.mocked(_query)
const queryOne = vi.mocked(_queryOne)
const withTransaction = vi.mocked(_withTransaction)
const canDiscard = vi.mocked(_canDiscard)
const createDraft = vi.mocked(_createDraft)
const mergeAndPublish = vi.mocked(_mergeAndPublish)

const UUID = '11111111-1111-4111-8111-111111111111'

const headers = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null })

const section = (over: Partial<DraftSection> = {}): DraftSection =>
  ({
    id: over.id ?? 's1',
    type: over.type ?? 'hero',
    title: null,
    subtitle: null,
    eyebrow: null,
    cta_label: null,
    cta_url: null,
    config: over.config ?? {},
    display_order: over.display_order ?? 0,
    is_active: true,
    starts_at: null,
    ends_at: null,
    created_at: over.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: over.updated_at ?? '2026-01-01T00:00:00.000Z',
    surface: over.surface ?? 'web',
    page: over.page ?? 'home',
    audience: over.audience ?? 'store',
    ...over,
  }) as DraftSection

beforeEach(() => {
  query.mockReset()
  queryOne.mockReset()
  withTransaction.mockReset()
  canDiscard.mockReset().mockResolvedValue({ ok: true } as never)
  createDraft.mockReset().mockResolvedValue('draft-created')
  mergeAndPublish.mockReset().mockResolvedValue({ inserted: 1 } as never)
})

describe('homepageDraftIdFrom', () => {
  it('reads a valid UUID from the header', () => {
    expect(homepageDraftIdFrom({ headers: headers({ [HOMEPAGE_DRAFT_HEADER]: UUID }) })).toBe(UUID)
  })

  it('falls back to the ?draft= query param', () => {
    expect(homepageDraftIdFrom({ url: `http://x/api?draft=${UUID}`, headers: headers({}) })).toBe(UUID)
  })

  it('returns null for a malformed id', () => {
    expect(homepageDraftIdFrom({ headers: headers({ [HOMEPAGE_DRAFT_HEADER]: 'nope' }) })).toBeNull()
  })

  it('returns null when neither header nor url supplies one', () => {
    expect(homepageDraftIdFrom({ headers: headers({}) })).toBeNull()
  })
})

describe('noHomepageDraft', () => {
  it('builds a 400 NO_DRAFT response', async () => {
    const res = noHomepageDraft()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Open a homepage draft first', code: 'NO_DRAFT' })
  })
})

describe('homepageLockFrom', () => {
  it('wraps the actor and the epoch', () => {
    const out = homepageLockFrom({ adminId: 'a1', role: 'admin', scopes: [] }, { headers: headers({}) })
    expect(out.epoch).toBe(7)
    expect(out.actor).toEqual({ adminId: 'a1', role: 'admin', scopes: [] })
  })
})

describe('nextDisplayOrder', () => {
  it('returns 0 for an empty list', () => {
    expect(nextDisplayOrder([])).toBe(0)
  })

  it('returns max + 1 otherwise', () => {
    expect(nextDisplayOrder([{ display_order: 2 }, { display_order: 5 }, { display_order: 1 }])).toBe(6)
  })
})

describe('applyDraftPatch', () => {
  it('assigns only changed fields and bumps updated_at', () => {
    const row: Record<string, unknown> = { a: 1, b: 2, updated_at: 'old' }
    const changed = applyDraftPatch(row, { a: 1, b: 3 })
    expect(changed).toBe(true)
    expect(row.b).toBe(3)
    expect(row.updated_at).not.toBe('old')
  })

  it('returns false and leaves updated_at when nothing changed', () => {
    const row: Record<string, unknown> = { a: 1, updated_at: 'old' }
    expect(applyDraftPatch(row, { a: 1 })).toBe(false)
    expect(row.updated_at).toBe('old')
  })

  it('compares objects canonically (key order insensitive)', () => {
    const row: Record<string, unknown> = { cfg: { x: 1, y: 2 } }
    expect(applyDraftPatch(row, { cfg: { y: 2, x: 1 } })).toBe(false)
  })
})

describe('applyDraftOrder', () => {
  it('sets display_order by position and sorts', () => {
    const rows = [section({ id: 'a' }), section({ id: 'b' }), section({ id: 'c' })]
    const out = applyDraftOrder(rows, ['c', 'a', 'b'])
    expect(out.map(r => r.id)).toEqual(['c', 'a', 'b'])
    expect(out.map(r => r.display_order)).toEqual([0, 1, 2])
  })

  it('ignores non-string and duplicate ids in the order list', () => {
    const rows = [section({ id: 'a' }), section({ id: 'b' })]
    const out = applyDraftOrder(rows, ['b', 'b', 123 as unknown as string, 'a'])
    // b -> 0, a -> 1 (second b ignored)
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('applyDraftLayout', () => {
  it('sets a half side and reorders', () => {
    const rows = [section({ id: 'a' }), section({ id: 'b' })]
    const out = applyDraftLayout(rows, ['b', 'a'], { a: 'left', b: 'right' })
    const a = out.find(r => r.id === 'a')!
    const b = out.find(r => r.id === 'b')!
    expect((a.config as { layout?: { side?: string } }).layout?.side).toBe('left')
    expect((b.config as { layout?: { side?: string } }).layout?.side).toBe('right')
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('strips the layout when the side is full', () => {
    const rows = [section({ id: 'a', config: { layout: { side: 'left' }, foo: 1 } })]
    const out = applyDraftLayout(rows, ['a'], { a: 'full' })
    const cfg = out[0].config as Record<string, unknown>
    expect(cfg.layout).toBeUndefined()
    expect(cfg.foo).toBe(1)
  })

  it('leaves rows with an invalid side untouched', () => {
    const rows = [section({ id: 'a', config: { foo: 1 } })]
    const out = applyDraftLayout(rows, ['a'], { a: 'weird' })
    expect(out[0].config).toEqual({ foo: 1 })
  })
})

describe('nextDisplayOrderOn', () => {
  it('counts only the matching surface/page/audience', () => {
    const rows = [
      section({ id: 'a', display_order: 0, surface: 'web', page: 'home', audience: 'store' }),
      section({ id: 'b', display_order: 3, surface: 'web', page: 'home', audience: 'store' }),
      section({ id: 'c', display_order: 9, surface: 'app', page: 'home', audience: 'store' }),
    ]
    expect(nextDisplayOrderOn(rows, 'home', 'store', 'web')).toBe(4)
    expect(nextDisplayOrderOn(rows, 'home', 'store', 'app')).toBe(10)
    // No matches -> 0.
    expect(nextDisplayOrderOn(rows, 'products', 'store', 'web')).toBe(0)
  })
})

describe('endsBeforeStart', () => {
  it('is false when either bound is missing', () => {
    expect(endsBeforeStart(null, '2026-01-02')).toBe(false)
    expect(endsBeforeStart('2026-01-01', null)).toBe(false)
  })

  it('is true when end <= start', () => {
    expect(endsBeforeStart('2026-01-02', '2026-01-01')).toBe(true)
    expect(endsBeforeStart('2026-01-02', '2026-01-02')).toBe(true)
  })

  it('is false when end is after start', () => {
    expect(endsBeforeStart('2026-01-01', '2026-01-02')).toBe(false)
  })
})

describe('copySurfaceLayout', () => {
  let n = 0
  const newId = () => `id-${n++}`
  beforeEach(() => (n = 0))

  const state = (over: Partial<HomepageDraftState> = {}): HomepageDraftState => ({
    sections: over.sections ?? [],
    heroSlides: over.heroSlides ?? [],
  })

  it('throws when source and target are identical', () => {
    expect(() => copySurfaceLayout(state(), 'web', 'web')).toThrow('Source and target surface are the same')
  })

  it('refuses to overwrite a non-empty target without replace', () => {
    const draft = state({ sections: [section({ id: 't', surface: 'app', page: 'home', audience: 'store' })] })
    expect(() => copySurfaceLayout(draft, 'web', 'app')).toThrow(SurfaceNotEmpty)
  })

  it('copies the default home layout for an empty store source, with fresh ids', () => {
    const draft = state()
    const result = copySurfaceLayout(draft, 'web', 'app', { newId, now: '2026-02-02T00:00:00.000Z' })
    expect(result.sections).toBeGreaterThan(0)
    expect(result.replaced).toBe(0)
    // Copied onto app, store audience, fresh ids.
    const copied = draft.sections.filter(s => s.surface === 'app')
    expect(copied.length).toBe(result.sections)
    expect(copied.every(s => s.id.startsWith('id-'))).toBe(true)
    expect(copied.every(s => s.created_at === '2026-02-02T00:00:00.000Z')).toBe(true)
  })

  it('copies real source sections and hero slides on the homepage', () => {
    const draft = state({
      sections: [
        section({ id: 'src1', surface: 'web', page: 'home', audience: 'store', display_order: 1 }),
        section({ id: 'src2', surface: 'web', page: 'home', audience: 'store', display_order: 0 }),
      ],
      heroSlides: [{ id: 'h1', surface: 'web', audience: 'store', display_order: 0 } as never],
    })
    const result = copySurfaceLayout(draft, 'web', 'app', { newId })
    expect(result.sections).toBe(2)
    expect(result.slides).toBe(1)
    const appSlides = (draft.heroSlides as { surface?: string }[]).filter(s => s.surface === 'app')
    expect(appSlides.length).toBe(1)
  })

  it('replaces an existing target layout when replace is set', () => {
    const draft = state({
      sections: [
        section({ id: 'src', surface: 'web', page: 'home', audience: 'store' }),
        section({ id: 'old', surface: 'app', page: 'home', audience: 'store' }),
      ],
    })
    const result = copySurfaceLayout(draft, 'web', 'app', { newId, replace: true })
    expect(result.replaced).toBe(1)
    // old target rows removed.
    expect(draft.sections.some(s => s.id === 'old')).toBe(false)
  })

  it('leaves out section types the target audience cannot use', () => {
    const draft = state({
      sections: [
        // business_cta is store-only; copying to a business audience should drop it.
        section({ id: 'cta', type: 'business_cta', surface: 'web', page: 'home', audience: 'store' }),
        section({ id: 'hero', type: 'hero', surface: 'web', page: 'home', audience: 'store' }),
      ],
    })
    const result = copySurfaceLayout(draft, 'web', 'web', { newId, audience: 'business', fromAudience: 'store' })
    const copied = draft.sections.filter(s => s.audience === 'business')
    expect(copied.some(s => s.type === 'business_cta')).toBe(false)
    expect(result.sections).toBe(copied.length)
  })

  it('does not copy hero slides for a listing page', () => {
    const draft = state({
      sections: [section({ id: 'src', surface: 'web', page: 'products', audience: 'store' })],
      heroSlides: [{ id: 'h1', surface: 'web', audience: 'store', display_order: 0 } as never],
    })
    const result = copySurfaceLayout(draft, 'web', 'app', { newId, page: 'products' })
    expect(result.slides).toBe(0)
  })
})

describe('getEditableHomepage', () => {
  it('returns live content with draft:null when no draft id', async () => {
    queryOne.mockResolvedValueOnce({ sections: [section({ id: 'a' })], hero_slides: [] })
    const out = await getEditableHomepage(null)
    expect(out.draft).toBeNull()
    expect(out.sections[0].id).toBe('a')
  })

  it('returns the draft content when a draft exists', async () => {
    queryOne.mockResolvedValueOnce({
      id: UUID,
      title: 'My draft',
      author_admin_id: 'adm',
      base: null,
      sections: [section({ id: 's', display_order: 0 })],
      hero_slides: [],
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by_name: 'Alice',
    })
    const out = await getEditableHomepage(UUID)
    expect(out.draft?.id).toBe(UUID)
    expect(out.draft?.title).toBe('My draft')
    expect(out.draft?.updatedBy).toBe('Alice')
    expect(out.sections[0].id).toBe('s')
  })
})

describe('withHomepageDraft', () => {
  it('runs the mutate inside a transaction and writes both arrays', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ sections: [section({ id: 's' })], hero_slides: [] }] }) // LOCK
        .mockResolvedValue({ rows: [], rowCount: 1 }), // WRITE
    }
    withTransaction.mockImplementation((async (fn: (c: any) => unknown) => fn(client)) as never)
    const result = await withHomepageDraft(UUID, 'adm', draft => {
      draft.sections.push(section({ id: 'new' }))
      return 'done'
    })
    expect(result).toBe('done')
    // LOCK then WRITE.
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE')
    expect(client.query.mock.calls[1][0]).toContain('UPDATE homepage_draft_branches')
  })

  it('returns the mutate result without writing when nothing changed', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ sections: [section({ id: 's' })], hero_slides: [] }] }),
    }
    withTransaction.mockImplementation((async (fn: (c: any) => unknown) => fn(client)) as never)
    const result = await withHomepageDraft(UUID, 'adm', () => 'noop')
    expect(result).toBe('noop')
    // Only the LOCK query ran; no WRITE.
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('throws DraftNotFoundError when the draft row is gone', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    withTransaction.mockImplementation((async (fn: (c: any) => unknown) => fn(client)) as never)
    await expect(withHomepageDraft(UUID, 'adm', () => 'x')).rejects.toThrow()
  })
})

describe('discardHomepageDraft', () => {
  it('deletes directly when there is no actor', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 } as never)
    expect(await discardHomepageDraft(UUID)).toBe(true)
    expect(query.mock.calls[0][0]).toContain('DELETE FROM homepage_draft_branches')
  })

  it('returns false when the direct delete removed nothing', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 } as never)
    expect(await discardHomepageDraft(UUID)).toBe(false)
  })

  it('discards inside a transaction when an actor holds the draft', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    withTransaction.mockImplementation((async (fn: (c: any) => unknown) => fn(client)) as never)
    const ok = await discardHomepageDraft(UUID, { actor: { adminId: 'adm', role: 'owner', scopes: [] } })
    expect(ok).toBe(true)
  })

  it('throws when the actor may not discard', async () => {
    canDiscard.mockResolvedValue({ ok: false, error: new Error('nope') } as never)
    await expect(
      discardHomepageDraft(UUID, { actor: { adminId: 'adm', role: 'editor', scopes: [] } })
    ).rejects.toThrow('nope')
  })
})

describe('createHomepageDraft / publish delegate to draft-branches', () => {
  it('createHomepageDraft calls createDraft', async () => {
    const id = await createHomepageDraft({ adminId: 'adm', role: 'admin', scopes: [] }, 'title')
    expect(id).toBe('draft-created')
    expect(createDraft).toHaveBeenCalled()
  })
})

describe('getHomepageDraftSummary', () => {
  it('returns the empty summary when there is no draft', async () => {
    queryOne.mockResolvedValueOnce(null)
    const sum = await getHomepageDraftSummary('not-a-uuid')
    expect(sum.hasDraft).toBe(false)
    expect(sum.sections).toEqual({ added: 0, removed: 0, edited: 0, reordered: false })
    expect(sum.bySurface.web.sections.added).toBe(0)
    expect(sum.byPage.home.web.sections.added).toBe(0)
    expect(sum.business.web.sections.added).toBe(0)
  })

  it('diffs the draft against its base', async () => {
    const base = { sections: [section({ id: 'keep', display_order: 0 })], hero_slides: [] }
    queryOne.mockResolvedValueOnce({
      id: UUID,
      title: 'D',
      author_admin_id: null,
      base,
      // draft: keeps 'keep' edited (title changed) and adds 'extra'.
      sections: [
        { ...section({ id: 'keep', display_order: 0 }), title: 'Changed' },
        section({ id: 'extra', display_order: 1 }),
      ],
      hero_slides: [],
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by_name: 'Bob',
    })
    const sum = await getHomepageDraftSummary(UUID)
    expect(sum.hasDraft).toBe(true)
    expect(sum.sections.added).toBe(1)
    expect(sum.sections.edited).toBe(1)
    expect(sum.sections.removed).toBe(0)
  })
})
