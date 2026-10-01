import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { CUSTOMER_OPS_TOOLS } from '@/lib/admin-agent/tools/customer-ops'
import * as db from '@/lib/shared/db'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)

function getTool(name: string) {
  return CUSTOMER_OPS_TOOLS.find(t => t.name === name)!
}

// Shape that loadCustomerLite expects from queryOne
const fakeDbUser = { id: 'u1', email: 'alice@test.com', first_name: 'Alice', last_name: null }

describe('admin-agent/tools/customer-ops', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('CUSTOMER_OPS_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(CUSTOMER_OPS_TOOLS)).toBe(true)
      expect(CUSTOMER_OPS_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of CUSTOMER_OPS_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  describe('get_customer_notes', () => {
    it('returns notes for existing customer', async () => {
      // get_customer_notes does NOT call loadCustomerLite; it calls queryMany directly
      mockQueryMany.mockResolvedValueOnce([{ id: 'n1', body: 'VIP customer', created_at: '2024-01-01' }])

      const result = await getTool('get_customer_notes').handler({ customerId: 'u1' })
      expect((result as any).notes).toBeDefined()
      expect((result as any).count).toBe(1)
    })

    it('returns empty notes array when no notes exist', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('get_customer_notes').handler({ customerId: 'u1' })
      expect((result as any).notes).toEqual([])
      expect((result as any).count).toBe(0)
    })

    it('uses explicit numeric limit and reports truncated when result fills limit', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, body: 'note' }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('get_customer_notes').handler({ customerId: 'u1', limit: 5 })
      expect((result as any).truncated).toBe(true)
    })

    it('clamps limit below minimum to 1', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      // limit 0 should be clamped to 1 — we just verify it does not throw and calls queryMany
      await getTool('get_customer_notes').handler({ customerId: 'u1', limit: 0 })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })

    it('clamps limit above maximum to 100', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('get_customer_notes').handler({ customerId: 'u1', limit: 9999 })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })

    it('uses default limit when limit is not a number', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('get_customer_notes').handler({ customerId: 'u1', limit: undefined })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })
  })

  describe('get_customer_tasks', () => {
    it('returns tasks for existing customer', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 't1', title: 'Follow up', status: 'open' }])

      const result = await getTool('get_customer_tasks').handler({ customerId: 'u1' })
      expect((result as any).tasks).toBeDefined()
      expect((result as any).count).toBe(1)
    })

    it('returns empty tasks array when no tasks exist', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('get_customer_tasks').handler({ customerId: 'u1' })
      expect((result as any).tasks).toEqual([])
      expect((result as any).count).toBe(0)
    })

    it('filters by status=open', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 't1', title: 'Task', status: 'pending' }])
      const result = await getTool('get_customer_tasks').handler({ customerId: 'u1', status: 'open' })
      expect((result as any).tasks).toHaveLength(1)
      // verify the SQL passed includes the open filter (indirectly, via call args)
      const sql = mockQueryMany.mock.calls[0][0] as string
      expect(sql).toContain("'pending','in_progress'")
    })

    it('filters by status=completed', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 't2', title: 'Done', status: 'completed' }])
      const result = await getTool('get_customer_tasks').handler({ customerId: 'u1', status: 'completed' })
      expect((result as any).tasks).toHaveLength(1)
      const sql = mockQueryMany.mock.calls[0][0] as string
      expect(sql).toContain("'completed'")
    })

    it('applies no status filter for unknown status value', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('get_customer_tasks').handler({ customerId: 'u1', status: 'other' })
      const sql = mockQueryMany.mock.calls[0][0] as string
      // should not contain extra status filter beyond the base user_id WHERE
      expect(sql).not.toContain("'pending','in_progress'")
      expect(sql).not.toContain("ct.status = 'completed'")
    })

    it('reports truncated=true when result count equals limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('get_customer_tasks').handler({ customerId: 'u1', limit: 3 })
      expect((result as any).truncated).toBe(true)
    })

    it('uses default limit when limit is not a number', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('get_customer_tasks').handler({ customerId: 'u1', limit: undefined })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })
  })

  describe('get_customer_tags', () => {
    it('returns tags for a customer', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'tg1', tag: 'vip', created_at: '2024-01-01', color: 'gold', sort_order: 1 },
      ])
      const result = await getTool('get_customer_tags').handler({ customerId: 'u1' })
      expect((result as any).tags).toHaveLength(1)
      expect((result as any).count).toBe(1)
    })

    it('returns empty tags array when customer has no tags', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('get_customer_tags').handler({ customerId: 'u1' })
      expect((result as any).tags).toEqual([])
      expect((result as any).count).toBe(0)
    })
  })

  describe('get_customer_health', () => {
    it('returns health row when it exists', async () => {
      const healthRow = {
        user_id: 'u1',
        score: 82,
        recency_score: 90,
        frequency_score: 70,
        monetary_score: 85,
        engagement_score: 80,
        satisfaction_score: 75,
        churn_risk: 'low',
        trend_delta_7d: 2,
        trend_delta_30d: -1,
        last_computed_at: '2024-06-01',
      }
      mockQueryOne.mockResolvedValueOnce(healthRow)
      const result = await getTool('get_customer_health').handler({ customerId: 'u1' })
      expect((result as any).health).toEqual(healthRow)
      expect((result as any).note).toBeUndefined()
    })

    it('returns null health with note when record does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_customer_health').handler({ customerId: 'u1' })
      expect((result as any).health).toBeNull()
      expect((result as any).note).toContain('not yet computed')
    })
  })

  describe('list_tag_definitions', () => {
    it('returns all tag definitions', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'd1', tag: 'vip', color: 'gold', sort_order: 1, created_at: '2024-01-01' },
        { id: 'd2', tag: 'at-risk', color: 'red', sort_order: 2, created_at: '2024-01-02' },
      ])
      const result = await getTool('list_tag_definitions').handler({})
      expect((result as any).definitions).toHaveLength(2)
      expect((result as any).count).toBe(2)
    })

    it('returns empty definitions when none exist', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_tag_definitions').handler({})
      expect((result as any).definitions).toEqual([])
      expect((result as any).count).toBe(0)
    })
  })

  describe('list_customers_by_tag', () => {
    it('returns customers for a given tag', async () => {
      const rows = [
        { id: 'u1', email: 'alice@test.com', name: 'Alice', phone: null, tagged_at: '2024-01-01', paid_orders: 3 },
      ]
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_customers_by_tag').handler({ tagSlug: 'vip' })
      expect((result as any).data.customers).toHaveLength(1)
      expect((result as any).summary).toContain('"vip"')
    })

    it('uses "No customers" summary when result is empty', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_customers_by_tag').handler({ tagSlug: 'ghost' })
      expect((result as any).summary).toContain('No customers')
      expect((result as any).data.truncated).toBe(false)
    })

    it('summary uses singular "customer" when exactly 1 result', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'u1', email: 'a@b.com', name: 'A' }])
      const result = await getTool('list_customers_by_tag').handler({ tagSlug: 'solo' })
      expect((result as any).summary).toContain('customer tagged')
      expect((result as any).summary).not.toContain('customers')
    })

    it('appends "+" to summary count when truncated', async () => {
      const rows = Array.from({ length: 2 }, (_, i) => ({ id: `u${i}`, email: `u${i}@test.com`, name: `User ${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      // limit=2 so rows.length === lim => truncated
      const result = await getTool('list_customers_by_tag').handler({ tagSlug: 'bulk', limit: 2 })
      expect((result as any).summary).toContain('2+')
      expect((result as any).data.truncated).toBe(true)
    })

    it('lower-cases and trims tagSlug', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('list_customers_by_tag').handler({ tagSlug: '  VIP  ' })
      const callArgs = mockQueryMany.mock.calls[0][1] as unknown[]
      expect(callArgs[0]).toBe('vip')
    })

    it('throws when tagSlug is empty', async () => {
      await expect(getTool('list_customers_by_tag').handler({ tagSlug: '' })).rejects.toThrow('tagSlug is required')
    })

    it('throws when tagSlug is whitespace only', async () => {
      await expect(getTool('list_customers_by_tag').handler({ tagSlug: '   ' })).rejects.toThrow('tagSlug is required')
    })

    it('uses default limit when limit is not a number', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('list_customers_by_tag').handler({ tagSlug: 'vip', limit: undefined })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })
  })

  describe('list_open_tasks', () => {
    it('returns all open tasks across store without adminId filter', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 't1', title: 'Task', priority: 'high', status: 'pending' }])
      const result = await getTool('list_open_tasks').handler({})
      expect((result as any).tasks).toHaveLength(1)
      expect((result as any).count).toBe(1)
    })

    it('filters by adminId when provided', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 't2', title: 'Assigned task' }])
      const result = await getTool('list_open_tasks').handler({ adminId: 'admin-uuid-1' })
      expect((result as any).tasks).toHaveLength(1)
      const sql = mockQueryMany.mock.calls[0][0] as string
      expect(sql).toContain('ct.assigned_to =')
    })

    it('does not add adminId WHERE filter when adminId is falsy', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('list_open_tasks').handler({ adminId: '' })
      const vals = mockQueryMany.mock.calls[0][1] as unknown[]
      // With no adminId, vals should be [lim] — only 1 element (the limit)
      expect(vals).toHaveLength(1)
    })

    it('reports truncated=true when rows equal limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}` }))
      mockQueryMany.mockResolvedValueOnce(rows)
      const result = await getTool('list_open_tasks').handler({ limit: 3 })
      expect((result as any).truncated).toBe(true)
    })

    it('uses default limit when limit is not a number', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      await getTool('list_open_tasks').handler({ limit: undefined })
      expect(mockQueryMany).toHaveBeenCalledOnce()
    })
  })

  describe('propose_add_customer_note', () => {
    it('proposes adding a note for valid customer', async () => {
      // loadCustomerLite calls queryOne once
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_add_customer_note').handler({
        customerId: 'u1',
        body: 'Customer prefers email contact',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('add_customer_note')
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_add_customer_note').handler({ customerId: 'bad', body: 'Some note' })
      ).rejects.toThrow('Customer not found')
    })

    it('throws when body is empty', async () => {
      await expect(getTool('propose_add_customer_note').handler({ customerId: 'u1', body: '' })).rejects.toThrow(
        'body is required'
      )
    })

    it('throws when body exceeds 2000 chars', async () => {
      await expect(
        getTool('propose_add_customer_note').handler({ customerId: 'u1', body: 'x'.repeat(2001) })
      ).rejects.toThrow('body too long')
    })

    it('truncates preview to 100 chars with ellipsis when body is long', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const longBody = 'A'.repeat(150)
      const result = await getTool('propose_add_customer_note').handler({ customerId: 'u1', body: longBody })
      const confirmation = (result as any).confirmation as string
      expect(confirmation).toContain('…')
      // preview should be 100 chars + ellipsis, not the full 150
      expect(confirmation.length).toBeLessThan(longBody.length + 50)
    })

    it('sets isPrivate=true when passed "true"', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_add_customer_note').handler({
        customerId: 'u1',
        body: 'Private note',
        isPrivate: 'true',
      })
      expect((result as any).payload.isPrivate).toBe(true)
    })

    it('sets isPrivate=false when passed "false"', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_add_customer_note').handler({
        customerId: 'u1',
        body: 'Public note',
        isPrivate: 'false',
      })
      expect((result as any).payload.isPrivate).toBe(false)
    })

    it('uses email as name when both first and last name are null', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u2', email: 'bob@test.com', first_name: null, last_name: null })
      const result = await getTool('propose_add_customer_note').handler({ customerId: 'u2', body: 'Note' })
      const confirmation = (result as any).confirmation as string
      expect(confirmation).toContain('bob@test.com')
    })

    it('assembles full name from first and last name', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'u3', email: 'carol@test.com', first_name: 'Carol', last_name: 'Smith' })
      const result = await getTool('propose_add_customer_note').handler({ customerId: 'u3', body: 'Note' })
      const confirmation = (result as any).confirmation as string
      expect(confirmation).toContain('Carol Smith')
    })
  })

  describe('propose_add_customer_tag', () => {
    it('proposes adding tag to customer', async () => {
      // loadCustomerLite: queryOne call 1
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // check existing tag: queryOne call 2 — not found, so we can propose
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_add_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'vip',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('add_customer_tag')
    })

    it('returns proposed=false when tag already applied', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // existing tag found
      mockQueryOne.mockResolvedValueOnce({ '?column?': 1 })
      const result = await getTool('propose_add_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'vip',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(getTool('propose_add_customer_tag').handler({ customerId: 'bad', tagSlug: 'vip' })).rejects.toThrow(
        'Customer not found'
      )
    })

    it('throws when tagSlug is empty', async () => {
      await expect(getTool('propose_add_customer_tag').handler({ customerId: 'u1', tagSlug: '' })).rejects.toThrow(
        'tagSlug is required'
      )
    })

    it('includes expiresAt in payload when provided', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_add_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'trial',
        expiresAt: '2025-12-31T00:00:00Z',
      })
      expect((result as any).payload.expiresAt).toBe('2025-12-31T00:00:00Z')
      // kv_pairs should include "Expires at"
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const expPair = kvBlock.pairs.find((p: any) => p.key === 'Expires at')
      expect(expPair).toBeDefined()
    })

    it('sets expiresAt to null when not provided', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_add_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'vip',
      })
      expect((result as any).payload.expiresAt).toBeNull()
    })

    it('lower-cases and trims tagSlug', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_add_customer_tag').handler({
        customerId: 'u1',
        tagSlug: '  VIP  ',
      })
      expect((result as any).payload.tagSlug).toBe('vip')
    })
  })

  describe('propose_remove_customer_tag', () => {
    it('proposes removing tag from customer', async () => {
      // loadCustomerLite: queryOne call 1
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // existing tag check: found
      mockQueryOne.mockResolvedValueOnce({ '?column?': 1 })
      const result = await getTool('propose_remove_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'vip',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('remove_customer_tag')
    })

    it('returns proposed=false when tag not on customer', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // tag not found
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_remove_customer_tag').handler({
        customerId: 'u1',
        tagSlug: 'vip',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_remove_customer_tag').handler({ customerId: 'bad', tagSlug: 'vip' })
      ).rejects.toThrow('Customer not found')
    })

    it('throws when tagSlug is empty', async () => {
      await expect(getTool('propose_remove_customer_tag').handler({ customerId: 'u1', tagSlug: '' })).rejects.toThrow(
        'tagSlug is required'
      )
    })

    it('lower-cases and trims tagSlug before checking', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce({ '?column?': 1 })
      const result = await getTool('propose_remove_customer_tag').handler({
        customerId: 'u1',
        tagSlug: '  VIP  ',
      })
      expect((result as any).payload.tagSlug).toBe('vip')
    })
  })

  describe('propose_create_customer_task', () => {
    it('proposes creating task for valid customer', async () => {
      // loadCustomerLite: queryOne call 1
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // no assignedToAdminId, so no second queryOne needed
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Follow up call',
        dueAt: '2025-01-15',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('create_customer_task')
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_create_customer_task').handler({ customerId: 'bad', title: 'Task' })
      ).rejects.toThrow('Customer not found')
    })

    it('throws when title is empty', async () => {
      await expect(getTool('propose_create_customer_task').handler({ customerId: 'u1', title: '' })).rejects.toThrow(
        'title is required'
      )
    })

    it('defaults priority to medium for invalid priority value', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task',
        priority: 'invalid',
      })
      expect((result as any).payload.priority).toBe('medium')
    })

    it('uses provided valid priority', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Urgent task',
        priority: 'urgent',
      })
      expect((result as any).payload.priority).toBe('urgent')
    })

    it('sets dueAt to null when not provided', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task without due date',
      })
      expect((result as any).payload.dueAt).toBeNull()
    })

    it('includes due date in confirmation and kv_pairs when dueAt provided', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task',
        dueAt: '2025-03-01',
      })
      expect((result as any).confirmation).toContain('due 2025-03-01')
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const duePair = kvBlock.pairs.find((p: any) => p.key === 'Due')
      expect(duePair).toBeDefined()
    })

    it('resolves assignee username when assignedToAdminId is provided and admin exists', async () => {
      // loadCustomerLite
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // admin lookup
      mockQueryOne.mockResolvedValueOnce({ label: 'admin_bob' })
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task',
        assignedToAdminId: 'admin-uuid-1',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const assigneePair = kvBlock.pairs.find((p: any) => p.key === 'Assignee')
      expect(assigneePair.value).toBe('@admin_bob')
    })

    it('uses raw assignee UUID as label when admin record not found', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // admin lookup returns null
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task',
        assignedToAdminId: 'unknown-admin-uuid',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const assigneePair = kvBlock.pairs.find((p: any) => p.key === 'Assignee')
      expect(assigneePair.value).toBe('unknown-admin-uuid')
    })

    it('shows "Self (acting admin)" assignee label when no assignedToAdminId', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      const result = await getTool('propose_create_customer_task').handler({
        customerId: 'u1',
        title: 'Task',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const assigneePair = kvBlock.pairs.find((p: any) => p.key === 'Assignee')
      expect(assigneePair.value).toBe('Self (acting admin)')
    })
  })

  describe('propose_close_customer_task', () => {
    it('proposes closing an existing task', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'task1',
        title: 'Follow up',
        status: 'open',
        user_id: 'u1',
        customer_email: 'alice@test.com',
        customer_name: 'Alice',
      })
      const result = await getTool('propose_close_customer_task').handler({
        taskId: 'task1',
        resolution: 'Called and resolved',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('close_customer_task')
    })

    it('throws when task not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_close_customer_task').handler({ taskId: 'bad', resolution: 'done' })
      ).rejects.toThrow('Task not found')
    })

    it('returns proposed=false when task already closed', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'task1',
        title: 'Follow up',
        status: 'completed',
        user_id: 'u1',
        customer_email: 'alice@test.com',
        customer_name: 'Alice',
      })
      const result = await getTool('propose_close_customer_task').handler({
        taskId: 'task1',
        resolution: 'done',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('returns proposed=false when task is cancelled', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'task1',
        title: 'Follow up',
        status: 'cancelled',
        user_id: 'u1',
        customer_email: 'alice@test.com',
        customer_name: 'Alice',
      })
      const result = await getTool('propose_close_customer_task').handler({
        taskId: 'task1',
      })
      expect((result as any).proposed).toBe(false)
      expect((result as any).info).toContain('cancelled')
    })

    it('throws when taskId is empty', async () => {
      await expect(getTool('propose_close_customer_task').handler({ taskId: '' })).rejects.toThrow('taskId is required')
    })

    it('sets resolution to null in payload when resolution is empty', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'task1',
        title: 'Task',
        status: 'pending',
        user_id: 'u1',
        customer_email: 'alice@test.com',
        customer_name: 'Alice',
      })
      const result = await getTool('propose_close_customer_task').handler({
        taskId: 'task1',
        resolution: '',
      })
      expect((result as any).payload.resolution).toBeNull()
    })

    it('includes resolution in kv_pairs when resolution is non-empty', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'task1',
        title: 'Task',
        status: 'pending',
        user_id: 'u1',
        customer_email: 'alice@test.com',
        customer_name: 'Alice',
      })
      const result = await getTool('propose_close_customer_task').handler({
        taskId: 'task1',
        resolution: 'Issue resolved via phone',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const resPair = kvBlock.pairs.find((p: any) => p.key === 'Resolution')
      expect(resPair).toBeDefined()
      expect(resPair.value).toBe('Issue resolved via phone')
    })
  })

  describe('propose_toggle_marketing_opt_out', () => {
    it('proposes opting out customer from marketing', async () => {
      // loadCustomerLite: queryOne call 1
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // marketing_opt_out check: call 2 — currently opted IN
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: false })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'true',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('toggle_marketing_opt_out')
    })

    it('proposes opting customer back in', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // currently opted OUT
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: true })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'false',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('toggle_marketing_opt_out')
    })

    it('throws when customer not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_toggle_marketing_opt_out').handler({ customerId: 'bad', optOut: 'true' })
      ).rejects.toThrow('Customer not found')
    })

    it('returns proposed=false when no change needed (already opted out)', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // already opted OUT
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: true })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'true',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('returns proposed=false when already opted in and target is opt in', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: false })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'false',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('handles null cur row (no users row found) as opted-in', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      // marketing_opt_out query returns null (row missing)
      mockQueryOne.mockResolvedValueOnce(null)
      // wasOptedOut = !!null?.marketing_opt_out = false, target=true => change needed
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'true',
      })
      expect((result as any).proposed).toBe(true)
    })

    it('includes privacy-sensitive callout when opting out', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: false })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'true',
      })
      const blocks = (result as any).ui_blocks as any[]
      const callout = blocks.find(b => b.type === 'callout' && b.tone === 'warn')
      expect(callout).toBeDefined()
      expect(callout.title).toContain('Privacy')
    })

    it('includes re-enabling callout when opting in', async () => {
      mockQueryOne.mockResolvedValueOnce(fakeDbUser)
      mockQueryOne.mockResolvedValueOnce({ marketing_opt_out: true })
      const result = await getTool('propose_toggle_marketing_opt_out').handler({
        customerId: 'u1',
        optOut: 'false',
      })
      const blocks = (result as any).ui_blocks as any[]
      const callout = blocks.find(b => b.type === 'callout' && b.tone === 'warn')
      expect(callout).toBeDefined()
      expect(callout.title).toContain('Re-enabling')
    })
  })

  describe('propose_create_tag_definition', () => {
    it('proposes creating new tag definition', async () => {
      // queryOne check for existing tag — not found
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'enterprise',
        label: 'Enterprise',
        description: 'Enterprise customers',
        color: '#FF5733',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('create_tag_definition')
    })

    it('returns proposed=false when tag definition already exists', async () => {
      // existing found
      mockQueryOne.mockResolvedValueOnce({ '?column?': 1 })
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'enterprise',
        label: 'Enterprise',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('throws when slug is missing', async () => {
      await expect(getTool('propose_create_tag_definition').handler({ slug: '', label: 'Enterprise' })).rejects.toThrow(
        'slug is required'
      )
    })

    it('throws when slug has invalid characters after cleaning', async () => {
      await expect(
        getTool('propose_create_tag_definition').handler({ slug: '!invalid!', label: 'Bad' })
      ).rejects.toThrow('slug must be lowercase alphanumerics + hyphens')
    })

    it('converts spaces to hyphens in slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'high value',
        label: 'High Value',
      })
      expect((result as any).payload.slug).toBe('high-value')
    })

    it('defaults color to "accent" when color is not provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'newslug',
        label: 'New Slug',
      })
      expect((result as any).payload.color).toBe('accent')
    })

    it('uses cleaned slug as label when label is empty', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'myslug',
        label: '   ',
      })
      expect((result as any).payload.label).toBe('myslug')
    })

    it('sets description to null in payload when not provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'simple',
        label: 'Simple',
      })
      expect((result as any).payload.description).toBeNull()
    })

    it('includes description in kv_pairs when provided', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'vip',
        label: 'VIP',
        description: 'Very important person',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const descPair = kvBlock.pairs.find((p: any) => p.key === 'Description')
      expect(descPair).toBeDefined()
    })

    it('does not include description in kv_pairs when description is absent', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('propose_create_tag_definition').handler({
        slug: 'plain',
        label: 'Plain',
      })
      const kvBlock = (result as any).ui_blocks.find((b: any) => b.type === 'kv_pairs')
      const descPair = kvBlock.pairs.find((p: any) => p.key === 'Description')
      expect(descPair).toBeUndefined()
    })
  })
})
