import { describe, it, expect } from 'vitest'
import { PROOF_EXEMPT_PATHS } from '@/lib/auth/session-binding-shared'

// EventSource cannot set the proof header, so the admin event stream must stay exempt or the
// stream never connects under enforce mode. The old notifications stream route no longer exists.
describe('PROOF_EXEMPT_PATHS', () => {
  it('exempts the admin event stream and the tracking beacon only', () => {
    expect(PROOF_EXEMPT_PATHS.has('/api/admin/events')).toBe(true)
    expect(PROOF_EXEMPT_PATHS.has('/api/track')).toBe(true)
    expect(PROOF_EXEMPT_PATHS.has('/api/admin/notifications/stream')).toBe(false)
    expect(PROOF_EXEMPT_PATHS.has('/api/admin/session/heartbeat')).toBe(false)
  })
})
