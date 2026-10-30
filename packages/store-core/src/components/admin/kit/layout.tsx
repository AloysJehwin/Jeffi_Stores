import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { AttentionList, type AttentionItem } from './period'
import { CopyValue } from './actions'

// Page shells. Server-safe (no hooks), so server pages pass ReactNode slots straight in.
// Links take already-resolved paths (ap(path, host)); the kit never builds /admin/... itself.

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  back?: { href: string; label: string }
  badges?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  /** Leading visual (logo, avatar) beside the title. */
  media?: ReactNode
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors">
      <ChevronLeft className="w-3.5 h-3.5" />
      {label}
    </Link>
  )
}

/** Title, one-line description, optional back link, status badges and an action slot. */
export function PageHeader({ title, description, back, badges, actions, meta, media }: PageHeaderProps) {
  return (
    <header className="space-y-1.5">
      {back && <BackLink {...back} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {media}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-bold text-foreground">{title}</h1>
              {badges}
            </div>
            {description && <p className="mt-0.5 text-sm text-foreground-muted">{description}</p>}
            {meta && <div className="mt-1 text-xs text-foreground-muted">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** Standard page padding and block spacing. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-4 sm:p-6 space-y-5">{children}</div>
}

export interface EntityPageProps {
  header: ReactNode
  tabs?: ReactNode
  /** Persistent notices (draft pending, needs reconnect); never action responses. */
  notices?: ReactNode
  kpis?: ReactNode
  attention?: AttentionItem[]
  main: ReactNode
  aside?: ReactNode
}

/** View-page layout: header, tabs, notices, KPIs, attention, then main (two columns) beside aside. */
export function EntityPage({ header, tabs, notices, kpis, attention, main, aside }: EntityPageProps) {
  return (
    <PageBody>
      {header}
      {tabs}
      {notices}
      {kpis}
      {attention && attention.length > 0 && <AttentionList items={attention} />}
      {aside ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          <div className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-3">{main}</div>
          <div className="min-w-0 space-y-4">{aside}</div>
        </div>
      ) : (
        <div className="space-y-4">{main}</div>
      )}
    </PageBody>
  )
}

/** A card with an uppercase title; the server-safe twin of Section with an optional hint. */
export function Card({ title, hint, action, children, flush }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated">
      {(title || action) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${flush ? 'px-5 pt-4 pb-3' : 'px-5 pt-5 pb-3'}`}>
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-foreground-muted">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? '' : `px-5 pb-5 ${title || action ? '' : 'pt-5'}`}>{children}</div>
    </section>
  )
}

const GRID = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }

/** Key-value grid for view pages. */
export function Fields({ cols = 2, children }: { cols?: 1 | 2 | 3; children: ReactNode }) {
  return <dl className={`grid gap-x-6 gap-y-3 ${GRID[cols]}`}>{children}</dl>
}

const isEmpty = (v: ReactNode) => v == null || v === '' || v === false

/** One label/value pair; empty values render as '-'. `copy` adds a copy button for that text. */
export function Field({ label, value, hint, copy, mono, span }: { label: ReactNode; value: ReactNode; hint?: ReactNode; copy?: string; mono?: boolean; span?: 1 | 2 | 3 }) {
  return (
    <div className={`min-w-0 ${span === 3 ? 'sm:col-span-2 lg:col-span-3' : span === 2 ? 'sm:col-span-2' : ''}`}>
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className={`mt-0.5 flex min-w-0 items-center gap-1 text-sm text-foreground break-words ${mono ? 'font-mono text-xs' : ''}`}>
        <span className="min-w-0">{isEmpty(value) ? '-' : value}</span>
        {copy && <CopyValue value={copy} />}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-foreground-muted">{hint}</p>}
    </div>
  )
}
