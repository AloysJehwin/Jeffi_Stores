'use client'

import { ADMIN_SCOPES, assignableScopes, type ScopeDefinition } from '@/lib/scopes'

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

function buildScopeGrid(SCOPES: ScopeDefinition[]) {
  const byBase: Record<string, { read?: typeof ADMIN_SCOPES[0]; write?: typeof ADMIN_SCOPES[0] }> = {}
  for (const s of SCOPES) {
    const base = s.key.replace(/:read$|:write$/, '')
    byBase[base] = byBase[base] || {}
    if (s.key.endsWith(':read')) byBase[base].read = s
    else if (s.key.endsWith(':write')) byBase[base].write = s
  }

  const groups: Record<string, { read?: typeof ADMIN_SCOPES[0]; write?: typeof ADMIN_SCOPES[0] }[]> = {}
  for (const pair of Object.values(byBase)) {
    const ref = pair.read || pair.write!
    const group = ref.group || 'General'
    groups[group] = groups[group] || []
    groups[group].push(pair)
  }
  return groups
}

const GROUP_ORDER = ['Dashboard', 'Catalogue', 'Sales', 'Fulfilment', 'Finance', 'Marketing', 'AI', 'Business', 'Settings', 'General']

export default function ScopeGrid({ selected, onToggle, onSelectAll, onClearAll, includePlatformScopes = false, allowedKeys }: Props) {
  const base = assignableScopes(includePlatformScopes)
  const SCOPE_GRID = buildScopeGrid(allowedKeys ? base.filter(s => allowedKeys.includes(s.key)) : base)
  const orderedGroups = GROUP_ORDER.filter(g => SCOPE_GRID[g])

  return (
    <div className="space-y-8">
      {(onSelectAll || onClearAll) && (
        <div className="flex items-center gap-1 text-xs font-medium">
          {onSelectAll && (
            <button type="button" onClick={onSelectAll} className="px-2.5 py-1 rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors">
              Select All
            </button>
          )}
          {onSelectAll && onClearAll && <span className="text-foreground-secondary">|</span>}
          {onClearAll && (
            <button type="button" onClick={onClearAll} className="px-2.5 py-1 rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors">
              Clear All
            </button>
          )}
        </div>
      )}

      {orderedGroups.map(group => (
        <div key={group}>
          <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">{group}</p>
          <div className="space-y-2">
            {SCOPE_GRID[group].map(({ read, write }) => (
              <div key={read?.key ?? write?.key} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {read ? (
                  <button
                    type="button"
                    onClick={() => onToggle(read.key)}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      selected.includes(read.key)
                        ? 'border-secondary-400 bg-secondary-500/10 dark:bg-secondary-500/15 shadow-sm'
                        : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-secondary/50'
                    }`}
                  >
                    <p className={`text-sm font-semibold leading-tight ${selected.includes(read.key) ? 'text-secondary-400' : 'text-foreground'}`}>{read.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5 leading-snug">{read.description}</p>
                  </button>
                ) : <div />}

                {write ? (
                  <button
                    type="button"
                    onClick={() => onToggle(write.key)}
                    className={`text-left rounded-xl border px-4 py-3 transition-all ${
                      selected.includes(write.key)
                        ? 'border-amber-400 bg-amber-500/10 dark:bg-amber-500/15 shadow-sm'
                        : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-secondary/50'
                    }`}
                  >
                    <p className={`text-sm font-semibold leading-tight ${selected.includes(write.key) ? 'text-amber-400' : 'text-foreground'}`}>{write.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5 leading-snug">{write.description}</p>
                  </button>
                ) : <div />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
