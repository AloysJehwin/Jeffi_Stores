import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ aiDenial: vi.fn(), AI_ADMIN_SCOPE: 'ai:use' }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/ai/template-scenario.schema', async () => {
  const { z } = await import('zod')
  return { TemplateScenarioRequest: z.object({ scenarioText: z.string().min(3), isPlatformLibrary: z.boolean().default(false) }) }
})
vi.mock('@/lib/ai/template-scenario', () => {
  class TemplateScenarioError extends Error { status = 422 }
  return { fillFromScenario: vi.fn(), rateLimit: vi.fn(), TemplateScenarioError }
})
vi.mock('@/lib/ai/billing', () => {
  class AiWalletError extends Error { status = 402; balanceInr = 1; neededInr = 5 }
  return { AiWalletError }
})
vi.mock('@/lib/ai/media', () => {
  class AiMediaError extends Error { status = 415 }
  return { AiMediaError }
})

import { POST } from '@admin/app/api/(admin)/admin/ai/template-scenario/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { fillFromScenario, rateLimit, TemplateScenarioError } from '@/lib/ai/template-scenario'
import { AiWalletError } from '@/lib/ai/billing'
import { AiMediaError } from '@/lib/ai/media'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/ai/template-scenario', { method: 'POST', body: JSON.stringify(body) })
const body = { scenarioText: 'order shipped' }

describe('POST /api/admin/ai/template-scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [], email: 'a@x.in' } as any)
    vi.mocked(aiDenial).mockReturnValue(null as any)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
    vi.mocked(rateLimit).mockReturnValue(true as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(fillFromScenario).mockResolvedValue({ body: 'Hi' } as any)
  })

  it('relays the scope rejection (templates:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req(body))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'templates:write')
  })

  it('403s on AI denial and plan gate', async () => {
    vi.mocked(aiDenial).mockReturnValueOnce('denied')
    expect((await POST(req(body))).status).toBe(403)
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
    expect((await POST(req(body))).status).toBe(403)
    expect(fillFromScenario).not.toHaveBeenCalled()
  })

  it('400s on a bad body', async () => {
    expect((await POST(req({ scenarioText: 'x' }))).status).toBe(400)
  })

  it('429s when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false as any)
    expect((await POST(req(body))).status).toBe(429)
    expect(fillFromScenario).not.toHaveBeenCalled()
  })

  it('returns the fill and passes tenant and admin email', async () => {
    const res = await POST(req(body))
    expect(await res.json()).toEqual({ body: 'Hi' })
    expect(fillFromScenario).toHaveBeenCalledWith(expect.objectContaining({ scenarioText: 'order shipped' }), 't1', false, 'a@x.in')
  })

  it('maps typed errors to their status', async () => {
    const Wallet = AiWalletError as unknown as new (m: string) => Error
    const Media = AiMediaError as unknown as new (m: string) => Error
    vi.mocked(fillFromScenario).mockRejectedValueOnce(new Wallet('low'))
    const w = await POST(req(body))
    expect(w.status).toBe(402)
    expect(await w.json()).toMatchObject({ balanceInr: 1, neededInr: 5 })
    vi.mocked(fillFromScenario).mockRejectedValueOnce(new Media('bad media'))
    expect((await POST(req(body))).status).toBe(415)
    const Scenario = TemplateScenarioError as unknown as new (m: string) => Error
    vi.mocked(fillFromScenario).mockRejectedValueOnce(new Scenario('bad'))
    expect((await POST(req(body))).status).toBe(422)
  })

  it('502s on an unknown failure', async () => {
    vi.mocked(fillFromScenario).mockRejectedValue(new Error('boom'))
    const res = await POST(req(body))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
