'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { canonicalQuery } from '@jeffi/list-filters/client'
import { Tabs } from '@/components/admin/channels/ui'
import { isSettingsHubTabId } from '@/lib/admin/settings-hub'
import { AUDIT_FIELDS } from '@/lib/filters/fields/audit'
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
  // Pins ?view= so filtering on the Overview never flips it to the list.
  useEffect(() => {
    if (sp.get('view')) return
    const p = new URLSearchParams(sp.toString())
    p.set('view', view)
    router.replace(`${pathname}?${p}`, { scroll: false })
  }, [sp, view, pathname, router])
  // Keeps ?tab= so the Settings hub stays on this tab, and the audit filters (and period).
  const set = (v: View) => {
    const t = sp.get('tab')
    const qs = canonicalQuery(sp, AUDIT_FIELDS)
    router.replace(`${pathname}?${t ? `tab=${encodeURIComponent(t)}&` : ''}view=${v}${qs ? `&${qs}` : ''}`, {
      scroll: false,
    })
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
