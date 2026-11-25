import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn((a: any) => ({ adminId: a.adminId })),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 5),
  withDraftCreate: vi.fn(),
  withDraftWrite: vi.fn(),
}))

import { POST } from '@admin/app/api/(admin)/admin/mailer/draft/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { draftLockResponse, withDraftCreate, withDraftWrite } from '@/lib/admin/draft-locks'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/mailer/draft', { method: 'POST', body: JSON.stringify(body) })

describe('POST mailer/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
  })

  it('401s and 403s (mailer:write)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({}))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({}))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'mailer:write')
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('creates a draft (201) with defaults and takes the lock', async () => {
    const res = await POST(req({ title: 'Sale', wizard_step: 9 }))
    expect(res.status).toBe(201)
    const id = (await res.json()).id
    expect(withDraftCreate).toHaveBeenCalledWith({ adminId: 'a1' }, 'mailer', id, expect.any(Function))
    const db = { query: vi.fn() }
    await vi.mocked(withDraftCreate).mock.calls[0][3](db as any)
    expect(db.query.mock.calls[0][1]).toEqual([id, 'custom', 'Sale', '', '{}', 'all', '{}', null, 3, 'a1', '{}'])
  })

  it('updates an existing draft under the write lock with the epoch, clamping the step', async () => {
    const res = await POST(req({ draft_id: 'd1', subject: 'Hi', wizard_step: 0, channels: { email: {} } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'd1' })
    expect(withDraftWrite).toHaveBeenCalledWith({ adminId: 'a1' }, 'mailer', 'd1', expect.any(Function), { epoch: 5 })
    const db = { query: vi.fn() }
    await vi.mocked(withDraftWrite).mock.calls[0][3](db as any)
    const p = db.query.mock.calls[0][1]
    expect(p[2]).toBe('Hi')
    expect(p[7]).toBe(1)
    expect(p[8]).toBe('d1')
    expect(p[9]).toBe('{"email":{}}')
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('returns 423 when another admin holds the draft, and rethrows other errors', async () => {
    vi.mocked(withDraftWrite).mockRejectedValueOnce(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
    expect((await POST(req({ draft_id: 'd1' }))).status).toBe(423)
    vi.mocked(withDraftCreate).mockRejectedValueOnce(new Error('boom'))
    await expect(POST(req({}))).rejects.toThrow('boom')
  })
})
