import { describe, it, expect } from 'vitest'
import { NextResponse, NextRequest } from '../src/next.js'

describe('NextResponse.json', () => {
  it('sets JSON content-type, status and serialized body', async () => {
    const res = NextResponse.json({ ok: true }, { status: 201 })
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"ok":true}')
  })
  it('merges init headers over the default', () => {
    const res = NextResponse.json({ a: 1 }, { headers: { 'x-custom': 'v' } })
    expect(res.headers.get('x-custom')).toBe('v')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.status).toBe(200)
  })
})

describe('NextResponse.redirect', () => {
  it('defaults to 307 with a location header', () => {
    const res = NextResponse.redirect('https://x.test/go')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://x.test/go')
  })
  it('accepts a custom status and a URL instance', () => {
    const res = NextResponse.redirect(new URL('https://x.test/perm'), 308)
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://x.test/perm')
  })
})

describe('NextRequest.nextUrl', () => {
  it('returns a URL parsed from this.url', () => {
    const req = new NextRequest('https://x.test/path?q=1')
    expect(req.nextUrl).toBeInstanceOf(URL)
    expect(req.nextUrl.pathname).toBe('/path')
    expect(req.nextUrl.searchParams.get('q')).toBe('1')
  })
})
