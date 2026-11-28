import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), archive: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({
  AGENT_STATUSES: ['draft', 'active', 'paused'],
  getSkillDetail: m.detail,
  updateSkill: m.update,
  archiveSkill: m.archive,
  SkillError: class SkillError extends Error {
    constructor(message: string, public status: number, public validation?: unknown) {
      super(message)
    }
  },
}))

import { GET, PATCH, DELETE } from '@controller/app/api/(admin)/admin/ecom/outreach/skills/[id]/route'
import { SkillError } from '@controller/lib/outreach/agent/skill/store'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.detail.mockResolvedValue({ skill: { id: ID }, versions: [], lists: [] })
  m.update.mockResolvedValue({ id: ID, title: 'New' })
  m.archive.mockResolvedValue(undefined)
})

describe('/api/admin/ecom/outreach/skills/[id]', () => {
  it('401 / 403 gates on every method', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req('GET'), ctx())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await PATCH(req('PATCH', { title: 'x' }), ctx())).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(403)
    expect(m.update).not.toHaveBeenCalled()
    expect(m.archive).not.toHaveBeenCalled()
  })

  it('400 on a malformed id', async () => {
    expect((await GET(req('GET'), ctx('nope'))).status).toBe(400)
    expect((await PATCH(req('PATCH', { title: 'x' }), ctx('nope'))).status).toBe(400)
    expect((await DELETE(req('DELETE'), ctx('nope'))).status).toBe(400)
  })

  it('GET returns the detail under the read scope; 404 when missing', async () => {
    expect(await (await GET(req('GET'), ctx())).json()).toEqual({ skill: { id: ID }, versions: [], lists: [] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    m.detail.mockResolvedValueOnce(null)
    expect((await GET(req('GET'), ctx())).status).toBe(404)
  })

  it('PATCH validates the body and updates under the write scope', async () => {
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400)
    expect((await PATCH(req('PATCH', { title: '' }), ctx())).status).toBe(400)
    expect((await PATCH(req('PATCH', { current_version_id: 'nope' }), ctx())).status).toBe(400)
    const res = await PATCH(req('PATCH', { title: 'New', description: null, current_version_id: VID }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skill: { id: ID, title: 'New' } })
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.update).toHaveBeenCalledWith(ID, { title: 'New', description: null, current_version_id: VID }, expect.objectContaining({ id: 'a1' }))
  })

  it('PATCH turns a SkillError into its status', async () => {
    m.update.mockRejectedValueOnce(new SkillError('That version does not belong to this skill', 400))
    const res = await PATCH(req('PATCH', { current_version_id: VID }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/does not belong/)
    m.update.mockRejectedValueOnce(new SkillError('Skill not found', 404))
    expect((await PATCH(req('PATCH', { title: 'x' }), ctx())).status).toBe(404)
  })

  it('DELETE archives', async () => {
    const res = await DELETE(req('DELETE'), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(m.archive).toHaveBeenCalledWith(ID, expect.objectContaining({ id: 'a1' }))
    m.archive.mockRejectedValueOnce(new SkillError('Skill not found', 404))
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(404)
    m.archive.mockRejectedValueOnce(new Error('db down'))
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(500)
  })
})
