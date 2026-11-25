import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminFor: vi.fn(), adminLanguage: vi.fn() }))
vi.mock('@/lib/support/types', () => ({ isSupportLanguage: (l: unknown) => l === 'en' || l === 'hi' }))

import { GET, PATCH } from '@admin/app/api/(admin)/admin/support/preferences/route'
import { query } from '@/lib/shared/db'
import { adminFor, adminLanguage } from '@/lib/support/http'

const get = () => new NextRequest('http://localhost/api/admin/support/preferences')
const patch = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/support/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminFor).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('GET /api/admin/support/preferences', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminFor).mockResolvedValueOnce(deny(401))
    expect((await GET(get())).status).toBe(401)
    vi.mocked(adminFor).mockResolvedValueOnce(deny(403))
    expect((await GET(get())).status).toBe(403)
    expect(adminFor).toHaveBeenCalledWith(expect.anything(), 'customers:read', { passive: true })
  })

  it('returns the agent language', async () => {
    vi.mocked(adminLanguage).mockResolvedValue('hi' as any)
    expect(await (await GET(get())).json()).toEqual({ lang: 'hi' })
    expect(adminLanguage).toHaveBeenCalledWith('a1')
  })
})

describe('PATCH /api/admin/support/preferences', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminFor).mockResolvedValueOnce(deny(401))
    expect((await PATCH(patch({ lang: 'en' }))).status).toBe(401)
    vi.mocked(adminFor).mockResolvedValueOnce(deny(403))
    expect((await PATCH(patch({ lang: 'en' }))).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 for an unsupported language', async () => {
    expect((await PATCH(patch({ lang: 'xx' }))).status).toBe(400)
    expect((await PATCH(patch({}))).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('saves the language on the admin row', async () => {
    expect(await (await PATCH(patch({ lang: 'hi' }))).json()).toEqual({ lang: 'hi' })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE admins SET support_language'), ['a1', 'hi'])
  })

  it('propagates a db failure', async () => {
    vi.mocked(query).mockRejectedValue(new Error('db'))
    await expect(PATCH(patch({ lang: 'en' }))).rejects.toThrow('db')
  })
})
