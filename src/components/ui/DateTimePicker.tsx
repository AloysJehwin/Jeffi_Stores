'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface DateTimePickerProps {
  value: string
  onChange: (val: string) => void
  name?: string
  disabled?: boolean
  min?: string
  max?: string
  className?: string
  placeholder?: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseDT(val: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  if (!val) return null
  const [datePart, timePart = '00:00'] = val.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, min] = timePart.split(':').map(Number)
  if ([y, m, d, h, min].some(isNaN)) return null
  return { year: y, month: m - 1, day: d, hour: h, minute: min }
}

function toDTStr(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function fmtDisplay(val: string): string {
  const p = parseDT(val)
  if (!p) return ''
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month].slice(0, 3)} ${p.year}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i)
const MINUTE_OPTIONS = [0, 15, 30, 45]

export default function DateTimePicker({
  value,
  onChange,
  name,
  disabled,
  min,
  max,
  className = '',
  placeholder = 'Select date & time',
}: DateTimePickerProps) {
  const parsed = parseDT(value)
  const today = new Date()

  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const [selDate, setSelDate] = useState<{ year: number; month: number; day: number } | null>(
    parsed ? { year: parsed.year, month: parsed.month, day: parsed.day } : null
  )
  const [selHour, setSelHour] = useState(parsed?.hour ?? 0)
  const [selMinute, setSelMinute] = useState(parsed?.minute ?? 0)
  const [mode, setMode] = useState<'day' | 'month' | 'year' | 'time'>('day')
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setMode('day')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openPicker = useCallback(() => {
    if (disabled) return
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropUp(rect.bottom + 360 > window.innerHeight && rect.top > 360)
    }
    const p = parseDT(value)
    if (p) {
      setViewYear(p.year); setViewMonth(p.month)
      setSelDate({ year: p.year, month: p.month, day: p.day })
      setSelHour(p.hour); setSelMinute(p.minute)
    }
    setMode('day')
    setOpen(true)
  }, [disabled, value])

  function selectDay(day: number) {
    const d = { year: viewYear, month: viewMonth, day }
    setSelDate(d)
    setMode('time')
  }

  function confirmTime() {
    if (!selDate) return
    const str = toDTStr(selDate.year, selDate.month, selDate.day, selHour, selMinute)
    onChange(str)
    setOpen(false)
    setMode('day')
  }

  function clearValue() {
    onChange('')
    setSelDate(null)
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

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const totalDays = daysInMonth(viewYear, viewMonth)
  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const yearStart = Math.floor(viewYear / 12) * 12
  const years = Array.from({ length: 12 }, (_, i) => yearStart + i)

  function isDayDisabled(day: number): boolean {
    const str = toDateStr(viewYear, viewMonth, day)
    if (min && str < min.slice(0, 10)) return true
    if (max && str > max.slice(0, 10)) return true
    return false
  }

  const displayVal = fmtDisplay(value)

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}

      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-surface-secondary text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400 ${
          open
            ? 'border-accent-500 ring-2 ring-accent-500 dark:ring-accent-400'
            : 'border-border-default hover:border-border-secondary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={displayVal ? 'text-foreground' : 'text-foreground-muted'}>
          {displayVal || placeholder}
        </span>
        <svg className="w-4 h-4 text-foreground-muted shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
        </svg>
      </button>

      {open && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 z-50 w-72 bg-surface-elevated border border-border-default rounded-xl shadow-lg p-3 select-none`}>

          {mode === 'day' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button type="button" onClick={() => setMode('month')} className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors">
                  {MONTHS[viewMonth]} {viewYear}
                </button>
                <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => <div key={d} className="text-center text-xs font-medium text-foreground-muted py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((d, i) => {
                  if (!d) return <div key={i} />
                  const str = toDateStr(viewYear, viewMonth, d)
                  const isSelected = selDate && str === toDateStr(selDate.year, selDate.month, selDate.day)
                  const isToday = str === toDateStr(today.getFullYear(), today.getMonth(), today.getDate())
                  const dis = isDayDisabled(d)
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={dis}
                      onClick={() => selectDay(d)}
                      className={`w-8 h-8 mx-auto rounded-lg text-xs font-medium transition-colors ${
                        isSelected ? 'bg-accent-500 text-white'
                        : isToday ? 'border border-accent-500 text-accent-500 hover:bg-accent-50 dark:hover:bg-accent-900/20'
                        : dis ? 'text-foreground-muted opacity-40 cursor-not-allowed'
                        : 'text-foreground hover:bg-surface-secondary'
                      }`}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
              {value && (
                <div className="mt-2 pt-2 border-t border-border-default text-right">
                  <button type="button" onClick={clearValue} className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors">Clear</button>
                </div>
              )}
            </>
          )}

          {mode === 'month' && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button type="button" onClick={() => setMode('year')} className="text-sm font-semibold text-foreground hover:text-accent-500 transition-colors">{viewYear}</button>
                <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTHS.map((name, m) => (
                  <button key={m} type="button" onClick={() => { setViewMonth(m); setMode('day') }}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      m === viewMonth ? 'bg-accent-500 text-white' : 'text-foreground hover:bg-surface-secondary'
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
                  <button key={y} type="button" onClick={() => { setViewYear(y); setMode('month') }}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      y === (parseDT(value)?.year ?? -1) ? 'bg-accent-500 text-white' : 'text-foreground hover:bg-surface-secondary'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'time' && selDate && (
            <>
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">
                {String(selDate.day).padStart(2, '0')} {MONTHS[selDate.month].slice(0, 3)} {selDate.year}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-xs text-foreground-muted mb-1.5">Hour</p>
                  <div className="h-40 overflow-y-auto rounded-lg border border-border-default bg-surface-secondary p-1 space-y-0.5 scrollbar-thin">
                    {HOUR_OPTIONS.map(h => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setSelHour(h)}
                        className={`w-full text-center py-1 rounded-md text-sm font-medium transition-colors ${
                          selHour === h ? 'bg-accent-500 text-white' : 'text-foreground hover:bg-surface-elevated'
                        }`}
                      >
                        {String(h).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted mb-1.5">Minute</p>
                  <div className="rounded-lg border border-border-default bg-surface-secondary p-1 space-y-0.5">
                    {MINUTE_OPTIONS.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSelMinute(m)}
                        className={`w-full text-center py-1.5 rounded-md text-sm font-medium transition-colors ${
                          selMinute === m ? 'bg-accent-500 text-white' : 'text-foreground hover:bg-surface-elevated'
                        }`}
                      >
                        :{String(m).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setMode('day')} className="flex-1 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors">
                  ← Back
                </button>
                <button type="button" onClick={confirmTime} className="flex-1 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors">
                  Confirm
                </button>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  )
}
