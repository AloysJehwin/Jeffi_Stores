import { TabLinks } from '@/components/admin/channels/ui'

// Overview / list tab bar for server-rendered list pages. The overview link keeps the period.
export default function OverviewTabs({
  basePath,
  active,
  sp,
  listLabel = 'List',
  actions,
}: {
  basePath: string
  active: 'overview' | 'list'
  sp: Record<string, string | string[] | undefined>
  listLabel?: string
  actions?: React.ReactNode
}) {
  const q = new URLSearchParams()
  if (typeof sp.from === 'string') q.set('from', sp.from)
  if (typeof sp.to === 'string') q.set('to', sp.to)
  const tabs = [
    { id: 'overview' as const, label: 'Overview', href: q.size ? `${basePath}?${q}` : basePath },
    { id: 'list' as const, label: listLabel, href: `${basePath}?tab=list` },
  ]
  return (
    <div className="mb-5">
      <TabLinks tabs={tabs} value={active} actions={actions} />
    </div>
  )
}
