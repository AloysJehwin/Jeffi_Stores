'use client'

import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

// An accordion for code sections: items open one at a time (or several with `multiple`). Answers stay in the HTML.

const Ctx = createContext<{ open: Set<string>; toggle: (id: string) => void } | null>(null)

export default function Accordion({ multiple = false, defaultOpen = false, className, children }: { multiple?: boolean; defaultOpen?: boolean; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(new Set(defaultOpen ? ['first'] : []))
  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(multiple ? prev : prev.has(id) ? [id] : [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <Ctx.Provider value={{ open, toggle }}>
      <div className={className ?? 'divide-y divide-border-default border-y border-border-default'}>{children}</div>
    </Ctx.Provider>
  )
}

export function AccordionItem({ title, first = false, className, children }: { title: string; first?: boolean; className?: string; children?: ReactNode }) {
  const ctx = useContext(Ctx)
  const id = useId()
  const [solo, setSolo] = useState(false)
  const key = first ? 'first' : id
  const isOpen = ctx ? ctx.open.has(key) : solo
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        onClick={() => (ctx ? ctx.toggle(key) : setSolo(o => !o))}
        className="flex min-h-[52px] w-full items-center justify-between gap-4 py-3 text-left font-medium text-foreground"
      >
        {title}
        <ChevronDown aria-hidden className={`h-5 w-5 shrink-0 text-foreground-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div id={`${id}-panel`} hidden={!isOpen} className="pb-4 text-foreground-secondary">
        {children}
      </div>
    </div>
  )
}
