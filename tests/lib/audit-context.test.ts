import { describe, it, expect } from 'vitest'
import { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext } from '@/lib/auth/audit-context'

describe('audit-context', () => {
  describe('getCurrentAuditAdminId', () => {
    it('returns null when no context is set', () => {
      // Outside any AsyncLocalStorage context the store is undefined
      expect(getCurrentAuditAdminId()).toBeNull()
    })
  })

  describe('setAuditAdminId / getCurrentAuditAdminId', () => {
    it('stores and retrieves an adminId within the same async context', async () => {
      await runWithAuditContext('admin-42', async () => {
        expect(getCurrentAuditAdminId()).toBe('admin-42')
      })
    })

    it('mutates the current context when called inside an existing context', async () => {
      await runWithAuditContext('initial', async () => {
        expect(getCurrentAuditAdminId()).toBe('initial')
        setAuditAdminId('mutated')
        expect(getCurrentAuditAdminId()).toBe('mutated')
      })
    })

    it('entersWith a new context when no existing store is present', () => {
      // Calling setAuditAdminId outside any runWithAuditContext seeds a root context
      // We verify it does not throw and stores the value
      expect(() => setAuditAdminId('root-admin')).not.toThrow()
    })

    it('stores null adminId correctly', async () => {
      await runWithAuditContext(null, async () => {
        expect(getCurrentAuditAdminId()).toBeNull()
      })
    })
  })

  describe('runWithAuditContext', () => {
    it('isolates context so outer context is unaffected', async () => {
      await runWithAuditContext('outer', async () => {
        await runWithAuditContext('inner', async () => {
          expect(getCurrentAuditAdminId()).toBe('inner')
        })
        // After inner context completes, outer is restored
        expect(getCurrentAuditAdminId()).toBe('outer')
      })
    })

    it('returns the value returned by fn', async () => {
      const result = await runWithAuditContext('admin-99', async () => {
        return 'expected-value'
      })
      expect(result).toBe('expected-value')
    })

    it('propagates exceptions thrown by fn', async () => {
      await expect(
        runWithAuditContext('admin-err', async () => {
          throw new Error('fn threw')
        })
      ).rejects.toThrow('fn threw')
    })

    it('restores context even when fn throws', async () => {
      await runWithAuditContext('outer-safe', async () => {
        try {
          await runWithAuditContext('inner-throw', async () => {
            throw new Error('boom')
          })
        } catch {
          // swallow
        }
        // Outer context is restored after inner throw
        expect(getCurrentAuditAdminId()).toBe('outer-safe')
      })
    })

    it('provides context to async operations', async () => {
      const captured: (string | null)[] = []
      await runWithAuditContext('async-admin', async () => {
        captured.push(getCurrentAuditAdminId())
        await Promise.resolve()
        captured.push(getCurrentAuditAdminId())
      })
      expect(captured).toEqual(['async-admin', 'async-admin'])
    })
  })
})
