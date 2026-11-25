import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/support/events', () => ({ subscribeInbox: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminFor: vi.fn(), sseStream: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/support/stream/route'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { subscribeInbox } from '@/lib/support/events'
import { adminFor, sseStream } from '@/lib/support/http'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/support/stream${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const sent: unknown[] = []
let onEvent: (e: any) => void = () => {}

beforeEach(() => {
  vi.resetAllMocks()
  sent.length = 0
  vi.mocked(adminFor).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(subscribeInbox).mockImplementation(((_t: any, fn: any) => {
    onEvent = fn
    return () => {}
  }) as any)
  vi.mocked(sseStream).mockImplementation((async (_r: any, fn: any) => {
    await fn((e: unknown) => sent.push(e))
    return new Response('stream')
  }) as any)
})

describe('GET /api/admin/support/stream', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminFor).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(adminFor).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(adminFor).toHaveBeenCalledWith(expect.anything(), 'customers:read', { passive: true })
    expect(sseStream).not.toHaveBeenCalled()
  })

  it('sends hello and forwards every inbox event for the tenant', async () => {
    expect((await GET(req())).status).toBe(200)
    expect(sent).toEqual([{ kind: 'hello' }])
    expect(subscribeInbox).toHaveBeenCalledWith('t1', expect.any(Function))
    onEvent({ kind: 'message', sessionId: 's1' })
    onEvent({ kind: 'message', sessionId: 's2' })
    expect(sent).toHaveLength(3)
  })

  it('narrows to one chat with ?s=', async () => {
    await GET(req('?s=s1'))
    onEvent({ kind: 'message', sessionId: 's1' })
    onEvent({ kind: 'message', sessionId: 's2' })
    expect(sent).toEqual([{ kind: 'hello' }, { kind: 'message', sessionId: 's1' }])
  })

  it('subscribes with a null tenant when it cannot be resolved', async () => {
    vi.mocked(resolveTenant).mockRejectedValue(new Error('none'))
    await GET(req())
    expect(subscribeInbox).toHaveBeenCalledWith(null, expect.any(Function))
  })
})
