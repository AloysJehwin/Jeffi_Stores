import { headers } from 'next/headers'
import { TabLinks } from '@/components/admin/kit/core'
import { PageHeader } from '@/components/admin/kit/layout'
import { settingsHubHref, visibleSettingsHubTabs, type SettingsHubTabId } from '@/lib/admin/settings-hub'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

/** Settings title and the hub's tab line; the tab's content renders below. */
export default async function SettingsHub({
  active,
  actions,
}: {
  active: SettingsHubTabId
  actions?: React.ReactNode
}) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(h.get('x-user-scopes') || '[]')
  } catch {}
  const host = await getHost()
  const tabs = visibleSettingsHubTabs(role, scopes).map(t => ({
    id: t.id,
    label: t.label,
    href: ap(settingsHubHref(t.id, role, scopes), host),
  }))
  return (
    <div className="px-4 sm:px-6 pt-4 sm:pt-6 space-y-5">
      <PageHeader title="Settings" description="Your account, team, service accounts and the audit log" />
      <TabLinks tabs={tabs} value={active} actions={actions} />
    </div>
  )
}
