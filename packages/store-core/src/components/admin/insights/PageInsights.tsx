'use client'

import { useState } from 'react'
import { api } from '../kit/core'
import type { InsightsQuery, InsightsSeries } from '@/lib/insights/series'
import { InsightsButton, type InsightsButtonProps } from './InsightsButton'
import { InsightsDrawer, type InsightsConfig } from './InsightsDrawer'

const withQuery = (base: string, q: InsightsQuery) => `${base}${base.includes('?') ? '&' : '?'}weeks=${q.weeks}${q.filter != null ? `&filter=${encodeURIComponent(q.filter)}` : ''}`

/** A `load` for InsightsConfig that GETs the route (a base url gets `?weeks=&filter=`) and reads `{ series }`; null on any failure. */
export function insightsLoader<E = unknown>(url: string | ((q: InsightsQuery) => string)): (q: InsightsQuery) => Promise<InsightsSeries<E> | null> {
  return async q => {
    try {
      const r = await api<{ series?: InsightsSeries<E> }>(typeof url === 'string' ? withQuery(url, q) : url(q))
      return r.ok ? r.data.series ?? null : null
    } catch {
      return null
    }
  }
}

export interface PageInsightsProps<E = unknown> {
  config: InsightsConfig<E>
  subtitle?: string
  button?: Omit<InsightsButtonProps, 'onClick' | 'expanded'>
}

/** The insights button and its drawer; the series loads on first open. Drop it into an Overview's PeriodBar `actions`. */
export function PageInsights<E = unknown>({ config, subtitle, button }: PageInsightsProps<E>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <InsightsButton {...button} expanded={open} onClick={() => setOpen(true)} />
      <InsightsDrawer<E> {...config} subtitle={subtitle} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
