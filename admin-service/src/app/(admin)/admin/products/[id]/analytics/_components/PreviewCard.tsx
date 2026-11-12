'use client'

import { useState, type ReactNode } from 'react'
import { Dialog, Section } from '@/components/admin/kit'
import { PREVIEW } from './analytics'

/** A card showing the first few rows, with the full list in a dialog when there are more. */
export function PreviewCard<T>({
  title,
  rows,
  empty,
  summary,
  preview,
  full,
  moreClassName = 'pt-1',
}: {
  title: string
  rows: T[]
  empty: string
  /** The dialog's one-line description. */
  summary: string
  preview: (rows: T[], more: ReactNode) => ReactNode
  full: (rows: T[]) => ReactNode
  moreClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const hasMore = rows.length > PREVIEW
  const more = hasMore && (
    <button onClick={() => setOpen(true)} className={`w-full text-center text-xs text-foreground-muted transition-colors hover:text-foreground ${moreClassName}`}>
      +{rows.length - PREVIEW} more
    </button>
  )
  return (
    <Section
      title={title}
      action={
        hasMore && (
          <button onClick={() => setOpen(true)} className="text-xs font-medium text-accent-500 hover:text-accent-600">
            View all ({rows.length}) →
          </button>
        )
      }
    >
      {rows.length === 0 ? <p className="text-sm text-foreground-muted">{empty}</p> : preview(rows.slice(0, PREVIEW), more)}
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={summary} zIndex="z-[300]" size="md">
        {full(rows)}
      </Dialog>
    </Section>
  )
}
