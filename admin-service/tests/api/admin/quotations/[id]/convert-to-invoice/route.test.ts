import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))
vi.mock('@/lib/payments/upi-qr', () => ({ createOrderUpiQr: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/quotations/[id]/convert-to-invoice/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'
import { createOrderUpiQr } from '@/lib/payments/upi-qr'

const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'q1' }) })

describe('POST /api/admin/quotations/[id]/convert-to-invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('proxies to document-service under quotations:write and passes failures through', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), '/admin/quotations/q1/convert-to-invoice', 'quotations:write')
    expect(createOrderUpiQr).not.toHaveBeenCalled()
  })

  it('returns a non-JSON response untouched', async () => {
    const pdf = new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } })
    vi.mocked(proxyAdminDocs).mockResolvedValue(pdf as never)
    expect(await call()).toBe(pdf)
  })

  it('returns the body unchanged when no QR was requested', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ invoiceId: 'i1' }, { status: 201 }))
    const res = await call()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ invoiceId: 'i1' })
  })

  it('creates the UPI QR for the exact amount and strips qrRequest', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(
      NextResponse.json({ invoiceId: 'i1', qrRequest: { orderId: 'o1', orderNumber: 'ORD-1', amountPaise: 12345, name: 'N', description: 'D' } })
    )
    vi.mocked(createOrderUpiQr).mockResolvedValue({ qrImageUrl: 'https://qr/1.png' } as never)
    const body = await (await call()).json()
    expect(body).toEqual({ invoiceId: 'i1', qrImageUrl: 'https://qr/1.png' })
    expect(createOrderUpiQr).toHaveBeenCalledWith({
      order: { id: 'o1', order_number: 'ORD-1' },
      amountPaise: 12345,
      name: 'N',
      description: 'D',
    })
  })

  it('still succeeds without a QR when QR creation fails', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ invoiceId: 'i1', qrRequest: { orderId: 'o1' } }))
    vi.mocked(createOrderUpiQr).mockRejectedValue(new Error('razorpay'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ invoiceId: 'i1' })
  })
})
