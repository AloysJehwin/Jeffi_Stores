import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'

// Tabs of the Settings hub (/admin/settings?tab=). Each tab keeps its old route's gate; the old
// routes redirect into the hub for admins who can open /admin/settings (settings:read).
export type SettingsHubTabId = 'account' | 'team' | 'service-accounts' | 'audit'

export const SETTINGS_HUB_TABS: {
  id: SettingsHubTabId
  label: string
  /** The tab's standalone route (the hub itself for Account). */
  href: string
  scope: string
  ownerOnly?: boolean
}[] = [
  { id: 'account', label: 'Account', href: '/admin/settings', scope: 'settings:read' },
  { id: 'team', label: 'Team', href: '/admin/team', scope: 'settings:read', ownerOnly: true },
  { id: 'service-accounts', label: 'Service accounts', href: '/admin/service-accounts', scope: 'service_accounts:read' },
  { id: 'audit', label: 'Audit log', href: '/admin/audit', scope: 'audit:read' },
]

// The audit page's own ?tab= values; in the hub they all mean the Audit log tab.
const AUDIT_INNER_TABS = new Set(['mail_log', 'sms_log', 'whatsapp_log', 'cron'])

export function isSettingsHubTabId(v: string | null | undefined): v is SettingsHubTabId {
  return SETTINGS_HUB_TABS.some(t => t.id === v)
}

export function resolveSettingsHubTab(tab: string | null | undefined): SettingsHubTabId {
  if (isSettingsHubTabId(tab)) return tab
  if (tab && AUDIT_INNER_TABS.has(tab)) return 'audit'
  return 'account'
}

export function visibleSettingsHubTabs(role: string, scopes: string[]) {
  return SETTINGS_HUB_TABS.filter(t => (!t.ownerOnly || isPlatformOwner(role)) && hasScope(role, scopes, t.scope))
}

/** Hub URL for a tab, or its standalone route when the admin cannot open /admin/settings. */
export function settingsHubHref(id: SettingsHubTabId, role: string, scopes: string[]): string {
  if (!hasScope(role, scopes, 'settings:read')) return SETTINGS_HUB_TABS.find(t => t.id === id)!.href
  return id === 'account' ? '/admin/settings' : `/admin/settings?tab=${id}`
}

/** Old standalone-route query, re-targeted at the hub. A tab value already present (the audit
 *  page's own tabs) is kept; otherwise the hub tab is added. */
export function settingsHubRedirect(id: SettingsHubTabId, sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach(x => q.append(k, x))
    else if (v != null) q.set(k, v)
  }
  if (resolveSettingsHubTab(q.get('tab')) !== id) q.set('tab', id)
  return `/admin/settings?${q.toString()}`
}
