import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  }
  const Pool = vi.fn(() => ({ connect: vi.fn().mockResolvedValue(mockClient), on: vi.fn() }))
  return { Pool }
})

import {
  loadApprovedDynamicTool,
  listApprovedDynamicTools,
  runReadonlySql,
  buildDynamicEmailProposal,
  bumpInvocationCount,
} from '@/lib/admin-agent/dynamic-tools'
import * as db from '@/lib/db'

const mockQuery = vi.mocked(db.query)
const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)

const readonlyTool = {
  id: 'tool-1',
  name: 'get_orders',
  description: 'Get orders',
  args_schema: {},
  kind: 'readonly_sql' as const,
  sql_template: 'SELECT * FROM orders WHERE customer_id = $customer_id',
  email_template: null,
}

const emailTool = {
  id: 'tool-2',
  name: 'send_promo',
  description: 'Send promo',
  args_schema: {},
  kind: 'templated_email' as const,
  sql_template: null,
  email_template: {
    subject: 'Hello {{customer_name}}',
    body: 'Dear {{customer_name}}, you have {{discount}}% off',
    recipientArg: 'email',
  },
}

describe('dynamic-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DATABASE_URL
  })

  describe('loadApprovedDynamicTool', () => {
    it('queries for approved tool by name', async () => {
      mockQueryOne.mockResolvedValueOnce(readonlyTool)
      const result = await loadApprovedDynamicTool('get_orders')
      expect(result).toEqual(readonlyTool)
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('admin_agent_proposed_tools'),
        ['get_orders']
      )
    })

    it('returns null when tool not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await loadApprovedDynamicTool('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listApprovedDynamicTools', () => {
    it('returns array of approved tools', async () => {
      mockQueryMany.mockResolvedValueOnce([readonlyTool, emailTool])
      const result = await listApprovedDynamicTools()
      expect(result).toHaveLength(2)
      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining('admin_agent_proposed_tools')
      )
    })

    it('returns empty array when no tools', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await listApprovedDynamicTools()
      expect(result).toEqual([])
    })
  })

  describe('runReadonlySql', () => {
    it('throws on wrong kind', async () => {
      await expect(runReadonlySql(emailTool, {})).rejects.toThrow('Tool kind mismatch')
    })

    it('throws when sql_template is null', async () => {
      const t = { ...readonlyTool, sql_template: null }
      await expect(runReadonlySql(t, {})).rejects.toThrow('No sql_template')
    })

    it('throws on INSERT statement', async () => {
      const t = { ...readonlyTool, sql_template: 'INSERT INTO orders VALUES (1)' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('DML')
    })

    it('throws on UPDATE statement', async () => {
      const t = { ...readonlyTool, sql_template: 'UPDATE orders SET status = 1' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('DML')
    })

    it('throws on DELETE statement', async () => {
      const t = { ...readonlyTool, sql_template: 'DELETE FROM orders' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('DML')
    })

    it('throws on DROP statement', async () => {
      const t = { ...readonlyTool, sql_template: 'DROP TABLE orders' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('DML')
    })

    it('throws on forbidden table (admins)', async () => {
      const t = { ...readonlyTool, sql_template: 'SELECT * FROM admins' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('forbidden')
    })

    it('throws on forbidden column (password_hash)', async () => {
      const t = { ...readonlyTool, sql_template: 'SELECT password_hash FROM users' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('forbidden')
    })

    it('throws on forbidden table (payment_methods)', async () => {
      const t = { ...readonlyTool, sql_template: 'SELECT * FROM payment_methods' }
      await expect(runReadonlySql(t, {})).rejects.toThrow('forbidden')
    })

    it('throws on missing arg substitution', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/test'
      const t = { ...readonlyTool, sql_template: 'SELECT * FROM orders WHERE id = $missing_arg' }
      await expect(runReadonlySql(t, {})).rejects.toThrow(/Arg substitution failed|Missing arg/)
    })

    it('throws when DATABASE_URL not configured', async () => {
      // DATABASE_URL is not set, pool creation throws
      await expect(runReadonlySql(readonlyTool, { customer_id: '123' }))
        .rejects.toThrow('DATABASE_URL not configured')
    })
  })

  describe('buildDynamicEmailProposal', () => {
    it('throws on wrong kind', async () => {
      await expect(buildDynamicEmailProposal(readonlyTool, {})).rejects.toThrow('Tool kind mismatch')
    })

    it('throws when email_template is null', async () => {
      const t = { ...emailTool, email_template: null }
      await expect(buildDynamicEmailProposal(t, {})).rejects.toThrow('No email_template')
    })

    it('throws when recipient arg is not a valid email', async () => {
      await expect(
        buildDynamicEmailProposal(emailTool, {
          email: 'not-an-email',
          customer_name: 'Alice',
          discount: '20',
        })
      ).rejects.toThrow('valid email')
    })

    it('builds email proposal with mustache-rendered fields', async () => {
      const result = await buildDynamicEmailProposal(emailTool, {
        email: 'alice@example.com',
        customer_name: 'Alice',
        discount: '20',
      })
      expect(result.proposed).toBe(true)
      expect(result.kind).toBe('send_dynamic_email')
      expect(result.payload.subject).toBe('Hello Alice')
      expect(result.payload.body).toContain('Alice')
      expect(result.payload.body).toContain('20%')
      expect(result.payload.toEmail).toBe('alice@example.com')
    })

    it('includes tool metadata in payload', async () => {
      const result = await buildDynamicEmailProposal(emailTool, {
        email: 'bob@example.com',
        customer_name: 'Bob',
        discount: '10',
      })
      expect(result.payload.toolId).toBe('tool-2')
      expect(result.payload.toolName).toBe('send_promo')
    })

    it('includes confirmation string', async () => {
      const result = await buildDynamicEmailProposal(emailTool, {
        email: 'carol@example.com',
        customer_name: 'Carol',
        discount: '15',
      })
      expect(typeof result.confirmation).toBe('string')
      expect(result.confirmation).toContain('carol@example.com')
    })

    it('handles missing mustache vars gracefully (renders empty string)', async () => {
      const result = await buildDynamicEmailProposal(emailTool, {
        email: 'test@example.com',
        // customer_name and discount missing
      })
      expect(result.payload.subject).toBe('Hello ')
      expect(result.payload.body).toContain('Dear ')
    })
  })

  describe('bumpInvocationCount', () => {
    it('runs UPDATE query on proposed_tools', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      await bumpInvocationCount('tool-123')
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('invocation_count'),
        ['tool-123']
      )
    })

    it('uses UPDATE admin_agent_proposed_tools table', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      await bumpInvocationCount('abc-456')
      const sql = mockQuery.mock.calls[0][0] as string
      expect(sql).toContain('admin_agent_proposed_tools')
      expect(sql).toContain('last_invoked_at')
    })
  })
})
