'use client'

import { useState } from 'react'
import type { AnalyticsData } from './analytics'

/** Server-rendered analytics for the first range; refetches when the range changes. */
export function useProductAnalytics(productId: string, initial: AnalyticsData) {
  const [data, setData] = useState<AnalyticsData>(initial)
  const [days, setDays] = useState(initial.days)
  const [loading, setLoading] = useState(false)

  async function changeRange(d: number) {
    setLoading(true)
    setDays(d)
    try {
      const res = await fetch(`/api/admin/products/${productId}/analytics?days=${d}`, { credentials: 'include' })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  return { data, days, loading, changeRange }
}
