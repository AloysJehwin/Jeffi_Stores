import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/jwt', () => ({ verifyReviewToken: vi.fn() }))

import { OPTIONS, POST } from '@/app/api/reviews/amp/route'
import { verifyReviewToken } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const PAYLOAD = { orderId: 'ord-1', productId: 'prod-1', userId: 'user-1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyReviewToken).mockResolvedValue(PAYLOAD as any)
  vi.mocked(queryOne).mockResolvedValue(null as any)
})

function makeJsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/reviews/amp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://jeffistores.in' },
    body: JSON.stringify(body),
  })
}

function makeFormReq(fields: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new NextRequest('http://localhost/api/reviews/amp', {
    method: 'POST',
    headers: { origin: 'https://jeffistores.in' },
    body: form,
  })
}

describe('OPTIONS /api/reviews/amp', () => {
  it('returns 200 with AMP headers for same-origin', async () => {
    const req = new NextRequest('http://localhost/api/reviews/amp', {
      method: 'OPTIONS',
      headers: { 'amp-same-origin': 'true', origin: 'https://jeffistores.in' },
    })
    const res = await OPTIONS(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('AMP-Access-Control-Allow-Source-Origin')).toBeTruthy()
  })

  it('returns 200 for cross-origin OPTIONS', async () => {
    const req = new NextRequest('http://localhost/api/reviews/amp', { method: 'OPTIONS' })
    const res = await OPTIONS(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/reviews/amp (JSON)', () => {
  it('returns 400 when token missing', async () => {
    const res = await POST(makeJsonReq({ rating: 5, comment: 'great' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when rating invalid', async () => {
    const res = await POST(makeJsonReq({ token: 't', rating: 0, comment: 'ok' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when comment empty', async () => {
    const res = await POST(makeJsonReq({ token: 't', rating: 5, comment: '  ' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when token invalid', async () => {
    vi.mocked(verifyReviewToken).mockResolvedValue(null as any)
    const res = await POST(makeJsonReq({ token: 'bad', rating: 5, comment: 'ok' }))
    expect(res.status).toBe(401)
  })

  it('returns 409 when already reviewed', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'rev-1' } as any)
    const res = await POST(makeJsonReq({ token: 't', rating: 5, comment: 'ok' }))
    expect(res.status).toBe(409)
  })

  it('submits review via JSON', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any)   // no existing review
      .mockResolvedValueOnce(null as any)   // INSERT (returns null but ignored)
    const res = await POST(makeJsonReq({ token: 't', rating: 4, comment: 'Good product', title: 'Nice' }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})

describe('POST /api/reviews/amp (form)', () => {
  it('returns 400 when token missing in form', async () => {
    const res = await POST(makeFormReq({ rating: '5', comment: 'ok' }))
    expect(res.status).toBe(400)
  })

  it('submits review via form data', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any)
    const res = await POST(makeFormReq({ token: 't', rating: '5', comment: 'Great!', tags: 'quality,value' }))
    expect(res.status).toBe(200)
  })
})
