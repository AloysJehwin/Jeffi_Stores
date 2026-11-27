import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({
  addSkillVersion: m.add,
  SkillError: class SkillError extends Error {
    constructor(message: string, public status: number, public validation?: unknown) {
      super(message)
    }
  },
}))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/skills/[id]/versions/route'
import { SkillError } from '@controller/lib/outreach/agent/skill/store'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const ID = '11111111-1111-4111-8111-111111111111'
const call = (body: unknown, id = ID) => POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.add.mockResolvedValue({ skill: { id: ID }, version: { id: 'v2', version: 2 }, validation: { ok: true } })
})

describe('/api/admin/ecom/outreach/skills/[id]/versions', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call({ content: 'x' })).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await call({ content: 'x' })).status).toBe(403)
    expect(m.add).not.toHaveBeenCalled()
  })

  it('400 on a malformed id or an empty body', async () => {
    expect((await call({ content: 'x' }, 'nope')).status).toBe(400)
    expect((await call({})).status).toBe(400)
    expect((await call({ content: '' })).status).toBe(400)
  })

  it('adds a version under the write scope and answers 201', async () => {
    const res = await call({ content: '# Skill v2' })
    expect(res.status).toBe(201)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.add).toHaveBeenCalledWith(ID, '# Skill v2', expect.objectContaining({ id: 'a1' }))
    expect(await res.json()).toMatchObject({ version: { version: 2 } })
  })

  it('a validation failure is a 400 with the validation; 404, 409 and server errors keep their status', async () => {
    m.add.mockRejectedValueOnce(new SkillError('Unknown tool', 400, { ok: false, issues: [], skill: null, tools: [] }))
    const bad = await call({ content: 'x' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Unknown tool', validation: { ok: false, issues: [], skill: null, tools: [] } })
    m.add.mockRejectedValueOnce(new SkillError('Skill not found', 404))
    expect((await call({ content: 'x' })).status).toBe(404)
    m.add.mockRejectedValueOnce(new SkillError('This skill is archived', 409))
    expect((await call({ content: 'x' })).status).toBe(409)
    m.add.mockRejectedValueOnce(new Error('db down'))
    expect((await call({ content: 'x' })).status).toBe(500)
  })
})
