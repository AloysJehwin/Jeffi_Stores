'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'

// URL-param filter bar for the ecom list pages. Status + plan (AdminSelect dropdowns)
// + a debounced search box. Writes to the query string; server pages read searchParams.
export default function EcomFilters({ showPlan = true }: { showPlan?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`${pathname}?${next.toString()}`)
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') || '') !== q) setParam('q', q)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const STATUS_OPTS = [
    { value: '', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'provisioning', label: 'Provisioning' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'terminated', label: 'Terminated' },
  ]
  const PLAN_OPTS = [
    { value: '', label: 'All plans' },
    { value: 'basic', label: 'Basic' },
    { value: 'growth', label: 'Growth' },
    { value: 'pro', label: 'Pro' },
    { value: 'enterprise', label: 'Enterprise' },
  ]

  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4 mb-6 grid grid-cols-1 sm:grid-cols-[minmax(0,200px)_minmax(0,200px)_1fr] gap-3 items-end">
      <AdminSelect
        label="Status"
        value={params.get('status') || ''}
        options={STATUS_OPTS}
        onChange={(v) => setParam('status', v)}
        sm
      />
      {showPlan && (
        <AdminSelect
          label="Plan"
          value={params.get('plan') || ''}
          options={PLAN_OPTS}
          onChange={(v) => setParam('plan', v)}
          sm
        />
      )}
      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1 uppercase tracking-wide">Search</label>
        <input
          className="w-full rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          placeholder="Search store name or subdomain…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
    </div>
  )
}
