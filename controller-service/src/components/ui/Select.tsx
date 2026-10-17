'use client'

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { portalRoot } from '@/lib/shared/portal-root'

// Shared Select / MultiSelect — trigger matches DatePicker (same height, border, radius, focus
// ring, dark tokens) and the popup portals through the same root so themed scopes style it.

export interface Option<T extends string | number> {
  value: T
  label: string
  disabled?: boolean
  hint?: string
}

interface BaseProps {
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
}

export interface SelectProps<T extends string | number> extends BaseProps {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
}

export interface MultiSelectProps<T extends string | number> extends BaseProps {
  value: T[]
  onChange: (v: T[]) => void
  options: Option<T>[]
}

const SIZE_CLS = {
  sm: 'h-control px-3 text-sm',
  md: 'h-control px-4 text-sm',
} as const

function defaultTriggerCls(open: boolean, disabled: boolean | undefined, size: 'sm' | 'md') {
  return `w-full flex items-center justify-between text-left transition-colors ${SIZE_CLS[size]} rounded-lg border bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400 ${
    open ? 'border-accent-500 ring-2 ring-accent-500 dark:ring-accent-400' : 'border-border-secondary hover:border-border-default'
  } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-foreground-muted shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function usePopup(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, popupRef: React.RefObject<HTMLElement | null>, close: () => void) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; dropUp: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current && !triggerRef.current.contains(t) && popupRef.current && !popupRef.current.contains(t)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, triggerRef, popupRef, close])

  useLayoutEffect(() => {
    if (!open) return
    function reposition() {
      const trig = triggerRef.current
      if (!trig) return
      const rect = trig.getBoundingClientRect()
      const h = popupRef.current?.offsetHeight ?? 240
      const margin = 8
      const vh = window.innerHeight
      const vw = window.innerWidth
      const spaceBelow = vh - rect.bottom
      const dropUp = spaceBelow < h + margin && rect.top > h + margin
      const left = Math.max(margin, Math.min(rect.left, vw - rect.width - margin))
      const top = dropUp ? rect.top - h - 4 : rect.bottom + 4
      setPos({ top, left, width: rect.width, dropUp })
    }
    const raf = requestAnimationFrame(reposition)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, triggerRef, popupRef])

  return pos
}

// Type-to-search: a short buffer that resets after 500ms.
function useTypeahead(options: { label: string; disabled?: boolean }[], onPick: (idx: number) => void) {
  const bufRef = useRef('')
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback(
    (key: string) => {
      if (key.length !== 1) return false
      bufRef.current += key.toLowerCase()
      if (tRef.current) clearTimeout(tRef.current)
      tRef.current = setTimeout(() => (bufRef.current = ''), 500)
      const idx = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(bufRef.current))
      if (idx >= 0) {
        onPick(idx)
        return true
      }
      return false
    },
    [options, onPick]
  )
}

export default function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  className = '',
  triggerClassName,
  size = 'md',
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const pos = usePopup(open, triggerRef, popupRef, close)

  const openList = useCallback(
    (fromKey = false) => {
      if (disabled) return
      const idx = options.findIndex(o => o.value === value)
      setHighlight(fromKey ? Math.max(idx, 0) : idx)
      setOpen(true)
    },
    [disabled, options, value]
  )

  function pick(idx: number) {
    const opt = options[idx]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
  }

  const typeahead = useTypeahead(options, setHighlight)

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open && highlight >= 0) pick(highlight)
      else openList(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return openList(true)
      let i = highlight
      do i = Math.min(i + 1, options.length - 1)
      while (options[i]?.disabled && i < options.length - 1)
      setHighlight(i)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openList(true)
      let i = highlight
      do i = Math.max(i - 1, 0)
      while (options[i]?.disabled && i > 0)
      setHighlight(i)
    } else if (e.key === 'Home') {
      if (open) {
        e.preventDefault()
        setHighlight(options.findIndex(o => !o.disabled))
      }
    } else if (e.key === 'End') {
      if (open) {
        e.preventDefault()
        for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setHighlight(i); break }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (open && typeahead(e.key)) {
      e.preventDefault()
    }
  }

  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, highlight])

  const selected = options.find(o => o.value === value)

  return (
    <div className={`relative ${className.includes('w-full') ? 'block' : 'inline-flex align-top'} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className={triggerClassName ? `${triggerClassName} ${open ? 'ring-2 ring-accent-500 dark:ring-accent-400' : ''}` : defaultTriggerCls(open, disabled, size)}
      >
        <span className={`truncate min-w-0 ${selected ? 'text-foreground' : 'text-foreground-muted'}`}>{selected?.label || placeholder}</span>
        <Chevron open={open} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        pos &&
        createPortal(
          <div
            ref={popupRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
            className="z-[9999] bg-surface-elevated border border-border-default rounded-xl shadow-lg overflow-hidden"
          >
            <ul ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-[280px] overflow-y-auto py-1">
              {options.map((opt, i) => {
                const sel = opt.value === value
                return (
                  <li
                    key={`${String(opt.value)}-${i}`}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={opt.disabled || undefined}
                    data-highlighted={highlight === i || undefined}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(i)}
                    className={`px-4 py-2 text-sm flex items-start justify-between gap-2 ${
                      opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${highlight === i && !opt.disabled ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300' : 'text-foreground-secondary'} ${
                      sel ? 'font-semibold text-accent-600 dark:text-accent-400' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{opt.label}</span>
                      {opt.hint && <span className="block text-[10px] text-foreground-muted truncate">{opt.hint}</span>}
                    </span>
                    {sel && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>,
          portalRoot()
        )}
    </div>
  )
}

export function MultiSelect<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  className = '',
  triggerClassName,
  size = 'md',
  'aria-label': ariaLabel,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const pos = usePopup(open, triggerRef, popupRef, close)

  function toggle(idx: number) {
    const opt = options[idx]
    if (!opt || opt.disabled) return
    const has = value.includes(opt.value)
    onChange(has ? value.filter(v => v !== opt.value) : [...value, opt.value])
  }

  const typeahead = useTypeahead(options, setHighlight)

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open && highlight >= 0) toggle(highlight)
      else {
        setOpen(true)
        setHighlight(0)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setHighlight(0); return }
      let i = highlight
      do i = Math.min(i + 1, options.length - 1)
      while (options[i]?.disabled && i < options.length - 1)
      setHighlight(i)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setHighlight(0); return }
      let i = highlight
      do i = Math.max(i - 1, 0)
      while (options[i]?.disabled && i > 0)
      setHighlight(i)
    } else if (e.key === 'Home') {
      if (open) {
        e.preventDefault()
        setHighlight(options.findIndex(o => !o.disabled))
      }
    } else if (e.key === 'End') {
      if (open) {
        e.preventDefault()
        for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setHighlight(i); break }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (open && typeahead(e.key)) {
      e.preventDefault()
    }
  }

  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, highlight])

  const selected = value.map(v => options.find(o => o.value === v)).filter((o): o is Option<T> => !!o)

  return (
    <div className={`relative ${className.includes('w-full') ? 'block' : 'inline-flex align-top'} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        onKeyDown={onKey}
        className={triggerClassName ? `${triggerClassName} ${open ? 'ring-2 ring-accent-500 dark:ring-accent-400' : ''}` : defaultTriggerCls(open, disabled, size)}
      >
        <span className="flex-1 min-w-0 flex flex-wrap gap-1 items-center">
          {selected.length === 0 && <span className="text-foreground-muted truncate">{placeholder}</span>}
          {selected.map(opt => (
            <span
              key={String(opt.value)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300 text-xs"
            >
              {opt.label}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${opt.label}`}
                onClick={e => {
                  e.stopPropagation()
                  if (disabled) return
                  onChange(value.filter(v => v !== opt.value))
                }}
                className="hover:text-accent-900 dark:hover:text-white cursor-pointer"
              >
                ×
              </span>
            </span>
          ))}
        </span>
        <Chevron open={open} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        pos &&
        createPortal(
          <div
            ref={popupRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
            className="z-[9999] bg-surface-elevated border border-border-default rounded-xl shadow-lg overflow-hidden"
          >
            <ul ref={listRef} role="listbox" aria-label={ariaLabel} aria-multiselectable className="max-h-[280px] overflow-y-auto py-1">
              {options.map((opt, i) => {
                const sel = value.includes(opt.value)
                return (
                  <li
                    key={`${String(opt.value)}-${i}`}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={opt.disabled || undefined}
                    data-highlighted={highlight === i || undefined}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => toggle(i)}
                    className={`px-4 py-2 text-sm flex items-start gap-2 ${
                      opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${highlight === i && !opt.disabled ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        sel ? 'bg-accent-500 border-accent-500 text-white' : 'border-border-default bg-surface'
                      }`}
                      aria-hidden
                    >
                      {sel && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3 h-3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${sel ? 'font-medium text-foreground' : 'text-foreground-secondary'}`}>{opt.label}</span>
                      {opt.hint && <span className="block text-[10px] text-foreground-muted truncate">{opt.hint}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>,
          portalRoot()
        )}
    </div>
  )
}
