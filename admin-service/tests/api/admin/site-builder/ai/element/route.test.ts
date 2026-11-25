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
vi.mock('@/lib/ai/stock', () => ({ seedOf: vi.fn(() => 42) }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down', siteAiAvailable: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: vi.fn() }))
vi.mock('@/lib/site/studio/element-ai', () => ({
  LANGUAGES: ['hi', 'ta'],
  TEXT_ACTIONS: ['rewrite', 'shorten', 'translate'],
  reworkText: vi.fn(),
  slotPicture: vi.fn(),
}))

import { POST } from '@admin/app/api/(admin)/admin/site-builder/ai/element/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { AiWalletError } from '@/lib/ai/billing'
import { siteAiAvailable } from '@/lib/site/ai-status'
import { siteEditorEnabled } from '@/lib/site/store'
import { reworkText, slotPicture } from '@/lib/site/studio/element-ai'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const DRAFT = '11111111-1111-4111-8111-111111111111'
const TEXT = { kind: 'text', action: 'shorten', text: 'A very long headline indeed' }
const PIC = { kind: 'picture', subject: 'a red kettle', draftId: DRAFT }
const allow = (...granted: string[]) => vi.mocked(hasScope).mockImplementation((_r, _s, scope) => granted.includes(scope))
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/site-builder/ai/element', {
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
  vi.mocked(reworkText).mockResolvedValue('A long headline')
  vi.mocked(slotPicture).mockResolvedValue({ url: 'https://img/x.jpg', alt: 'kettle', credit: 'Photo by Z' } as any)
})

describe('POST /api/admin/site-builder/ai/element', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(TEXT))).status).toBe(401)
  })

  it.each([[['settings:write']], [['catalog_enrichment:write']]])('returns 403 when granted only %j', async (granted) => {
    allow(...granted)
    expect((await POST(req(TEXT))).status).toBe(403)
    expect(reworkText).not.toHaveBeenCalled()
  })

  it('returns 404 while the visual editor is off', async () => {
    vi.mocked(siteEditorEnabled).mockResolvedValue(false)
    expect((await POST(req(TEXT))).status).toBe(404)
    expect(reworkText).not.toHaveBeenCalled()
  })

  it.each([[undefined], [{ kind: 'text', action: 'shorten', text: '' }], [{ kind: 'text', action: 'bogus', text: 'hi' }], [{ kind: 'picture', subject: 'a' }]])('returns 400 for a bad body (%j)', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
  })

  it('returns 503 and makes no AI call for a text action while the AI is unavailable', async () => {
    vi.mocked(siteAiAvailable).mockResolvedValue(false)
    const res = await POST(req(TEXT))
    expect(res.status).toBe(503)
    expect(reworkText).not.toHaveBeenCalled()
  })

  it('reworks text through the mocked AI', async () => {
    const res = await POST(req({ ...TEXT, language: 'hi', context: 'hero' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'A long headline' })
    expect(reworkText).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', action: 'shorten', text: 'A very long headline indeed', language: 'hi', context: 'hero' }))
  })

  it('finds a picture seeded by the draft and returns its credit', async () => {
    const res = await POST(req(PIC))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://img/x.jpg', alt: 'kettle', credit: 'Photo by Z' })
    expect(slotPicture).toHaveBeenCalledWith({ subject: 'a red kettle', aspect: undefined, seed: 42, ref: `site-editor:${DRAFT}` })
    expect(siteAiAvailable).not.toHaveBeenCalled()
  })

  it('returns 422 when no picture comes up', async () => {
    vi.mocked(slotPicture).mockResolvedValue(null as any)
    expect((await POST(req(PIC))).status).toBe(422)
  })

  it('relays a wallet shortfall as 402', async () => {
    vi.mocked(reworkText).mockRejectedValue(new AiWalletError('Top up', 0, 2))
    const res = await POST(req(TEXT))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'Top up', balanceInr: 0, neededInr: 2 })
  })

  it('returns 503 when the studio AI is down mid-call and 502 for other failures', async () => {
    vi.mocked(reworkText).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'StudioAiDownError' }))
    expect((await POST(req(TEXT))).status).toBe(503)
    vi.mocked(reworkText).mockRejectedValueOnce(new Error('boom'))
    expect((await POST(req(TEXT))).status).toBe(502)
  })
})
