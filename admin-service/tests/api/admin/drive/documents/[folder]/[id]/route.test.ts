import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))
vi.mock('@/lib/drive/documents', () => ({
  DOC_FOLDERS: {
    invoices: { name: 'Invoices', scope: 'orders:read' },
    'cash-sales': { name: 'Cash sales', scope: 'pos:read' },
  },
  isDocFolder: (f: string) => f === 'invoices' || f === 'cash-sales',
}))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), denied: vi.fn() }))
vi.mock('@admin/app/api/(admin)/admin/cash-sale/[id]/receipt/route', () => ({ GET: vi.fn() }))
vi.mock('@admin/app/api/(admin)/admin/packing-slips/[id]/route', () => ({ GET: vi.fn() }))
vi.mock('@admin/app/api/(admin)/admin/orders/[id]/shipping-label/route', () => ({ GET: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/drive/documents/[folder]/[id]/route'
import { hasScope } from '@/lib/auth/scopes'
import { proxyAdminDocs } from '@/lib/documents/proxy'
import { driveActor, denied } from '@/lib/drive/http'
import { GET as cashSaleReceipt } from '@admin/app/api/(admin)/admin/cash-sale/[id]/receipt/route'

const ID = '55555555-5555-4555-8555-555555555555'
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/drive/documents/invoices/${ID}${qs}`)
const ctx = (folder: string, id = ID) => ({ params: Promise.resolve({ folder, id }) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const pdf = (disposition = 'attachment; filename="inv.pdf"') =>
  new Response('PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': disposition } })
const realFetch = globalThis.fetch

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(denied).mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('GET /api/admin/drive/documents/[folder]/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await GET(req(), ctx('invoices'))).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await GET(req(), ctx('invoices'))).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:read')
  })

  it('returns 404 for an unknown folder or a non-uuid id', async () => {
    expect((await GET(req(), ctx('nope'))).status).toBe(404)
    expect((await GET(req(), ctx('invoices', 'not-a-uuid'))).status).toBe(404)
    expect(proxyAdminDocs).not.toHaveBeenCalled()
  })

  it('returns 403 without the section scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req(), ctx('invoices'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'orders:read')
    expect(proxyAdminDocs).not.toHaveBeenCalled()
  })

  it('proxies the invoice and serves it inline by default', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(pdf() as any)
    const res = await GET(req(), ctx('invoices'))
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), `/orders/${ID}/invoice`, 'orders:read')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="inv.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('serves as an attachment with ?download=1', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(pdf('inline; filename="inv.pdf"') as any)
    const res = await GET(req('?download=1'), ctx('invoices'))
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="inv.pdf"')
  })

  it('renders cash-sale receipts through the receipt route', async () => {
    vi.mocked(cashSaleReceipt).mockResolvedValue(pdf() as any)
    const res = await GET(req(), ctx('cash-sales'))
    expect(res.status).toBe(200)
    expect(cashSaleReceipt).toHaveBeenCalledTimes(1)
    expect(proxyAdminDocs).not.toHaveBeenCalled()
  })

  it('reads a redirected stored PDF from the bucket host', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://bucket.s3.amazonaws.com/docs/inv%201.pdf' } }) as any
    )
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('BYTES', { status: 200, headers: { 'content-type': 'application/pdf' } })) as any
    const res = await GET(req(), ctx('invoices'))
    expect(res.headers.get('content-disposition')).toBe('inline; filename="inv 1.pdf"')
    expect(await res.text()).toBe('BYTES')
  })

  it('returns 502 when the stored PDF cannot be read', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://bucket.s3.amazonaws.com/inv.pdf' } }) as any
    )
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('no', { status: 403 })) as any
    expect((await GET(req(), ctx('invoices'))).status).toBe(502)
  })

  it('does not follow a redirect to a foreign host', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.test/inv.pdf' } }) as any
    )
    globalThis.fetch = vi.fn() as any
    const res = await GET(req(), ctx('invoices'))
    expect(res.status).toBe(302)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
