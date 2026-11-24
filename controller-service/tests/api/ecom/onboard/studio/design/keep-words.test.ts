import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Before a hand-edited page is designed again: the owner keeps their words (into the brief) or starts fresh.

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), flag: vi.fn(), update: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: m.flag }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn() }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, updateStudioSession: m.update }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/design/keep-words/route'

const url = 'https://ecom.example.com/api/ecom/onboard/studio/design/keep-words?product=showcase&site=11111111-2222-3333-4444-555555555555'
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }))
const tree = { t: 'el', tag: 'section', props: {}, id: 'e1', children: [{ t: 'text', value: 'Calm hands', id: 'e1.0' }] }

beforeEach(() => {
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.flag.mockResolvedValue(true)
  m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', brief: { storeName: 'Spa', keepWords: ['old'] }, pages: { 'showcase:home': { order: ['a'], blocks: { a: { id: 'a', type: 'code_section', v: 1, props: { tree } } } } } })
})

describe('studio design keep-words', () => {
  it('keeps the page’s words in the brief', async () => {
    expect(await (await post({ page: 'showcase:home', keep: true })).json()).toEqual({ words: 1 })
    expect(m.update).toHaveBeenCalledWith('sess-1', { brief: { storeName: 'Spa', keepWords: ['Calm hands'] } })
  })

  it('starts fresh by taking them out, and needs a designed page and the flag', async () => {
    await post({ page: 'showcase:home', keep: false })
    expect(m.update).toHaveBeenCalledWith('sess-1', { brief: { storeName: 'Spa' } })
    expect((await post({ page: 'store:about', keep: true })).status).toBe(404)
    m.flag.mockResolvedValue(false)
    expect((await post({ page: 'showcase:home', keep: true })).status).toBe(404)
  })
})
