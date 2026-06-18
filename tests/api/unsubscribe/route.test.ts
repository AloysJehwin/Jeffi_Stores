import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

import { GET, POST } from '@/app/api/unsubscribe/route'
import * as db from '@/lib/db'

function makeGet(search = '') {
  return new NextRequest(`http://localhost/api/unsubscribe${search}`)
}
function makePost(search = '') {
  return new NextRequest(`http://localhost/api/unsubscribe${search}`, { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/unsubscribe', () => {
  it('returns 400 text/html when token is missing', async () => {
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('text/html')
    const text = await res.text()
    expect(text).toContain('Invalid unsubscribe link')
  })

  it('returns 200 HTML confirmation when token is valid', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'u@example.com' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeGet('?token=valid-token') as any)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("You've been unsubscribed")
    expect(text).toContain('u@example.com')
  })

  it('returns 404 HTML when token does not match any user', async () => {
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await GET(makeGet('?token=bad-token') as any)
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).toContain('Link not recognised')
  })

  it('updates campaign record when campaign param is provided', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'u@example.com' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeGet('?token=valid-token&campaign=promo') as any)
    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE email_campaigns_sent'),
      expect.arrayContaining(['u1', 'promo'])
    )
  })

  it('skips campaign update when campaign param absent', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'u@example.com' } as any)

    const res = await GET(makeGet('?token=valid-token') as any)
    expect(res.status).toBe(200)
    expect(db.query).not.toHaveBeenCalled()
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/unsubscribe', () => {
  it('returns 400 JSON when token is missing', async () => {
    const res = await POST(makePost() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing token/i)
  })

  it('returns success:true when unsubscribe works', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'u@example.com' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost('?token=tok') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns success:false when token not found', async () => {
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await POST(makePost('?token=bad') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('updates campaign when campaign param provided via POST', async () => {
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'u1', email: 'u@example.com' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    await POST(makePost('?token=tok&campaign=weekly') as any)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE email_campaigns_sent'),
      expect.arrayContaining(['u1', 'weekly'])
    )
  })
})
