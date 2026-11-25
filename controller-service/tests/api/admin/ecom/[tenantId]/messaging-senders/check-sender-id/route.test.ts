import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const check = vi.hoisted(() => ({ checkSenderId: vi.fn() }))
vi.mock('@/lib/messaging/dlt-sender-check', () => check)

import { GET } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/messaging-senders/check-sender-id/route'

const get = (header?: string) => GET(new NextRequest(`http://localhost/x${header === undefined ? '' : `?header=${header}`}`))

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
})

describe('GET /api/admin/ecom/[tenantId]/messaging-senders/check-sender-id', () => {
  it('401s unauthenticated and 403s a non-platform admin without calling AWS', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get('JEFFIS')).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await get('JEFFIS')).status).toBe(403)
    expect(check.checkSenderId).not.toHaveBeenCalled()
  })

  it('returns the AWS answer for the platform admin', async () => {
    check.checkSenderId.mockResolvedValue({ header: 'JEFFIS', registered: true, status: 'TRANSACTIONAL' })
    const res = await get('JEFFIS')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ header: 'JEFFIS', registered: true, status: 'TRANSACTIONAL' })
    expect(check.checkSenderId).toHaveBeenCalledWith('JEFFIS')
  })

  it('400s a bad header and 502s an AWS failure without leaking its message', async () => {
    check.checkSenderId.mockRejectedValueOnce(new Error('The DLT header is 3 to 11 letters or digits'))
    expect((await get('x')).status).toBe(400)
    check.checkSenderId.mockRejectedValueOnce(new Error('AccessDenied arn:aws:iam::123'))
    const res = await get('JEFFIS')
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('arn:aws')
  })
})
