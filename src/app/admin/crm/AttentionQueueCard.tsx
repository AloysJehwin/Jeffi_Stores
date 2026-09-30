'use client'

import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import CollapsibleSection from '@/components/admin/CollapsibleSection'
import type { AttentionItem, AttentionSeverity } from '@/lib/crm-insights-shared'

const DOT: Record<AttentionSeverity, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-zinc-400',
}

export default function AttentionQueueCard({ items }: { items: AttentionItem[] }) {
  return (
    <CollapsibleSection title="Needs Attention" count={items.length}>
      {items.length === 0 ? (
        <p className="text-sm text-foreground-muted">Nothing needs attention right now.</p>
      ) : (
        <div className="divide-y divide-border-default">
          {items.map((it, i) => (
            <Link
              key={`${it.kind}-${i}`}
              href={ap(it.href)}
              className="flex items-center gap-3 py-2.5 group hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[it.severity]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">
                  {it.label}
                </p>
                <p className="text-[11px] text-foreground-muted truncate mt-0.5">{it.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </CollapsibleSection>
  )
}
