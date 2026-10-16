'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import { isSettingsHubTabId } from '@/lib/admin/settings-hub'
import AuditOverview from './AuditOverview'

type View = 'overview' | 'list'

// Overview is the default tab. Any other query param (the list's own filters and tabs from old
// URLs and links) opens the existing content; ?view= picks explicitly. The Settings hub's own
// ?tab= does not count.
export function viewFor(sp: URLSearchParams): View {
  const v = sp.get('view')
  if (v === 'overview' || v === 'list') return v
  for (const k of sp.keys()) {
    if (k === 'from' || k === 'to' || (k === 'tab' && isSettingsHubTabId(sp.get('tab')))) continue
    return 'list'
  }
  return 'overview'
}

export default function AuditTabs({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view = viewFor(new URLSearchParams(sp.toString()))
  // Keeps ?tab= so the Settings hub stays on this tab.
  const set = (v: View) => {
    const t = sp.get('tab')
    router.replace(`${pathname}?${t ? `tab=${encodeURIComponent(t)}&` : ''}view=${v}`, { scroll: false })
  }
  return (
    <div className="w-full">
      <div className="px-4 sm:px-6 pt-3 shrink-0">
        <Tabs
          tabs={[
            { id: 'overview' as View, label: 'Overview' },
            { id: 'list' as View, label: 'Audit log' },
          ]}
          value={view}
          onChange={set}
        />
      </div>
      {view === 'overview' ? (
        <div className="p-4 sm:p-6">
          <AuditOverview />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
