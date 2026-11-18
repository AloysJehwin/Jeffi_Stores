'use client'

import { ArrowLeft, ArrowRight, Loader2, Paintbrush, Wand2 } from 'lucide-react'
import { ghostBtn, primaryBtn } from '../ui'
import type { BriefReference, PlannedPage, StudioPlan } from '@/lib/site/studio/types'
import { ReferenceStrip } from './StylePreview'

// The page plan: the pages the AI designs section by section (optional ones can be switched off) and the pages that
// take the theme.

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`ecom-focus relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'ecom-accent-bg' : 'bg-[var(--org-sand-deep)]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

function PageRow({ p, onToggle, locked }: { p: PlannedPage; onToggle: (v: boolean) => void; locked: boolean }) {
  return (
    <li className={`flex items-start gap-3 rounded-xl border border-border-default px-4 py-3 ${p.enabled ? 'bg-surface-elevated' : 'bg-surface-secondary/40'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-sm font-semibold ${p.enabled ? 'text-foreground' : 'text-foreground-muted line-through'}`}>{p.label}</span>
          <span className="text-xs text-foreground-muted">
            {p.sections.length} section{p.sections.length === 1 ? '' : 's'}
          </span>
        </div>
        {p.enabled && p.sections.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.sections.map(s => (
              <span key={s.id} title={s.intent} className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-foreground-secondary">
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {p.optional ? <Toggle on={p.enabled} onChange={onToggle} label={`Include ${p.label}`} disabled={locked} /> : <span className="pt-0.5 text-[11px] text-foreground-muted">Always</span>}
    </li>
  )
}

export default function PlanStep({
  plan,
  locked,
  busy,
  onToggle,
  onBack,
  onNext,
  nextLabel,
  references = [],
  subject = 'store',
}: {
  plan: StudioPlan
  references?: BriefReference[]
  locked: boolean
  busy: boolean
  onToggle: (key: string, on: boolean) => void
  onBack: () => void
  onNext: () => void
  nextLabel: string
  /** What the site is for, in the copy ("store", "business"). */
  subject?: string
}) {
  const groups = (['store', 'business'] as const).map(a => ({ audience: a, pages: plan.pages.filter(p => p.audience === a) })).filter(g => g.pages.length)
  const themed = (['store', 'business'] as const).map(a => ({ audience: a, pages: plan.themed.filter(p => p.audience === a) })).filter(g => g.pages.length)
  return (
    <div>
      <div className="rounded-2xl org-sand px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">The approach</div>
        <div className="mt-0.5 text-sm">
          <span className="font-semibold text-foreground">{plan.approach.name}.</span> <span className="text-foreground-secondary">{plan.approach.description}</span>
        </div>
      </div>
      <ReferenceStrip references={references} />

      <div className={`mt-5 grid grid-cols-1 gap-6 ${themed.length ? 'lg:grid-cols-[3fr_2fr]' : ''}`}>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wand2 className="h-4 w-4 org-brown" /> Designed by AI
          </h3>
          <p className="mt-0.5 text-xs text-foreground-muted">Each section written for your {subject}. Switch off the optional ones you don&apos;t need.</p>
          {groups.map(g => (
            <div key={g.audience} className="mt-3">
              {groups.length > 1 && <div className="mb-1.5 text-xs font-semibold text-foreground-secondary">{g.audience === 'store' ? 'Store' : 'Business portal'}</div>}
              <ul className="space-y-2">
                {g.pages.map(p => (
                  <PageRow key={p.key} p={p} locked={locked || busy} onToggle={v => onToggle(p.key, v)} />
                ))}
              </ul>
            </div>
          ))}
        </section>
        {themed.length > 0 && (
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Paintbrush className="h-4 w-4 org-brown" /> Themed
            </h3>
            <p className="mt-0.5 text-xs text-foreground-muted">These take your colours, fonts and shapes, so they match without extra work.</p>
            {themed.map(g => (
              <div key={g.audience} className="mt-3">
                {themed.length > 1 && <div className="mb-1.5 text-xs font-semibold text-foreground-secondary">{g.audience === 'store' ? 'Store' : 'Business portal'}</div>}
                <div className="flex flex-wrap gap-1.5">
                  {g.pages.map(p => (
                    <span key={`${p.audience}:${p.key}`} className="rounded-full border border-border-default bg-surface-elevated px-2.5 py-1 text-xs text-foreground-secondary">
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} disabled={busy} className={ghostBtn}>
          <ArrowLeft className="h-4 w-4" /> Questions
        </button>
        <button type="button" onClick={onNext} disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Finding looks…' : nextLabel}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
