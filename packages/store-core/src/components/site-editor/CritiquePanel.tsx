'use client'

import { AlertTriangle, CheckCircle2, Crosshair, Wand2 } from 'lucide-react'
import type { TreeFinding } from '@/lib/site/code/tree-critique'

// The page checked the way a careful designer would (lib/site/code/tree-critique.ts): each finding can be shown on
// the canvas and, where it can be, fixed as an undoable change (or shortened by the AI).

export default function CritiquePanel({
  findings,
  canWrite,
  canShorten,
  busy,
  onShow,
  onFix,
}: {
  findings: TreeFinding[]
  canWrite: boolean
  canShorten: boolean
  busy: boolean
  onShow: (f: TreeFinding) => void
  onFix: (f: TreeFinding) => void
}) {
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  if (!findings.length)
    return (
      <p className="flex items-center gap-2 text-sm text-foreground-secondary">
        <CheckCircle2 className="h-4 w-4 text-green-600" /> Nothing to fix: contrast, lengths, picture descriptions, headings and free layers look right.
      </p>
    )
  return (
    <ul className="space-y-2" aria-label="What to fix">
      {findings.map((f, i) => {
        const fixable = !!f.fix && ('ops' in f.fix ? f.fix.ops.length > 0 : canShorten)
        return (
          <li key={`${f.block}:${f.id}:${f.code}:${i}`} className="rounded-lg border border-border-default p-2.5 space-y-2">
            <p className="flex gap-2 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {f.message}
            </p>
            <div className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => onShow(f)}>
                <Crosshair className="h-3.5 w-3.5" /> Show
              </button>
              {canWrite && fixable && (
                <button type="button" className={btn} disabled={busy} onClick={() => onFix(f)}>
                  <Wand2 className="h-3.5 w-3.5" /> {f.fix && 'shorten' in f.fix ? 'Shorten with AI' : 'Fix'}
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
