import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ detail: vi.fn(), cancel: vi.fn(), retry: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/jobs', () => ({
  getJobDetail: m.detail,
  cancelJob: m.cancel,
  retryJob: m.retry,
  JobError: class JobError extends Error {
    constructor(message: string, public status = 400) {
      super(message)
    }
  },
}))

import { GET, PATCH } from '@controller/app/api/(admin)/admin/ecom/outreach/jobs/[jobId]/route'
import { JobError } from '@controller/lib/outreach/agent/jobs'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = (id = ID) => ({ params: Promise.resolve({ jobId: id }) })
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.detail.mockResolvedValue({ job: { id: ID }, calls: [] })
  m.cancel.mockResolvedValue({ id: ID, status: 'cancelled' })
  m.retry.mockResolvedValue({ id: ID, status: 'pending' })
})

describe('/api/admin/ecom/outreach/jobs/[jobId]', () => {
  it('401 / 403 gates on both methods', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req('GET'), ctx())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await PATCH(req('PATCH', { action: 'cancel' }), ctx())).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await PATCH(req('PATCH', { action: 'cancel' }), ctx())).status).toBe(403)
    expect(m.cancel).not.toHaveBeenCalled()
    expect(m.retry).not.toHaveBeenCalled()
  })

  it('400 on a malformed id', async () => {
    expect((await GET(req('GET'), ctx('nope'))).status).toBe(400)
    expect((await PATCH(req('PATCH', { action: 'cancel' }), ctx('nope'))).status).toBe(400)
  })

  it('GET returns the detail under the read scope; 404 when missing; 500 on failure', async () => {
    expect(await (await GET(req('GET'), ctx())).json()).toEqual({ job: { id: ID }, calls: [] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(m.detail).toHaveBeenCalledWith(ID)
    m.detail.mockResolvedValueOnce(null)
    expect((await GET(req('GET'), ctx())).status).toBe(404)
    m.detail.mockRejectedValueOnce(new Error('db down'))
    expect((await GET(req('GET'), ctx())).status).toBe(500)
  })

  it('PATCH validates the body', async () => {
    expect((await PATCH(req('PATCH'), ctx())).status).toBe(400)
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400)
    expect((await PATCH(req('PATCH', { action: 'delete' }), ctx())).status).toBe(400)
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it('PATCH cancel cancels as the admin under the write scope', async () => {
    const res = await PATCH(req('PATCH', { action: 'cancel' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: { id: ID, status: 'cancelled' } })
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.cancel).toHaveBeenCalledWith(ID, 'admin:a1', 'cancelled_by_admin')
  })

  it('PATCH cancel 409s when the job already ended', async () => {
    m.cancel.mockResolvedValueOnce(null)
    const res = await PATCH(req('PATCH', { action: 'cancel' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already ended/)
  })

  it('PATCH retry retries as the admin', async () => {
    const res = await PATCH(req('PATCH', { action: 'retry' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: { id: ID, status: 'pending' } })
    expect(m.retry).toHaveBeenCalledWith(ID, 'admin:a1')
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it('maps a JobError to its status and anything else to 500', async () => {
    m.retry.mockRejectedValueOnce(new JobError('Only a failed or cancelled job can be retried', 409))
    const res = await PATCH(req('PATCH', { action: 'retry' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/failed or cancelled/)
    m.cancel.mockRejectedValueOnce(new Error('db down'))
    expect((await PATCH(req('PATCH', { action: 'cancel' }), ctx())).status).toBe(500)
  })
})
