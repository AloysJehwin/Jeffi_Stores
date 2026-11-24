import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ resolveAiScope: vi.fn(), parseAiJson: vi.fn(), aiDenial: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeDescriptorForPrompt: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/ai-fill-form/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiChat } from '@/lib/shared/ai-client'
import { resolveAiScope, parseAiJson, aiDenial } from '@/lib/auth/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'

const fields = [{ name: 'title', type: 'text', label: 'Title' }]
const req = (body: unknown) => new NextRequest('http://localhost/api/admin/ai-fill-form', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { scenario: 'a winter sale', fields, scope: 'products:write' }

describe('POST /api/admin/ai-fill-form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(resolveAiScope).mockReturnValue('products:write' as any)
    vi.mocked(aiDenial).mockReturnValue(null as any)
    vi.mocked(storeDescriptorForPrompt).mockResolvedValue('Acme')
    vi.mocked(aiChat).mockResolvedValue({ content: '{"title":"Sale"}' } as any)
    vi.mocked(parseAiJson).mockReturnValue({ title: 'Sale' } as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('400s on invalid json, scope, scenario and fields', async () => {
    expect((await POST(req('nope'))).status).toBe(400)
    vi.mocked(resolveAiScope).mockReturnValueOnce(null as any)
    expect((await POST(req(good))).status).toBe(400)
    expect((await POST(req({ ...good, scenario: 'a' }))).status).toBe(400)
    expect((await POST(req({ ...good, fields: [] }))).status).toBe(400)
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('403s when the scope is denied', async () => {
    vi.mocked(aiDenial).mockReturnValue('No AI for you')
    const res = await POST(req(good))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'No AI for you' })
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('fills the fields and bills the form_fill feature', async () => {
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ fields: { title: 'Sale' } })
    const arg = vi.mocked(aiChat).mock.calls[0][0] as any
    expect(arg.feature).toBe('form_fill')
    expect(arg.messages[1].content).toContain('title (Title, type: text)')
  })

  it('502s on unparseable AI output', async () => {
    vi.mocked(parseAiJson).mockReturnValue(null as any)
    expect((await POST(req(good))).status).toBe(502)
  })

  it('503s when the AI call throws', async () => {
    vi.mocked(aiChat).mockRejectedValue(new Error('down'))
    const res = await POST(req(good))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'down' })
  })
})
