'use client'

import { useState, Fragment, type ReactNode, type ComponentType } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { BrowserFrame } from '@/app/(ecom)/ecom/BrowserFrame'

// Shared chrome for every per-app demo: pill stepper, fixed-height browser frame, Back/Next.
// Each demo keeps its own state and views — this only standardises the shell so no stage shifts layout.

export interface DemoStep {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}

export function useSteps(steps: DemoStep[]) {
  const [step, setStep] = useState(steps[0].id)
  const idx = steps.findIndex(s => s.id === step)
  return {
    step,
    idx,
    go: setStep,
    next: () => setStep(steps[Math.min(steps.length - 1, idx + 1)].id),
    back: () => setStep(steps[Math.max(0, idx - 1)].id),
  }
}

export function AppDemoShell({
  steps,
  step,
  onStep,
  caption,
  children,
}: {
  steps: DemoStep[]
  step: string
  onStep: (id: string) => void
  caption: string
  children: ReactNode
}) {
  const idx = steps.findIndex(s => s.id === step)
  const cur = steps[Math.max(0, idx)]
  const CurIcon = cur.icon
  return (
    <div className="w-full">
      <div className="sm:hidden pb-2">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <CurIcon className="w-4 h-4 shrink-0 ecom-accent-text" />
            <span className="truncate">{cur.label}</span>
          </span>
          <span className="shrink-0 text-xs font-medium tabular-nums text-foreground-muted">{idx + 1} of {steps.length}</span>
        </div>
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStep(s.id)}
              aria-label={s.label}
              aria-current={i === idx ? 'step' : undefined}
              className="flex-1 h-11 flex items-center"
            >
              <span
                className={clsx('h-1.5 w-full rounded-full', i === idx ? 'ecom-accent-bg' : i > idx && 'bg-surface-elevated')}
                style={i < idx ? { background: 'var(--org-apricot)' } : undefined}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="hidden sm:flex gap-2 overflow-x-auto pb-3 h-14">
        {steps.map((s, i) => {
          const Icon = s.icon
          const active = i === idx
          const done = i < idx
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onStep(s.id)}
              className={clsx(
                'shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                active ? 'ecom-accent-bg text-white' : done ? 'org-peach org-brown' : 'org-sand org-sand-hover text-foreground'
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              {s.label}
            </button>
          )
        })}
      </div>

      <BrowserFrame alt={caption} caption={caption} className="w-full">
        <div className="grid grid-cols-1 min-h-80 overflow-hidden p-3 sm:block sm:h-[520px] sm:min-h-0 sm:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="h-full min-w-0"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </BrowserFrame>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onStep(steps[Math.max(0, idx - 1)].id)}
          disabled={idx === 0}
          className="flex-1 sm:flex-initial min-h-11 sm:min-h-0 org-sand org-sand-hover rounded-full px-5 py-2 text-sm font-semibold text-foreground disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onStep(steps[Math.min(steps.length - 1, idx + 1)].id)}
          disabled={idx === steps.length - 1}
          className="flex-1 sm:flex-initial min-h-11 sm:min-h-0 ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Next step
        </button>
      </div>
    </div>
  )
}

// ── view primitives ──
export const rs = (n: number) => '₹' + n.toLocaleString('en-IN')

export const TONE: Record<string, string> = {
  ok: 'org-sage org-sage-text',
  warn: 'org-peach org-brown',
  bad: 'bg-[#f2d4cd] text-[#8a2e1f]',
  neutral: 'org-sand text-foreground-secondary',
}

export function Tag({ tone = 'neutral', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={clsx('inline-flex max-w-full sm:max-w-none rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-normal sm:whitespace-nowrap', TONE[tone])}>{children}</span>
}

export function Field({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <div className="mt-1 flex items-center justify-between rounded-xl bg-surface-elevated px-3 py-2 text-sm text-foreground">
        <span className="min-w-0 break-words sm:truncate">{value}</span>
        {hint && <span className="ml-2 shrink-0 text-[11px] text-foreground-muted">{hint}</span>}
      </div>
    </label>
  )
}

export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('h-full flex flex-col min-h-0', className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 mb-3 sm:flex-nowrap sm:gap-0">
          {title && <h3 className="min-w-0 font-display font-black text-lg text-foreground">{title}</h3>}
          {action}
        </div>
      )}
      <div className="flex-1 min-h-0 sm:overflow-hidden">{children}</div>
    </div>
  )
}

export function Btn({ children, onClick, disabled, tone = 'solid' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'solid' | 'sand' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full min-h-11 sm:min-h-0 px-4 py-2 text-sm font-semibold disabled:opacity-40 transition-colors',
        tone === 'solid' ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover text-foreground'
      )}
    >
      {children}
    </button>
  )
}

export function Table({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  const stack = cols.length > 2
  return (
    <>
      {stack && (
        <div className="sm:hidden space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-2xl bg-surface-elevated px-3 py-2.5">
              <div className="break-words text-sm font-medium text-foreground">{r[0]}</div>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {cols.slice(1).map((h, j) =>
                  r[j + 1] === '' || r[j + 1] == null ? null : (
                    <Fragment key={j}>
                      <dt className="text-foreground-muted">{h}</dt>
                      <dd className="min-w-0 break-words text-right text-foreground-secondary">{r[j + 1]}</dd>
                    </Fragment>
                  )
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
      <div className={clsx('h-full overflow-hidden rounded-2xl bg-surface-elevated', stack && 'hidden sm:block')}>
        <table className="w-full text-sm">
          <thead className="org-sand text-foreground-secondary">
            <tr>
              {cols.map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={clsx('px-3 py-2.5 whitespace-normal break-words sm:whitespace-nowrap', j === 0 ? 'font-medium text-foreground' : 'text-foreground-secondary')}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'accent' }) {
  return (
    <div className="min-w-0 rounded-2xl org-sand p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-foreground-muted sm:tracking-widest">{label}</div>
      <div className={clsx('mt-1 font-display font-black text-xl tabular-nums sm:text-2xl', tone === 'accent' ? 'ecom-accent-text' : 'text-foreground')}>{value}</div>
    </div>
  )
}

export function Done({ icon: Icon, title, copy, action, done, onAction, actionLabel, doneLabel }: {
  icon: ComponentType<{ className?: string }>
  title: string
  copy: string
  done: boolean
  onAction: () => void
  actionLabel: string
  doneLabel?: string
  action?: ReactNode
}) {
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-sm">
        <span className={clsx('mx-auto grid place-items-center w-16 h-16 rounded-full', done ? 'org-sage org-sage-text' : 'org-peach ecom-accent-text')}>
          {done ? <Check className="w-8 h-8" /> : <Icon className="w-8 h-8" />}
        </span>
        <h3 className="mt-5 font-display font-black text-2xl text-foreground">{done ? (doneLabel ?? 'Done') : title}</h3>
        <p className="mt-2 text-sm text-foreground-secondary">{copy}</p>
        <div className="mt-5">{done ? action : <Btn onClick={onAction}>{actionLabel}</Btn>}</div>
      </div>
    </div>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 rounded-full org-sand overflow-hidden">
      <motion.div className="h-full ecom-accent-bg" initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6 }} />
    </div>
  )
}
