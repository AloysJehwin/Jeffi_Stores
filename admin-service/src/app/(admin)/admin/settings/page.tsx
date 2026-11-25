import { headers } from 'next/headers'
import { resolveSettingsHubTab, visibleSettingsHubTabs } from '@/lib/admin/settings-hub'
import { isPlatformOwner } from '@/lib/auth/scopes'
import SettingsHub from '@/components/admin/SettingsHub'
import ProvidersPage from '@/components/admin/providers/ProvidersPage'
import CliTokensPanel from './_components/CliTokensPanel'
import AccountPanel from './_components/AccountPanel'
import NumbersPanel from './_components/NumbersPanel'
import TeamPanel from '../team/_components/TeamPanel'
import ServiceAccountsPanel from '../service-accounts/_components/ServiceAccountsPanel'
import AuditPanel from '../audit/AuditPanel'

// Settings hub: Account, Team, Numbers, Providers, Service accounts, CLI & tokens and Audit log, picked by ?tab=.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const h = await headers()
  const role = h.get('x-user-role') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(h.get('x-user-scopes') || '[]')
  } catch {}
  const requested = resolveSettingsHubTab(typeof sp.tab === 'string' ? sp.tab : null)
  const tab = visibleSettingsHubTabs(role, scopes).some(t => t.id === requested) ? requested : 'account'

  if (tab === 'team') return <TeamPanel />
  if (tab === 'numbers') {
    return (
      <>
        <SettingsHub active="numbers" />
        <NumbersPanel role={role} />
      </>
    )
  }
  if (tab === 'providers') {
    return (
      <>
        <SettingsHub active="providers" />
        <div className="p-4 sm:p-6">
          <ProvidersPage />
        </div>
      </>
    )
  }
  if (tab === 'service-accounts') return <ServiceAccountsPanel />
  if (tab === 'cli') {
    return (
      <>
        <SettingsHub active="cli" />
        <CliTokensPanel owner={isPlatformOwner(role)} />
      </>
    )
  }
  if (tab === 'audit') return <AuditPanel />
  return <AccountPanel />
}
