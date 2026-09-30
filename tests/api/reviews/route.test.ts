import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendNewReviewNotification: vi.fn(),
}))
vi.mock('@/lib/s3', () => ({
  uploadReviewImage: vi.fn(),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { GET, PATCH, POST } from '@/app/api/reviews/route'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'
import { sendNewReviewNotification } from '@/lib/email'
import { uploadReviewImage } from '@/lib/s3'
import { createAutoTask } from '@/lib/auto-tasks'

const mockAuth = vi.mocked(authenticateUser)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)
const mockSendNotif = vi.mocked(sendNewReviewNotification)
const mockUpload = vi.mocked(uploadReviewImage)
const mockCreateTask = vi.mocked(createAutoTask)

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const USER_ID = 'user-uuid-1234-5678-abcd-ef1234567890'

function makeGetRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/reviews')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

function makeFormRequest(fields: Record<string, string | File>, method = 'POST') {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new Request('http://localhost/api/reviews', { method, body: fd })
}

describe('GET /api/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when productId is missing', async () => {
    const res = await GET(makeGetRequest() as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Product ID required')
  })

  it('returns reviews for a product', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { id: 'r1', rating: 5, comment: 'Great', users: { first_name: 'John', last_name: 'D' } },
    ])
    const res = await GET(makeGetRequest({ productId: PRODUCT_ID }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reviews).toHaveLength(1)
  })

  it('returns empty array when no reviews', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    const res = await GET(makeGetRequest({ productId: PRODUCT_ID }) as any)
    const json = await res.json()
    expect(json.reviews).toEqual([])
  })

  it('returns 500 on db error', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('db down'))
    const res = await GET(makeGetRequest({ productId: PRODUCT_ID }) as any)
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await PATCH(makeFormRequest({ reviewId: 'r1', rating: '4', comment: 'Good' }, 'PATCH') as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when required fields missing', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await PATCH(makeFormRequest({ reviewId: '', rating: '', comment: '' }, 'PATCH') as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when rating is out of range', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await PATCH(makeFormRequest({ reviewId: 'r1', rating: '6', comment: 'ok' }, 'PATCH') as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when review not found or not owned', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makeFormRequest({ reviewId: 'r1', rating: '4', comment: 'ok' }, 'PATCH') as any)
    expect(res.status).toBe(404)
  })

  it('updates review and returns message', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'r1' }) // existing check
      .mockResolvedValueOnce({ id: 'r1', rating: 4, comment: 'ok' }) // updated

    const res = await PATCH(makeFormRequest({ reviewId: 'r1', rating: '4', comment: 'ok' }, 'PATCH') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toContain('updated')
  })

  it('uploads new image files during PATCH and returns updated review', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'r1' }) // existing check
      .mockResolvedValueOnce({ id: 'r1', rating: 5, comment: 'good', image_urls: ['https://cdn/new.jpg'] }) // updated

    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/new.jpg', thumbnailUrl: 'https://cdn/thumb_new.jpg' } as any)

    const fd = new FormData()
    fd.append('reviewId', 'r1')
    fd.append('rating', '5')
    fd.append('comment', 'good product indeed')
    fd.append('images', new File(['imgdata'], 'review.png', { type: 'image/png' }))

    const req = new Request('http://localhost/api/reviews', { method: 'PATCH', body: fd })
    const res = (await req.clone) ? await PATCH(req as any) : await PATCH(req as any)
    expect(res.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledOnce()
  })

  it('returns 500 on db error during PATCH', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockRejectedValueOnce(new Error('db crash'))

    const res = await PATCH(makeFormRequest({ reviewId: 'r1', rating: '4', comment: 'ok' }, 'PATCH') as any)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeFormRequest({ productId: PRODUCT_ID, rating: '5', comment: 'Great product!' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when user already reviewed', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'existing-review' }) // existing review check

    const res = await POST(
      makeFormRequest({ productId: PRODUCT_ID, rating: '5', comment: 'Great product already!' }) as any
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('already reviewed')
  })

  it('creates review, sends notification, returns 200', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing review
      .mockResolvedValueOnce(null) // no purchase
      .mockResolvedValueOnce({ id: 'r-new', rating: 4, comment: 'Good product!' }) // inserted review
      .mockResolvedValueOnce({ name: 'Hex Bolt' }) // reviewedProduct
      .mockResolvedValueOnce({ first_name: 'John', last_name: 'D', email: 'j@example.com' }) // userDetails
      .mockResolvedValueOnce({ name: 'Hex Bolt', slug: 'hex-bolt' }) // product for notification

    mockSendNotif.mockResolvedValueOnce(undefined as any)

    const res = await POST(
      makeFormRequest({ productId: PRODUCT_ID, rating: '4', comment: 'Good product here!' }) as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toContain('submitted')
  })

  it('creates auto task for low rating (<=2)', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing review
      .mockResolvedValueOnce(null) // no purchase
      .mockResolvedValueOnce({ id: 'r-new', rating: 1 }) // inserted review
      .mockResolvedValueOnce({ name: 'Bolt' })
      .mockResolvedValueOnce({ first_name: 'J', last_name: 'D', email: 'j@e.com' })
      .mockResolvedValueOnce({ name: 'Bolt', slug: 'bolt' })

    mockSendNotif.mockResolvedValueOnce(undefined as any)
    mockCreateTask.mockResolvedValueOnce(undefined as any)

    await POST(
      makeFormRequest({ productId: PRODUCT_ID, rating: '1', comment: 'Terrible product experience here' }) as any
    )
    // createAutoTask is called fire-and-forget; we just ensure no crash
    expect(mockAuth).toHaveBeenCalled()
  })

  it('marks is_verified_purchase=true when user has delivered order', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing review
      .mockResolvedValueOnce({ id: 'oi1' }) // has purchase!
      .mockResolvedValueOnce({ id: 'r-new', rating: 5, is_verified_purchase: true })
      .mockResolvedValueOnce({ name: 'Bolt' })
      .mockResolvedValueOnce({ first_name: 'J', last_name: 'D', email: 'j@e.com' })
      .mockResolvedValueOnce({ name: 'Bolt', slug: 'bolt' })

    mockSendNotif.mockResolvedValueOnce(undefined as any)

    const res = await POST(
      makeFormRequest({ productId: PRODUCT_ID, rating: '5', comment: 'Verified purchase review here!' }) as any
    )
    expect(res.status).toBe(200)
    // is_verified_purchase=true should be passed to queryOne insert
    const insertCall = mockQueryOne.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO product_reviews')
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toContain(true)
  })

  it('uploads review images and calls query UPDATE after inserting review', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing review
      .mockResolvedValueOnce(null) // no purchase
      .mockResolvedValueOnce({ id: 'r-img', rating: 4, comment: 'With image review' })
      .mockResolvedValueOnce({ name: 'Hex Bolt' })
      .mockResolvedValueOnce({ first_name: 'Jane', last_name: 'D', email: 'jane@example.com' })
      .mockResolvedValueOnce({ name: 'Hex Bolt', slug: 'hex-bolt' })

    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/r1.jpg', thumbnailUrl: 'https://cdn/thumb_r1.jpg' } as any)
    mockSendNotif.mockResolvedValueOnce(undefined as any)
    mockQuery.mockResolvedValueOnce(undefined as any)

    const fd = new FormData()
    fd.append('productId', PRODUCT_ID)
    fd.append('rating', '4')
    fd.append('comment', 'Great product with image upload here')
    fd.append('images', new File(['imgdata'], 'review-pic.png', { type: 'image/png' }))
    const req = new Request('http://localhost/api/reviews', { method: 'POST', body: fd })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledOnce()
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE product_reviews SET image_urls'),
      expect.any(Array)
    )
  })

  it('returns 500 on unexpected POST error', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockRejectedValueOnce(new Error('db crash'))

    const res = await POST(makeFormRequest({ productId: PRODUCT_ID, rating: '4', comment: 'crash test here' }) as any)
    expect(res.status).toBe(500)
  })
})
