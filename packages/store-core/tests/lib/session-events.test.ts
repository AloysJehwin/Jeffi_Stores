import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/redis', () => ({ getRedisClient: () => ({ get: vi.fn(), set: vi.fn() }) }))

import { publishSessionEvent, subscribeSessionEvents } from '@/lib/auth/session-events'

describe('session events (in-process fallback when redis has no pub/sub)', () => {
  it('delivers a published event to a subscriber of the same session only', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeSessionEvents('s1', a)
    const offB = subscribeSessionEvents('s2', b)
    await publishSessionEvent('s1', {
      type: 'deadline',
      deadlineAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T01:00:00.000Z',
    })
    expect(a).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0][0]).toMatchObject({ type: 'deadline' })
    expect(b).not.toHaveBeenCalled()
    offA()
    offB()
  })

  it('stops delivering after unsubscribe', async () => {
    const h = vi.fn()
    const off = subscribeSessionEvents('s3', h)
    off()
    await publishSessionEvent('s3', { type: 'logout', reason: 'idle' })
    expect(h).not.toHaveBeenCalled()
  })

  it('fans a logout out to every subscriber of that session', async () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    const off1 = subscribeSessionEvents('s4', h1)
    const off2 = subscribeSessionEvents('s4', h2)
    await publishSessionEvent('s4', { type: 'logout', reason: 'logout' })
    expect(h1).toHaveBeenCalledWith({ type: 'logout', reason: 'logout' })
    expect(h2).toHaveBeenCalledWith({ type: 'logout', reason: 'logout' })
    off1()
    off2()
  })
})
