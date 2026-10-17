import Link from 'next/link'
import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'

// Empty, error and loading states. Server-safe; they replace content, so they are inline by design.

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  /** A link action, or any node (a client button) via `actionNode`. */
  action?: { label: string; href: string }
  actionNode?: ReactNode
  /** Drop the card border when nested inside a card or table. */
  bare?: boolean
}

export function EmptyState({ icon, title, body, action, actionNode, bare }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${bare ? '' : 'rounded-xl border border-border-default bg-surface-elevated'}`}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-secondary text-foreground-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-foreground-muted">{body}</p>}
      {action && (
        <Link href={action.href} className="control-md mt-4 bg-accent-500 font-medium text-white hover:bg-accent-600">
          {action.label}
        </Link>
      )}
      {actionNode && <div className="mt-4">{actionNode}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Could not load this', body, actionNode, bare }: { title?: ReactNode; body?: ReactNode; actionNode?: ReactNode; bare?: boolean }) {
  return (
    <EmptyState
      bare={bare}
      icon={<AlertCircle className="h-5 w-5 text-red-500" />}
      title={title}
      body={body}
      actionNode={actionNode}
    />
  )
}

const bar = 'rounded bg-surface-secondary'
const card = 'rounded-xl border border-border-default bg-surface-elevated'

function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <div className={`h-7 w-48 ${bar}`} />
      <div className={`h-4 w-72 ${bar} opacity-60`} />
    </div>
  )
}

/** Table rows only (inside a DataTable or Suspense fallback for a list body). */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className={`${card} overflow-hidden animate-pulse`}>
      <div className="h-10 border-b border-border-default bg-surface-secondary/60" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 border-b border-border-default/60 px-4 last:border-0">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className={`h-3.5 ${bar} ${j === 0 ? 'flex-1' : 'w-20 hidden sm:block'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Header, KPI row, toolbar and table. */
export function ListSkeleton({ kpis = 3, rows = 8, cols = 5, header = true }: { kpis?: number; rows?: number; cols?: number; header?: boolean }) {
  return (
    <div className="space-y-5 animate-pulse">
      {header && <HeaderSkeleton />}
      {kpis > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className={`${card} h-[84px]`} />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <div className={`h-control w-40 ${card} rounded-lg`} />
        <div className={`h-control flex-1 ${card} rounded-lg`} />
      </div>
      <TableSkeleton rows={rows} cols={cols} />
    </div>
  )
}

/** Header, KPI row, then main (two columns) beside an aside. */
export function DetailSkeleton({ kpis = 3 }: { kpis?: number }) {
  return (
    <div className="space-y-5 animate-pulse">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: kpis }).map((_, i) => (
          <div key={i} className={`${card} h-[84px]`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={`${card} h-72 xl:col-span-2`} />
        <div className={`${card} h-72`} />
      </div>
    </div>
  )
}

/** Header and form sections with field rows, then the footer bar. */
export function FormSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="space-y-5 animate-pulse">
      <HeaderSkeleton />
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className={`${card} space-y-4 p-5`}>
          <div className={`h-4 w-40 ${bar}`} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="space-y-1.5">
                <div className={`h-3 w-24 ${bar}`} />
                <div className={`h-control ${bar} rounded-lg`} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className={`${card} h-14`} />
    </div>
  )
}
