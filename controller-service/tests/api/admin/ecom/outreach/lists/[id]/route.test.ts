import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/lists', () => ({
  setListSkill: m.set,
  ListError: class ListError extends Error {
    constructor(message: string, public status = 400) {
      super(message)
    }
  },
}))

import { PATCH } from '@controller/app/api/(admin)/admin/ecom/outreach/lists/[id]/route'
import { ListError } from '@controller/lib/outreach/lists'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '33333333-3333-4333-8333-333333333333'
const SID = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'
const call = (body: unknown, id = ID) => PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.set.mockResolvedValue({ id: ID, skill_id: SID, skill_version_id: VID })
})

describe('PATCH /api/admin/ecom/outreach/lists/[id]', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call({ skill_id: SID })).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await call({ skill_id: SID })).status).toBe(403)
    expect(m.set).not.toHaveBeenCalled()
  })

  it('400 on a malformed id or body', async () => {
    expect((await call({ skill_id: SID }, 'nope')).status).toBe(400)
    expect((await call({})).status).toBe(400)
    expect((await call({ skill_id: 'x' })).status).toBe(400)
    expect((await call({ skill_id: SID, skill_version_id: 'x' })).status).toBe(400)
  })

  it('sets the skill and an optional pinned version under the write scope', async () => {
    const res = await call({ skill_id: SID, skill_version_id: VID })
    expect(res.status).toBe(200)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.set).toHaveBeenCalledWith(ID, SID, VID, 'admin:a1')
    expect(await res.json()).toEqual({ list: { id: ID, skill_id: SID, skill_version_id: VID } })
    await call({ skill_id: SID })
    expect(m.set).toHaveBeenLastCalledWith(ID, SID, null, 'admin:a1')
  })

  it('null clears the skill', async () => {
    await call({ skill_id: null })
    expect(m.set).toHaveBeenCalledWith(ID, null, null, 'admin:a1')
  })

  it('turns a ListError into its status and anything else into a 500', async () => {
    m.set.mockRejectedValueOnce(new ListError('That version does not belong to the skill', 400))
    const res = await call({ skill_id: SID, skill_version_id: VID })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/does not belong/)
    m.set.mockRejectedValueOnce(new ListError('List not found', 404))
    expect((await call({ skill_id: SID })).status).toBe(404)
    m.set.mockRejectedValueOnce(new Error('db down'))
    expect((await call({ skill_id: SID })).status).toBe(500)
  })
})
