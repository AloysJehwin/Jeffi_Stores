import Link from 'next/link'
import { detailHref, type DetailSection } from './labels'

const SECTIONS: { key: DetailSection; label: string; store?: boolean }[] = [
  { key: 'store', label: 'Store' },
  { key: 'instance', label: 'Instance', store: true },
  { key: 'status', label: 'Status' },
  { key: 'billing', label: 'Billing' },
]

/** Store · Instance · Status · Billing for one tenant; Instance only when it has a store. */
export default function SectionNav({ tenantId, active, isStore }: { tenantId: string; active: DetailSection; isStore: boolean }) {
  return (
    <nav aria-label="Tenant pages" className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-surface-secondary p-1">
      {SECTIONS.filter(s => isStore || !s.store).map(s => {
        const on = s.key === active
        return (
          <Link
            key={s.key}
            href={detailHref(tenantId, s.key)}
            aria-current={on ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}
          >
            {s.key === 'store' && !isStore ? 'Workspace' : s.label}
          </Link>
        )
      })}
    </nav>
  )
}
