import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shipping/gst-api-creds', () => {
  class GstApiNotConnectedError extends Error {}
  return { resolveGstApiCreds: vi.fn(), GstApiNotConnectedError, GST_API_LABEL: { ewaybill: 'e-way bill', einvoice: 'e-invoice' } }
})
vi.mock('@/lib/shipping/ewaybill', () => ({ authenticateEWayBill: vi.fn() }))
vi.mock('@/lib/shipping/einvoice', () => ({ authenticateEInvoice: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/gst/credentials/test/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveGstApiCreds, GstApiNotConnectedError } from '@/lib/shipping/gst-api-creds'
import { authenticateEWayBill } from '@/lib/shipping/ewaybill'
import { authenticateEInvoice } from '@/lib/shipping/einvoice'

const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

describe('POST gst/credentials/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(resolveGstApiCreds).mockResolvedValue({ gstin: '29ABC' } as any)
  })

  it('relays a scope rejection (gst:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req({ provider: 'ewaybill' }))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'gst:write')
    expect(resolveGstApiCreds).not.toHaveBeenCalled()
  })

  it('400s on an unknown provider', async () => {
    expect((await POST(req({ provider: 'x' }))).status).toBe(400)
    expect((await POST(req(null))).status).toBe(400)
  })

  it('signs in with the e-way bill API', async () => {
    const j = await (await POST(req({ provider: 'ewaybill' }))).json()
    expect(j).toEqual({ ok: true, message: 'Signed in to the e-way bill API as GSTIN 29ABC.' })
    expect(authenticateEWayBill).toHaveBeenCalledWith({ gstin: '29ABC' })
    expect(authenticateEInvoice).not.toHaveBeenCalled()
  })

  it('signs in with the e-invoice API', async () => {
    await POST(req({ provider: 'einvoice' }))
    expect(authenticateEInvoice).toHaveBeenCalled()
  })

  it('reports missing credentials without calling the API', async () => {
    vi.mocked(resolveGstApiCreds).mockResolvedValue(null as any)
    const j = await (await POST(req({ provider: 'ewaybill' }))).json()
    expect(j.ok).toBe(false)
    expect(authenticateEWayBill).not.toHaveBeenCalled()
  })

  it('reports a not-connected store and a failed login as ok:false', async () => {
    vi.mocked(resolveGstApiCreds).mockRejectedValueOnce(new (GstApiNotConnectedError as unknown as new (m: string) => Error)('Connect first'))
    expect(await (await POST(req({ provider: 'ewaybill' }))).json()).toEqual({ ok: false, message: 'Connect first' })
    vi.mocked(authenticateEWayBill).mockRejectedValueOnce(new Error('Bad credentials'))
    expect(await (await POST(req({ provider: 'ewaybill' }))).json()).toEqual({ ok: false, message: 'Bad credentials' })
  })
})
