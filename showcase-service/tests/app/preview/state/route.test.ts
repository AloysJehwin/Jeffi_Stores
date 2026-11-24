// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The preview poller's endpoint: version, status, expiry and section hashes for a good link on its own host; 410 once
// run out; 404 for a bad token or another site's host. Never cached, nothing of the content.

const { checkShowcasePreviewToken, getShowcaseById } = vi.hoisted(() => ({ checkShowcasePreviewToken: vi.fn(), getShowcaseById: vi.fn() }))
vi.mock('@/lib/showcase/preview-token', () => ({ checkShowcasePreviewToken }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById }))

import { GET } from '@showcase/app/preview/state/route'

const SITE = {
  id: 's-1', slug: 'latte', customDomain: null, status: 'draft', workspaceSuspended: false, updatedAt: '2026-11-24T10:00:00.000Z',
  business: { name: 'Latte', phone: '+91 98765 43210' }, content: { services: [] },
  page: { order: ['hero'], blocks: { hero: { id: 'hero', type: 'code_section', v: 1, props: { compiled: { id: 'hero', ast: {} } } } } },
}
const get = (host: string, t = 'tok') => GET(new NextRequest(`https://${host}/preview/state?t=${t}`, { headers: { host } }))

describe('GET /preview/state', () => {
  beforeEach(() => {
    checkShowcasePreviewToken.mockResolvedValue({ state: 'valid', siteId: 's-1', jti: 'j', expiresAt: '2026-11-25T10:00:00.000Z' })
    getShowcaseById.mockResolvedValue(SITE)
  })

  it('answers the version and expiry of a draft, uncached and with no content', async () => {
    const res = await get('site-latte.jeffistores.in')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const body = await res.json()
    expect(body).toEqual({ ok: true, version: SITE.updatedAt, status: 'draft', live: false, expiresAt: '2026-11-25T10:00:00.000Z', sections: { hero: expect.any(String) } })
    expect(JSON.stringify(body)).not.toContain('98765')
    expect(checkShowcasePreviewToken).toHaveBeenCalledWith('tok')
  })

  it('says live once published', async () => {
    getShowcaseById.mockResolvedValue({ ...SITE, status: 'live' })
    expect(await (await get('site-latte.jeffistores.in')).json()).toMatchObject({ ok: true, status: 'live', live: true })
  })

  it('410s an expired link', async () => {
    checkShowcasePreviewToken.mockResolvedValue({ state: 'expired', siteId: 's-1', jti: 'j' })
    const res = await get('site-latte.jeffistores.in')
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ ok: false, state: 'expired' })
  })

  it("404s a bad token, and a good one on another site's host", async () => {
    expect((await get('site-brew.jeffistores.in')).status).toBe(404)
    checkShowcasePreviewToken.mockResolvedValue({ state: 'invalid' })
    const res = await get('site-latte.jeffistores.in')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, state: 'invalid' })
  })
})
