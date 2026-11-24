'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { portalRoot } from '@/lib/shared/portal-root'

interface DatePickerProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  min?: string
  max?: string
  className?: string
  placeholder?: string
  /** Replaces the trigger's default border/padding/background classes, to match the surrounding form. */
  triggerClassName?: string
  /** Shows Clear (sets '') and Today under the month grid. */
  clearable?: boolean
  'aria-label'?: string
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseDateVal(val: string): { year: number; month: number; day: number } | null {
  if (!val) return null
  const parts = val.split('-')
  if (parts.length !== 3) return null
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null
  return { year, month, day }
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function ymdOf(d: Date): string {
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** A YYYY-MM-DD date as the picker shows it ("26 Oct 2026"), so text beside a picker can match it. */
export function formatDisplay(val: string): string {
  const p = parseDateVal(val)
  if (!p) return ''
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month].slice(0, 3)} ${p.year}`
}

export default function DatePicker({
  value,
  onChange,
  disabled,
  min,
  max,
  className = '',
  placeholder = 'Select date',
  triggerClassName,
  clearable,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const parsed = parseDateVal(value)
  const today = new Date()

  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const [mode, setMode] = useState<'day' | 'month' | 'year'>('day')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null)
  // Keyboard: the day that holds focus in the grid (roving tabindex); set when the grid should take focus.
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const pullFocus = useRef(false)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(t) &&
        popupRef.current &&
        !popupRef.current.contains(t)
      ) {
        setOpen(false)
        setMode('day')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function reposition() {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const popupW = 256
      const popupH = clearable ? 360 : 320
      const margin = 8
      const vw = window.innerWidth
      const vh = window.innerHeight

      let left = rect.left
      if (left + popupW + margin > vw) left = Math.max(margin, vw - popupW - margin)

      let top = rect.bottom + 4
      if (top + popupH + margin > vh && rect.top - popupH - 4 > margin) {
        top = rect.top - popupH - 4
      }
      setPopupPos({ top, left })
    }
    // rAF ensures layout is settled (e.g. inside collapsible sections)
    const raf = requestAnimationFrame(reposition)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, clearable])

  const clamp = useCallback((ymd: string) => (min && ymd < min ? min : max && ymd > max ? max : ymd), [min, max])

  const openPicker = useCallback(() => {
    if (disabled) return
    const start = clamp(parseDateVal(value) ? value : ymdOf(new Date()))
    const p = parseDateVal(start)!
    setViewYear(p.year)
    setViewMonth(p.month)
    setFocusDay(start)
    pullFocus.current = true
    setMode('day')
    setOpen(true)
  }, [disabled, value, clamp])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setMode('day')
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Focus into the grid on open and on arrow keys, not when the month buttons are clicked.
  useEffect(() => {
    if (!open || !popupPos || mode !== 'day' || !pullFocus.current || !focusDay) return
    const el = popupRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)
    if (el) {
      el.focus()
      pullFocus.current = false
    }
  }, [open, popupPos, mode, focusDay, viewYear, viewMonth])

  // Tabbing out of the calendar closes it.
  useEffect(() => {
    if (!open) return
    function onFocusIn(e: FocusEvent) {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || popupRef.current?.contains(t)) return
      setOpen(false)
      setMode('day')
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open])

  function onDayKey(e: React.KeyboardEvent, day: number) {
    const cur = new Date(viewYear, viewMonth, day)
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    let next: Date
    if (e.key in step) next = addDays(cur, step[e.key])
    else if (e.key === 'Home') next = addDays(cur, -cur.getDay())
    else if (e.key === 'End') next = addDays(cur, 6 - cur.getDay())
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const m = viewMonth + (e.key === 'PageUp' ? -1 : 1)
      next = new Date(viewYear, m, Math.min(day, daysInMonth(viewYear, m)))
    } else return
    e.preventDefault()
    const ymd = clamp(ymdOf(next))
    const p = parseDateVal(ymd)!
    setViewYear(p.year)
    setViewMonth(p.month)
    setFocusDay(ymd)
    pullFocus.current = true
  }

  function selectDay(day: number) {
    const str = toDateStr(viewYear, viewMonth, day)
    if (min && str < min) return
    if (max && str > max) return
    onChange(str)
    close(true)
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(y => y - 1)
    } else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(y => y + 1)
    } else setViewMonth(m => m + 1)
  }

  function selectMonth(m: number) {
    setViewMonth(m)
    setMode('day')
  }

  function selectYear(y: number) {
    setViewYear(y)
    setMode('month')
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const totalDays = daysInMonth(viewYear, viewMonth)
  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const yearStart = Math.floor(viewYear / 12) * 12
  const years = Array.from({ length: 12 }, (_, i) => yearStart + i)

  function isDayDisabled(d: number): boolean {
    const str = toDateStr(viewYear, viewMonth, d)
    if (min && str < min) return true
    if (max && str > max) return true
    return false
  }

  const displayVal = formatDisplay(value)
  // The one day the Tab key reaches: the focused day, else the chosen one, else the first that can be picked.
  const inView = (ymd: string | null) => {
    const p = ymd ? parseDateVal(ymd) : null
    return !!p && p.year === viewYear && p.month === viewMonth && !isDayDisabled(p.day)
  }
  const firstOpen = cells.find(d => d && !isDayDisabled(d))
  const tabDay = inView(focusDay) ? focusDay : inView(value) ? value : firstOpen ? toDateStr(viewYear, viewMonth, firstOpen) : null

  return (
    <div ref={containerRef} className={`relative ${className.includes('w-full') ? 'block' : 'inline-flex align-top'} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : openPicker())}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-datepicker-trigger
        className={`w-full flex items-center justify-between text-left text-sm transition-colors ${
          triggerClassName ? `${triggerClassName} ${open ? 'ring-2 ring-accent-400' : ''}` :
          `h-control px-4 rounded-lg border bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400 ${
            open ? 'border-accent-500 ring-2 ring-accent-500 dark:ring-accent-400' : 'border-border-secondary hover:border-border-default'
          }`
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`whitespace-nowrap ${displayVal ? 'text-foreground' : 'text-foreground-muted'}`}>
          {displayVal || placeholder}
        </span>
        <svg
          className="w-4 h-4 text-foreground-muted shrink-0 ml-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
          />
        </svg>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        popupPos &&
        createPortal(
          <div
            ref={popupRef}
            style={{ position: 'fixed', top: popupPos.top, left: popupPos.left }}
            data-datepicker-popup
            role="dialog"
            aria-label={ariaLabel ?? 'Choose a date'}
            onKeyDown={e => {
              if (e.key !== 'Escape') return
              e.stopPropagation()
              close(true)
            }}
            className="z-[1000] w-64 bg-surface-elevated border border-border-default rounded-xl shadow-lg p-3 select-none"
          >
            {mode === 'day' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={prevMonth}
                    aria-label="Previous month"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('month')}
                    className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors"
                  >
                    {MONTHS[viewMonth]} {viewYear}
                  </button>
                  <button
                    type="button"
                    onClick={nextMonth}
                    aria-label="Next month"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-7 mb-1">
                  {DAYS.map(d => (
                    <div key={d} className="text-center text-xs font-medium text-foreground-muted py-1">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-y-0.5">
                  {cells.map((d, i) => {
                    if (!d) return <div key={i} />
                    const str = toDateStr(viewYear, viewMonth, d)
                    const isSelected = str === value
                    const isToday = str === toDateStr(today.getFullYear(), today.getMonth(), today.getDate())
                    const dis = isDayDisabled(d)
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={dis}
                        onClick={() => selectDay(d)}
                        onKeyDown={e => onDayKey(e, d)}
                        tabIndex={str === tabDay ? 0 : -1}
                        data-day={str}
                        aria-pressed={isSelected}
                        data-selected={isSelected || undefined}
                        data-today={isToday || undefined}
                        className={`w-8 h-8 mx-auto rounded-lg text-xs font-medium transition-colors ${
                          isSelected
                            ? 'bg-accent-500 text-white'
                            : isToday
                              ? 'border border-accent-500 text-accent-500 hover:bg-accent-50 dark:hover:bg-accent-900/20'
                              : dis
                                ? 'text-foreground-muted opacity-40 cursor-not-allowed'
                                : 'text-foreground hover:bg-surface-secondary'
                        }`}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
                {clearable && (
                  <div className="mt-2 flex items-center justify-between border-t border-border-default pt-2">
                    <button type="button" disabled={!value} onClick={() => { onChange(''); close(true) }}
                      className="px-2 py-1 rounded-lg text-xs font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40">
                      Clear
                    </button>
                    <button type="button" onClick={() => {
                      const t = toDateStr(today.getFullYear(), today.getMonth(), today.getDate())
                      if ((min && t < min) || (max && t > max)) return
                      onChange(t); close(true)
                    }} className="px-2 py-1 rounded-lg text-xs font-semibold text-foreground hover:bg-surface-secondary">
                      Today
                    </button>
                  </div>
                )}
              </>
            )}

            {mode === 'month' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={() => setViewYear(y => y - 1)}
                    aria-label="Previous year"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('year')}
                    className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors"
                  >
                    {viewYear}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewYear(y => y + 1)}
                    aria-label="Next year"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {MONTHS.map((name, m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectMonth(m)}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        m === viewMonth && viewYear === (parseDateVal(value)?.year ?? -1)
                          ? 'bg-accent-500 text-white'
                          : 'text-foreground hover:bg-surface-secondary'
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {mode === 'year' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={() => setViewYear(y => y - 12)}
                    aria-label="Earlier years"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-semibold text-foreground">
                    {yearStart}–{yearStart + 11}
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewYear(y => y + 12)}
                    aria-label="Later years"
                    className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {years.map(y => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => selectYear(y)}
                      className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        y === (parseDateVal(value)?.year ?? -1)
                          ? 'bg-accent-500 text-white'
                          : 'text-foreground hover:bg-surface-secondary'
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>,
          portalRoot()
        )}
    </div>
  )
}
