import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@controller/app/api/(ecom)/ecom/attribution/route'
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE_S, decodeAttribution, encodeAttribution, parseAttribution } from '@controller/lib/attribution/capture'

const req = (body: unknown, cookie?: string) => {
  const r = new NextRequest('https://ecom.jeffistores.in/api/ecom/attribution', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  if (cookie) r.cookies.set(ATTRIBUTION_COOKIE, cookie)
  return r
}

describe('POST /api/ecom/attribution', () => {
  it('sets a first-party 90-day Lax cookie with the click id and UTM tags', async () => {
    const res = await POST(req({ params: { gclid: 'g1', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ecom_store', junk: 'x' }, landingPath: '/pricing' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ captured: true })
    const c = res.cookies.get(ATTRIBUTION_COOKIE)!
    expect(c.sameSite).toBe('lax')
    expect(c.maxAge).toBe(ATTRIBUTION_MAX_AGE_S)
    expect(c.httpOnly).toBe(true)
    expect(decodeAttribution(c.value)).toMatchObject({ gclid: 'g1', landingPath: '/pricing', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ecom_store' } })
  })

  it('sets nothing when the URL carried no click id or UTM', async () => {
    for (const body of [{ params: { page: '2' } }, {}, 'not json']) {
      const res = await POST(req(body))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ captured: false })
      expect(res.cookies.get(ATTRIBUTION_COOKIE)).toBeUndefined()
    }
  })

  it('a UTM-only visit keeps the click id already in the cookie', async () => {
    const old = encodeAttribution(parseAttribution({ gclid: 'g1' }, '/')!)
    const res = await POST(req({ params: { utm_source: 'newsletter' } }, old))
    expect(decodeAttribution(res.cookies.get(ATTRIBUTION_COOKIE)!.value)?.gclid).toBe('g1')
  })
})
