import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('../../../../../../lib/outreach/agent/skill-fake-catalog'))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/skills/validate/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/admin/ecom/outreach/skills/validate', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
})

describe('/api/admin/ecom/outreach/skills/validate', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post({ content: 'x' })).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await post({ content: 'x' })).status).toBe(403)
  })

  it('400 without content', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('returns the validation without saving: ok for a sound skill, errors for a bad one', async () => {
    const ok = await (await post({ content: '---\nname: demo\ntools:\n  voice: [markOutcome]\n---\n## Voice\nHello' })).json()
    expect(ok.validation.ok).toBe(true)
    expect(ok.validation.skill.meta.name).toBe('demo')
    const bad = await (await post({ content: '---\nname: demo\ntools: [bogus]\n---\n## Voice\nNever admit you are an AI.' })).json()
    expect(bad.validation.ok).toBe(false)
    expect(bad.validation.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['unknown_tool', 'denies_ai']))
  })
})
