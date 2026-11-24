import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let hdrs: Record<string, string> = {}
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs[k] ?? null }) }))
vi.mock('@/lib/tenancy/get-host', () => ({ getHost: async () => 'shop.test' }))
vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))
vi.mock('@/lib/admin/settings-hub', () => ({
  settingsHubHref: (id: string) => `/admin/settings/${id}`,
  visibleSettingsHubTabs: (role: string, scopes: string[]) => [
    { id: 'account', label: 'Account' },
    ...(role === 'administrator' || scopes.includes('team:read') ? [{ id: 'team', label: 'Team' }] : []),
  ],
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import SettingsHub from '@/components/admin/SettingsHub'

describe('SettingsHub (async server component)', () => {
  it('shows the Settings header and only the tabs the role may see', async () => {
    hdrs = { 'x-user-role': 'staff', 'x-user-scopes': '[]' }
    render(await SettingsHub({ active: 'account' }))
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText(/Your account, team, service accounts/)).toBeInTheDocument()
    expect(screen.getByText('Account').closest('a')).toHaveAttribute('href', '/admin/settings/account')
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
  })

  it('adds tabs for admins and renders the actions slot', async () => {
    hdrs = { 'x-user-role': 'administrator', 'x-user-scopes': '[]' }
    render(await SettingsHub({ active: 'team', actions: <button>Invite</button> }))
    expect(screen.getByText('Team').closest('a')).toHaveAttribute('href', '/admin/settings/team')
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument()
  })

  it('tolerates malformed scopes JSON', async () => {
    hdrs = { 'x-user-role': 'staff', 'x-user-scopes': '{bad' }
    render(await SettingsHub({ active: 'account' }))
    expect(screen.getByText('Account')).toBeInTheDocument()
  })
})
