import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The editor's cheap element actions on a Showcase: the day's free AI help, platform-funded; a picture is a stock photo
// first and keeps its credit; the help comes back when nothing came of it.

const m = vi.hoisted(() => ({ owner: vi.fn(), session: vi.fn(), flag: vi.fn(), spend: vi.fn(), refund: vi.fn(), rework: vi.fn(), picture: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: m.flag }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_CODE: 'ai_unavailable', AI_UNAVAILABLE_MESSAGE: 'AI is down.', siteAiAvailable: vi.fn(async () => true) }))
vi.mock('@/lib/site/studio', () => ({ studioBudgetLeft: () => 10 }))
vi.mock('@/lib/site/studio/element-ai', () => ({ TEXT_ACTIONS: ['rewrite', 'shorten', 'translate'], LANGUAGES: ['Hindi'], reworkText: m.rework, slotPicture: m.picture }))
vi.mock('@controller/lib/site-studio/sessions', () => ({ getStudioSession: m.session, spendTweaks: m.spend, refundTweaks: m.refund }))
vi.mock('@controller/lib/site-studio/funded', () => ({ funded: (_id: string, _b: number, fn: () => Promise<unknown>) => fn() }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/studio/design/element/route'

const url = 'https://ecom.example.com/api/ecom/onboard/studio/design/element?product=showcase&site=11111111-2222-3333-4444-555555555555'
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  m.owner.mockResolvedValue({ id: 'o-1' })
  m.flag.mockResolvedValue(true)
  m.session.mockResolvedValue({ id: 'sess-1', product: 'showcase', status: 'ready', brief: { category: 'tea shop' }, pages: {} })
  m.spend.mockResolvedValue(true)
})

describe('studio design element actions', () => {
  it('reworks words as the day’s help', async () => {
    m.rework.mockResolvedValue('Fresh tea daily')
    const res = await post({ kind: 'text', action: 'shorten', text: 'We brew fresh tea every single day' })
    expect(await res.json()).toEqual({ text: 'Fresh tea daily' })
    expect(m.spend).toHaveBeenCalledWith('sess-1', 1, expect.any(Number))
  })

  it('finds a picture stock first, out of any gallery, keeping its credit', async () => {
    const credit = { name: 'A', source: 'pexels', pageUrl: 'https://www.pexels.com/photo/1', url: null }
    m.picture.mockResolvedValue({ url: 'https://cdn.example.com/stock/pexels-1.jpg', alt: 'Tea', credit })
    const body = await (await post({ kind: 'picture', subject: 'chai', aspect: '1:1' })).json()
    expect(body).toEqual({ url: 'https://cdn.example.com/stock/pexels-1.jpg', alt: 'Tea', credit })
    expect(m.picture.mock.calls[0][0]).toMatchObject({ subject: 'chai', category: 'tea shop', aspect: '1:1', skipGallery: true })
  })

  it('refuses past the day’s help and gives it back when nothing came of it', async () => {
    m.spend.mockResolvedValue(false)
    expect((await post({ kind: 'text', action: 'rewrite', text: 'x' })).status).toBe(429)
    m.spend.mockResolvedValue(true)
    m.picture.mockResolvedValue(null)
    expect((await post({ kind: 'picture', subject: 'chai' })).status).toBe(422)
    m.rework.mockRejectedValue(new Error('boom'))
    expect((await post({ kind: 'text', action: 'rewrite', text: 'x' })).status).toBe(502)
    expect(m.refund).toHaveBeenCalledTimes(2)
    expect((await post({ kind: 'bogus' })).status).toBe(400)
  })
})
