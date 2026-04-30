'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import AdminSelect from './AdminSelect'

interface FilterOption {
  value: string
  label: string
  group?: string
  indent?: boolean
}

interface FilterConfig {
  name: string
  label: string
  options: FilterOption[]
}

interface AdminFiltersProps {
  filters: FilterConfig[]
  searchPlaceholder?: string
  searchParam?: string
}

export default function AdminFilters({ filters, searchPlaceholder, searchParam = 'search' }: AdminFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(name, value)
      } else {
        params.delete(name)
      }
      return params.toString()
    },
    [searchParams]
  )

  const handleFilterChange = (name: string, value: string) => {
    const qs = createQueryString(name, value)
    router.push(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const value = formData.get(searchParam) as string
    const qs = createQueryString(searchParam, value.trim())
    router.push(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  const hasActiveFilters = filters.some(f => searchParams.get(f.name)) || searchParams.get(searchParam)
  const activeCount = filters.filter(f => searchParams.get(f.name)).length + (searchParams.get(searchParam) ? 1 : 0)

  const handleClearAll = () => {
    router.push(pathname)
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 mb-6 sticky top-0 z-10">
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(o => !o)}
        className="sm:hidden w-full flex items-center justify-between text-sm font-medium text-foreground"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 010 2H4a1 1 0 01-1-1zm3 6a1 1 0 011-1h10a1 1 0 010 2H7a1 1 0 01-1-1zm4 6a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 rounded-full bg-accent-500 text-white text-xs font-semibold">
              {activeCount}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Filter fields — hidden on mobile when collapsed, always visible on sm+ */}
      <div className={`${mobileOpen ? 'mt-4' : 'hidden'} sm:block`}>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 sm:gap-4">
          {filters.map((filter) => (
            <div key={filter.name} className="w-full sm:flex-1 sm:min-w-[160px] sm:max-w-[220px]">
              <label
                htmlFor={`filter-${filter.name}`}
                className="block text-xs font-medium text-foreground-muted mb-1.5 uppercase tracking-wider"
              >
                {filter.label}
              </label>
              <AdminSelect
                id={`filter-${filter.name}`}
                value={searchParams.get(filter.name) || ''}
                placeholder="All"
                options={[
                  { value: '', label: 'All' },
                  ...filter.options,
                ]}
                onChange={(val) => handleFilterChange(filter.name, val)}
              />
            </div>
          ))}

          {searchPlaceholder && (
            <form onSubmit={handleSearchSubmit} className="w-full sm:flex-1 sm:min-w-[200px] sm:max-w-[300px]">
              <label
                htmlFor={`filter-${searchParam}`}
                className="block text-xs font-medium text-foreground-muted mb-1.5 uppercase tracking-wider"
              >
                Search
              </label>
              <div className="relative">
                <input
                  id={`filter-${searchParam}`}
                  type="text"
                  name={searchParam}
                  defaultValue={searchParams.get(searchParam) || ''}
                  placeholder={searchPlaceholder}
                  className="w-full px-3 py-2 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-accent-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
            </form>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="px-3 py-2 text-sm font-medium text-foreground-secondary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-border-secondary transition-colors whitespace-nowrap"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
