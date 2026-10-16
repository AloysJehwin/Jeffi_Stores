'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import TeamOverview from './TeamOverview'

type View = 'overview' | 'list'

// Overview is the default tab. Any other query param (the list's own filters and tabs from old
// URLs and links) opens the existing content; ?view= picks explicitly.
export function viewFor(sp: URLSearchParams): View {
  const v = sp.get('view')
  if (v === 'overview' || v === 'list') return v
  for (const k of sp.keys()) if (k !== 'from' && k !== 'to') return 'list'
  return 'overview'
}

export default function TeamTabs({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view = viewFor(new URLSearchParams(sp.toString()))
  const set = (v: View) => router.replace(`${pathname}?view=${v}`, { scroll: false })
  return (
    <div className="space-y-6">
      <Tabs
        tabs={[
          { id: 'overview' as View, label: 'Overview' },
          { id: 'list' as View, label: 'Members' },
        ]}
        value={view}
        onChange={set}
      />
      {view === 'overview' ? (
        <div className="pt-1">
          <TeamOverview />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
