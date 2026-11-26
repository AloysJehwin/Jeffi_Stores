import { describe, it, expect } from 'vitest'
import { visibleSettingsHubTabs } from '@/lib/admin/settings-hub'

const ids = (role: string, scopes: string[]) => visibleSettingsHubTabs(role, scopes).map(t => t.id)

describe('settings hub: Providers tab', () => {
  it('shows to the flagship administrator', () => {
    expect(ids('administrator', [])).toContain('providers')
  })

  it('shows to a store admin holding settings:read', () => {
    expect(ids('super_admin', ['settings:read'])).toContain('providers')
    expect(ids('manager', ['settings:write'])).toContain('providers')
  })

  it('hides from an admin without settings:read', () => {
    expect(ids('manager', ['dashboard:read'])).not.toContain('providers')
  })
})
