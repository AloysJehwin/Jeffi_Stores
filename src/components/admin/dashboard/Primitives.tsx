import Link from 'next/link'
import type { ReactNode } from 'react'
import { PctBadge } from './StatCard'

export const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`
export const rsCompact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `Rs ${(n / 1e5).toFixed(2)} L`
  return rs(n)
}
export const numStr = (n: number) => n.toLocaleString('en-IN')
export const pctStr = (v: number | null, digits = 1) => (v == null ? 'n/a' : `${v.toFixed(digits)}%`)
export const hoursStr = (v: number | null) => (v == null ? 'n/a' : v < 1 ? `${Math.max(1, Math.round(v * 60))} min` : v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`)
export const daysStr = (v: number | null) => (v == null ? 'n/a' : v < 1 ? `${Math.max(1, Math.round(v * 24))} h` : `${v.toFixed(1)} d`)
export const delta = (now: number | null, prev: number | null): number | null =>
  now == null || prev == null || prev === 0 ? null : Math.round(((now - prev) / prev) * 100)

export const Icon = ({ d, cls }: { d: string; cls: string }) => (
  <svg className={`w-5 h-5 ${cls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)

export const Chevron = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
)

export function GroupLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <p className="text-xs uppercase tracking-wide text-foreground-muted font-semibold">{title}</p>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
    </div>
  )
}

export function SectionHeader({ title, actionLabel, href }: { title: string; actionLabel?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {actionLabel && href && (
        <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors">
          {actionLabel} <Chevron />
        </Link>
      )}
    </div>
  )
}

/** With `href` the whole card navigates and must contain no inner anchors. */
export function SectionCard({ href, span, children }: { href?: string; span?: boolean; children: ReactNode }) {
  const base = `bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-4 sm:p-5 ${span ? 'lg:col-span-2' : ''}`
  if (href) {
    return (
      <Link href={href} className={`${base} block hover:ring-accent-500/50 hover:shadow-md transition-[box-shadow,ring-color] duration-200`}>
        {children}
      </Link>
    )
  }
  return <div className={base}>{children}</div>
}

export function MiniStat({ label, value, tone, href, sub }: { label: string; value: string; tone?: string; href?: string; sub?: string }) {
  const inner = (
    <>
      <span className="text-xs text-foreground-muted min-w-0 truncate">{label}</span>
      <span className="text-right shrink-0">
        <span className={`text-sm font-bold tabular-nums ${tone || 'text-foreground'}`}>{value}</span>
        {sub && <span className="block text-[11px] leading-tight text-foreground-muted tabular-nums">{sub}</span>}
      </span>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="flex items-center justify-between gap-3 rounded-md px-1 -mx-1 py-1 hover:bg-surface-secondary transition-colors">
        {inner}
      </Link>
    )
  }
  return <div className="flex items-center justify-between gap-3 py-1">{inner}</div>
}

export function CompactStat({ label, value, sub, pct, invert, tone, href }: {
  label: string; value: string; sub?: string; pct?: number | null; invert?: boolean; tone?: string; href?: string
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium truncate">{label}</p>
        {pct !== undefined && <PctBadge value={pct ?? null} invert={invert} />}
      </div>
      <p className={`text-lg font-bold tabular-nums leading-tight mt-1 ${tone || 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-[11px] text-foreground-muted mt-0.5 truncate">{sub}</p>}
    </>
  )
  const cls = 'rounded-lg bg-surface-secondary/60 dark:bg-white/[0.03] px-3 py-2.5 min-w-0'
  if (href) return <Link href={href} className={`${cls} block hover:bg-surface-secondary transition-colors`}>{inner}</Link>
  return <div className={cls}>{inner}</div>
}

export function ListRows({ rows }: { rows: { key: string; primary: string; secondary?: string; value?: string; badge?: ReactNode; href: string }[] }) {
  if (!rows.length) return <p className="text-xs text-foreground-muted py-4 text-center">No data yet.</p>
  return (
    <div className="divide-y divide-border-default">
      {rows.map(r => (
        <Link key={r.key} href={r.href} className="flex items-center gap-3 py-2.5 group hover:bg-surface-secondary rounded-md px-1 -mx-1 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">{r.primary}</p>
            {r.secondary && <p className="text-xs text-foreground-muted truncate mt-0.5">{r.secondary}</p>}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-1">
            {r.badge}
            {r.value && <span className="text-xs font-semibold text-foreground tabular-nums">{r.value}</span>}
          </div>
        </Link>
      ))}
    </div>
  )
}

export function LinkedLegend({ items }: { items: { label: string; value: string; color: string; href: string }[] }) {
  return (
    <ul className="mt-3 space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>
          <Link href={it.href} className="flex items-center gap-2 text-xs rounded-md px-1 -mx-1 py-1 hover:bg-surface-secondary transition-colors">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
            <span className="text-foreground-secondary flex-1 min-w-0 truncate">{it.label}</span>
            <span className="text-foreground font-semibold tabular-nums">{it.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'bg-surface-secondary text-foreground-secondary',
    good: 'bg-green-500/10 text-green-700 dark:text-green-400',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bad: 'bg-red-500/10 text-red-700 dark:text-red-400',
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${tones[tone]}`}>{children}</span>
}

/** 24 thin bars, one per hour of the day, busiest hour highlighted. */
export function HourBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  const peak = counts.indexOf(max)
  const total = counts.reduce((s, n) => s + n, 0)
  return (
    <div>
      <div className="flex items-end gap-[3px] h-16">
        {counts.map((n, h) => (
          <div key={h} className="flex-1 flex flex-col justify-end h-full" title={`${String(h).padStart(2, '0')}:00  ${n} orders`}>
            <div
              className={`w-full rounded-sm ${total > 0 && h === peak ? 'bg-accent-500' : 'bg-accent-500/35'}`}
              style={{ height: `${Math.max(n > 0 ? 6 : 2, Math.round((n / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-foreground-muted mt-1 tabular-nums">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
      <p className="text-xs text-foreground-secondary mt-2">
        {total > 0 ? `Busiest hour ${String(peak).padStart(2, '0')}:00 to ${String(peak + 1).padStart(2, '0')}:00 with ${max} orders (IST)` : 'No orders in this range.'}
      </p>
    </div>
  )
}

export const FUNNEL_STAGES = [
  { key: 'pending', label: 'Pending', dot: 'bg-yellow-400 dark:bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300' },
  { key: 'processing', label: 'Processing', dot: 'bg-blue-400 dark:bg-blue-500', text: 'text-blue-700 dark:text-blue-300' },
  { key: 'shipped', label: 'Shipped', dot: 'bg-indigo-400 dark:bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300' },
  { key: 'out_for_delivery', label: 'Out for Delivery', dot: 'bg-violet-400 dark:bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
  { key: 'delivered', label: 'Delivered', dot: 'bg-accent-500', text: 'text-accent-600' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-red-400 dark:bg-red-500', text: 'text-red-700 dark:text-red-300' },
] as const

export function FunnelBar({ counts, hrefFor }: { counts: Record<string, number>; hrefFor: (key: string) => string }) {
  const total = FUNNEL_STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0)
  return (
    <div className="space-y-3">
      <div className="flex gap-1 h-2.5">
        {FUNNEL_STAGES.map(st => {
          const v = counts[st.key] || 0
          return (
            <Link key={st.key} href={hrefFor(st.key)} className={`${st.dot} rounded-full hover:opacity-80 transition-opacity`}
              style={{ flexGrow: v || 0.15 }} title={`${st.label}: ${v}${total ? ` (${Math.round((v / total) * 100)}%)` : ''}`} />
          )
        })}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {FUNNEL_STAGES.map(st => (
          <Link key={st.key} href={hrefFor(st.key)} className="group rounded-lg px-2 py-1.5 hover:bg-surface-secondary transition-colors">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
              <span className="text-xs text-foreground-muted truncate group-hover:text-foreground transition-colors">{st.label}</span>
            </div>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${st.text}`}>{counts[st.key] || 0}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function statusBadgeClass(status: string) {
  if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (status === 'processing' || status === 'confirmed') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (status === 'shipped') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
  if (status === 'out_for_delivery') return 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
  if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

export function statusLabel(s: string) {
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'cancel_requested') return 'Cancel Req.'
  return s.replace(/_/g, ' ')
}
