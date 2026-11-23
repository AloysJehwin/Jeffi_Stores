// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The Showcase tracker's beacon: what it records, and the visits it leaves out (bots, prefetches, other sites' pages,
// sites that are not live, visitors over the limit).

const { recordBeacon, siteForHost, hit } = vi.hoisted(() => ({ recordBeacon: vi.fn(), siteForHost: vi.fn(), hit: vi.fn() }))

vi.mock('@showcase/lib/site', () => ({ siteForHost }))
vi.mock('@showcase/lib/rate-limit', () => ({ hit }))
vi.mock('@showcase/lib/track', async importOriginal => ({ ...(await importOriginal<typeof import('@showcase/lib/track')>()), recordBeacon }))

import { POST } from '@showcase/app/api/track/route'

const HOST = 'site-latte.jeffistores.in'
const IP = '203.0.113.7'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const SITE = { id: 'site-1', slug: 'latte', status: 'live', workspaceSuspended: false }
const VIEW = { s: 'b6f1e1c2-0d6a-4a8e-9d3e-1f2a3b4c5d6e', t: 'pageview', p: '/', q: '?utm_source=ig', tz: 'Asia/Kolkata', lang: 'en-US', sw: 390, sh: 844 }

const beacon = (body: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`https://${HOST}/api/track`, {
    method: 'POST',
    headers: { host: HOST, origin: `https://${HOST}`, 'x-forwarded-for': IP, 'user-agent': IPHONE, 'content-type': 'text/plain;charset=UTF-8', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('POST /api/track (Showcase)', () => {
  beforeEach(() => {
    siteForHost.mockResolvedValue(SITE)
    hit.mockResolvedValue(1)
    recordBeacon.mockResolvedValue(undefined)
  })

  it('records a page view with the parsed browser and country, keyed without the raw IP', async () => {
    const res = await POST(beacon(VIEW))
    expect(res.status).toBe(204)
    expect(hit).toHaveBeenCalledWith(`showcase:track:site-1:${IP}`, 600)
    expect(hit).toHaveBeenCalledWith(`showcase:track:${IP}`, 86400)
    const [b, ctx] = recordBeacon.mock.calls[0]
    expect(b).toMatchObject(VIEW)
    expect(ctx).toMatchObject({ siteId: 'site-1', siteHost: HOST, ua: { device: 'Mobile', browser: 'Safari', os: 'iOS' }, geo: { country: 'IN', region: null, city: null } })
    expect(ctx.visitorKey).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(ctx)).not.toContain(IP)
  })

  it('leaves out bots and prefetches without counting them', async () => {
    expect((await POST(beacon(VIEW, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }))).status).toBe(204)
    expect((await POST(beacon(VIEW, { 'user-agent': '' }))).status).toBe(204)
    expect((await POST(beacon(VIEW, { 'sec-purpose': 'prefetch' }))).status).toBe(204)
    expect(recordBeacon).not.toHaveBeenCalled()
    expect(hit).not.toHaveBeenCalled()
  })

  it("refuses another site's page, a site that is not live, and a malformed beacon", async () => {
    expect((await POST(beacon(VIEW, { origin: 'https://evil.example' }))).status).toBe(403)
    siteForHost.mockResolvedValueOnce({ ...SITE, status: 'paused' })
    expect((await POST(beacon(VIEW))).status).toBe(404)
    siteForHost.mockResolvedValueOnce({ ...SITE, workspaceSuspended: true })
    expect((await POST(beacon(VIEW))).status).toBe(404)
    expect((await POST(beacon('{not json'))).status).toBe(400)
    expect((await POST(beacon({ ...VIEW, s: 'x' }))).status).toBe(400)
    expect((await POST(beacon({ ...VIEW, t: 'purchase' }))).status).toBe(400)
    expect((await POST(beacon({ ...VIEW, p: 'x'.repeat(5000) }))).status).toBe(413)
    expect(recordBeacon).not.toHaveBeenCalled()
  })

  it('stops recording a visitor past the limits', async () => {
    hit.mockResolvedValueOnce(241).mockResolvedValueOnce(1)
    expect((await POST(beacon(VIEW))).status).toBe(429)
    hit.mockResolvedValueOnce(1).mockResolvedValueOnce(3001)
    expect((await POST(beacon(VIEW))).status).toBe(429)
    expect(recordBeacon).not.toHaveBeenCalled()
  })

  it('clamps scroll and time, and still answers when the write fails', async () => {
    recordBeacon.mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(beacon({ s: VIEW.s, t: 'ping', sc: 140, en: -5 }))
    expect(res.status).toBe(204)
    expect(recordBeacon.mock.calls[0][0]).toMatchObject({ t: 'ping', sc: 100, en: 0 })
  })
})
