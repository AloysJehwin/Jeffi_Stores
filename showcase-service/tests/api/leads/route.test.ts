// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The Showcase contact form's endpoint: what it keeps, who it refuses, the field it names and where a no-script
// visitor lands.

const { after, insertShowcaseLead, siteForHost, hit, emailLeadToOwner } = vi.hoisted(() => ({
  after: vi.fn(),
  insertShowcaseLead: vi.fn(),
  siteForHost: vi.fn(),
  hit: vi.fn(),
  emailLeadToOwner: vi.fn(),
}))

vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after }))
vi.mock('@/lib/showcase/store', () => ({ insertShowcaseLead }))
vi.mock('@showcase/lib/site', () => ({ siteForHost }))
vi.mock('@showcase/lib/rate-limit', () => ({ hit }))
vi.mock('@showcase/lib/notify', () => ({ emailLeadToOwner }))

import { POST } from '@showcase/app/api/leads/route'

const HOST = 'site-latte.jeffistores.in'
const ENDPOINT = `https://${HOST}/api/leads`
const IP = '203.0.113.7'
const SITE = { id: 'site-1', slug: 'latte', status: 'live', workspaceSuspended: false }
const SAVED = { id: 'lead-1', siteId: 'site-1', name: 'Priya Sharma', phone: '+91 98765 43210', email: 'priya@example.com', message: 'Hi there', createdAt: '2026-11-18T10:00:00.000Z', readAt: null }

const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `https://${HOST}`, 'x-forwarded-for': IP, ...extra })
const json = (body: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(ENDPOINT, { method: 'POST', headers: headers({ 'content-type': 'application/json', accept: 'application/json', ...extra }), body: JSON.stringify(body) })
const form = (fields: Record<string, string>) =>
  new NextRequest(ENDPOINT, { method: 'POST', headers: headers({ 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }), body: new URLSearchParams(fields).toString() })

describe('POST /api/leads (Showcase)', () => {
  beforeEach(() => {
    siteForHost.mockResolvedValue(SITE)
    hit.mockResolvedValue(1)
    insertShowcaseLead.mockResolvedValue(SAVED)
    emailLeadToOwner.mockResolvedValue(undefined)
  })

  it('saves the enquiry, cleaned, and emails the owner once it has answered', async () => {
    const res = await POST(json({ name: 'Priya\nSharma', phone: '+91 98765 43210', email: ' Priya@Example.com ', message: 'Hi\u0007 there' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(siteForHost).toHaveBeenCalledWith(HOST)
    expect(insertShowcaseLead).toHaveBeenCalledWith('site-1', { name: 'Priya Sharma', phone: '+91 98765 43210', email: 'priya@example.com', message: 'Hi there' })
    expect(hit).toHaveBeenCalledWith(`showcase:lead:site-1:${IP}`, 600)
    expect(hit).toHaveBeenCalledWith(`showcase:lead:${IP}`, 86400)
    expect(emailLeadToOwner).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    await after.mock.calls[0][0]()
    expect(emailLeadToOwner).toHaveBeenCalledWith(SITE, SAVED)
  })

  it('answers a filled honeypot as sent and keeps nothing', async () => {
    const res = await POST(json({ name: 'Bot', phone: '9876543210', website: 'https://spam.example' }))
    expect(res.status).toBe(201)
    expect(insertShowcaseLead).not.toHaveBeenCalled()
    expect(hit).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it("refuses a post from another site's page", async () => {
    const res = await POST(json({ name: 'Priya', phone: '9876543210' }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(insertShowcaseLead).not.toHaveBeenCalled()
  })

  it('takes no enquiries for a site that is paused or whose workspace is suspended', async () => {
    siteForHost.mockResolvedValueOnce({ ...SITE, status: 'paused' })
    expect((await POST(json({ name: 'Priya', phone: '9876543210' }))).status).toBe(404)
    siteForHost.mockResolvedValueOnce({ ...SITE, workspaceSuspended: true })
    expect((await POST(json({ name: 'Priya', phone: '9876543210' }))).status).toBe(404)
    expect(insertShowcaseLead).not.toHaveBeenCalled()
  })

  it.each([
    [{ name: '', phone: '9876543210' }, 'name'],
    [{ name: '\u0007', phone: '9876543210' }, 'name'],
    [{ name: 'Priya' }, 'contact'],
    [{ name: 'Priya', phone: '12ab' }, 'phone'],
    [{ name: 'Priya', phone: '1234567890123456' }, 'phone'],
    [{ name: 'Priya', email: 'priya@example' }, 'email'],
    [{ name: 'Priya', email: 'priya@example.com?subject=hi' }, 'email'],
    [{ name: 'Priya', phone: '9876543210', message: 'x'.repeat(2001) }, 'message'],
  ])('names the field to fix: %j → %s', async (body, field) => {
    const res = await POST(json(body))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.field).toBe(field)
    expect(data.error).toMatch(/^Please /)
    expect(insertShowcaseLead).not.toHaveBeenCalled()
  })

  it('limits how often one visitor can send, per site and per day', async () => {
    hit.mockResolvedValueOnce(6).mockResolvedValueOnce(6)
    const res = await POST(json({ name: 'Priya', phone: '9876543210' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('600')
    expect((await res.json()).error).toBe('Too many messages. Please try again later.')
    hit.mockResolvedValueOnce(1).mockResolvedValueOnce(21)
    expect((await POST(json({ name: 'Priya', phone: '9876543210' }))).headers.get('retry-after')).toBe('86400')
    expect(insertShowcaseLead).not.toHaveBeenCalled()
  })

  it('sends a no-script visitor back to the page, saying what went wrong', async () => {
    const sent = await POST(form({ name: 'Priya', phone: '9876543210', message: 'Hello' }))
    expect(sent.status).toBe(303)
    expect(sent.headers.get('location')).toBe('/?lead=sent')
    expect(insertShowcaseLead).toHaveBeenCalledWith('site-1', { name: 'Priya', phone: '9876543210', email: '', message: 'Hello' })
    expect((await POST(form({ name: 'Priya', phone: 'call me' }))).headers.get('location')).toBe('/?lead=error&why=phone')
    expect((await POST(form({ name: 'Priya' }))).headers.get('location')).toBe('/?lead=error&why=contact')
    hit.mockResolvedValueOnce(6)
    expect((await POST(form({ name: 'Priya', phone: '9876543210' }))).headers.get('location')).toBe('/?lead=error&why=limit')
    expect((await POST(form({ name: 'Bot', phone: '9876543210', website: 'x' }))).headers.get('location')).toBe('/?lead=sent')
  })

  it('refuses a body past 16 KB, with or without a content-length', async () => {
    const big = JSON.stringify({ name: 'Priya', phone: '9876543210', message: 'x'.repeat(20_000) })
    expect((await POST(json({ name: 'Priya' }, { 'content-length': String(20_000) }))).status).toBe(413)
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big))
        c.close()
      },
    })
    const chunked = new NextRequest(new Request(ENDPOINT, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: stream, duplex: 'half' } as RequestInit))
    expect(chunked.headers.get('content-length')).toBeNull()
    expect((await POST(chunked)).status).toBe(413)
    expect(insertShowcaseLead).not.toHaveBeenCalled()
  })

  it('says so when the enquiry cannot be saved, and emails nobody', async () => {
    insertShowcaseLead.mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(json({ name: 'Priya', phone: '9876543210' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Your message could not be sent. Please try again.')
    expect(after).not.toHaveBeenCalled()
  })
})
