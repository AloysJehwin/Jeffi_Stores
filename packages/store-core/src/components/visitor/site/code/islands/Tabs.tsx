'use client'

import { Children, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react'

// Tabs for code sections. Every panel is server-rendered (hidden ones stay in the HTML for search engines); the
// buttons only switch which one shows. Tab elements pass their label as a prop.

export function TabPanel({ children }: { label: string; children?: ReactNode }) {
  return <>{children}</>
}

const STYLES: Record<string, { list: string; tab: string; on: string; off: string }> = {
  underline: { list: 'flex gap-6 overflow-x-auto border-b border-border-default', tab: '-mb-px whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition-colors', on: 'border-accent-500 text-foreground', off: 'border-transparent text-foreground-muted hover:text-foreground' },
  pills: { list: 'flex gap-2 overflow-x-auto', tab: 'whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors', on: 'bg-foreground text-surface', off: 'bg-surface-secondary text-foreground-secondary hover:text-foreground' },
  boxed: { list: 'inline-flex gap-1 overflow-x-auto rounded-[var(--radius-button,0.5rem)] bg-surface-secondary p-1', tab: 'whitespace-nowrap rounded-[var(--radius-button,0.5rem)] px-4 py-2 text-sm font-semibold transition-colors', on: 'bg-surface text-foreground shadow-sm', off: 'text-foreground-muted hover:text-foreground' },
}

export default function Tabs({ variant = 'underline', align = 'left', className, children }: { variant?: string; align?: 'left' | 'center'; className?: string; children?: ReactNode }) {
  const id = useId()
  const [active, setActive] = useState(0)
  const panels = Children.toArray(children).filter((c): c is ReactElement<{ label?: string; children?: ReactNode }> => isValidElement(c))
  const s = STYLES[variant] ?? STYLES.underline
  if (!panels.length) return null
  return (
    <div className={className}>
      <div role="tablist" className={`${s.list} ${align === 'center' ? 'justify-center' : ''}`}>
        {panels.map((p, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-p${i}`}
            onClick={() => setActive(i)}
            className={`${s.tab} ${i === active ? s.on : s.off}`}
          >
            {p.props.label || `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div key={i} role="tabpanel" id={`${id}-p${i}`} aria-labelledby={`${id}-t${i}`} hidden={i !== active} className="pt-6">
          {p.props.children}
        </div>
      ))}
    </div>
  )
}
