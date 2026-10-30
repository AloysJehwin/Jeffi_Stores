'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, Lock, PencilLine } from 'lucide-react'
import { adminHref, arr, TEXT_TONE, toneOf, type BlockTone } from './format'

// Any proposed change (status, refund, stock adjustment, field edits): subject, from → to
// per field, what happens on approval, warnings.

export interface ChangeSummaryBlockData {
  type: 'change_summary'
  title: string
  subject?: { label: string; href?: string | null; meta?: string | null }
  changes: Array<{ field: string; from?: string | null; to: string; tone?: BlockTone }>
  effects?: string[]
  warnings?: string[]
  requires?: string | null
}

const label = 'text-[10px] font-semibold uppercase tracking-wide text-foreground-muted'

export default function ChangeSummaryBlock({ block }: { block: ChangeSummaryBlockData }) {
  const changes = arr(block.changes)
  const effects = arr(block.effects)
  const warnings = arr(block.warnings)
  const s = block.subject

  return (
    <div className="max-w-2xl overflow-hidden rounded-xl border border-border-default bg-surface-elevated text-xs text-foreground">
      <div className="flex items-start gap-2.5 border-b border-border-default px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 dark:text-accent-400">
          <PencilLine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{block.title}</p>
          {s?.label && (
            <p className="mt-0.5 [overflow-wrap:anywhere]">
              {s.href ? (
                <Link
                  href={adminHref(s.href)}
                  className="font-medium text-accent-600 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-accent-400"
                >
                  {s.label}
                </Link>
              ) : (
                <span className="font-medium">{s.label}</span>
              )}
              {s.meta && <span className="text-foreground-muted"> · {s.meta}</span>}
            </p>
          )}
        </div>
        {block.requires && (
          <span
            className="inline-flex max-w-[45%] shrink-0 items-center gap-1 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted"
            title={`Requires ${block.requires}`}
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate">{block.requires}</span>
          </span>
        )}
      </div>

      {changes.length > 0 && (
        <ul className="divide-y divide-border-default">
          {changes.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="w-28 shrink-0 text-foreground-muted [overflow-wrap:anywhere]">{c.field}</span>
              <span className="flex min-w-[10rem] flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {c.from != null && c.from !== '' && (
                  <>
                    <span className="text-foreground-muted line-through [overflow-wrap:anywhere]">{c.from}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-foreground-muted" aria-label="to" />
                  </>
                )}
                <span className={`font-semibold [overflow-wrap:anywhere] ${TEXT_TONE[toneOf(c.tone)]}`}>{c.to}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {effects.length > 0 && (
        <div className="border-t border-border-default px-3 py-2.5">
          <p className={`${label} mb-1`}>On approval</p>
          <ul className="space-y-1">
            {effects.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
                <span className="[overflow-wrap:anywhere]">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border-t border-border-default p-2.5">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <ul className="min-w-0 space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
