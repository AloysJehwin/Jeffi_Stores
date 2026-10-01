import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }))

vi.mock('@/lib/shared/db', () => ({
  queryOne: mockQueryOne,
}))

import { resolveAdminByEmail, enforceCertGate } from '@/lib/auth/admin-identity'

const ORIGINAL_ENV = process.env.NODE_ENV

// NODE_ENV is typed readonly; assign via defineProperty to satisfy tsc.
function setNodeEnv(v: string | undefined) {
  Object.defineProperty(process.env, 'NODE_ENV', { value: v, configurable: true, writable: true, enumerable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  setNodeEnv(ORIGINAL_ENV)
})

function baseAdmin(overrides: Partial<any> = {}) {
  return {
    id: 'admin-1',
    user_id: 'u1',
    role: 'admin',
    scopes: [],
    mfa_enabled: false,
    email: 'a@b.com',
    first_name: null,
    last_name: null,
    google_id: null,
    ...overrides,
  }
}

describe('resolveAdminByEmail', () => {
  it('returns null for empty email', async () => {
    const res = await resolveAdminByEmail('')
    expect(res).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('returns null when no admin row found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await resolveAdminByEmail('nobody@x.com')
    expect(res).toBeNull()
  })

  it('returns admin with array scopes', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1',
      user_id: 'u1',
      role: 'admin',
      scopes: ['read'],
      mfa_enabled: true,
      email: 'a@b.com',
      first_name: 'A',
      last_name: 'B',
      google_id: 'g1',
    })
    const res = await resolveAdminByEmail('a@b.com')
    expect(res).toMatchObject({ id: 'a1', scopes: ['read'] })
  })

  it('coerces non-array scopes to empty array', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1',
      user_id: 'u1',
      role: 'admin',
      scopes: null,
      mfa_enabled: false,
      email: 'a@b.com',
      first_name: null,
      last_name: null,
      google_id: null,
    })
    const res = await resolveAdminByEmail('a@b.com')
    expect(res!.scopes).toEqual([])
  })
})

describe('enforceCertGate', () => {
  describe('non-production', () => {
    it('passes and echoes certCN when not production', async () => {
      setNodeEnv('development')
      const res = await enforceCertGate(baseAdmin(), 'some-cn', 'serial')
      expect(res).toEqual({ ok: true, certCN: 'some-cn' })
      expect(mockQueryOne).not.toHaveBeenCalled()
    })

    it('returns undefined certCN when cn empty', async () => {
      setNodeEnv('test')
      const res = await enforceCertGate(baseAdmin(), '', '')
      expect(res).toEqual({ ok: true, certCN: undefined })
    })
  })

  describe('production', () => {
    beforeEach(() => {
      setNodeEnv('production')
    })

    it('rejects when no cert present at all', async () => {
      const res = await enforceCertGate(baseAdmin(), '', '')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('client certificate is required')
    })

    it('treats CN "Admin User" as no cert present', async () => {
      const res = await enforceCertGate(baseAdmin(), 'Admin User', '')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
    })

    // ---- serial path ----
    it('rejects when serial not recognized', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // cert lookup
      const res = await enforceCertGate(baseAdmin(), '', '255')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('not recognized or expired')
    })

    it('accepts a matching serial owned by this admin', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ admin_id: 'admin-1' }) // cert
        .mockResolvedValueOnce({ role: 'admin' }) // cert owner
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'cn', '255')
      expect(res.ok).toBe(true)
    })

    it('converts a decimal serial to hex for the lookup', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'admin-1' }).mockResolvedValueOnce({ role: 'admin' })
      await enforceCertGate(baseAdmin({ id: 'admin-1' }), 'cn', '255')
      // 255 -> 'ff'
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['ff'])
    })

    it('lowercases an already-hex serial (non-decimal)', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'admin-1' }).mockResolvedValueOnce({ role: 'admin' })
      await enforceCertGate(baseAdmin({ id: 'admin-1' }), 'cn', 'AbCdEf')
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['abcdef'])
    })

    it('handles an invalid serial (BigInt throws) by lowercasing', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'admin-1' }).mockResolvedValueOnce({ role: 'admin' })
      // contains a non-hex letter 'z' so not the hex branch, and BigInt('12z') throws
      await enforceCertGate(baseAdmin({ id: 'admin-1' }), 'cn', '12Z')
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['12z'])
    })

    it('rejects when logging into super_admin but cert owner is not super_admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'other' }).mockResolvedValueOnce({ role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'super_admin' }), 'cn', '255')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('not authorized')
    })

    it('rejects when cert belongs to a different account and owner is not super_admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'other' }).mockResolvedValueOnce({ role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'cn', '255')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('not authorized')
    })

    it('accepts when cert owner is super_admin even if it belongs to a different account', async () => {
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'super' }).mockResolvedValueOnce({ role: 'super_admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'cn', '255')
      expect(res.ok).toBe(true)
    })

    // ---- CN path (no serial) ----
    it('rejects when CN not recognized', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // cn lookup
      const res = await enforceCertGate(baseAdmin(), 'user@x.com', '')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('not recognized')
    })

    it('accepts a matching CN owned by this admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'admin-1', role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'user@x.com', '')
      expect(res.ok).toBe(true)
      expect(res.certCN).toBe('user@x.com')
    })

    it('rejects CN path when logging into super_admin but owner not super_admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'admin-1', role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'super_admin' }), 'user@x.com', '')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('not authorized')
    })

    it('rejects CN path when cert belongs to a different account and owner not super_admin', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'other', role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'user@x.com', '')
      expect(res.ok).toBe(false)
    })

    it('accepts CN path when cert owner is super_admin for a different account', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'super', role: 'super_admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'user@x.com', '')
      expect(res.ok).toBe(true)
    })

    it('passes when certCN present but equals "Admin User" and a serial exists (no CN branch)', async () => {
      // serial present -> uses serial branch; CN "Admin User" is ignored for the elseif
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'admin-1' }).mockResolvedValueOnce({ role: 'admin' })
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1' }), 'Admin User', '255')
      expect(res.ok).toBe(true)
    })

    it('passes when only serial-less present and CN is exactly "Admin User" -> neither serial nor CN branch runs', async () => {
      // certPresent true because... actually certCN==='Admin User' & no serial => not present -> rejected earlier.
      // This asserts that path is the rejection, covered above; here validate ok:true final path with valid serial owner match.
      mockQueryOne.mockResolvedValueOnce({ admin_id: 'admin-1' }).mockResolvedValueOnce(null) // certOwner null -> certOwnerIsSuperAdmin false, but belongs to this account
      const res = await enforceCertGate(baseAdmin({ id: 'admin-1', role: 'admin' }), 'cn', '255')
      expect(res.ok).toBe(true)
    })
  })
})
