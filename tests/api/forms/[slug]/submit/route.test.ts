import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/shared/s3', () => ({ uploadGalleryImage: vi.fn() }))
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn() }) },
}))

import { POST } from '@/app/api/forms/[slug]/submit/route'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { uploadGalleryImage } from '@/lib/shared/s3'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)
const mockUpload = vi.mocked(uploadGalleryImage)

const params = { params: Promise.resolve({ slug: 'review-form' }) }

function makeFormData(fields: Record<string, string | File>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

function makeRequest(formData: FormData) {
  return new Request('http://localhost/api/forms/review-form/submit', {
    method: 'POST',
    body: formData,
  })
}

const activeForm = {
  id: 'form1',
  coupon_id: null,
  is_active: true,
  custom_fields: [],
}

describe('POST /api/forms/[slug]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when form not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const fd = makeFormData({ email: 'a@b.com' })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(404)
  })

  it('returns 410 when form is inactive', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...activeForm, is_active: false })
    const fd = makeFormData({ email: 'a@b.com' })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(410)
  })

  it('returns 400 for invalid email', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm)
    const fd = makeFormData({ email: 'not-an-email' })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('valid email')
  })

  it('returns 400 when no screenshot file', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm)
    const fd = makeFormData({ email: 'valid@example.com' })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('screenshot')
  })

  it('returns 400 when screenshot is not an image', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm)
    const file = new File(['data'], 'file.pdf', { type: 'application/pdf' })
    const fd = makeFormData({ email: 'valid@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when screenshot exceeds 5MB', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm)
    const bigData = new Uint8Array(6 * 1024 * 1024)
    const file = new File([bigData], 'big.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'valid@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('5MB')
  })

  it('returns 409 when email already submitted', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm).mockResolvedValueOnce({ id: 'existing-sub' })
    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'exists@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(409)
  })

  it('returns 500 on upload failure', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm).mockResolvedValueOnce(null) // no existing submission
    mockUpload.mockRejectedValueOnce(new Error('s3 fail'))

    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'new@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(500)
  })

  it('returns 200 on successful submission without coupon', async () => {
    mockQueryOne.mockResolvedValueOnce(activeForm).mockResolvedValueOnce(null) // no existing submission
    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/screen.jpg' } as any)
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.couponCode).toBeNull()
  })

  it('returns coupon data on successful submission with coupon', async () => {
    const formWithCoupon = { ...activeForm, coupon_id: 'coup1' }
    const coupon = {
      id: 'coup1',
      code: 'SAVE10',
      description: '10% off',
      valid_until: null,
      discount_type: 'percentage',
      discount_value: 10,
    }
    mockQueryOne.mockResolvedValueOnce(formWithCoupon).mockResolvedValueOnce(null).mockResolvedValueOnce(coupon)
    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/screen.jpg' } as any)
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.couponCode).toBe('SAVE10')
  })

  it('validates required custom fields', async () => {
    const formWithFields = {
      ...activeForm,
      custom_fields: [{ id: 'f1', label: 'Phone', type: 'text', required: true }],
    }
    mockQueryOne.mockResolvedValueOnce(formWithFields)
    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Phone')
  })

  it('processes image-type custom field by uploading it', async () => {
    const formWithImageField = {
      ...activeForm,
      custom_fields: [{ id: 'img1', label: 'Receipt', type: 'image', required: false }],
    }
    mockQueryOne.mockResolvedValueOnce(formWithImageField).mockResolvedValueOnce(null) // no existing submission
    mockUpload
      .mockResolvedValueOnce({ url: 'https://cdn/screenshot.jpg' } as any) // screenshot upload
      .mockResolvedValueOnce({ url: 'https://cdn/receipt.jpg' } as any) // custom field image upload
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const screenshot = new File(['img'], 'shot.png', { type: 'image/png' })
    const receipt = new File(['recdata'], 'receipt.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot })
    fd.append('field_img1', receipt)
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledTimes(2)
  })

  it('returns coupon with valid_until date rendered in response', async () => {
    const formWithCoupon = { ...activeForm, coupon_id: 'coup2' }
    const coupon = {
      id: 'coup2',
      code: 'FLAT50',
      description: 'Flat Rs 50 off',
      valid_until: '2026-12-31T00:00:00.000Z',
      discount_type: 'flat',
      discount_value: 50,
    }
    mockQueryOne
      .mockResolvedValueOnce(formWithCoupon)
      .mockResolvedValueOnce(null) // no existing submission
      .mockResolvedValueOnce(coupon)
    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/screen.jpg' } as any)
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.couponCode).toBe('FLAT50')
    expect(json.discountType).toBe('flat')
    expect(json.validUntil).toBe('2026-12-31T00:00:00.000Z')
  })

  it('succeeds even when email sending throws', async () => {
    const formWithCoupon = { ...activeForm, coupon_id: 'coup3' }
    const coupon = {
      id: 'coup3',
      code: 'ERR10',
      description: null,
      valid_until: null,
      discount_type: 'percentage',
      discount_value: 10,
    }
    mockQueryOne
      .mockResolvedValueOnce(formWithCoupon)
      .mockResolvedValueOnce(null) // no existing submission
      .mockResolvedValueOnce(coupon)
    mockUpload.mockResolvedValueOnce({ url: 'https://cdn/screen.jpg' } as any)
    mockWithTransaction.mockResolvedValueOnce(undefined)

    // Make the nodemailer transporter.sendMail throw
    const nodemailer = await import('nodemailer')
    const mockTransport = { sendMail: vi.fn().mockRejectedValueOnce(new Error('SMTP down')) }
    vi.mocked(nodemailer.default.createTransport).mockReturnValueOnce(mockTransport as any)

    const file = new File(['img'], 'shot.png', { type: 'image/png' })
    const fd = makeFormData({ email: 'user@example.com', screenshot: file })
    const res = await POST(makeRequest(fd) as any, params as any)
    // Should still succeed — email failure is caught silently
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.couponCode).toBe('ERR10')
  })
})
