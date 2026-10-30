'use client'

import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

// Single draft/edit-session banner. Renders exactly one row at a time; the three states are
// mutually exclusive. Amber tone, rounded-xl, matches card edges. See docs/plans/ADMIN_LAYOUT_STANDARD.md.

export type DraftNoticeState = 'live' | 'draft' | 'draft-with-local'

export interface DraftNoticeCopy {
  draft: string
  draftWithLocal: string
  restore: string
  discard: string
}

const DEFAULT_COPY: DraftNoticeCopy = {
  draft: 'Editing a draft. The live record is unchanged until you publish.',
  draftWithLocal: 'A newer local autosave exists for this draft.',
  restore: 'Restore',
  discard: 'Discard',
}

export interface DraftNoticeProps {
  state: DraftNoticeState
  onDiscard?: () => void
  onRestore?: () => void
  copy?: Partial<DraftNoticeCopy>
}

export function DraftNotice({ state, onDiscard, onRestore, copy }: DraftNoticeProps) {
  if (state === 'live') return null
  const c = { ...DEFAULT_COPY, ...copy }
  const msg = state === 'draft-with-local' ? c.draftWithLocal : c.draft
  const showRestore = state === 'draft-with-local' && !!onRestore
  const showDiscard = !!onDiscard
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 sm:mt-0" aria-hidden />
        <span className="min-w-0">{msg}</span>
      </div>
      {(showRestore || showDiscard) && (
        <div className="flex shrink-0 items-center gap-3">
          {showRestore && (
            <button
              type="button"
              onClick={onRestore}
              className="h-control inline-flex items-center text-sm font-semibold text-accent-500 hover:underline"
            >
              {c.restore}
            </button>
          )}
          {showDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              className="h-control inline-flex items-center text-sm font-semibold text-foreground-secondary hover:underline"
            >
              {c.discard}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export type { ReactNode }
