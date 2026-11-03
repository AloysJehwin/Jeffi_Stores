import { describe, it, expect } from 'vitest'
import { PROOF_EXEMPT_PATHS } from '@/lib/auth/session-binding-shared'

// EventSource / sendBeacon cannot set the proof header, so these transports stay exempt by path.
// The read probes (/me, check-session) are NOT path-exempt anymore: they are exempt by method
// (reads never require a proof), so the set holds only the header-incapable transports.
describe('PROOF_EXEMPT_PATHS', () => {
  it('exempts only the header-incapable transports', () => {
    expect(PROOF_EXEMPT_PATHS.has('/api/admin/events')).toBe(true)
    expect(PROOF_EXEMPT_PATHS.has('/api/track')).toBe(true)
    expect(PROOF_EXEMPT_PATHS.size).toBe(2)
  })

  it('does not carry per-portal probe paths (those are covered by the read rule)', () => {
    expect(PROOF_EXEMPT_PATHS.has('/api/auth/me')).toBe(false)
    expect(PROOF_EXEMPT_PATHS.has('/api/business/me')).toBe(false)
    expect(PROOF_EXEMPT_PATHS.has('/api/admin/check-session')).toBe(false)
  })
})
