'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

// URL-param filter bar for the ecom list pages. Status + plan dropdowns + a debounced
// search box. Writes to the query string; server pages read searchParams and filter.
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

  const sel = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6 grid grid-cols-1 sm:grid-cols-[auto_auto_1fr] gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Status</label>
        <select className={sel} value={params.get('status') || ''} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="provisioning">Provisioning</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>
      {showPlan && (
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Plan</label>
          <select className={sel} value={params.get('plan') || ''} onChange={(e) => setParam('plan', e.target.value)}>
            <option value="">All</option>
            <option value="basic">Basic</option>
            <option value="growth">Growth</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Search</label>
        <input className={`${sel} w-full`} placeholder="Search store name or subdomain…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
    </div>
  )
}
