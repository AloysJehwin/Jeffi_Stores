import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { CUSTOMER_OPS_TOOLS } from '@/lib/admin-agent/tools/customer-ops'
import * as db from '@/lib/db'

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
      await expect(
        getTool('propose_add_customer_note').handler({ customerId: 'u1', body: '' })
      ).rejects.toThrow('body is required')
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
      await expect(
        getTool('propose_add_customer_tag').handler({ customerId: 'bad', tagSlug: 'vip' })
      ).rejects.toThrow('Customer not found')
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
      await expect(
        getTool('propose_create_customer_task').handler({ customerId: 'u1', title: '' })
      ).rejects.toThrow('title is required')
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
      await expect(
        getTool('propose_create_tag_definition').handler({ slug: '', label: 'Enterprise' })
      ).rejects.toThrow('slug is required')
    })
  })
})
