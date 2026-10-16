import Link from 'next/link'

type SP = { [k: string]: string | string[] | undefined }

// Overview is the default tab. A ?tab=list link, or any list filter from an old URL, opens the list.
const LIST_PARAMS = ['status', 'plan', 'q']

export function ecomTab(sp: SP): 'overview' | 'list' {
  if (sp.tab === 'list') return 'list'
  if (sp.tab === 'overview') return 'overview'
  return LIST_PARAMS.some(k => sp[k]) ? 'list' : 'overview'
}

export default function EcomTabs({
  base,
  active,
  listLabel,
}: {
  base: string
  active: 'overview' | 'list'
  listLabel: string
}) {
  const tabs = [
    { id: 'overview', label: 'Overview', href: base },
    { id: 'list', label: listLabel, href: `${base}?tab=list` },
  ] as const
  return (
    <div className="flex gap-0.5 border-b border-border-default overflow-x-auto mb-6" role="tablist">
      {tabs.map(t => (
        <Link
          key={t.id}
          href={t.href}
          role="tab"
          aria-selected={active === t.id}
          className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${
            active === t.id
              ? 'border-accent-500 text-foreground font-medium'
              : 'border-transparent text-foreground-muted hover:text-foreground'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
