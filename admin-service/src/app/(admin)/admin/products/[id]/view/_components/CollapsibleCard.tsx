'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Field } from '@/components/admin/kit'

/** A kit-styled card that starts closed unless `defaultOpen`. `onOpen` fires each time it opens (lazy loads). */
export function CollapsibleCard({ title, children, onOpen, defaultOpen = false }: { title: string; children: ReactNode; onOpen?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-secondary/40"
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-border-default px-5 py-4">{children}</div>}
    </section>
  )
}

/** Kit Fields, but two-up on a phone as well: these cards hold many short values. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</dl>
}

/** Kit Field that is left out when it has no value (the product page hides unset attributes). `wide` takes the full row. */
export function Row({ label, value, mono, wide }: { label: string; value?: any; mono?: boolean; wide?: boolean }) {
  if (value == null || value === '' || value === false) return null
  const field = <Field label={label} value={value} mono={mono} />
  return wide ? <div className="col-span-2 min-w-0">{field}</div> : field
}
