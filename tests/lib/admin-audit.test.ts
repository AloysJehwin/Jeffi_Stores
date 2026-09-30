import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables exist before vi.mock() factories run
// ---------------------------------------------------------------------------
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { logAdminAudit, diffOf } from '@/lib/admin-audit'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logAdminAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('inserts an audit row with minimal params', async () => {
    await logAdminAudit({
      adminId: 'admin-001',
      action: 'create',
      entityType: 'product',
      summary: 'Created product',
    })

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO admin_audit_log')
    expect(params[0]).toBe('admin-001')
    expect(params[1]).toBe('create')
    expect(params[2]).toBe('product')
    expect(params[4]).toBe('Created product')
  })

  it('passes entityId to query', async () => {
    await logAdminAudit({
      adminId: 'admin-002',
      action: 'update',
      entityType: 'order',
      entityId: 'order-999',
      summary: 'Updated order',
    })
    const params = mockQuery.mock.calls[0][1]
    expect(params[3]).toBe('order-999')
  })

  it('serialises diff to JSON', async () => {
    await logAdminAudit({
      adminId: 'admin-001',
      action: 'price_change',
      entityType: 'product',
      summary: 'Price changed',
      diff: { price: { from: 100, to: 200 } },
    })
    const params = mockQuery.mock.calls[0][1]
    const diffJson = params[5]
    expect(typeof diffJson).toBe('string')
    const parsed = JSON.parse(diffJson)
    expect(parsed.price.from).toBe(100)
  })

  it('passes null for diff when not provided', async () => {
    await logAdminAudit({
      adminId: 'admin-001',
      action: 'login',
      entityType: 'admin',
      summary: 'Admin logged in',
    })
    const params = mockQuery.mock.calls[0][1]
    expect(params[5]).toBeNull()
  })

  it('extracts ip from x-forwarded-for header', async () => {
    const mockReq = {
      headers: {
        get: (name: string) => {
          if (name === 'x-forwarded-for') return '10.0.0.1, 10.0.0.2'
          if (name === 'user-agent') return 'test-agent'
          return null
        },
      },
    } as unknown as NextRequest

    await logAdminAudit({
      adminId: 'admin-001',
      action: 'login',
      entityType: 'admin',
      summary: 'Login',
      request: mockReq,
    })
    const params = mockQuery.mock.calls[0][1]
    expect(params[7]).toBe('10.0.0.1') // trimmed first IP
    expect(params[8]).toBe('test-agent')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const mockReq = {
      headers: {
        get: (name: string) => {
          if (name === 'x-real-ip') return '192.168.1.5'
          if (name === 'user-agent') return 'agent'
          return null
        },
      },
    } as unknown as NextRequest

    await logAdminAudit({
      adminId: 'admin-001',
      action: 'logout',
      entityType: 'admin',
      summary: 'Logout',
      request: mockReq,
    })
    const params = mockQuery.mock.calls[0][1]
    expect(params[7]).toBe('192.168.1.5')
  })

  it('does not throw when query fails — writes to debug log', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error')).mockResolvedValueOnce({ rows: [] })

    await expect(
      logAdminAudit({
        adminId: null,
        action: 'delete',
        entityType: 'product',
        summary: 'Deleted',
      })
    ).resolves.toBeUndefined()

    // Second call is the debug log insert
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery.mock.calls[1][1][0]).toBe('logAdminAudit')
  })

  it('does not throw even when debug log also fails', async () => {
    mockQuery.mockRejectedValue(new Error('total failure'))
    await expect(
      logAdminAudit({
        adminId: null,
        action: 'export',
        entityType: 'system',
        summary: 'Export attempt',
      })
    ).resolves.toBeUndefined()
  })

  it('includes metadata JSON in params', async () => {
    await logAdminAudit({
      adminId: 'admin-001',
      action: 'import',
      entityType: 'system',
      summary: 'Import',
      metadata: { rows: 42 },
    })
    const params = mockQuery.mock.calls[0][1]
    const meta = JSON.parse(params[6])
    expect(meta.rows).toBe(42)
  })

  it('uses empty object for metadata when not provided', async () => {
    await logAdminAudit({
      adminId: 'admin-001',
      action: 'send',
      entityType: 'customer',
      summary: 'Sent email',
    })
    const params = mockQuery.mock.calls[0][1]
    expect(params[6]).toBe('{}')
  })
})

// ---------------------------------------------------------------------------
// diffOf
// ---------------------------------------------------------------------------

describe('diffOf', () => {
  it('returns empty object when both inputs are null', () => {
    expect(diffOf(null, null, ['name'])).toEqual({})
  })

  it('returns empty object when before is null', () => {
    expect(diffOf(null, { name: 'a' }, ['name'])).toEqual({})
  })

  it('returns empty object when after is null', () => {
    expect(diffOf({ name: 'a' }, null, ['name'])).toEqual({})
  })

  it('returns empty object when no fields changed', () => {
    const before = { name: 'Alice', price: 100 }
    const after = { name: 'Alice', price: 100 }
    expect(diffOf(before, after, ['name', 'price'])).toEqual({})
  })

  it('detects a string field change', () => {
    const before = { name: 'Alice' }
    const after = { name: 'Bob' }
    const result = diffOf(before, after, ['name'])
    expect(result.name).toEqual({ from: 'Alice', to: 'Bob' })
  })

  it('detects a numeric field change', () => {
    const before = { price: 100 }
    const after = { price: 200 }
    const result = diffOf(before, after, ['price'])
    expect(result.price).toEqual({ from: 100, to: 200 })
  })

  it('detects change from null to a value', () => {
    const before = { code: null as string | null }
    const after = { code: 'ABC' as string | null }
    const result = diffOf<{ code: string | null }>(before, after, ['code'])
    expect(result.code).toEqual({ from: null, to: 'ABC' })
  })

  it('detects change from a value to null', () => {
    const before = { code: 'ABC' as string | null }
    const after = { code: null as string | null }
    const result = diffOf<{ code: string | null }>(before, after, ['code'])
    expect(result.code).toEqual({ from: 'ABC', to: null })
  })

  it('serialises objects for comparison', () => {
    const before = { tags: ['a', 'b'] }
    const after = { tags: ['a', 'c'] }
    const result = diffOf(before, after, ['tags'])
    expect(result.tags).toBeDefined()
    expect(result.tags.from).toEqual(['a', 'b'])
  })

  it('ignores fields that are equal objects', () => {
    const before = { meta: { x: 1 } }
    const after = { meta: { x: 1 } }
    expect(diffOf(before, after, ['meta'])).toEqual({})
  })

  it('only checks the specified fields', () => {
    const before = { name: 'Alice', price: 100 }
    const after = { name: 'Alice', price: 200 }
    const result = diffOf(before, after, ['name']) // price not in field list
    expect(result).toEqual({})
  })
})
