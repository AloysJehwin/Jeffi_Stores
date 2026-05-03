'use client'

import { ADMIN_SCOPES } from '@/lib/scopes'

const UNGROUPED_LABEL = 'General'

interface Props {
  selected: string[]
  onToggle: (key: string) => void
  variant?: 'card' | 'button'
}

export default function ScopeGrid({ selected, onToggle, variant = 'card' }: Props) {
  const groups = ADMIN_SCOPES.reduce<Record<string, typeof ADMIN_SCOPES>>((acc, scope) => {
    const g = scope.group || UNGROUPED_LABEL
    acc[g] = acc[g] ? [...acc[g], scope] : [scope]
    return acc
  }, {})

  const groupOrder = [UNGROUPED_LABEL, 'Catalogue', 'Operations', 'Marketing', 'Settings'].filter(g => groups[g])

  return (
    <div className="space-y-4">
      {groupOrder.map(groupName => (
        <div key={groupName}>
          <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">{groupName}</p>
          <div className="grid grid-cols-2 gap-2">
            {groups[groupName].map(scope => {
              const active = selected.includes(scope.key)
              if (variant === 'button') {
                return (
                  <button
                    key={scope.key}
                    type="button"
                    onClick={() => onToggle(scope.key)}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      active
                        ? 'border-accent-500 bg-accent-500/10 dark:bg-accent-500/15'
                        : 'border-border-default bg-surface hover:border-border-secondary hover:bg-surface-secondary'
                    }`}
                  >
                    <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border ${
                      active ? 'bg-accent-500 border-accent-500' : 'border-border-secondary bg-surface'
                    }`}>
                      {active && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span>
                      <span className={`block text-xs font-semibold ${active ? 'text-accent-600 dark:text-accent-400' : 'text-foreground'}`}>
                        {scope.label}
                      </span>
                      <span className="block text-xs text-foreground-muted leading-relaxed mt-0.5">{scope.description}</span>
                    </span>
                  </button>
                )
              }
              return (
                <label
                  key={scope.key}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    active
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                      : 'border-border-default hover:border-border-secondary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(scope.key)}
                    className="mt-0.5 accent-accent-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{scope.label}</p>
                    <p className="text-xs text-foreground-muted">{scope.description}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
