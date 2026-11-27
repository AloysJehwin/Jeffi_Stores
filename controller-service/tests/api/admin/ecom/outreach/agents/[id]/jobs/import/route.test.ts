import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ importJobs: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/jobs-import', () => ({ importJobs: m.importJobs }))
vi.mock('@controller/lib/outreach/import', () => ({
  ImportError: class ImportError extends Error {
    constructor(message: string, public status = 400) {
      super(message)
    }
  },
}))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/agents/[id]/jobs/import/route'
import { ImportError } from '@controller/lib/outreach/import'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const url = 'http://localhost/api/admin/ecom/outreach/agents/x/jobs/import'
const upload = (fields: Record<string, string>, file: File | null = new File(['phone\n9876543210'], 'jobs.csv', { type: 'text/csv' })) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('file', file)
  return new NextRequest(url, { method: 'POST', body: fd })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.importJobs.mockResolvedValue({ created: 2, duplicates: 1, failed: [{ row: 4, errors: ['bad phone'] }] })
})

describe('POST /api/admin/ecom/outreach/agents/[id]/jobs/import', () => {
  it('401 / 403 gates before touching the import', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await POST(upload({ mapping: '{}' }), ctx())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await POST(upload({ mapping: '{}' }), ctx())).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await POST(upload({ mapping: '{}' }), ctx())).status).toBe(403)
    expect(m.importJobs).not.toHaveBeenCalled()
  })

  it('400 on a malformed agent id', async () => {
    expect((await POST(upload({ mapping: '{}' }), ctx('nope'))).status).toBe(400)
    expect(m.importJobs).not.toHaveBeenCalled()
  })

  it('413 when the declared size is over the limit', async () => {
    // fetch's Request drops a hand-set content-length, so stub the header the route reads.
    const r = new NextRequest(url, { method: 'POST', body: new FormData() })
    const get = r.headers.get.bind(r.headers)
    vi.spyOn(r.headers, 'get').mockImplementation(n => (n.toLowerCase() === 'content-length' ? String(16 * 1024 * 1024) : get(n)))
    expect((await POST(r, ctx())).status).toBe(413)
    expect(m.importJobs).not.toHaveBeenCalled()
  })

  it('400 when no file arrives', async () => {
    const res = await POST(upload({ mapping: '{}' }, null), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No file/)
  })

  it('400 on a mapping that is missing, not JSON or the wrong shape', async () => {
    const missing = await POST(upload({}), ctx())
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toMatch(/mapping must be JSON/)
    expect((await POST(upload({ mapping: 'not json' }), ctx())).status).toBe(400)
    const wrong = await POST(upload({ mapping: JSON.stringify({ phone: '' }) }), ctx())
    expect(wrong.status).toBe(400)
    expect((await wrong.json()).error).toMatch(/phone/)
    expect((await POST(upload({ mapping: JSON.stringify({ phone: 5 }) }), ctx())).status).toBe(400)
    expect(m.importJobs).not.toHaveBeenCalled()
  })

  it('201 with the import result, passing the file, mapping and actor under the write scope', async () => {
    const res = await POST(upload({ mapping: JSON.stringify({ phone: ' Mobile ' }) }), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: 2, duplicates: 1, failed: [{ row: 4, errors: ['bad phone'] }] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    const arg = m.importJobs.mock.calls[0][0]
    expect(arg).toMatchObject({ skillId: ID, fileName: 'jobs.csv', mapping: { phone: 'Mobile' }, actor: { id: 'a1', label: 'admin:a1' } })
    expect(Buffer.isBuffer(arg.buf)).toBe(true)
    expect(arg.buf.toString()).toBe('phone\n9876543210')
  })

  it('maps an ImportError to its status and anything else to 500', async () => {
    m.importJobs.mockRejectedValueOnce(new ImportError('Agent not found', 404))
    const res = await POST(upload({ mapping: '{}' }), ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Agent not found')
    m.importJobs.mockRejectedValueOnce(new Error('db down'))
    const err = await POST(upload({ mapping: '{}' }), ctx())
    expect(err.status).toBe(500)
    expect((await err.json()).error).toBe('db down')
  })
})
