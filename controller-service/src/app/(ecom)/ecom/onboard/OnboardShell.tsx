'use client'

import type { ReactNode } from 'react'
import {
  Building2,
  Check,
  ClipboardList,
  CreditCard,
  FileText,
  ImageIcon,
  Landmark,
  LayoutGrid,
  ListChecks,
  Rocket,
  Store,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import ConsoleFrame, { ConsoleBrand, ConsoleOwner } from '../dashboard/_components/ConsoleFrame'
import type { RailStep, StepIconKey } from './steps'

const ICONS: Record<StepIconKey, LucideIcon> = {
  plan: ClipboardList,
  store: Store,
  business: Building2,
  gst: FileText,
  warehouse: Warehouse,
  bank: Landmark,
  branding: ImageIcon,
  review: ListChecks,
  payment: CreditCard,
  setup: Rocket,
  services: LayoutGrid,
  workspace: Building2,
}

/**
 * The dashboard's console frame for onboarding: the rail lists the steps (finished ones are links back when
 * `onSelect` is given) and, on mobile, the top bar shows the current step and a progress strip.
 */
export default function OnboardShell({
  owner,
  heading,
  subheading,
  steps,
  current,
  groupTitle = 'Store setup',
  onSelect,
  saving = false,
  children,
}: {
  owner: { email: string; name: string | null }
  heading: string
  subheading?: string
  steps: readonly RailStep[]
  /** Index of the current step; steps.length marks every step done. */
  current: number
  groupTitle?: string
  onSelect?: (index: number) => void
  saving?: boolean
  children: ReactNode
}) {
  const total = steps.length
  const at = Math.min(current, total - 1)

  const rail = (close: () => void) => (
    <div className="flex flex-col h-full">
      <ConsoleBrand />

      {/* Sits where the dashboard's store switcher does. */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5">
        <span className="inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-lg org-peach org-brown">
          <Rocket className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{heading}</span>
          {subheading && <span className="block truncate text-[11px] text-foreground-muted">{subheading}</span>}
        </span>
      </div>

      <nav aria-label="Onboarding steps" className="-mx-1 flex-1 overflow-y-auto px-1 py-1">
        <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">{groupTitle}</div>
        <ol className="space-y-0.5">
          {steps.map((s, i) => {
            const done = i < current
            const active = i === current
            const Icon = done ? Check : ICONS[s.icon]
            const cls = `ecom-focus flex w-full items-center gap-3 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
              active
                ? 'ecom-current font-semibold'
                : done
                  ? 'text-foreground-secondary ecom-hover hover:text-foreground'
                  : 'text-foreground-muted'
            }`
            const body = (
              <>
                <Icon className={`w-4 h-4 flex-shrink-0 ${done ? 'org-sage-text' : ''}`} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
              </>
            )
            return (
              <li key={s.label} title={s.desc}>
                {done && onSelect ? (
                  <button
                    type="button"
                    className={cls}
                    onClick={() => {
                      close()
                      onSelect(i)
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={cls} aria-current={active ? 'step' : undefined}>
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="mt-6 pt-4 border-t border-border-default space-y-2">
        {saving && <p className="px-1 text-xs text-foreground-muted">Saving draft…</p>}
        <ConsoleOwner owner={owner} />
      </div>
    </div>
  )

  return (
    <ConsoleFrame
      rail={rail}
      title={current >= total ? heading : steps[at].label}
      trailing={
        <span className="w-9 text-right text-xs font-medium tabular-nums text-foreground-muted" aria-live="polite">
          {saving ? '…' : `${Math.min(current + 1, total)}/${total}`}
        </span>
      }
      topBarExtra={
        <div aria-hidden className="absolute inset-x-0 bottom-0 flex gap-0.5">
          {steps.map((s, i) => (
            <span key={s.label} className={`h-[3px] flex-1 ${i < current ? 'ecom-accent-bg' : i === current ? 'ecom-sel' : 'bg-surface-secondary'}`} />
          ))}
        </div>
      }
    >
      {children}
    </ConsoleFrame>
  )
}
