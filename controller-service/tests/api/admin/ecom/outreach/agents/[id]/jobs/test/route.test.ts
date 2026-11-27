import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ createJob: vi.fn(), getAgent: vi.fn(), state: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/jobs', () => ({ createJob: m.createJob, SHOWCASE_PROGRAM: 'showcase-offer' }))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({ getAgent: m.getAgent }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: m.state }))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/agents/[id]/jobs/test/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const req = (body?: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.getAgent.mockResolvedValue({ resolved: { skill: { meta: { inputs: { name: { role: 'text' }, phone: { role: 'contact' } } } } } })
  m.state.mockResolvedValue({ test_numbers: ['+919876543210'] })
  m.createJob.mockResolvedValue({ job: { id: 'j1' }, created: true, errors: [] })
})

describe('POST /api/admin/ecom/outreach/agents/[id]/jobs/test', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await POST(req({ inputs: {} }), ctx())).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await POST(req({ inputs: {} }), ctx())).status).toBe(403)
    expect(m.createJob).not.toHaveBeenCalled()
  })

  it('400 on a malformed id or body', async () => {
    expect((await POST(req({ inputs: {} }), ctx('nope'))).status).toBe(400)
    expect((await POST(req(), ctx())).status).toBe(400)
    expect((await POST(req({}), ctx())).status).toBe(400)
    expect((await POST(req({ inputs: 'x' }), ctx())).status).toBe(400)
  })

  it('404 when the agent is missing', async () => {
    m.getAgent.mockResolvedValueOnce(null)
    expect((await POST(req({ inputs: { phone: '9876543210' } }), ctx())).status).toBe(404)
  })

  it('400 when the contact input is not a valid mobile number', async () => {
    const res = await POST(req({ inputs: { phone: '123' } }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/phone must be a valid Indian mobile number/)
    m.getAgent.mockResolvedValueOnce({ resolved: { skill: { meta: { inputs: { name: { role: 'text' } } } } } })
    const none = await POST(req({ inputs: {} }), ctx())
    expect(none.status).toBe(400)
    expect((await none.json()).error).toMatch(/The contact input/)
  })

  it('400 when the number is not one of the program test numbers', async () => {
    const res = await POST(req({ inputs: { phone: '9123456780' } }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/test numbers/)
    m.state.mockResolvedValueOnce({})
    expect((await POST(req({ inputs: { phone: '9876543210' } }), ctx())).status).toBe(400)
    expect(m.createJob).not.toHaveBeenCalled()
  })

  it('201 creates a due-now test job under the write scope', async () => {
    const inputs = { name: 'Asha', phone: '9876543210' }
    const res = await POST(req({ inputs }), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ jobId: 'j1', created: true })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.state).toHaveBeenCalledWith('showcase-offer')
    expect(m.createJob).toHaveBeenCalledWith({ skillId: ID, inputs, source: 'test', dueAt: expect.any(Date), actor: { id: 'a1', label: 'admin:a1' } })
  })

  it('400 with the validation errors when no job comes back', async () => {
    m.createJob.mockResolvedValueOnce({ job: null, created: false, errors: ['name is required'] })
    const res = await POST(req({ inputs: { phone: '9876543210' } }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'name is required', errors: ['name is required'] })
    m.createJob.mockResolvedValueOnce({ job: null, created: false, errors: [] })
    expect((await (await POST(req({ inputs: { phone: '9876543210' } }), ctx())).json()).error).toMatch(/Could not create/)
  })

  it('500 when the store throws', async () => {
    m.createJob.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(req({ inputs: { phone: '9876543210' } }), ctx())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
