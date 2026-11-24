import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/support/translate', () => ({ ensureTranslations: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn(), adminLanguage: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/translate/route'
import { ensureTranslations } from '@/lib/support/translate'
import { adminChat, adminLanguage } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const req = () => new NextRequest('http://localhost/api/admin/support/sessions/s1/translate', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { id: 's1' } } as any)
  vi.mocked(adminLanguage).mockResolvedValue('hi' as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/translate', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:read', { passive: true })
    expect(ensureTranslations).not.toHaveBeenCalled()
  })

  it('translates pending messages into the agent language', async () => {
    vi.mocked(ensureTranslations).mockResolvedValue(3 as any)
    expect(await (await POST(req(), ctx)).json()).toEqual({ translated: 3 })
    expect(adminLanguage).toHaveBeenCalledWith('a1')
    expect(ensureTranslations).toHaveBeenCalledWith('s1', 'hi', 20)
  })

  it('propagates a translation failure', async () => {
    vi.mocked(ensureTranslations).mockRejectedValue(new Error('ai'))
    await expect(POST(req(), ctx)).rejects.toThrow('ai')
  })
})
