'use client'

import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import { autosaveLabel } from '@/hooks/useAutosaveDraft'

export default function AutosaveStatusPill({ status }: { status: AutosaveStatus }) {
  const tone =
    status === 'saving'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : status === 'saved'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : status === 'error'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : status === 'locked'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-surface-secondary text-foreground-muted border-border-default'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${tone}`}>
      {status === 'saving' && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" aria-hidden />}
      {autosaveLabel(status)}
    </span>
  )
}
