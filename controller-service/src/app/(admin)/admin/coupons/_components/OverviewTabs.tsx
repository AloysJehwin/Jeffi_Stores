import { TabLinks } from '@/components/admin/channels/ui'

// Overview / list tab bar for server-rendered list pages. The overview link keeps the period.
export default function OverviewTabs({
  basePath,
  active,
  sp,
  listLabel = 'List',
  actions,
  hrefs,
  draftsLabel,
}: {
  basePath: string
  active: 'overview' | 'list' | 'drafts'
  sp: Record<string, string | string[] | undefined>
  listLabel?: string
  actions?: React.ReactNode
  /** Filterable lists pass tabHref links, which carry their filters across tabs. */
  hrefs?: { overview: string; list: string; drafts?: string }
  /** Set (with hrefs.drafts) to add a Drafts tab. */
  draftsLabel?: React.ReactNode
}) {
  const q = new URLSearchParams()
  if (typeof sp.from === 'string') q.set('from', sp.from)
  if (typeof sp.to === 'string') q.set('to', sp.to)
  const tabs = [
    { id: 'overview' as const, label: 'Overview', href: hrefs?.overview ?? (q.size ? `${basePath}?${q}` : basePath) },
    { id: 'list' as const, label: listLabel, href: hrefs?.list ?? `${basePath}?tab=list` },
    ...(draftsLabel ? [{ id: 'drafts' as const, label: draftsLabel, href: hrefs?.drafts ?? `${basePath}?tab=drafts` }] : []),
  ]
  return (
    <div className="mb-5">
      <TabLinks tabs={tabs} value={active} actions={actions} />
    </div>
  )
}
