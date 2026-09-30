'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import FilterValueHelp from './FilterValueHelp'
import AdminSelect from './AdminSelect'
import { splitFilterValues, type AdvancedFilterField } from '@/lib/catalog/product-attribute-filters-shared'

interface Props {
  fields: AdvancedFilterField[]
  paramNames?: string[]
  mode?: 'trigger' | 'content' | 'both'
  forceExpanded?: boolean
  valuesEndpoint?: string
}

function fieldParamNames(f: AdvancedFilterField): string[] {
  return Array.isArray(f.name) ? f.name : [f.name]
}

function chipLabel(f: AdvancedFilterField, params: URLSearchParams): string {
  const name = Array.isArray(f.name) ? f.name[0] : f.name
  if (f.type === 'range') {
    const [min, max] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
    const mn = params.get(min)
    const mx = params.get(max)
    const u = f.unit || ''
    if (mn && mx) return `${f.label}: ${u}${mn}–${u}${mx}`
    if (mn) return `${f.label}: ≥${u}${mn}`
    if (mx) return `${f.label}: ≤${u}${mx}`
  }
  if (f.type === 'date-range') {
    const [from, to] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
    const df = params.get(from)
    const dt = params.get(to)
    if (df && dt) return `${f.label}: ${df}–${dt}`
    if (df) return `${f.label}: from ${df}`
    if (dt) return `${f.label}: to ${dt}`
  }
  if (f.type === 'boolean') return `${f.label}: Yes`
  if (f.type === 'toggle' || f.type === 'select' || f.type === 'multi-select') {
    const val = params.get(name) || ''
    const opt = f.options?.find(o => o.value === val)
    return `${f.label}: ${opt?.label || val}`
  }
  if (f.type === 'value-help') {
    const vals = splitFilterValues(params.get(name))
    return `${f.label}: ${vals.join(', ')}`
  }
  return `${f.label}: ${params.get(name)}`
}

function fieldIsActive(f: AdvancedFilterField, params: URLSearchParams): boolean {
  return fieldParamNames(f).some(n => !!params.get(n))
}

function FilterSection({
  title,
  activeCount,
  children,
}: {
  title: string
  activeCount: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isOpen = open || activeCount > 0
  return (
    <div className="border border-border-default rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-surface-secondary hover:bg-surface-secondary/80 transition-colors rounded-t-lg ${!isOpen ? 'rounded-b-lg' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{title}</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent-500 text-white rounded-full leading-none">
              {activeCount}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">{children}</div>
      )}
    </div>
  )
}

function MultiSelectField({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const selected = value ? value.split(',').filter(Boolean) : []
  const [isOpen, setIsOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    function onDown(e: MouseEvent) {
      if (
        !(e.target as Element).closest('[data-msf-dropdown]') &&
        !(e.target as Element).closest(`[data-msf-btn="${name}"]`)
      )
        setIsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [isOpen, name])

  function open() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: r.width })
    setIsOpen(o => !o)
  }

  function toggle(val: string) {
    const next = selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val]
    onChange(next.join(','))
  }

  const label = selected.length > 0 ? selected.map(v => options.find(o => o.value === v)?.label || v).join(', ') : 'Any'

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        data-msf-btn={name}
        onClick={open}
        className={`w-full bg-surface border text-left transition-all cursor-pointer flex items-center justify-between rounded-lg px-2 py-1.5 text-sm gap-2
          ${isOpen ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-secondary hover:border-border-default'}
          ${selected.length > 0 ? 'text-foreground' : 'text-foreground-muted'}`}
      >
        <span className="truncate min-w-0">{label}</span>
        <svg
          className={`text-foreground-muted shrink-0 w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-msf-dropdown
            className="fixed z-[9999] bg-surface-elevated border border-border-default rounded-lg shadow-xl overflow-hidden py-1"
            style={{ top: rect.top, left: rect.left, width: Math.max(rect.width, 160) }}
          >
            {options.map(o => {
              const isSel = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-surface-secondary transition-colors ${isSel ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground-secondary'}`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${isSel ? 'bg-accent-500 border-accent-500' : 'border-border-secondary'}`}
                  >
                    {isSel && (
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
                  {o.label}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

// Exported trigger-only button for inline placement in filter bar
export function AdvancedFilterTrigger({
  activeCount,
  expanded,
  onToggle,
}: {
  activeCount: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors
        ${
          activeCount > 0
            ? 'bg-accent-50 dark:bg-accent-900/20 border-accent-400 text-accent-700 dark:text-accent-300'
            : 'border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary hover:border-border-default'
        }`}
    >
      {activeCount > 0 ? (
        <>
          <span className="font-semibold">
            {activeCount} filter{activeCount > 1 ? 's' : ''}
          </span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </>
      ) : (
        <>
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Hide filters
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> More filters
            </>
          )}
        </>
      )}
    </button>
  )
}

