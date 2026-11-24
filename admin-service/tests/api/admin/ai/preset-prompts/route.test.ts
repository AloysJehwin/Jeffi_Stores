import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ aiDenial: vi.fn(), AI_ADMIN_SCOPE: 'ai:use' }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/ai/preset-prompts', () => ({
  DEFAULT_PRESETS: [
    { kind: 'image', feature: null, scenario: 'd', prompt: 'default image' },
    { kind: 'video', feature: null, scenario: 'v', prompt: 'default video' },
  ],
  readPresets: vi.fn(),
  writeTenantPreset: vi.fn(),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/ai/preset-prompts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { readPresets, writeTenantPreset } from '@/lib/ai/preset-prompts'

const get = (qs: string) => new NextRequest(`http://localhost/api/admin/ai/preset-prompts${qs}`)
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/ai/preset-prompts', { method: 'POST', body: JSON.stringify(body) })
const body = { kind: 'image', scenario: 'Sale', prompt: 'a sale banner' }

describe('ai/preset-prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(aiDenial).mockReturnValue(null as any)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
    vi.mocked(readPresets).mockResolvedValue([{ prompt: 'p' }] as any)
    vi.mocked(writeTenantPreset).mockResolvedValue({ id: 'pr1' } as any)
  })

  describe('GET', () => {
    it('400s on a bad kind', async () => {
      expect((await GET(get('?kind=audio'))).status).toBe(400)
      expect(requireAdminScope).not.toHaveBeenCalled()
    })
    it('relays the scope rejection', async () => {
      vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
      expect((await GET(get('?kind=image'))).status).toBe(403)
      expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    })
    it('403s on AI denial and plan gate', async () => {
      vi.mocked(aiDenial).mockReturnValueOnce('denied')
      expect((await GET(get('?kind=image'))).status).toBe(403)
      vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
      expect((await GET(get('?kind=image'))).status).toBe(403)
      expect(readPresets).not.toHaveBeenCalled()
    })
    it('lists the merged presets', async () => {
      const res = await GET(get('?kind=image&feature=hero'))
      expect(await res.json()).toEqual({ presets: [{ prompt: 'p' }] })
      expect(readPresets).toHaveBeenCalledWith({ kind: 'image', feature: 'hero' })
    })
    it('falls back to the platform defaults when the read throws', async () => {
      vi.mocked(readPresets).mockRejectedValue(new Error('no tenant'))
      const j = await (await GET(get('?kind=video'))).json()
      expect(j.presets).toEqual([{ kind: 'video', feature: null, scenario: 'v', prompt: 'default video' }])
    })
  })

  describe('POST', () => {
    it('relays the scope rejection', async () => {
      vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
      expect((await POST(post(body))).status).toBe(401)
      expect(writeTenantPreset).not.toHaveBeenCalled()
    })
    it('403s on a plan without AI', async () => {
      vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
      expect((await POST(post(body))).status).toBe(403)
    })
    it('400s on a bad body', async () => {
      expect((await POST(post({ kind: 'image', scenario: '', prompt: 'x' }))).status).toBe(400)
      expect((await POST(post({ ...body, feature: 'not-a-feature' }))).status).toBe(400)
    })
    it('upserts the override', async () => {
      const res = await POST(post({ ...body, display_order: 3 }))
      expect(await res.json()).toEqual({ id: 'pr1' })
      expect(writeTenantPreset).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', feature: null, scenario: 'Sale', prompt: 'a sale banner', display_order: 3, createdBy: 'a1' }))
    })
    it('500s when the save throws', async () => {
      vi.mocked(writeTenantPreset).mockRejectedValue(new Error('db down'))
      const res = await POST(post(body))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'db down' })
    })
  })
})
