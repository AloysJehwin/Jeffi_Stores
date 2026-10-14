'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface Item {
  slug: string
  display_name: string
  service_types: string[]
}

export default function TenantSwitcher({ items, value, disabled, onChange }: { items: Item[]; value: string; disabled?: boolean; onChange: (slug: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(() => Math.max(0, items.findIndex(t => t.slug === value)))
  const ref = useRef<HTMLDivElement>(null)
  const current = items.find(t => t.slug === value) ?? items[0]
  const single = items.length < 2

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const pick = (slug: string) => { setOpen(false); if (slug !== value) onChange(slug) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(items.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? pick(items[hi].slug) : setOpen(true) }
    else if (e.key === 'Escape') setOpen(false)
  }
  const label = (t: Item) => t.service_types.includes('store') ? 'Store' : t.service_types.map(s => (s === 'messaging' ? 'Messaging' : 'Documents')).join(' + ')

  return (
    <div ref={ref} className="relative mb-6">
      <button
        type="button"
        disabled={disabled || single}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKey}
        className="org-square w-full flex items-center gap-3 rounded-xl border border-border-default bg-surface-elevated pl-3 pr-3 py-2.5 text-left text-sm font-semibold text-foreground disabled:opacity-100"
      >
        <span className="inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-lg org-peach text-[13px] font-display font-black uppercase">{current.display_name.slice(0, 1)}</span>
        <span className="flex-1 min-w-0">
          <span className="block truncate">{current.display_name}</span>
          <span className="block text-[11px] font-normal text-foreground-muted">{label(current)}</span>
        </span>
        {!single && <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-border-default bg-surface-elevated p-1 shadow-xl">
          {items.map((t, i) => {
            const active = t.slug === value
            return (
              <li
                key={t.slug}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(t.slug)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${i === hi ? 'org-sand' : ''}`}
              >
                <span className="inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-lg org-peach text-[13px] font-display font-black uppercase">{t.display_name.slice(0, 1)}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block truncate ${active ? 'font-semibold' : ''}`}>{t.display_name}</span>
                  <span className="block text-[11px] text-foreground-muted">{label(t)}</span>
                </span>
                {active && <Check className="w-4 h-4 org-brown" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
