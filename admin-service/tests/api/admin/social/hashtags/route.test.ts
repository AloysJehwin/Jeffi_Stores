import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/hashtags', () => ({ suggestHashtags: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social/hashtags/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { readJson } from '@/lib/channels/route'
import { suggestHashtags } from '@/lib/social/hashtags'

const req = () => new NextRequest('http://localhost/api/admin/social/hashtags', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('POST /api/admin/social/hashtags', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for empty text', async () => {
    vi.mocked(readJson).mockResolvedValue({ text: '   ' })
    expect((await POST(req())).status).toBe(400)
    expect(suggestHashtags).not.toHaveBeenCalled()
  })

  it('returns the suggestions for the trimmed text', async () => {
    vi.mocked(readJson).mockResolvedValue({ text: ' red shoes ' })
    vi.mocked(suggestHashtags).mockResolvedValue(['#red'] as any)
    expect(await (await POST(req())).json()).toEqual({ hashtags: ['#red'] })
    expect(suggestHashtags).toHaveBeenCalledWith('red shoes')
  })

  it('maps a provider failure to 502 and a 403 through', async () => {
    vi.mocked(readJson).mockResolvedValue({ text: 'x' })
    vi.mocked(suggestHashtags).mockRejectedValueOnce(new Error('ai down'))
    const bad = await POST(req())
    expect(bad.status).toBe(502)
    expect((await bad.json()).error).toBe('ai down')
    vi.mocked(suggestHashtags).mockRejectedValueOnce(Object.assign(new Error('plan'), { status: 403 }))
    expect((await POST(req())).status).toBe(403)
  })
})
