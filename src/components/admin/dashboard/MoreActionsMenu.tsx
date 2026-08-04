'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'

/**
 * "More" quick-actions disclosure. A native <details> that also closes when the
 * user clicks outside it or presses Escape (native <details> only closes on the
 * summary toggle otherwise). Self-contained client island so the rest of the
 * command bar stays server-static.
 */
export default function MoreActionsMenu({ actions, host }: {
  actions: { label: string; path: string }[]
  host: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current
      if (el?.open && !el.contains(e.target as Node)) el.open = false
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) ref.current.open = false
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <details ref={ref} className="relative group/more">
      <summary className="list-none cursor-pointer flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-medium text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors duration-200">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-surface-secondary text-foreground-secondary group-hover/more:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
        </span>
        <span>More</span>
      </summary>
      <div className="absolute right-0 mt-2 w-48 bg-surface-elevated rounded-xl ring-1 ring-border-default shadow-md dark:ring-white/10 p-2 z-20 grid gap-0.5">
        {actions.map(m => (
          <Link
            key={m.label}
            href={ap(m.path, host)}
            onClick={() => { if (ref.current) ref.current.open = false }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors"
          >
            {m.label}
          </Link>
        ))}
      </div>
    </details>
  )
}
