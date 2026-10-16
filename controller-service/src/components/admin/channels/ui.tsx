'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react'

// Building blocks shared by the channel consoles (Merchant, Amazon, Amazon Ads, Meta Ads, Social),
// in the Google Ads console's style.

export const inputCls =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40'
export const btnPrimary =
  'inline-flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50'
export const btnGhost =
  'inline-flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50'

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
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
}: {
  label: string
  value: string
  delta?: number | null
  invert?: boolean
  sub?: string
  highlight?: boolean
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0
  return (
    <div className={`bg-surface-elevated border rounded-xl p-4 flex flex-col gap-1 ${highlight ? 'border-accent-500/50' : 'border-border-default'}`}>
      <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${highlight ? 'text-accent-500' : 'text-foreground'}`}>{value}</p>
      {delta != null && (
        <p className={`text-xs flex items-center gap-1 ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {(delta * 100).toFixed(1)}% vs previous
        </p>
      )}
      {sub && <p className="text-xs text-foreground-muted">{sub}</p>}
    </div>
  )
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">{children}</div>
}

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'muted'

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: Tone }) {
  const cls = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    green: 'bg-green-500/10 text-green-700 dark:text-green-400',
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    muted: 'bg-surface-secondary text-foreground-muted',
  }[tone]
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

export function Banner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-0.5 border-b border-border-default overflow-x-auto" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${
            value === t.id ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
          }`}
        >
          {t.label}
          {t.count ? <span className="ml-1 text-xs text-accent-500">({t.count})</span> : null}
        </button>
      ))}
    </div>
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
  const [page, setPage] = useState(1)
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
  if (!rows.length) return <Empty msg={empty} />
  const pages = Math.ceil(sorted.length / pageSize)
  const shown = sorted.slice((page - 1) * pageSize, page * pageSize)
  return (
    <div>
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
                  <td key={c.key} className={`py-2 px-2 align-top ${c.num ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-3 text-xs text-foreground-muted">
          <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Prev
          </button>
          {page} / {pages}
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Next
          </button>
        </div>
      )}
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
    <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg w-fit">
      {presets.map(n => {
        const r = lastDays(n, endOffset)
        const active = r.from === value.from && r.to === value.to
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(r)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${active ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
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
