import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateBusiness = vi.hoisted(() => vi.fn())
const listActiveSessions = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateBusiness }))
vi.mock('@/lib/auth/auth-sessions', () => ({ listActiveSessions }))

import { GET } from '@storefront/app/api/(public)/business/sessions/route'

const get = () => GET(new NextRequest('http://localhost/api/business/sessions'))

describe('GET /api/business/sessions', () => {
  beforeEach(() => {
    authenticateBusiness.mockResolvedValue({ userId: 'b1', sessionId: 's2' })
    listActiveSessions.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
  })

  it('401s when not a signed-in business', async () => {
    authenticateBusiness.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(listActiveSessions).not.toHaveBeenCalled()
  })

  it('lists the caller sessions and marks the current one', async () => {
    const res = await get()
    expect(await res.json()).toEqual({
      sessions: [
        { id: 's1', current: false },
        { id: 's2', current: true },
      ],
    })
    expect(listActiveSessions).toHaveBeenCalledWith('business', 'b1')
  })

  it('surfaces a store failure', async () => {
    listActiveSessions.mockRejectedValue(new Error('db'))
    await expect(get()).rejects.toThrow('db')
  })
})
