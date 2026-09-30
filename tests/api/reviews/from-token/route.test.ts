import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ verifyReviewToken: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET, POST } from '@/app/api/reviews/from-token/route'
import { verifyReviewToken } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const PAYLOAD = { orderId: 'ord-1', productId: 'prod-1', userId: 'user-1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyReviewToken).mockResolvedValue(PAYLOAD as any)
  vi.mocked(queryOne).mockResolvedValue(null as any)
})

function makeGetReq(token?: string) {
  const url = token
    ? `http://localhost/api/reviews/from-token?token=${token}`
    : 'http://localhost/api/reviews/from-token'
  return new NextRequest(url)
}

function makePostReq(body: unknown) {
  return new NextRequest('http://localhost/api/reviews/from-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/reviews/from-token', () => {
  it('returns 400 when token missing', async () => {
    const res = await GET(makeGetReq())
    expect(res.status).toBe(400)
  })

  it('returns 401 when token invalid', async () => {
    vi.mocked(verifyReviewToken).mockResolvedValue(null as any)
    const res = await GET(makeGetReq('bad-token'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when product not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await GET(makeGetReq('valid-token'))
    expect(res.status).toBe(404)
  })

  it('returns product info and alreadyReviewed=false', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Widget', image_url: null } as any)
      .mockResolvedValueOnce(null as any)
    const res = await GET(makeGetReq('valid-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.productId).toBe('prod-1')
    expect(body.alreadyReviewed).toBe(false)
  })

  it('returns alreadyReviewed=true when review exists', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Widget', image_url: 'img.jpg' } as any)
      .mockResolvedValueOnce({ id: 'rev-1' } as any)
    const res = await GET(makeGetReq('valid-token'))
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyReviewed).toBe(true)
  })
})

describe('POST /api/reviews/from-token', () => {
  it('returns 400 when token missing', async () => {
    const res = await POST(makePostReq({ rating: 5, comment: 'great' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when rating missing', async () => {
    const res = await POST(makePostReq({ token: 't', comment: 'great' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when comment missing', async () => {
    const res = await POST(makePostReq({ token: 't', rating: 5 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when rating out of range', async () => {
    const res = await POST(makePostReq({ token: 't', rating: 6, comment: 'ok' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when token invalid', async () => {
    vi.mocked(verifyReviewToken).mockResolvedValue(null as any)
    const res = await POST(makePostReq({ token: 'bad', rating: 5, comment: 'great' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when already reviewed', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'rev-1' } as any)
    const res = await POST(makePostReq({ token: 't', rating: 5, comment: 'great' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already reviewed/)
  })

  it('returns 400 when order not delivered', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any) // no existing review
      .mockResolvedValueOnce(null as any) // order check fails
    const res = await POST(makePostReq({ token: 't', rating: 5, comment: 'great' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not delivered/)
  })

  it('submits review on happy path', async () => {
    const review = { id: 'rev-1', rating: 5 }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null as any) // no existing review
      .mockResolvedValueOnce({ id: 'ord-1' } as any) // order check passes
      .mockResolvedValueOnce(review as any) // INSERT review
    const res = await POST(makePostReq({ token: 't', rating: 5, comment: 'great', title: 'Nice' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/submitted/)
  })
})
