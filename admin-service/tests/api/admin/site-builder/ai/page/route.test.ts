import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/studio/redesign', () => {
  class PageRedoRefused extends Error {
    constructor(message: string, public status: 400 | 404 | 409) {
      super(message)
    }
  }
  return { PageRedoRefused, pageRedoStatus: vi.fn(), startPageRedo: vi.fn() }
})
vi.mock('@/lib/site/studio/keep-words', () => ({ pageWords: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ getPublishedPage: vi.fn(), getSiteDraft: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/site-builder/ai/page/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { siteAiAvailable } from '@/lib/site/ai-status'
import { PageRedoRefused, pageRedoStatus, startPageRedo } from '@/lib/site/studio/redesign'
import { pageWords } from '@/lib/site/studio/keep-words'
import { getPublishedPage, getSiteDraft } from '@/lib/site/store'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const DRAFT = '11111111-1111-4111-8111-111111111111'
const BODY = { draftId: DRAFT, ref: { audience: 'store', page: 'home' } }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const post = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/page', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })
const get = (qs = `?draft=${DRAFT}`) => new NextRequest(`http://localhost/api/admin/site-builder/ai/page${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
  vi.mocked(siteAiAvailable).mockResolvedValue(true)
  vi.mocked(startPageRedo).mockResolvedValue({ id: 'job1', status: 'running' } as any)
})

describe('POST /api/admin/site-builder/ai/page', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(post(BODY))).status).toBe(401)
    expect(startPageRedo).not.toHaveBeenCalled()
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(post(BODY))).status).toBe(403)
    expect(startPageRedo).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ ref: BODY.ref }], [{ ...BODY, draftId: 'nope' }], [{ ...BODY, surfaces: [] }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(post(body))).status).toBe(400)
    expect(startPageRedo).not.toHaveBeenCalled()
  })

  it('returns 503 and starts nothing while the AI is unavailable', async () => {
    vi.mocked(siteAiAvailable).mockResolvedValue(false)
    expect((await POST(post(BODY))).status).toBe(503)
    expect(startPageRedo).not.toHaveBeenCalled()
  })

  it('starts the redo on both surfaces by default and answers 202 with the job', async () => {
    const res = await POST(post(BODY))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ job: { id: 'job1', status: 'running' } })
    expect(startPageRedo).toHaveBeenCalledWith(DRAFT, { audience: 'store', page: 'home' }, ['web', 'web_mobile'], 'a1', { keepWords: [] })
    expect(pageWords).not.toHaveBeenCalled()
  })

  it('keeps the draft page words when keepWords is set', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue({ docs: { pages: { 'store:web:home:': { order: [], blocks: {} } } } } as any)
    vi.mocked(pageWords).mockReturnValue(['Welcome', 'Shop now'])
    await POST(post({ ...BODY, keepWords: true, surfaces: ['web'] }))
    expect(startPageRedo).toHaveBeenCalledWith(DRAFT, { audience: 'store', page: 'home' }, ['web'], 'a1', { keepWords: ['Welcome', 'Shop now'] })
    expect(getPublishedPage).not.toHaveBeenCalled()
  })

  it('falls back to the published page words when the draft has none', async () => {
    vi.mocked(getSiteDraft).mockResolvedValue({ docs: {} } as any)
    vi.mocked(getPublishedPage).mockResolvedValue({ doc: { order: [] } } as any)
    vi.mocked(pageWords).mockReturnValue(['Live words'])
    await POST(post({ ...BODY, keepWords: true }))
    expect(vi.mocked(startPageRedo).mock.calls[0][4]).toEqual({ keepWords: ['Live words'] })
  })

  it('relays a refusal with its own status', async () => {
    vi.mocked(startPageRedo).mockRejectedValue(new PageRedoRefused('Another redo is running', 409))
    const res = await POST(post(BODY))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Another redo is running' })
  })

  it('rethrows an unexpected failure', async () => {
    vi.mocked(startPageRedo).mockRejectedValue(new Error('db'))
    await expect(POST(post(BODY))).rejects.toThrow('db')
  })
})

describe('GET /api/admin/site-builder/ai/page', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(get())).status).toBe(401)
  })

  it('returns 400 for a bad draft id', async () => {
    expect((await GET(get('?draft=nope'))).status).toBe(400)
    expect((await GET(get(''))).status).toBe(400)
    expect(pageRedoStatus).not.toHaveBeenCalled()
  })

  it('returns the job status', async () => {
    vi.mocked(pageRedoStatus).mockResolvedValue({ state: 'done' } as any)
    const res = await GET(get())
    expect(await res.json()).toEqual({ job: { state: 'done' } })
    expect(pageRedoStatus).toHaveBeenCalledWith(DRAFT)
  })
})
