import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/support/sessions', () => ({ getSessionDto: vi.fn() }))
vi.mock('@/lib/support/admin', () => ({ closeChat: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn(), agentRef: vi.fn() }))

import { GET, PATCH } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/route'
import { getSessionDto } from '@/lib/support/sessions'
import { closeChat } from '@/lib/support/admin'
import { adminChat, agentRef } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const get = () => new NextRequest('http://localhost/api/admin/support/sessions/s1')
const patch = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/support/sessions/s1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const chat = { admin: { adminId: 'a1' }, session: { id: 's1', status: 'open' } }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(adminChat).mockResolvedValue(chat as any)
  vi.mocked(agentRef).mockResolvedValue({ id: 'a1', name: 'Agent' } as any)
})

describe('GET /api/admin/support/sessions/[sessionId]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await GET(get(), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await GET(get(), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:read', { passive: true })
  })

  it('returns the session', async () => {
    vi.mocked(getSessionDto).mockResolvedValue({ id: 's1' } as any)
    expect(await (await GET(get(), ctx)).json()).toEqual({ session: { id: 's1' } })
  })
})

describe('PATCH /api/admin/support/sessions/[sessionId]', () => {
  it('rejects unauthenticated and a missing write scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await PATCH(patch({ status: 'closed' }), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await PATCH(patch({ status: 'closed' }), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:write')
    expect(closeChat).not.toHaveBeenCalled()
  })

  it('returns 400 for anything but closing', async () => {
    expect((await PATCH(patch({ status: 'open' }), ctx)).status).toBe(400)
    expect(closeChat).not.toHaveBeenCalled()
  })

  it('closes the chat as the agent', async () => {
    vi.mocked(closeChat).mockResolvedValue(true as any)
    expect(await (await PATCH(patch({ status: 'closed' }), ctx)).json()).toEqual({ success: true })
    expect(closeChat).toHaveBeenCalledWith(chat.session, { id: 'a1', name: 'Agent' })
  })

  it('returns 404 when the chat is already closed', async () => {
    vi.mocked(closeChat).mockResolvedValue(false as any)
    expect((await PATCH(patch({ status: 'closed' }), ctx)).status).toBe(404)
  })

  it('returns 500 when closing fails', async () => {
    vi.mocked(closeChat).mockRejectedValue(new Error('db'))
    expect((await PATCH(patch({ status: 'closed' }), ctx)).status).toBe(500)
  })
})