export default function AdvancedFilterPanel({
  fields,
  paramNames,
  mode = 'both',
  forceExpanded,
  valuesEndpoint,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const expanded = forceExpanded ?? searchParams.get('_adv') === '1'
  const [local, setLocal] = useState<Record<string, string>>({})

  function toggleExpanded() {
    const params = new URLSearchParams(searchParams.toString())
    if (expanded) {
      params.delete('_adv')
    } else {
      params.set('_adv', '1')
    }
    router.push(`?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const state: Record<string, string> = {}
    fields.forEach(f =>
      fieldParamNames(f).forEach(n => {
        const v = searchParams.get(n)
        if (v) state[n] = v
      })
    )
    setLocal(state)
  }, [searchParams])

  const activeFields = fields.filter(f => fieldIsActive(f, searchParams))
  const activeCount = activeFields.length
  const allParams = paramNames || fields.flatMap(fieldParamNames)
  const sections = Array.from(new Set(fields.map(f => f.section || 'General')))

  function setLocalVal(name: string, value: string) {
    setLocal(prev =>
      value ? { ...prev, [name]: value } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name))
    )
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    Object.entries(local).forEach(([k, v]) => {
      if (v) params.set(k, v)
    })
    params.delete('page')
    params.delete('_adv')
    router.push(`?${params.toString()}`)
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    params.delete('page')
    params.delete('_adv')
    setLocal({})
    router.push(`?${params.toString()}`)
  }

  function removeChip(f: AdvancedFilterField) {
    const params = new URLSearchParams(searchParams.toString())
    fieldParamNames(f).forEach(n => params.delete(n))
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  const inputCls =
    'w-full px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors placeholder:text-foreground-muted'

  // Scrolls on its own: the filter card is sticky, and the spec sections can outgrow the screen.
  const sectionList = () => (
    <div className="max-h-[50vh] overflow-y-auto overscroll-contain space-y-1.5 pr-1">
      {sections.map(section => {
        const sectionFields = fields.filter(f => (f.section || 'General') === section)
        const sectionActive = sectionFields.filter(f => fieldIsActive(f, searchParams)).length
        return (
          <FilterSection key={section} title={section} activeCount={sectionActive}>
            {sectionFields.map((f, i) => {
              const isWide = f.type === 'range' || f.type === 'date-range'
              return (
                <div key={i} className={isWide ? 'col-span-2' : ''}>
                  <label className="block text-[11px] font-medium text-foreground-muted mb-1">{f.label}</label>
                  {renderField(f)}
                </div>
              )
            })}
          </FilterSection>
        )
      })}
    </div>
  )

  function renderField(f: AdvancedFilterField) {
    const name = Array.isArray(f.name) ? f.name[0] : f.name
    if (f.type === 'boolean') {
      const isOn = local[name] === 'true'
      return (
        <button
          type="button"
          onClick={() => setLocalVal(name, isOn ? '' : 'true')}
          className="flex items-center gap-2 mt-0.5"
        >
          <span
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors ${isOn ? 'bg-accent-500 border-accent-500' : 'bg-border-secondary border-border-secondary'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'}`}
            />
          </span>
          <span
            className={`text-xs ${isOn ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground-muted'}`}
          >
            {isOn ? 'Yes only' : 'Any'}
          </span>
        </button>
      )
    }
    if (f.type === 'toggle') {
      const opts = f.options || [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ]
      return (
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setLocalVal(name, '')}
            className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${!local[name] ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}
          >
            Any
          </button>
          {opts.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => setLocalVal(name, o.value)}
              className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${local[name] === o.value ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )
    }
    if (f.type === 'select') {
      return (
        <AdminSelect
          sm
          value={local[name] || ''}
          placeholder="Any"
          options={[{ value: '', label: 'Any' }, ...(f.options || [])]}
          onChange={v => setLocalVal(name, v)}
        />
      )
    }
    if (f.type === 'multi-select') {
      return (
        <MultiSelectField
          name={name}
          options={f.options || []}
          value={local[name] || ''}
          onChange={v => setLocalVal(name, v)}
        />
      )
    }
    if (f.type === 'range') {
      const [minName, maxName] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
      const u = f.unit || ''
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input
              type="number"
              min={0}
              placeholder="Min"
              className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[minName] || ''}
              onChange={e => setLocalVal(minName, e.target.value)}
            />
          </div>
          <span className="text-foreground-muted flex-shrink-0">–</span>
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input
              type="number"
              min={0}
              placeholder="Max"
              className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[maxName] || ''}
              onChange={e => setLocalVal(maxName, e.target.value)}
            />
          </div>
        </div>
      )
    }
    if (f.type === 'date-range') {
      const [fromName, toName] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="flex-1">
            <DatePicker value={local[fromName] || ''} onChange={v => setLocalVal(fromName, v)} placeholder="From" />
          </div>
          <span className="text-foreground-muted flex-shrink-0">–</span>
          <div className="flex-1">
            <DatePicker value={local[toName] || ''} onChange={v => setLocalVal(toName, v)} placeholder="To" />
          </div>
        </div>
      )
    }
    if (f.type === 'text')
      return (
        <input
          type="text"
          className={inputCls}
          placeholder={f.placeholder || `Filter by ${f.label}`}
          value={local[name] || ''}
          onChange={e => setLocalVal(name, e.target.value)}
        />
      )
    if (f.type === 'value-help')
      return (
        <FilterValueHelp
          field={name}
          label={f.label}
          value={local[name] || ''}
          onChange={v => setLocalVal(name, v)}
          placeholder={f.placeholder}
          multi
          endpoint={valuesEndpoint}
        />
      )
    return null
  }

  // mode='trigger' → inline button only (placed next to search in AdminFilters)
  // mode='content' → sections only (placed full-width below filter row)
  // mode='both' (default) → trigger + sections together (legacy)

  if (mode === 'trigger') {
    return <AdvancedFilterTrigger activeCount={activeCount} expanded={expanded} onToggle={toggleExpanded} />
  }

  if (mode === 'content') {
    if (!expanded && activeCount === 0) return null
    return (
      <div className="mt-2 pt-2 border-t border-border-default space-y-1.5">
        {activeCount > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border-default">
            {activeFields.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded-full"
              >
                {chipLabel(f, searchParams)}
                <button type="button" onClick={() => removeChip(f)}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={reset}
              className="text-xs text-foreground-muted hover:text-foreground underline"
            >
              Clear all
            </button>
          </div>
        )}
        {expanded && (
          <>
            {sectionList()}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={reset}
                className="px-3 py-1.5 text-xs font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors"
              >
                Reset All
              </button>
              <button
                type="button"
                onClick={apply}
                className="px-5 py-1.5 text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // mode='both': trigger right-aligned + content below (default)
  return (
    <div className="w-full">
      <div className="flex justify-end">
        <AdvancedFilterTrigger activeCount={activeCount} expanded={expanded} onToggle={toggleExpanded} />
      </div>
      {(expanded || activeCount > 0) && (
        <div className="mt-2 pt-2 border-t border-border-default space-y-1.5">
          {activeCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border-default">
              {activeFields.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded-full"
                >
                  {chipLabel(f, searchParams)}
                  <button type="button" onClick={() => removeChip(f)}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={reset}
                className="text-xs text-foreground-muted hover:text-foreground underline"
              >
                Clear all
              </button>
            </div>
          )}
          {expanded && (
            <>
              {sectionList()}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 text-xs font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors"
                >
                  Reset All
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="px-5 py-1.5 text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors"
                >
                  Apply Filters
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
