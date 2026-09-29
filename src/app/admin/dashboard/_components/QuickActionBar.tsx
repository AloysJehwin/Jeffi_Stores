'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { NAV_ICONS } from '@/components/admin/AdminSidebarNav'

interface Action { label: string; icon: string; path: string; primary?: boolean }

function fallbackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  )
}

// A quick-action tile. Icon comes from the shared sidebar NAV_ICONS map.
function Tile({ label, icon, path, primary, host }: Action & { host: string }) {
  return (
    <Link
      href={ap(path, host)}
      className="group flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-medium text-foreground-secondary hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated transition-colors duration-200"
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${primary ? 'bg-accent-500/10 text-accent-600 group-hover:bg-accent-500 group-hover:text-white' : 'bg-surface-secondary text-foreground-secondary group-hover:text-foreground'} [&_svg]:w-5 [&_svg]:h-5`}>
        {NAV_ICONS[icon] ?? fallbackIcon()}
      </span>
      <span className="text-center leading-tight">{label}</span>
    </Link>
  )
}

// Command bar: primary quick actions in a fixed 8-column grid; a centered
// chevron expands the rest in-place into the same grid (mirrors the
// products-list AdvancedFilterPanel toggle).
export default function QuickActionBar({ primary, more, host }: {
  primary: Action[]
  more: Action[]
  host: string
}) {
  const [expanded, setExpanded] = useState(false)
  const actions = expanded ? [...primary, ...more] : primary

  return (
    <div className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-2">
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1">
        {actions.map(a => (
          <Tile key={a.label} {...a} host={host} />
        ))}
      </div>

      {more.length > 0 && (
        <div className="flex justify-center mt-1 -mb-1">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Show fewer actions' : 'Show more actions'}
            className="flex items-center gap-1 px-3 py-1 text-xs text-foreground-muted hover:text-foreground transition-colors rounded-full hover:bg-surface-secondary"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
