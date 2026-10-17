'use client'

import type { ReactNode } from 'react'
import { PeriodBar, OverviewSkeleton, usePeriod, useOverviewData } from '@/components/admin/overview/kit'
import type { Period } from '@/lib/overview/period'

/** Period bar + loader shared by the platform overviews; renders children only with fresh data. */
export function useEcomOverview<T>(endpoint: string, extra = '') {
  const [period, setPeriod] = usePeriod()
  const url = `${endpoint}?from=${period.from}&to=${period.to}${extra}`
  const res = useOverviewData<T>(url)
  return { period, setPeriod, ...res }
}

export function OverviewShell<T>({
  period,
  setPeriod,
  data,
  error,
  loading,
  reload,
  children,
}: {
  period: Period
  setPeriod: (p: Period) => void
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
  children: (d: T) => ReactNode
}) {
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : !data ? (
        <OverviewSkeleton />
      ) : (
        children(data)
      )}
    </div>
  )
}

export function bytes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = v
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

export const dateIn = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/** Two-column grid that stacks on mobile. */
export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
}
