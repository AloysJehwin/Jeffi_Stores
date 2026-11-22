import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(() => Promise.resolve({ rows: [] })), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') } }))
vi.mock('@/lib/payments/upi/creds', () => ({ resolveUpiProvider: vi.fn() }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: vi.fn(() => false) }))
vi.mock('@/lib/payments/upi/pay-uri', () => ({ upiPayUri: vi.fn(() => 'upi://pay?x=1') }))

import { createOrderUpiQr } from '@/lib/payments/upi-qr'
import { query, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import QRCode from 'qrcode'
import { resolveUpiProvider } from '@/lib/payments/upi/creds'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { upiPayUri } from '@/lib/payments/upi/pay-uri'

const order = { id: 'ord_1', order_number: 'N-1' }
const opts = { order, amountPaise: 12300, name: 'Acme', description: 'Order N-1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(isFlagship).mockReturnValue(false)
})

describe('createOrderUpiQr', () => {
  it('builds a static UPI QR for a UPG (own-VPA) store, no gateway call', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme' } as any)
    vi.mocked(resolveUpiProvider).mockResolvedValue({ provider: 'upg', vpa: 'acme@upi' } as any)
    const r = await createOrderUpiQr(opts)
    expect(upiPayUri).toHaveBeenCalledWith({ vpa: 'acme@upi', payeeName: 'Acme', amountPaise: 12300, reference: 'N-1' })
    expect(QRCode.toDataURL).toHaveBeenCalled()
    expect(r.qrId).toBe('upi_static_ord_1')
    expect(r.qrImageUrl).toBe('data:image/png;base64,QR')
    expect(getRazorpayInstanceFor).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.stringContaining('razorpay_qr_id'), ['upi_static_ord_1', 'data:image/png;base64,QR', 'ord_1'])
  })

  it('creates a gateway QR when the store is not UPG and crops the poster', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme' } as any)
    vi.mocked(resolveUpiProvider).mockResolvedValue({ provider: 'razorpay' } as any)
    const create = vi.fn(async () => ({ id: 'qr_rzp', image_url: 'https://rzp/poster.png' }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { create } } } as any)
    // sharp chain + fetch so cropRazorpayQr succeeds
    const sharp = (await import('sharp')).default as any
    const chain = {
      metadata: vi.fn(async () => ({ width: 674, height: 1644 })),
      extract: vi.fn(() => chain),
      resize: vi.fn(() => chain),
      png: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from('img')),
    }
    vi.mocked(sharp).mockReturnValue(chain)
    vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })))

    const r = await createOrderUpiQr(opts)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'upi_qr', usage: 'single_use', fixed_amount: true, payment_amount: 12300, notes: expect.objectContaining({ order_id: 'ord_1', tenant_id: 't1', tenant_slug: 'acme' }) }))
    expect(r.qrId).toBe('qr_rzp')
    expect(r.qrImageUrl).toMatch(/^data:image\/png;base64,/)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('razorpay_qr_id'), ['qr_rzp', expect.any(String), 'ord_1'])
  })

  it('falls back to the gateway image url when cropping fails', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme' } as any)
    vi.mocked(resolveUpiProvider).mockResolvedValue({ provider: 'razorpay' } as any)
    const create = vi.fn(async () => ({ id: 'qr_rzp', image_url: 'https://rzp/poster.png' }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { create } } } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('download failed') }))
    const r = await createOrderUpiQr(opts)
    expect(r.qrImageUrl).toBe('https://rzp/poster.png')
  })

  it('uses the gateway path for a flagship tenant (never UPG)', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: '0', slug: 'platform' } as any)
    vi.mocked(isFlagship).mockReturnValue(true)
    const create = vi.fn(async () => ({ id: 'qr_rzp', image_url: 'https://rzp/poster.png' }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { create } } } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x') }))
    await createOrderUpiQr(opts)
    expect(resolveUpiProvider).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalled()
  })

  it('uses the gateway path when there is no tenant at all', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue(null as any)
    const create = vi.fn(async () => ({ id: 'qr_rzp', image_url: 'u' }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { create } } } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x') }))
    const r = await createOrderUpiQr(opts)
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith(undefined)
    // notes carry no tenant fields
    expect((create.mock.calls[0] as any[])[0].notes).toEqual({ order_id: 'ord_1', order_number: 'N-1' })
    expect(r.qrId).toBe('qr_rzp')
  })

  it('falls back to the gateway when resolveUpiProvider rejects', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme' } as any)
    vi.mocked(resolveUpiProvider).mockRejectedValue(new Error('creds down'))
    const create = vi.fn(async () => ({ id: 'qr_rzp', image_url: 'u' }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { create } } } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x') }))
    await createOrderUpiQr(opts)
    expect(create).toHaveBeenCalled()
  })
})
