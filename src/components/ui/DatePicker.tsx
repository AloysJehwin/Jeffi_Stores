'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DatePickerProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  min?: string
  max?: string
  className?: string
  placeholder?: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
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

function formatDisplay(val: string): string {
  const p = parseDateVal(val)
  if (!p) return ''
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month].slice(0, 3)} ${p.year}`
}

export default function DatePicker({ value, onChange, disabled, min, max, className = '', placeholder = 'Select date' }: DatePickerProps) {
  const parsed = parseDateVal(value)
  const today = new Date()

  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const [mode, setMode] = useState<'day' | 'month' | 'year'>('day')
  const containerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(t) &&
        popupRef.current   && !popupRef.current.contains(t)
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
      const popupH = 320
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
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const openPicker = useCallback(() => {
    if (disabled) return
    const p = parseDateVal(value)
    if (p) { setViewYear(p.year); setViewMonth(p.month) }
    setMode('day')
    setOpen(true)
  }, [disabled, value])

  function selectDay(day: number) {
    const str = toDateStr(viewYear, viewMonth, day)
    if (min && str < min) return
    if (max && str > max) return
    onChange(str)
    setOpen(false)
    setMode('day')
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
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

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg border bg-surface-secondary text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400 ${
          open
            ? 'border-accent-500 ring-2 ring-accent-500 dark:ring-accent-400'
            : 'border-border-default hover:border-border-secondary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} text-${displayVal ? 'foreground' : 'foreground-muted'}`}
      >
        <span className={`whitespace-nowrap ${displayVal ? 'text-foreground' : 'text-foreground-muted'}`}>
          {displayVal || placeholder}
        </span>
        <svg className="w-4 h-4 text-foreground-muted shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
        </svg>
      </button>

      {open && typeof document !== 'undefined' && popupPos && createPortal(
        <div
          ref={popupRef}
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left }}
          className="z-[1000] w-64 bg-surface-elevated border border-border-default rounded-xl shadow-lg p-3 select-none"
        >

          {mode === 'day' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('month')}
                  className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors"
                >
                  {MONTHS[viewMonth]} {viewYear}
                </button>
                <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-xs font-medium text-foreground-muted py-1">{d}</div>
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
            </>
          )}

          {mode === 'month' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('year')}
                  className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors"
                >
                  {viewYear}
                </button>
                <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
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
                <button type="button" onClick={() => setViewYear(y => y - 12)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <span className="text-sm font-semibold text-foreground">{yearStart}–{yearStart + 11}</span>
                <button type="button" onClick={() => setViewYear(y => y + 12)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
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
        document.body
      )}
    </div>
  )
}
