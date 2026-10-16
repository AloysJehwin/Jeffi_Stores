'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import ShelvingOverview from './ShelvingOverview'

type View = 'overview' | 'list'

// Overview is the default tab. Any other query param (the list's own filters and tabs from old
// URLs and links) opens the existing content; ?view= picks explicitly.
export function viewFor(sp: URLSearchParams): View {
  const v = sp.get('view')
  if (v === 'overview' || v === 'list') return v
  for (const k of sp.keys()) if (k !== 'from' && k !== 'to') return 'list'
  return 'overview'
}

export default function ShelvingTabs({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view = viewFor(new URLSearchParams(sp.toString()))
  const set = (v: View) => router.replace(`${pathname}?view=${v}`, { scroll: false })
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 pt-3 shrink-0">
        <Tabs
          tabs={[
            { id: 'overview' as View, label: 'Overview' },
            { id: 'list' as View, label: 'Locations' },
          ]}
          value={view}
          onChange={set}
        />
      </div>
      {view === 'overview' ? (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ShelvingOverview />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
