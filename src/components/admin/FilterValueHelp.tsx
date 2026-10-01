'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search } from 'lucide-react'
import { joinFilterValues, splitFilterValues } from '@/lib/catalog/product-attribute-filters-shared'

interface ValueRow {
  value: string
  count: number
}

interface Props {
  field: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multi?: boolean
  endpoint?: string
}

export default function FilterValueHelp({
  field,
  label,
  value,
  onChange,
  placeholder,
  multi = true,
  endpoint = '/api/admin/products/attribute-values',
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ValueRow[]>([])
  const [loading, setLoading] = useState(false)
  const selected = splitFilterValues(value)
  const searchRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchValues = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const res = await fetch(`${endpoint}?field=${encodeURIComponent(field)}&search=${encodeURIComponent(q)}`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          setRows(data.values || [])
        }
      } finally {
        setLoading(false)
      }
    },
    [field, endpoint]
  )

  useEffect(() => {
    if (!open) return
    fetchValues('')
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, fetchValues])

  useEffect(() => {
    if (!open) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetchValues(search), 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [search, open, fetchValues])

  function toggle(v: string) {
    if (!multi) {
      onChange(v === value ? '' : v)
      setOpen(false)
      return
    }
    const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]
    onChange(joinFilterValues(next))
  }

  function removeTag(v: string) {
    onChange(joinFilterValues(selected.filter(s => s !== v)))
  }

  return (
    <>
      {/* Input with browse icon */}
      <div className="relative">
        <div
          className={`w-full min-h-[34px] flex items-center flex-wrap gap-1 px-2 py-1 text-sm border rounded-lg bg-surface cursor-text transition-colors
            ${selected.length > 0 ? 'border-accent-400' : 'border-border-secondary hover:border-border-default'}`}
          onClick={() => setOpen(true)}
        >
          {selected.length === 0 && (
            <span className="text-foreground-muted text-sm px-1">{placeholder || `Any ${label}`}</span>
          )}
          {selected.map(v => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded"
            >
              {v}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  removeTag(v)
                }}
                className="hover:text-accent-900"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
        {/* Browse icon */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
          title={`Browse ${label} values`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="8" y="3" width="13" height="13" rx="1" />
            <path d="M3 8h5M3 12h5M3 16h5M3 20h13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Value Help Popup */}
      {open && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface-elevated rounded-xl border border-border-default shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
              <div>
                <h2 className="text-base font-semibold text-foreground">Select {label}</h2>
                {multi && selected.length > 0 && (
                  <p className="text-xs text-foreground-muted mt-0.5">{selected.length} selected</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-foreground-muted hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-border-default">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${label}…`}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 placeholder:text-foreground-muted"
                />
              </div>
            </div>

            {/* Selected chips */}
            {multi && selected.length > 0 && (
              <div className="px-5 py-2 border-b border-border-default flex flex-wrap gap-1.5">
                {selected.map(v => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 rounded-full"
                  >
                    {v}
                    <button type="button" onClick={() => removeTag(v)}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="text-xs text-foreground-muted hover:text-foreground underline"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Results table */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-12">No values found</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary sticky top-0">
                    <tr>
                      {multi && <th className="w-10 px-4 py-2.5" />}
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                        Value
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                        Products
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {rows.map(r => {
                      const isSelected = selected.includes(r.value)
                      return (
                        <tr
                          key={r.value}
                          className={`cursor-pointer transition-colors hover:bg-surface-secondary/60 ${isSelected ? 'bg-accent-50 dark:bg-accent-900/10' : ''}`}
                          onClick={() => toggle(r.value)}
                        >
                          {multi && (
                            <td className="px-4 py-2.5">
                              <span
                                className={`w-4 h-4 rounded border flex items-center justify-center
                                ${isSelected ? 'bg-accent-500 border-accent-500' : 'border-border-secondary'}`}
                              >
                                {isSelected && (
                                  <svg
                                    className="w-2.5 h-2.5 text-white"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                            </td>
                          )}
                          <td
                            className={`px-4 py-2.5 font-medium ${isSelected ? 'text-accent-600 dark:text-accent-400' : 'text-foreground'}`}
                          >
                            {r.value}
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground-muted tabular-nums">{r.count}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-default bg-surface-secondary rounded-b-xl">
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-4 py-2 text-sm text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-6 py-2 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors"
              >
                {multi ? `Apply (${selected.length} selected)` : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
