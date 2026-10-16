import Link from 'next/link'

// Overview / list tab bar for server-rendered list pages. The overview link keeps the period.
export default function OverviewTabs({
  basePath,
  active,
  sp,
  listLabel = 'List',
}: {
  basePath: string
  active: 'overview' | 'list'
  sp: Record<string, string | string[] | undefined>
  listLabel?: string
}) {
  const q = new URLSearchParams()
  if (typeof sp.from === 'string') q.set('from', sp.from)
  if (typeof sp.to === 'string') q.set('to', sp.to)
  const tabs = [
    { id: 'overview' as const, label: 'Overview', href: q.size ? `${basePath}?${q}` : basePath },
    { id: 'list' as const, label: listLabel, href: `${basePath}?tab=list` },
  ]
  return (
    <div className="flex gap-1 border-b border-border-default overflow-x-auto mb-5" role="tablist">
      {tabs.map(t => (
        <Link
          key={t.id}
          href={t.href}
          role="tab"
          aria-selected={active === t.id}
          className={`shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.id
              ? 'border-accent-500 text-foreground'
              : 'border-transparent text-foreground-muted hover:text-foreground'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
