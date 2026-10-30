import { describe, it, expect, afterEach, vi } from 'vitest'
vi.mock('@/lib/tenant-registry', () => ({ getTenant: vi.fn() }))
import { tenantAdminUrl } from '@/lib/integrations/oauth'

const orig = process.env.ADMIN_BASE_URL
afterEach(() => { process.env.ADMIN_BASE_URL = orig })

describe('tenantAdminUrl', () => {
  it('is admin-{slug} on the production root', () => {
    process.env.ADMIN_BASE_URL = 'https://admin.jeffistores.in'
    expect(tenantAdminUrl('acme')).toBe('https://admin-acme.jeffistores.in')
  })
  it('follows a local dev host', () => {
    process.env.ADMIN_BASE_URL = 'http://localhost:3000'
    expect(tenantAdminUrl('testco')).toBe('http://admin-testco.localhost:3000')
  })
})
