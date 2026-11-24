import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/replies/admin', () => ({ ENTITY_READ_SCOPE: { orders: 'orders:read' }, listRecordReplies: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/replies/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listRecordReplies } from '@/lib/replies/admin'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const ID = '11111111-1111-4111-8111-111111111111'
const call = (qs: string) => GET(new NextRequest(`http://localhost/x${qs}`))

describe('GET /api/admin/replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call(`?entityType=orders&entityId=${ID}`)).status).toBe(401)
  })

  it('returns 400 for an unknown entity type or a bad id', async () => {
    expect((await call(`?entityType=nope&entityId=${ID}`)).status).toBe(400)
    expect((await call('?entityType=orders&entityId=abc')).status).toBe(400)
    expect(listRecordReplies).not.toHaveBeenCalled()
  })

  it("returns 403 without the entity's read scope", async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call(`?entityType=orders&entityId=${ID}`)).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'orders:read')
    expect(listRecordReplies).not.toHaveBeenCalled()
  })

  it("lists the record's replies", async () => {
    vi.mocked(listRecordReplies).mockResolvedValue({ replies: [{ id: 'r1' }] } as never)
    const res = await call(`?entityType=orders&entityId=${ID}`)
    expect(await res.json()).toEqual({ replies: [{ id: 'r1' }] })
    expect(listRecordReplies).toHaveBeenCalledWith('orders', ID)
  })

  it('propagates a store failure', async () => {
    vi.mocked(listRecordReplies).mockRejectedValue(new Error('db'))
    await expect(call(`?entityType=orders&entityId=${ID}`)).rejects.toThrow('db')
  })
})
