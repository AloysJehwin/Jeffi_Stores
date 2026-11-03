'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { canonicalQuery } from '@jeffi/list-filters/client'
import { Tabs } from '@/components/admin/channels/ui'
import { tabHref } from '@/lib/admin/filter-url'
import { TASK_FIELDS, TASK_LIST_PRESET, TASK_SEARCH } from '@/lib/filters/fields/tasks'
import TasksOverview from './TasksOverview'

type View = 'overview' | 'list'

const listQuery = (sp: URLSearchParams) =>
  canonicalQuery(sp, TASK_FIELDS, { search: TASK_SEARCH.param, omit: ['from', 'to'] })

// Overview is the default tab. ?tab= (or the old ?view=) picks explicitly, an old sub-tab value opens
// the list, and so does any list filter (old URLs and links).
export function viewFor(sp: URLSearchParams): View {
  const v = sp.get('tab') ?? sp.get('view')
  if (v === 'overview' || v === 'list') return v
  return v || listQuery(sp) ? 'list' : 'overview'
}

export default function TasksTabs({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const params = new URLSearchParams(sp.toString())
  const view = viewFor(params)
  // Old links: ?scope=all / ?status=all meant no filter.
  useEffect(() => {
    const p = new URLSearchParams(sp.toString())
    const stale = ['scope', 'status'].filter(k => p.get(k) === 'all')
    if (!stale.length) return
    stale.forEach(k => p.delete(k))
    if (!p.get('tab')) p.set('tab', 'list')
    router.replace(`${pathname}?${p}`, { scroll: false })
  }, [sp, router, pathname])
  // Tabs keep the filters; the list opens on my open tasks unless filters came along.
  const set = (v: View) => {
    params.delete('view')
    const href = tabHref(pathname, v, params, TASK_FIELDS, { search: TASK_SEARCH.param })
    router.replace(v === 'list' && !listQuery(params) ? `${href}&${TASK_LIST_PRESET}` : href, { scroll: false })
  }
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: 'overview' as View, label: 'Overview' },
          { id: 'list' as View, label: 'Tasks' },
        ]}
        value={view}
        onChange={set}
      />
      {view === 'overview' ? (
        <div className="pt-1">
          <TasksOverview />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
