import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { logActivity } from '@/lib/activity'
import { query } from '@/lib/db'

const mockQuery = vi.mocked(query)

describe('logActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a row into customer_activity_log', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await logActivity({
      userId: 'user-1',
      kind: 'order_placed',
      summary: 'Order #123 placed',
    })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO customer_activity_log'),
      expect.arrayContaining(['user-1', null, 'order_placed'])
    )
  })

  it('passes referenceId and referenceType when provided', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await logActivity({
      userId: 'user-1',
      kind: 'tag_added',
      referenceId: 'tag-abc',
      referenceType: 'customer_tags',
      summary: 'Tag added',
    })
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[3]).toBe('tag-abc')
    expect(args[4]).toBe('customer_tags')
  })

  it('serialises metadata to JSON', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await logActivity({
      userId: 'user-1',
      kind: 'login',
      summary: 'Login',
      metadata: { ip: '1.2.3.4' },
    })
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[6]).toBe(JSON.stringify({ ip: '1.2.3.4' }))
  })

  it('does not throw when DB insert fails (silent catch)', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('primary fail'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    await expect(
      logActivity({ userId: 'user-1', kind: 'logout', summary: 'Logged out' })
    ).resolves.toBeUndefined()
  })

  it('passes actorId when provided', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await logActivity({
      userId: 'user-1',
      actorId: 'admin-42',
      kind: 'note_added',
      summary: 'Note added by admin',
    })
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[1]).toBe('admin-42')
  })

  it('defaults metadata to empty object', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await logActivity({ userId: 'u1', kind: 'signup', summary: 'Signed up' })
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[6]).toBe('{}')
  })
})
