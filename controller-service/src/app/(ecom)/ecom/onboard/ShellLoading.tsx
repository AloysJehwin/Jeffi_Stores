import type { ReactNode } from 'react'
import { Check, Menu, Rocket } from 'lucide-react'
import { Sk } from '@/components/admin/kit/skeleton'
import { ConsoleBrand } from '../dashboard/_components/ConsoleFrame'

/** OnboardShell's frame while the page loads: real step labels when known (`done` of them ticked), else shimmering ones. */
export default function ShellLoading({ heading, steps, done = 0, groupTitle = 'Store setup', children }: { heading?: string; steps?: readonly { label: string }[]; done?: number; groupTitle?: string; children: ReactNode }) {
  return (
    <div className="ecom-console min-h-screen lg:grid lg:grid-cols-[264px_1fr]" aria-busy="true" aria-label="Loading">
      <aside className="hidden lg:block sticky top-0 h-screen border-r border-border-default bg-surface p-5">
        <div className="flex flex-col h-full">
          <ConsoleBrand />
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5">
            <span className="inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-lg org-peach org-brown">
              <Rocket className="w-3.5 h-3.5" />
            </span>
            <span className="flex-1 min-w-0 space-y-1">
              {heading ? <span className="block truncate text-sm font-semibold text-foreground">{heading}</span> : <Sk className="h-3.5 w-28" />}
              <Sk className="h-2.5 w-32" />
            </span>
          </div>
          <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">{groupTitle}</div>
          <ol className="space-y-0.5">
            {steps
              ? steps.map((s, i) => (
                  <li key={s.label} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${i < done ? 'text-foreground-secondary' : 'text-foreground-muted'}`}>
                    {i < done ? <Check className="w-4 h-4 flex-shrink-0 org-sage-text" /> : <span className="w-4 h-4 flex-shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  </li>
                ))
              : Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <Sk className="h-4 w-4 rounded-full" />
                    <Sk className={`h-3.5 ${i % 2 ? 'w-16' : 'w-24'}`} />
                  </li>
                ))}
          </ol>
        </div>
      </aside>
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border-default bg-surface">
        <Menu className="w-5 h-5" />
        <Sk className="h-4 w-32" />
        <span className="w-9" />
      </div>
      <main className="min-w-0 px-5 sm:px-8 lg:px-12 py-8 lg:py-10">{children}</main>
    </div>
  )
}
