'use client'

import { AlertTriangle, CheckCircle2, Crosshair, Loader2, Monitor, Wand2 } from 'lucide-react'
import type { TreeFinding } from '@/lib/site/code/tree-critique'

// The page checked the way a careful designer would (lib/site/code/tree-critique.ts): each finding can be shown on
// the canvas and, where it can be, fixed as an undoable change (or shortened by the AI). "Check screen sizes" loads the
// saved page at Phone, Tablet and Desktop widths and lists what runs past the screen (SiteEditor runs it).

export interface SizeCheck {
  running: boolean
  /** Checked before the latest change. */
  stale: boolean
  /** Screens that did not answer in time. */
  missing: string[]
  /** null until checked. */
  found: { key: string; what: string; screen: string; show: () => void }[] | null
  run: () => void
}

export default function CritiquePanel({
  findings,
  canWrite,
  canShorten,
  busy,
  onShow,
  onFix,
  sizes,
}: {
  findings: TreeFinding[]
  canWrite: boolean
  canShorten: boolean
  busy: boolean
  onShow: (f: TreeFinding) => void
  onFix: (f: TreeFinding) => void
  sizes?: SizeCheck
}) {
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  const ok = (text: string) => (
    <p className="flex items-center gap-2 text-sm text-foreground-secondary">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> {text}
    </p>
  )
  const answered = sizes ? ['Phone', 'Tablet', 'Desktop'].filter(s => !sizes.missing.includes(s)) : []
  return (
    <div className="space-y-3">
      {!findings.length ? (
        ok('Nothing to fix: contrast, lengths, picture descriptions, headings and free layers look right.')
      ) : (
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
      )}
      {sizes && (
        <section aria-label="Screen sizes" className="space-y-2 border-t border-border-default pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Screen sizes</p>
            <button type="button" className={btn} disabled={sizes.running} onClick={sizes.run}>
              {sizes.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Monitor className="h-3.5 w-3.5" />} {sizes.running ? 'Checking…' : 'Check screen sizes'}
            </button>
          </div>
          {sizes.found === null ? (
            !sizes.running && <p className="text-xs text-foreground-muted">Loads the saved page at Phone (390px), Tablet (768px) and Desktop (1280px) and lists what runs past the screen.</p>
          ) : !answered.length ? (
            <p className="text-xs text-foreground-muted">The page did not load in time; check again.</p>
          ) : !sizes.found.length ? (
            ok(`Nothing runs past the screen on ${answered.join(', ')}.`)
          ) : (
            <ul className="space-y-2" aria-label="Runs past the screen">
              {sizes.found.map(f => (
                <li key={f.key} className="rounded-lg border border-border-default p-2.5 space-y-2">
                  <p className="flex gap-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {f.what} runs past the screen on {f.screen}, so it is cut off or the page scrolls sideways there.
                  </p>
                  <button type="button" className={btn} onClick={f.show}>
                    <Crosshair className="h-3.5 w-3.5" /> Show
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sizes.found !== null && sizes.missing.length > 0 && answered.length > 0 && <p className="text-[11px] text-foreground-muted">{sizes.missing.join(', ')} did not load in time.</p>}
          {sizes.stale && <p className="text-[11px] text-foreground-muted">Checked before your latest change.</p>}
        </section>
      )}
    </div>
  )
}
