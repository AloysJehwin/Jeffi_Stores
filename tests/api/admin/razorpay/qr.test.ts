import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
}))
vi.mock('sharp', () => ({
  default: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/razorpay/qr/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { getRazorpayInstance } from '@/lib/razorpay'
import sharp from 'sharp'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['quotations'] }

function makePost(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/razorpay/qr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  orderId: 'order-1',
  amountPaise: 118000,
  description: 'Invoice #INV-001',
}

// Set up sharp mock to return a chainable builder
function makeSharpChain() {
  const chain: any = {
    metadata: vi.fn().mockResolvedValue({ width: 674, height: 1644 }),
    extract: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-png-data')),
  }
  return chain
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/razorpay/qr', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing quotations scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
  })

  it('returns 400 when orderId missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ amountPaise: 10000 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'orderId and amountPaise required' })
  })

  it('returns 400 when amountPaise missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ orderId: 'order-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Order not found' })
  })

  it('creates QR code, crops image, updates order and returns qrId', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ id: 'order-1' } as any)

    const mockQr = {
      id: 'qr_abc123',
      image_url: 'https://rzp.io/qr/abc.png',
    }
    const mockRzp = { qrCode: { create: vi.fn().mockResolvedValue(mockQr) } }
    vi.mocked(getRazorpayInstance).mockReturnValue(mockRzp as any)

    // Mock fetch for downloading QR image
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: async () => Buffer.from('fake-image').buffer,
    }))

    const sharpChain = makeSharpChain()
    vi.mocked(sharp as any).mockReturnValue(sharpChain)

    vi.mocked(query).mockResolvedValue(undefined as any)

    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.qrId).toBe('qr_abc123')
    expect(body.qrImageUrl).toContain('data:image/png;base64,')

    expect(mockRzp.qrCode.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upi_qr',
      payment_amount: 118000,
      fixed_amount: true,
    }))

    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders'),
      ['qr_abc123', expect.any(String), 'order-1']
    )
  })

  it('uses default description when not provided', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ id: 'order-1' } as any)

    const mockQr = { id: 'qr_xyz', image_url: 'https://rzp.io/qr/xyz.png' }
    const mockRzp = { qrCode: { create: vi.fn().mockResolvedValue(mockQr) } }
    vi.mocked(getRazorpayInstance).mockReturnValue(mockRzp as any)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: async () => Buffer.from('img').buffer,
    }))
    const sharpChain = makeSharpChain()
    vi.mocked(sharp as any).mockReturnValue(sharpChain)
    vi.mocked(query).mockResolvedValue(undefined as any)

    await POST(makePost({ orderId: 'order-1', amountPaise: 5000 }))
    expect(mockRzp.qrCode.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Invoice Payment',
    }))
  })

  it('returns 500 on razorpay error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ id: 'order-1' } as any)
    const mockRzp = { qrCode: { create: vi.fn().mockRejectedValue(new Error('razorpay error')) } }
    vi.mocked(getRazorpayInstance).mockReturnValue(mockRzp as any)

    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'razorpay error' })
  })

  it('returns 500 on db error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockRejectedValue(new Error('db down'))

    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db down' })
  })
})
