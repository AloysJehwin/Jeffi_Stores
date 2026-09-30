import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ touchSession: vi.fn() }))

import { POST } from '@/app/api/admin/session/heartbeat/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { touchSession } from '@/lib/auth/auth-sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const mockTouch = vi.mocked(touchSession)
const req = () => new NextRequest('http://localhost/api/admin/session/heartbeat', { method: 'POST' })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/admin/session/heartbeat', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(mockTouch).not.toHaveBeenCalled()
  })

  it('touches the caller session and returns the new deadline as epoch ms', async () => {
    mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [], sid: 'tok' } as any)
    mockTouch.mockResolvedValue({ deadlineAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-01-01T01:00:00.000Z' })
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockTouch).toHaveBeenCalledWith('tok')
    expect(body.authenticated).toBe(true)
    expect(body.deadlineAt).toBe(Date.parse('2030-01-01T00:00:00.000Z'))
    expect(body.expiresAt).toBe(Date.parse('2030-01-01T01:00:00.000Z'))
    expect(typeof body.serverNow).toBe('number')
  })

  it('401 when the session vanished between auth and touch', async () => {
    mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [], sid: 'tok' } as any)
    mockTouch.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
  })
})
