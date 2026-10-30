'use client'

// Shared period state for every /admin/financial tab. Reads ?from&to from the URL (shared across
// tabs so switching tabs preserves the range) and writes back on change. Thin wrapper over the
// kit period helpers.

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  matchPreset,
  parsePeriod,
  presetRange,
  type Period,
  type PeriodPreset,
} from '@/lib/overview/period'

export type FinancePreset = Extract<PeriodPreset, '7d' | '30d' | 'month' | 'last_month' | '90d' | 'fy'>

export const FINANCE_PRESETS: FinancePreset[] = ['7d', '30d', 'month', 'last_month', '90d', 'fy']

const isFinancePreset = (k: PeriodPreset | null): k is FinancePreset =>
  !!k && (FINANCE_PRESETS as PeriodPreset[]).includes(k)

type Params = { get(key: string): string | null }

/** Resolve the active preset from URL params. Returns 'custom' when the range doesn't match a preset. */
export function parsePresetFromUrl(sp: Params, fallback: FinancePreset = '30d'): FinancePreset | 'custom' {
  const range = rangeFromUrl(sp, fallback)
  const matched = matchPreset(range)
  return isFinancePreset(matched) ? matched : 'custom'
}

/** Resolve the active range from URL params, falling back to `defaultPreset` when ?from/?to are missing or invalid. */
export function rangeFromUrl(sp: Params, defaultPreset: FinancePreset = '30d'): Period {
  return parsePeriod(sp.get('from'), sp.get('to'), undefined, defaultPreset)
}

export type UseFinancePeriod = {
  preset: FinancePreset | 'custom'
  range: Period
  from: string
  to: string
  parsed: Period
  setPreset: (key: FinancePreset) => void
  setRange: (range: Period) => void
}

/** Shared ?from&to state across the whole /admin/financial page. Reads on first render and keeps
 * the URL in sync via a shallow `router.replace` (scroll:false). */
export function useFinancePeriod(defaultPreset: FinancePreset = '30d'): UseFinancePeriod {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const range = rangeFromUrl(sp, defaultPreset)
  const matched = matchPreset(range)
  const preset: FinancePreset | 'custom' = isFinancePreset(matched) ? matched : 'custom'

  const setRange = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(sp.toString())
      q.set('from', p.from)
      q.set('to', p.to)
      router.replace(`${pathname}?${q}`, { scroll: false })
    },
    [sp, router, pathname]
  )

  const setPreset = useCallback(
    (key: FinancePreset) => {
      setRange(presetRange(key))
    },
    [setRange]
  )

  return { preset, range, from: range.from, to: range.to, parsed: range, setPreset, setRange }
}
