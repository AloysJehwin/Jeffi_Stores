import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))

import {
  ok,
  err,
  stripSensitive,
  pick,
  pickAll,
  isAgentToolResult,
} from '@/lib/admin-agent/tool-envelope'

describe('tool-envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ok', () => {
    it('merges input with ok:true', () => {
      const result = ok({ summary: 'done', data: [1, 2] })
      expect(result).toEqual({ ok: true, summary: 'done', data: [1, 2] })
    })

    it('works with minimal input', () => {
      const result = ok({ summary: 'minimal' })
      expect(result.ok).toBe(true)
      expect(result.summary).toBe('minimal')
    })

    it('preserves all extra fields', () => {
      const result = ok({ summary: 'x', count: 5, data: [], meta: { page: 1 } })
      expect(result.ok).toBe(true)
      expect(result.count).toBe(5)
      expect(result.data).toEqual([])
      expect(result.meta).toEqual({ page: 1 })
    })
  })

  describe('err', () => {
    it('returns ok:false with summary', () => {
      const result = err('something went wrong')
      expect(result.ok).toBe(false)
      expect(result.summary).toBe('something went wrong')
    })

    it('includes optional reason', () => {
      const result = err('summary', 'reason text')
      expect(result.reason).toBe('reason text')
    })

    it('includes optional hint', () => {
      const result = err('summary', 'reason', 'hint text')
      expect(result.hint).toBe('hint text')
    })

    it('omits reason and hint when not provided', () => {
      const result = err('summary')
      expect(result).not.toHaveProperty('reason')
      expect(result).not.toHaveProperty('hint')
    })

    it('includes reason but no hint', () => {
      const result = err('summary', 'reason only')
      expect(result.reason).toBe('reason only')
      expect(result).not.toHaveProperty('hint')
    })
  })

  describe('stripSensitive', () => {
    it('removes password field', () => {
      const row = { id: 1, password: 'secret123', name: 'Alice' }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('password')
      expect(result.name).toBe('Alice')
    })

    it('removes secret field', () => {
      const row = { api_secret: 'abc', data: 'safe' }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('api_secret')
    })

    it('removes token field', () => {
      const row = { access_token: 'tok123', user_id: 5 }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('access_token')
      expect(result.user_id).toBe(5)
    })

    it('removes signature field', () => {
      const row = { signature: 'sig', payload: 'data' }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('signature')
    })

    it('removes hash field', () => {
      const row = { password_hash: 'hashed', id: 1 }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('password_hash')
    })

    it('removes salt field', () => {
      const row = { salt: 'abc', id: 2 }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('salt')
    })

    it('removes reset_ prefixed fields', () => {
      const row = { reset_token: 'tok', reset_at: '2024', id: 3 }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('reset_token')
      expect(result).not.toHaveProperty('reset_at')
    })

    it('removes otp field', () => {
      const row = { otp: '123456', phone: '999' }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('otp')
    })

    it('removes 2fa field', () => {
      const row = { '2fa_secret': 'abc', email: 'a@b.com' }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('2fa_secret')
    })

    it('preserves safe fields', () => {
      const row = { id: 1, name: 'Bob', email: 'bob@test.com', created_at: '2024' }
      const result = stripSensitive(row)
      expect(result).toEqual({ id: 1, name: 'Bob', email: 'bob@test.com', created_at: '2024' })
    })

    it('handles empty object', () => {
      expect(stripSensitive({})).toEqual({})
    })

    it('case-insensitive match on PASSWORD', () => {
      const row = { PASSWORD: 'x', data: 1 }
      const result = stripSensitive(row)
      expect(result).not.toHaveProperty('PASSWORD')
    })
  })

  describe('pick', () => {
    it('returns only requested keys', () => {
      const row = { id: 1, name: 'Alice', secret: 'hidden' }
      expect(pick(row, ['id', 'name'])).toEqual({ id: 1, name: 'Alice' })
    })

    it('skips missing keys', () => {
      const row = { id: 1 }
      expect(pick(row, ['id', 'missing' as any])).toEqual({ id: 1 })
    })

    it('returns empty object for empty keys', () => {
      expect(pick({ id: 1 }, [])).toEqual({})
    })
  })

  describe('pickAll', () => {
    it('applies pick to every row', () => {
      const rows = [
        { id: 1, name: 'A', secret: 'x' },
        { id: 2, name: 'B', secret: 'y' },
      ]
      expect(pickAll(rows, ['id', 'name'])).toEqual([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ])
    })

    it('returns empty array for empty input', () => {
      expect(pickAll([], ['id'])).toEqual([])
    })
  })

  describe('isAgentToolResult', () => {
    it('returns true for valid ok result', () => {
      expect(isAgentToolResult({ ok: true, summary: 'done' })).toBe(true)
    })

    it('returns true for valid err result', () => {
      expect(isAgentToolResult({ ok: false, summary: 'failed' })).toBe(true)
    })

    it('returns false for missing ok', () => {
      expect(isAgentToolResult({ summary: 'no ok' })).toBe(false)
    })

    it('returns false for missing summary', () => {
      expect(isAgentToolResult({ ok: true })).toBe(false)
    })

    it('returns false for non-boolean ok', () => {
      expect(isAgentToolResult({ ok: 1, summary: 'x' })).toBe(false)
    })

    it('returns false for non-string summary', () => {
      expect(isAgentToolResult({ ok: true, summary: 123 })).toBe(false)
    })

    it('returns false for null', () => {
      expect(isAgentToolResult(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isAgentToolResult(undefined)).toBe(false)
    })

    it('returns false for primitive', () => {
      expect(isAgentToolResult('string')).toBe(false)
    })
  })
})
