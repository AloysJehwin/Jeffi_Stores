import { headers } from 'next/headers'
import { resolveSettingsHubTab, visibleSettingsHubTabs } from '@/lib/admin/settings-hub'
import AccountPanel from './_components/AccountPanel'
import TeamPanel from '../team/_components/TeamPanel'
import ServiceAccountsPanel from '../service-accounts/_components/ServiceAccountsPanel'
import AuditPanel from '../audit/AuditPanel'

// Settings hub: Account, Team, Service accounts and Audit log, picked by ?tab=.
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
  if (tab === 'service-accounts') return <ServiceAccountsPanel />
  if (tab === 'audit') return <AuditPanel />
  return <AccountPanel />
}
