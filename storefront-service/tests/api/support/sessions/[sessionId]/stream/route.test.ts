import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const customerChat = vi.hoisted(() => vi.fn())
const sseStream = vi.hoisted(() => vi.fn())
const resolveTenant = vi.hoisted(() => vi.fn())
const subscribeSession = vi.hoisted(() => vi.fn())
const localize = vi.hoisted(() => vi.fn())

vi.mock('@/lib/support/http', () => ({ customerChat, sseStream }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant }))
vi.mock('@/lib/support/events', () => ({ subscribeSession }))
vi.mock('@/lib/support/messages', () => ({ localize }))

import { GET } from '@storefront/app/api/(public)/support/sessions/[sessionId]/stream/route'

const get = () =>
  GET(new NextRequest('http://localhost/api/support/sessions/s1/stream'), { params: Promise.resolve({ sessionId: 's1' }) })

/** Opens the stream the route builds and returns what was sent plus the subscriber the route registered. */
async function open() {
  const sent: any[] = []
  const res = await get()
  const start = sseStream.mock.calls[0][1] as (send: (d: unknown) => void) => Promise<() => void>
  const cleanup = await start(d => sent.push(d))
  const onEvent = subscribeSession.mock.calls[0][2] as (e: any) => void
  return { res, sent, cleanup, onEvent }
}

describe('GET /api/support/sessions/[sessionId]/stream', () => {
  beforeEach(() => {
    customerChat.mockResolvedValue({ user: { userId: 'u1' }, session: { customer_lang: 'hi' } })
    resolveTenant.mockResolvedValue({ tenantId: 't1' })
    subscribeSession.mockReturnValue(() => {})
    sseStream.mockImplementation(() => new Response('stream'))
    localize.mockImplementation((m: any, _t: any, lang: string) => ({ ...m, localizedTo: lang }))
  })

  it('passes the chat access denial through without opening a stream', async () => {
    customerChat.mockResolvedValue(NextResponse.json({ error: 'Session not found' }, { status: 404 }))
    expect((await get()).status).toBe(404)
    expect(sseStream).not.toHaveBeenCalled()
  })

  it('says hello and subscribes the session under its tenant', async () => {
    const { res, sent, cleanup } = await open()
    expect(await res.text()).toBe('stream')
    expect(sent).toEqual([{ kind: 'hello', sessionId: 's1' }])
    expect(subscribeSession).toHaveBeenCalledWith('t1', 's1', expect.any(Function))
    expect(typeof cleanup).toBe('function')
  })

  it('subscribes with a null tenant on the flagship host', async () => {
    resolveTenant.mockRejectedValue(new Error('none'))
    await open()
    expect(subscribeSession.mock.calls[0][0]).toBeNull()
  })

  it('hides internal handoff notes from the customer and tracks their language', async () => {
    const { sent, onEvent } = await open()
    onEvent({ kind: 'session', session: { id: 's1', customerLang: 'ta', handoffSummary: 'secret', handoffReason: 'why', agent: 'Ravi' } })
    expect(sent[1]).toEqual({ kind: 'session', session: { id: 's1', customerLang: 'ta', agent: 'Ravi' } })
    onEvent({ kind: 'message', message: { sender: 'admin', text: 'hello' }, translations: {} })
    expect(sent[2].message.localizedTo).toBe('ta')
  })

  it('sends the customer own messages unlocalized', async () => {
    const { sent, onEvent } = await open()
    onEvent({ kind: 'message', message: { sender: 'customer', text: 'mine' }, translations: {} })
    expect(sent[1]).toEqual({ kind: 'message', sessionId: 's1', message: { sender: 'customer', text: 'mine' } })
    expect(localize).not.toHaveBeenCalled()
  })

  it('forwards translations only for the customer language, hides own presence, forwards agent presence', async () => {
    const { sent, onEvent } = await open()
    onEvent({ kind: 'translation', translations: { hi: 'x' } })
    onEvent({ kind: 'translation', translations: { fr: 'y' } })
    onEvent({ kind: 'presence', side: 'customer' })
    onEvent({ kind: 'presence', side: 'admin', online: true })
    expect(sent.slice(1)).toEqual([
      { kind: 'translation', translations: { hi: 'x' } },
      { kind: 'presence', side: 'admin', online: true },
    ])
  })
})
