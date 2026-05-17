'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type SortDir = 'asc' | 'desc'

interface SortOption {
  value: string
  label: string
}

interface SortableHeaderProps {
  label: string
  column: string
  options?: SortOption[]
  currentSort?: string
  currentDir?: SortDir
  onSort?: (col: string, dir: SortDir) => void
  className?: string
  align?: 'left' | 'right'
}

const DEFAULT_OPTIONS: SortOption[] = [
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
]

const NUMERIC_OPTIONS: SortOption[] = [
  { value: 'asc', label: 'Low → High' },
  { value: 'desc', label: 'High → Low' },
]

const DATE_OPTIONS: SortOption[] = [
  { value: 'desc', label: 'Newest first' },
  { value: 'asc', label: 'Oldest first' },
]

export function sortOptions(type: 'text' | 'number' | 'date'): SortOption[] {
  if (type === 'number') return NUMERIC_OPTIONS
  if (type === 'date') return DATE_OPTIONS
  return DEFAULT_OPTIONS
}

export default function SortableHeader({
  label,
  column,
  options = DEFAULT_OPTIONS,
  currentSort,
  currentDir,
  onSort,
  className = '',
  align = 'left',
}: SortableHeaderProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLTableCellElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isActive = currentSort === column
  const activeDir = isActive ? currentDir : undefined

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function handleSelect(dir: SortDir) {
    setOpen(false)
    if (onSort) {
      onSort(column, dir)
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', column)
    params.set('dir', dir)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <th ref={ref} className={`relative px-6 py-3 text-xs font-medium text-foreground-muted uppercase tracking-wider ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 group hover:text-foreground transition-colors ${isActive ? 'text-secondary-600 dark:text-secondary-400' : ''}`}
      >
        <span>{label}</span>
        <span className={`transition-colors ${isActive ? 'text-secondary-500 dark:text-secondary-400' : 'text-foreground-muted group-hover:text-foreground-secondary'}`}>
          {isActive && activeDir === 'asc' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          ) : isActive && activeDir === 'desc' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          )}
        </span>
      </button>

      {open && (
        <div className={`absolute top-full mt-1 z-30 bg-surface-elevated border border-border-default rounded-lg shadow-lg overflow-hidden min-w-[140px] ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value as SortDir)}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2 ${
                isActive && activeDir === opt.value
                  ? 'bg-secondary-50 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-300'
                  : 'text-foreground hover:bg-surface-secondary'
              }`}
            >
              {isActive && activeDir === opt.value && (
                <svg className="w-3 h-3 shrink-0 text-secondary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!(isActive && activeDir === opt.value) && <span className="w-3 shrink-0" />}
              {opt.label}
            </button>
          ))}
          {isActive && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                if (onSort) {
                  onSort('', 'asc')
                  return
                }
                const params = new URLSearchParams(searchParams.toString())
                params.delete('sort')
                params.delete('dir')
                params.delete('page')
                router.push(`${pathname}?${params.toString()}`)
              }}
              className="w-full text-left px-3 py-2 text-xs text-foreground-muted hover:bg-surface-secondary border-t border-border-default transition-colors"
            >
              Clear sort
            </button>
          )}
        </div>
      )}
    </th>
  )
}
