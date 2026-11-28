import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), state: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: m.state }))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({
  listSkills: m.list,
  createSkill: m.create,
  SkillError: class SkillError extends Error {
    constructor(message: string, public status: number, public validation?: unknown) {
      super(message)
    }
  },
}))

import { GET, POST } from '@controller/app/api/(admin)/admin/ecom/outreach/skills/route'
import { SkillError } from '@controller/lib/outreach/agent/skill/store'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const url = 'http://localhost/api/admin/ecom/outreach/skills'
const post = (body: unknown) => new NextRequest(url, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.list.mockResolvedValue([{ id: 's1', slug: 'demo' }])
  m.state.mockResolvedValue({ default_skill_id: 's1' })
  m.create.mockResolvedValue({ skill: { id: 's1' }, version: { id: 'v1' }, validation: { ok: true } })
})

describe('/api/admin/ecom/outreach/skills', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await POST(post({ content: 'x' }))).status).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('GET returns the skills, the builtins and the default skill id under the read scope', async () => {
    const j = await (await GET(new NextRequest(url + '?archived=1'))).json()
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:read')
    expect(j.skills).toEqual([{ id: 's1', slug: 'demo' }])
    expect(j.defaultSkillId).toBe('s1')
    expect(j.builtins.map((b: { slug: string }) => b.slug)).toEqual(['showcase-offer', 'showcase-two-call', 'showcase-whatsapp-only', 'post-order-review', 'cod-confirmation', 'abandoned-checkout'])
    expect(j.builtins[0].content).toContain('## Voice')
    expect(m.list).toHaveBeenCalledWith({ tenantId: null, program: 'showcase-offer', includeArchived: true })
    expect((await GET(new NextRequest(url + '?program=nope'))).status).toBe(404)
  })

  it('POST 400s on a missing body', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect((await POST(post({ content: '' }))).status).toBe(400)
    expect((await POST(post({ content: 'x', program: 'nope' }))).status).toBe(404)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('POST creates under the write scope and answers 201', async () => {
    const res = await POST(post({ content: '# Skill' }))
    expect(res.status).toBe(201)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_outreach:write')
    expect(m.create).toHaveBeenCalledWith({ tenantId: null, program: 'showcase-offer', content: '# Skill', actor: expect.objectContaining({ id: 'a1' }) })
    expect(await res.json()).toMatchObject({ skill: { id: 's1' }, version: { id: 'v1' } })
  })

  it('POST turns a validation failure into a 400 with the validation, and a taken name into a 409', async () => {
    m.create.mockRejectedValueOnce(new SkillError('Unknown tool', 400, { ok: false, issues: [], skill: null, tools: [] }))
    const bad = await POST(post({ content: 'x' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Unknown tool', validation: { ok: false, issues: [], skill: null, tools: [] } })
    m.create.mockRejectedValueOnce(new SkillError('A skill named "demo" already exists', 409))
    const dup = await POST(post({ content: 'x' }))
    expect(dup.status).toBe(409)
    expect(await dup.json()).toEqual({ error: 'A skill named "demo" already exists' })
    m.create.mockRejectedValueOnce(new Error('db down'))
    expect((await POST(post({ content: 'x' }))).status).toBe(500)
  })
})
