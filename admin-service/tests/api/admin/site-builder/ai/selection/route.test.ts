import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/ai/billing', () => {
  class AiWalletError extends Error {
    status = 402 as const
    constructor(message: string, public balanceInr: number, public neededInr: number) {
      super(message)
    }
  }
  return { AiWalletError }
})
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: vi.fn() }))
vi.mock('@/lib/site/studio/selection', () => ({ changeSelection: vi.fn() }))
vi.mock('@/lib/site/studio/context', () => ({ studioCtxFor: vi.fn() }))
vi.mock('@/lib/site/studio/redesign', () => ({ draftStudioContext: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/ai/selection/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { AiWalletError } from '@/lib/ai/billing'
import { siteAiAvailable } from '@/lib/site/ai-status'
import { siteEditorEnabled } from '@/lib/site/store'
import { changeSelection } from '@/lib/site/studio/selection'
import { studioCtxFor } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const DRAFT = '11111111-1111-4111-8111-111111111111'
const TREE = { tag: 'div', children: [] }
const BODY = { ref: { audience: 'store', page: 'home' }, block: { label: 'Hero', tree: TREE }, ids: ['n1', 'n2'], instruction: 'make the button red' }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'nope' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  allow('catalog_enrichment:write', 'settings:write')
  vi.mocked(siteEditorEnabled).mockResolvedValue(true)
  vi.mocked(siteAiAvailable).mockResolvedValue(true)
  vi.mocked(draftStudioContext).mockResolvedValue({ own: true } as any)
  vi.mocked(studioCtxFor).mockResolvedValue({ ctx: { c: 1 }, key: 'k1' } as any)
  vi.mocked(changeSelection).mockResolvedValue({ tree: { tag: 'span' }, changed: ['n1'] } as any)
})

describe('POST /api/admin/site-builder/ai/selection', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(BODY))).status).toBe(401)
    expect(changeSelection).not.toHaveBeenCalled()
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(req(BODY))).status).toBe(403)
    expect(changeSelection).not.toHaveBeenCalled()
  })

  it('returns 404 while the visual editor is off', async () => {
    vi.mocked(siteEditorEnabled).mockResolvedValue(false)
    expect((await POST(req(BODY))).status).toBe(404)
    expect(changeSelection).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ ...BODY, instruction: 'x' }], [{ ...BODY, block: { label: 'Hero' } }], [{ ...BODY, ids: Array(21).fill('i') }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(changeSelection).not.toHaveBeenCalled()
  })

  it('returns 503 and makes no AI call while the AI is unavailable', async () => {
    vi.mocked(siteAiAvailable).mockResolvedValue(false)
    expect((await POST(req(BODY))).status).toBe(503)
    expect(changeSelection).not.toHaveBeenCalled()
  })

  it('passes the tree, ids and the draft studio context to the mocked AI and returns the new tree', async () => {
    const res = await POST(req({ ...BODY, draftId: DRAFT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tree: { tag: 'span' }, changed: ['n1'] })
    expect(studioCtxFor).toHaveBeenCalledWith({ audience: 'store', page: 'home' }, { own: true })
    expect(changeSelection).toHaveBeenCalledWith({ c: 1 }, { label: 'Hero', tree: TREE, page: 'home', key: 'k1', ids: ['n1', 'n2'], instruction: 'make the button red' })
  })

  it('defaults the label and ids', async () => {
    await POST(req({ ...BODY, ids: undefined, block: { tree: TREE } }))
    expect(vi.mocked(changeSelection).mock.calls[0][1]).toMatchObject({ label: 'Section', ids: [] })
    expect(draftStudioContext).not.toHaveBeenCalled()
  })

  it('relays a wallet shortfall as 402', async () => {
    vi.mocked(changeSelection).mockRejectedValue(new AiWalletError('Top up', 1, 4))
    const res = await POST(req(BODY))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Top up', balanceInr: 1, neededInr: 4 })
  })

  it('returns 503 when the studio AI is down, 422 for a refused change and 502 otherwise', async () => {
    vi.mocked(changeSelection).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'StudioAiDownError' }))
    expect((await POST(req(BODY))).status).toBe(503)
    vi.mocked(changeSelection).mockRejectedValueOnce(new Error('The AI could not make that change'))
    expect((await POST(req(BODY))).status).toBe(422)
    vi.mocked(changeSelection).mockRejectedValueOnce(Object.assign(new Error('bad tree'), { name: 'PrintError' }))
    expect((await POST(req(BODY))).status).toBe(422)
    vi.mocked(changeSelection).mockRejectedValueOnce(new Error('network'))
    expect((await POST(req(BODY))).status).toBe(502)
  })
})
