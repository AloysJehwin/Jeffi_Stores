'use client'

import Link from 'next/link'
import { useBusinessHome } from './BusinessHomeProvider'

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-7">
      <div className="flex items-center gap-4">
        <div className="w-1 h-10 bg-accent-500 rounded-full" />
        <div>
          <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow}</p>
          <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title}</h2>
        </div>
      </div>
      {action}
    </div>
  )
}

export function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 min-h-[44px] sm:min-h-0 -my-2 sm:my-0 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 whitespace-nowrap transition-colors"
    >
      {label}
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

/** What a visitor sees in place of a section that needs a business account. */
export function SignInPrompt({ eyebrow, title, message }: { eyebrow?: string; title?: string; message: string }) {
  const { href } = useBusinessHome()
  return (
    <section className="py-8 md:py-10">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border-default bg-surface-elevated p-5 md:p-6">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow}</p>
            <h2 className="text-lg md:text-xl font-black text-foreground tracking-tight">{title}</h2>
            <p className="text-sm text-foreground-secondary mt-1">{message}</p>
          </div>
          <Link
            href={href('/business/signin')}
            className="inline-flex items-center justify-center gap-2 bg-accent-500 hover:bg-accent-400 text-white font-black text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-accent-500/25 shrink-0"
          >
            Sign In
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  )
}

/** Placeholder blocks while the business's data loads. */
export function SkeletonBlocks({ count, className }: { count: number; className: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`animate-pulse rounded-xl bg-surface-secondary ${className}`} />
      ))}
    </>
  )
}
