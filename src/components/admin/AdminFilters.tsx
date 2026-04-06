'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import AdminSelect from './AdminSelect'

interface FilterOption {
  value: string
  label: string
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

  const handleClearAll = () => {
    router.push(pathname)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex flex-wrap items-end gap-4">
        {/* Dropdown Filters */}
        {filters.map((filter) => (
          <div key={filter.name} className="flex-1 min-w-[160px] max-w-[220px]">
            <label
              htmlFor={`filter-${filter.name}`}
              className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider"
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

        {/* Search Input */}
        {searchPlaceholder && (
          <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px] max-w-[300px]">
            <label
              htmlFor={`filter-${searchParam}`}
              className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider"
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
                className="w-full px-3 py-2 pr-9 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-gray-400 placeholder:text-gray-400"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-accent-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </form>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg border border-gray-300 transition-colors whitespace-nowrap"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  )
}
