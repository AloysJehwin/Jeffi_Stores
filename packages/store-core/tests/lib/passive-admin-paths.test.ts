import { describe, it, expect } from 'vitest'
import { isPassiveAdminRequest } from '@/lib/auth/passive-admin-paths'

describe('isPassiveAdminRequest', () => {
  it('treats session checks, the event stream and the bell poll as passive', () => {
    expect(isPassiveAdminRequest('/api/admin/check-session', 'GET')).toBe(true)
    expect(isPassiveAdminRequest('/api/admin/events', 'GET')).toBe(true)
    expect(isPassiveAdminRequest('/api/admin/notifications', 'GET')).toBe(true)
    expect(isPassiveAdminRequest('/api/admin/support/sessions', 'GET')).toBe(true)
    expect(isPassiveAdminRequest('/api/admin/support/sessions/abc', 'GET')).toBe(true)
  })

  it('treats real admin actions as activity', () => {
    expect(isPassiveAdminRequest('/api/admin/notifications/read', 'POST')).toBe(false)
    expect(isPassiveAdminRequest('/api/admin/notifications', 'POST')).toBe(false)
    expect(isPassiveAdminRequest('/api/admin/orders', 'GET')).toBe(false)
    expect(isPassiveAdminRequest('/api/admin/session/heartbeat', 'POST')).toBe(false)
  })
})
