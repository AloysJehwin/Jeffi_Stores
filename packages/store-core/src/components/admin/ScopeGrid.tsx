'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { assignableScopes, type ScopeDefinition } from '@/lib/auth/scopes'

interface Props {
  selected: string[]
  onToggle: (key: string) => void
  onSelectAll?: () => void
  onClearAll?: () => void
  variant?: 'card' | 'button'
  includePlatformScopes?: boolean
  /** Plan entitlement — omit on the platform, where every scope is sellable. */
  allowedKeys?: string[]
}

type Pair = { read?: ScopeDefinition; write?: ScopeDefinition }

function buildScopeGrid(scopes: ScopeDefinition[]) {
  const byBase: Record<string, Pair> = {}
  for (const s of scopes) {
    const base = s.key.replace(/:read$|:write$/, '')
    byBase[base] = byBase[base] || {}
    if (s.key.endsWith(':read')) byBase[base].read = s
    // Write and any other action scope (e.g. social:approve) sit in the write column.
    else byBase[base].write = s
  }

  const groups: Record<string, Pair[]> = {}
  for (const pair of Object.values(byBase)) {
    const group = (pair.read || pair.write)!.group || 'General'
    groups[group] = groups[group] || []
    groups[group].push(pair)
  }
  return groups
}

const GROUP_ORDER = ['Dashboard', 'Catalogue', 'Orders', 'Sales', 'Fulfilment', 'Finance', 'Marketing', 'AI', 'Business', 'Settings', 'Ecom Store', 'General']

const keysOf = (pairs: Pair[]) => pairs.flatMap(p => [p.read?.key, p.write?.key].filter(Boolean) as string[])

function ScopeButton({ scope, on, tone, onToggle }: { scope: ScopeDefinition; on: boolean; tone: 'read' | 'write'; onToggle: (k: string) => void }) {
  const onCls =
    tone === 'read'
      ? 'border-secondary-400 bg-secondary-500/10 dark:bg-secondary-500/15 shadow-sm'
      : 'border-amber-400 bg-amber-500/10 dark:bg-amber-500/15 shadow-sm'
  return (
    <button
      type="button"
      onClick={() => onToggle(scope.key)}
      aria-pressed={on}
      className={`text-left rounded-xl border px-4 py-3 transition-all ${on ? onCls : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-secondary/50'}`}
    >
      <p className={`text-sm font-semibold leading-tight ${on ? (tone === 'read' ? 'text-secondary-400' : 'text-amber-400') : 'text-foreground'}`}>{scope.label}</p>
      <p className="text-xs text-foreground-muted mt-0.5 leading-snug">{scope.description}</p>
    </button>
  )
}

export default function ScopeGrid({ selected, onToggle, onSelectAll, onClearAll, includePlatformScopes = false, allowedKeys }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const grid = useMemo(() => {
    const base = assignableScopes(includePlatformScopes)
    return buildScopeGrid(allowedKeys ? base.filter(s => allowedKeys.includes(s.key)) : base)
  }, [includePlatformScopes, allowedKeys])

  const q = query.trim().toLowerCase()
  const match = (s?: ScopeDefinition) => !!s && (s.label.toLowerCase().includes(q) || s.key.includes(q) || s.description.toLowerCase().includes(q))
  const groups = GROUP_ORDER.filter(g => grid[g])
    .map(g => ({ name: g, pairs: q ? grid[g].filter(p => match(p.read) || match(p.write)) : grid[g] }))
    .filter(g => g.pairs.length)

  // Toggling every key that differs from the target keeps callers on their single-key onToggle.
  const setGroup = (keys: string[], on: boolean) => keys.filter(k => selected.includes(k) !== on).forEach(onToggle)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a permission"
            className="w-full h-control rounded-lg border border-border-default bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-secondary-400/40"
          />
        </label>
        {(onSelectAll || onClearAll) && (
          <div className="flex items-center gap-1 text-xs font-medium">
            {onSelectAll && (
              <button type="button" onClick={onSelectAll} className="px-2.5 h-control-sm rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors">
                Select All
              </button>
            )}
            {onSelectAll && onClearAll && <span className="text-foreground-secondary">|</span>}
            {onClearAll && (
              <button type="button" onClick={onClearAll} className="px-2.5 h-control-sm rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors">
                Clear All
              </button>
            )}
          </div>
        )}
      </div>

      {groups.length === 0 && <p className="text-sm text-foreground-muted py-4 text-center">No permission matches “{query}”.</p>}

      {groups.map(({ name, pairs }) => {
        const keys = keysOf(grid[name])
        const picked = keys.filter(k => selected.includes(k)).length
        const isOpen = q ? true : !!open[name]
        return (
          <div key={name} className="rounded-xl border border-border-default bg-surface-elevated">
            <div className="flex items-center gap-2 px-3 sm:px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(o => ({ ...o, [name]: !o[name] }))}
                aria-expanded={isOpen}
                className="flex-1 min-w-0 flex items-center gap-2 text-left"
              >
                <ChevronDown className={`w-4 h-4 shrink-0 text-foreground-muted transition-transform ${isOpen ? '' : '-rotate-90'}`} aria-hidden />
                <span className="text-sm font-semibold text-foreground truncate">{name}</span>
                <span className={`text-xs tabular-nums shrink-0 ${picked ? 'text-secondary-400 font-medium' : 'text-foreground-muted'}`}>
                  {picked} of {keys.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setGroup(keys, picked < keys.length)}
                className="shrink-0 px-2 h-control-sm rounded-md text-xs font-medium text-secondary-400 hover:bg-surface-secondary transition-colors"
              >
                {picked < keys.length ? 'All' : 'None'}
              </button>
            </div>
            {isOpen && (
              <div className="px-3 sm:px-4 pb-4 space-y-2">
                {pairs.map(({ read, write }) => (
                  <div key={read?.key ?? write?.key} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {read ? <ScopeButton scope={read} tone="read" on={selected.includes(read.key)} onToggle={onToggle} /> : <div className="hidden md:block" />}
                    {write ? <ScopeButton scope={write} tone="write" on={selected.includes(write.key)} onToggle={onToggle} /> : <div className="hidden md:block" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
