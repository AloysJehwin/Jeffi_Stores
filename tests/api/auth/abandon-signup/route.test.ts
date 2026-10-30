import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/shared/s3', () => ({
  deleteObjectKey: vi.fn(),
}))

import { POST } from '@controller/app/api/(public)/auth/abandon-signup/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as s3 from '@/lib/shared/s3'

function req() {
  return new Request('http://localhost/api/auth/abandon-signup', { method: 'POST' }) as any
}

describe('POST /api/auth/abandon-signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(s3.deleteObjectKey).mockResolvedValue(undefined)
  })

  it('401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('deletes a brand-new, unverified, order-less customer account', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      is_recent: true,
      order_count: '0',
    } as any)
    const res = await POST(req())
    const body = await res.json()
    expect(body.deleted).toBe(true)
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'), ['u1'])
  })

  it('NEVER deletes a verified account', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: true,
      user_type: 'customer',
      is_recent: true,
      order_count: '0',
    } as any)
    const res = await POST(req())
    const body = await res.json()
    expect(body.deleted).toBe(false)
    expect(body.reason).toBe('not_eligible')
    expect(db.query).not.toHaveBeenCalled()
  })

  it('NEVER deletes an account that has orders', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      is_recent: true,
      order_count: '3',
    } as any)
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('NEVER deletes an old account (outside the recent window)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      is_recent: false,
      order_count: '0',
    } as any)
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('NEVER deletes an APPROVED business account', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'business',
      approval_status: 'approved',
      is_recent: true,
      order_count: '0',
    } as any)
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('deletes a brand-new, UNAPPROVED, order-less business account (cancelled Google signup)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'business',
      approval_status: 'pending',
      is_recent: true,
      order_count: '0',
    } as any)
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(true)
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'), ['u1'])
  })

  it('removes the Google avatar it uploaded along with the account', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      avatar_s3_key: 'avatars/u1.jpg',
      is_recent: true,
      order_count: '0',
    } as any)
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(true)
    expect(s3.deleteObjectKey).toHaveBeenCalledWith('avatars/u1.jpg')
  })

  it('still reports the account deleted when the avatar cleanup fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      avatar_s3_key: 'avatars/u1.jpg',
      is_recent: true,
      order_count: '0',
    } as any)
    vi.mocked(s3.deleteObjectKey).mockRejectedValueOnce(new Error('s3 down'))
    const res = await POST(req())
    expect((await res.json()).deleted).toBe(true)
  })

  it('keeps the avatar when the phone was verified before the delete ran', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'u1',
      phone_verified: false,
      user_type: 'customer',
      avatar_s3_key: 'avatars/u1.jpg',
      is_recent: true,
      order_count: '0',
    } as any)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const res = await POST(req())
    const body = await res.json()
    expect(body.deleted).toBe(false)
    expect(body.reason).toBe('not_eligible')
    expect(s3.deleteObjectKey).not.toHaveBeenCalled()
  })

  it('no-op when the account no longer exists', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null as any)
    const res = await POST(req())
    const body = await res.json()
    expect(body.deleted).toBe(false)
    expect(body.reason).toBe('not_found')
    expect(db.query).not.toHaveBeenCalled()
  })
})
