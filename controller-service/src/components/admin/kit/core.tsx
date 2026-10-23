'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react'
import { badgeCls, type Tone } from './tones'
import { InfiniteFooter, useReveal } from './infinite'

// Core admin kit: cards, KPIs, badges, tabs, the client table, fetch and number helpers.
// Originally the channel consoles' building blocks (channels/ui re-exports this),
// in the Google Ads console's style.

export const inputCls =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40'
export const btnPrimary =
  'inline-flex h-control items-center justify-center gap-2 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50 whitespace-nowrap'
export const btnGhost =
  'inline-flex h-control items-center justify-center gap-2 rounded-lg border border-border-default px-3 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50 whitespace-nowrap'

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-surface-elevated border border-border-default rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="min-w-0 break-words text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

export function Empty({ msg = 'Nothing here yet' }: { msg?: string }) {
  return <p className="text-sm text-foreground-muted text-center py-8">{msg}</p>
}

export function Kpi({
  label,
  value,
  delta,
  invert,
  sub,
  highlight,
  href,
  icon,
}: {
  label: string
  value: string
  delta?: number | null
  invert?: boolean
  sub?: string
  highlight?: boolean
  /** Whole card links here (already-resolved path). */
  href?: string
  /** Small leading icon chip. */
  icon?: React.ReactNode
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0
  const cls = `min-w-0 bg-surface-elevated border rounded-xl p-3 sm:p-4 flex flex-col gap-1 ${highlight ? 'border-accent-500/50' : 'border-border-default'} ${href ? 'hover:border-accent-400 transition-colors' : ''}`
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-foreground-muted uppercase tracking-wide font-medium leading-tight break-words">{label}</p>
        {icon && <span className="shrink-0 text-foreground-muted [&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
      </div>
      <p className={`text-lg sm:text-xl font-bold tabular-nums [overflow-wrap:anywhere] ${highlight ? 'text-accent-500' : 'text-foreground'}`}>{value}</p>
      {delta != null && (
        <p className={`text-xs flex items-center gap-1 ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {(delta * 100).toFixed(1)}% vs previous
        </p>
      )}
      {sub && <p className="text-xs text-foreground-muted">{sub}</p>}
    </>
  )
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  // On phones an odd last card spans both columns so the grid has no hole.
  return (
    <div className="grid gap-3 grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:[&>*:last-child:nth-child(odd)]:col-span-1">
      {children}
    </div>
  )
}

export type { Tone }

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={badgeCls(tone)}>{children}</span>
}

export function Banner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const TabSlotCtx = createContext<{ el: HTMLElement | null; setEl: React.Dispatch<React.SetStateAction<HTMLElement | null>> } | null>(null)

/** Wrap a tab bar and its content so the content can put its actions on the tab line (TabActionsPortal). */
export function TabActionsHost({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ el, setEl }), [el])
  return <TabSlotCtx.Provider value={value}>{children}</TabSlotCtx.Provider>
}

/** Renders its children on the enclosing host's tab line; inline when there is no host. */
export function TabActionsPortal({ children }: { children: React.ReactNode }) {
  const ctx = useContext(TabSlotCtx)
  if (!ctx) return <>{children}</>
  return ctx.el ? createPortal(children, ctx.el) : null
}

/** Tab bar with optional actions on the same line. Tabs scroll sideways when they overflow (no
 * visible scrollbar, edge fades show there is more); actions stay pinned on the right. */
export function TabStrip({ selected, actions, children }: { selected: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const n = React.Children.count(children)
  const slot = useContext(TabSlotCtx)
  // The first bar inside a host takes the slot; nested bars keep their own actions only.
  const setSlot = slot?.setEl
  const ownSlot = useRef<HTMLElement | null>(null)
  const slotRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!setSlot) return
      if (node) {
        ownSlot.current = node
        setSlot(prev => prev ?? node)
      } else {
        const mine = ownSlot.current
        ownSlot.current = null
        setSlot(prev => (prev === mine ? null : prev))
      }
    },
    [setSlot]
  )
  const measure = () => {
    const el = ref.current
    if (el) setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n])
  useEffect(() => {
    const t = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (t && typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])
  return (
    <div className="flex items-end gap-2 border-b border-border-default">
      <div className="relative flex-1 min-w-0">
        <div
          ref={ref}
          onScroll={measure}
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {children}
        </div>
        {edges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-secondary to-transparent" />}
        {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-secondary to-transparent" />}
      </div>
      {(actions || slot) && (
        <div className="flex items-center gap-1 shrink-0 pb-1">
          {actions}
          {slot && <span ref={slotRef} className="contents" />}
        </div>
      )}
    </div>
  )
}

export const tabCls = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 shrink-0 transition-colors ${
    active ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
  }`

type TabItem<T> = { id: T; label: React.ReactNode; count?: number; icon?: React.ReactNode }

function TabInner({ t }: { t: { label: React.ReactNode; count?: number; icon?: React.ReactNode } }) {
  return (
    <>
      {t.icon}
      {t.label}
      {t.count ? <span className="text-xs text-accent-500">({t.count})</span> : null}
    </>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  actions,
}: {
  tabs: readonly TabItem<T>[]
  value: T
  onChange: (t: T) => void
  actions?: React.ReactNode
}) {
  return (
    <TabStrip selected={value} actions={actions}>
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={tabCls(value === t.id)}>
          <TabInner t={t} />
        </button>
      ))}
    </TabStrip>
  )
}

/** Same bar as Tabs, for tabs driven by the URL. */
export function TabLinks<T extends string>({
  tabs,
  value,
  actions,
  replace,
  scroll,
}: {
  tabs: readonly (TabItem<T> & { href: string })[]
  value: T
  actions?: React.ReactNode
  replace?: boolean
  scroll?: boolean
}) {
  return (
    <TabStrip selected={value} actions={actions}>
      {tabs.map(t => (
        <Link key={t.id} href={t.href} replace={replace} scroll={scroll} role="tab" aria-selected={value === t.id} className={tabCls(value === t.id)}>
          <TabInner t={t} />
        </Link>
      ))}
    </TabStrip>
  )
}

/** Primary text action for the tab line; icon only below sm so it never crowds the tabs. */
export function TabAction({
  href,
  onClick,
  icon,
  label,
  disabled,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  label: string
  disabled?: boolean
}) {
  const cls =
    'inline-flex h-control items-center gap-1.5 rounded-lg bg-accent-500 px-2 sm:px-3 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50 whitespace-nowrap'
  const inner = (
    <>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </>
  )
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cls}>
      {inner}
    </button>
  )
}

export interface Col<T> {
  key: string
  label: string
  render: (r: T) => React.ReactNode
  sort?: (r: T) => number | string
  num?: boolean
}

const PAGE = 25

export function Table<T>({ rows, cols, rowKey, empty, pageSize = PAGE }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty?: string; pageSize?: number }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [desc, setDesc] = useState(true)
  const sorted = useMemo(() => {
    const c = cols.find(c => c.key === sortKey)
    if (!c?.sort) return rows
    const s = [...rows].sort((a, b) => {
      const x = c.sort!(a)
      const y = c.sort!(b)
      return x < y ? -1 : x > y ? 1 : 0
    })
    return desc ? s.reverse() : s
  }, [rows, cols, sortKey, desc])
  const { shown, control } = useReveal(sorted, pageSize, `${sortKey}|${desc}`)
  if (!rows.length) return <Empty msg={empty} />
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default text-xs text-foreground-muted">
              {cols.map(c => (
                <th
                  key={c.key}
                  className={`py-2 px-2 font-medium whitespace-nowrap ${c.num ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                  onClick={() => {
                    if (!c.sort) return
                    if (sortKey === c.key) setDesc(d => !d)
                    else {
                      setSortKey(c.key)
                      setDesc(true)
                    }
                  }}
                >
                  {c.label}
                  {sortKey === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={rowKey(r)} className="border-b border-border-default/60 last:border-0">
                {cols.map(c => (
                  <td key={c.key} className={`whitespace-nowrap py-2 px-2 align-top ${c.num ? 'text-right tabular-nums' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InfiniteFooter shown={shown.length} control={control} />
    </div>
  )
}

export const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-'

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const { json, ...rest } = init ?? {}
  const r = await fetch(url, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), 'x-requested-with': 'fetch', ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, data }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
export function lastDays(n: number, endOffset = 0): { from: string; to: string } {
  const to = new Date()
  to.setDate(to.getDate() - endOffset)
  const from = new Date(to)
  from.setDate(from.getDate() - (n - 1))
  return { from: isoDay(from), to: isoDay(to) }
}

export function RangePresets({ value, onChange, presets = [7, 14, 30, 90], endOffset = 0 }: { value: { from: string; to: string }; onChange: (r: { from: string; to: string }) => void; presets?: number[]; endOffset?: number }) {
  return (
    <div className="flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg w-fit">
      {presets.map(n => {
        const r = lastDays(n, endOffset)
        const active = r.from === value.from && r.to === value.to
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(r)}
            className={`flex items-center px-3 text-xs font-medium rounded-md ${active ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            {n}d
          </button>
        )
      })}
    </div>
  )
}

export const money = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? '-'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)
export const count = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '-' : Math.round(v).toLocaleString('en-IN'))
export const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(d)}%`)
export const change = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null)
