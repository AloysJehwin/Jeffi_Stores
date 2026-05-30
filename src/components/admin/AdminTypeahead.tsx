'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SuggestItem {
  id: string
  label: string
  sublabel?: string
  href?: string
}

interface AdminTypeaheadProps {
  type: string
  value: string
  onChange: (value: string) => void
  onSelect?: (item: SuggestItem) => void
  onEnter?: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  disabled?: boolean
  autoFocus?: boolean
}

function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>

  const words = trimmed.split(/\s+/).filter(Boolean)
  const pattern = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark key={i} className="bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 rounded-sm not-italic font-semibold">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export default function AdminTypeahead({
  type,
  value,
  onChange,
  onSelect,
  onEnter,
  placeholder,
  className = '',
  inputClassName = '',
  disabled = false,
  autoFocus = false,
}: AdminTypeaheadProps) {
  const [items, setItems] = useState<SuggestItem[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const typedValueRef = useRef(value)
  const skipFetchRef = useRef(false)

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false
      return
    }
    typedValueRef.current = value
    setActiveIdx(-1)
    if (value.trim().length < 2) {
      setItems([])
      setOpen(false)
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)
      try {
        const res = await fetch(
          `/api/admin/suggest?type=${encodeURIComponent(type)}&q=${encodeURIComponent(value)}`,
          { signal: abortRef.current.signal, credentials: 'include' }
        )
        if (res.ok) {
          const data = await res.json()
          const newItems = data.items || []
          if (newItems.length > 0 && containerRef.current) {
            const r = containerRef.current.getBoundingClientRect()
            setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width })
          }
          setItems(newItems)
          setOpen(newItems.length > 0)
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setItems([])
          setOpen(false)
        }
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [value, type])

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  const selectItem = useCallback((item: SuggestItem) => {
    onSelect?.(item)
    setOpen(false)
    setItems([])
  }, [onSelect])

  function previewItem(idx: number) {
    skipFetchRef.current = true
    if (idx < 0) {
      onChange(typedValueRef.current)
    } else {
      onChange(items[idx].label)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      skipFetchRef.current = true
      onChange(typedValueRef.current)
      setOpen(false)
      return
    }
    if (!open) {
      if (e.key === 'Enter') { e.preventDefault(); onEnter?.(value); return }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => {
        const next = Math.min(i + 1, items.length - 1)
        previewItem(next)
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => {
        const next = Math.max(i - 1, -1)
        previewItem(next)
        return next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0) {
        selectItem(items[activeIdx])
      } else {
        setOpen(false)
        onEnter?.(value)
      }
    }
  }

  const defaultInputCls = 'w-full px-3 py-2 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted'

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (items.length > 0 && containerRef.current) {
              const r = containerRef.current.getBoundingClientRect()
              setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width })
              setOpen(true)
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className={inputClassName || defaultInputCls}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none">
          {loading ? (
            <span className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin block" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </span>
      </div>

      {open && items.length > 0 && dropdownPos && (
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 99999,
          }}
          className="bg-surface-elevated rounded-lg shadow-xl border border-border-default overflow-hidden max-h-64 overflow-y-auto"
        >
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); selectItem(item) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${activeIdx === idx ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-medium truncate">
                  <Highlight text={item.label} query={value} />
                </p>
                {item.sublabel && (
                  <p className="text-xs text-foreground-muted truncate mt-0.5">{item.sublabel}</p>
                )}
              </div>
              <svg className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
