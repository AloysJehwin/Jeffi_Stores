'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import FilterValueHelp from './FilterValueHelp'

export type AdvancedFilterFieldType = 'select' | 'range' | 'date-range' | 'toggle' | 'boolean' | 'text' | 'multi-select' | 'value-help'

export interface AdvancedFilterField {
  name: string | [string, string]
  label: string
  type: AdvancedFilterFieldType
  options?: { value: string; label: string }[]
  section?: string
  placeholder?: string
  unit?: string
}

interface AdvancedFilterPanelProps {
  fields: AdvancedFilterField[]
  paramNames?: string[]
}

function fieldParamNames(f: AdvancedFilterField): string[] {
  if (Array.isArray(f.name)) return f.name
  return [f.name]
}

function chipLabel(f: AdvancedFilterField, params: URLSearchParams): string {
  if (f.type === 'range') {
    const [min, max] = Array.isArray(f.name) ? f.name : [f.name + '_min', f.name + '_max']
    const mn = params.get(min); const mx = params.get(max); const u = f.unit || ''
    if (mn && mx) return `${f.label}: ${u}${mn}–${u}${mx}`
    if (mn) return `${f.label}: ≥${u}${mn}`
    if (mx) return `${f.label}: ≤${u}${mx}`
  }
  if (f.type === 'date-range') {
    const [from, to] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
    const df = params.get(from); const dt = params.get(to)
    if (df && dt) return `${f.label}: ${df} – ${dt}`
    if (df) return `${f.label}: from ${df}`
    if (dt) return `${f.label}: to ${dt}`
  }
  if (f.type === 'toggle' || f.type === 'select') {
    const name = Array.isArray(f.name) ? f.name[0] : f.name
    const val = params.get(name) || ''
    const opt = f.options?.find(o => o.value === val)
    return `${f.label}: ${opt?.label || val}`
  }
  if (f.type === 'multi-select') {
    const name = Array.isArray(f.name) ? f.name[0] : f.name
    const vals = params.get(name)?.split(',').filter(Boolean) || []
    const labels = vals.map(v => f.options?.find(o => o.value === v)?.label || v)
    return `${f.label}: ${labels.join(', ')}`
  }
  if (f.type === 'text') {
    const name = Array.isArray(f.name) ? f.name[0] : f.name
    return `${f.label}: ${params.get(name)}`
  }
  return f.label
}

function fieldIsActive(f: AdvancedFilterField, params: URLSearchParams): boolean {
  return fieldParamNames(f).some(n => !!params.get(n))
}

// Popup multi/single select chooser
function OptionsPopup({ options, value, multi, onChange, onClose }: {
  options: { value: string; label: string }[]
  value: string
  multi?: boolean
  onChange: (v: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const selected = value ? value.split(',').filter(Boolean) : []

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  function toggle(v: string) {
    if (!multi) { onChange(v === value ? '' : v); onClose(); return }
    const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]
    onChange(next.join(','))
  }

  return (
    <div ref={ref} className="absolute z-[500] top-full left-0 mt-1 bg-surface-elevated border border-border-default rounded-xl shadow-xl min-w-[180px] max-w-[260px] py-1 overflow-hidden">
      {multi && selected.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border-default">
          <button type="button" onClick={() => onChange('')} className="text-xs text-accent-500 hover:underline">Clear all</button>
        </div>
      )}
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => toggle(o.value)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-surface-secondary
            ${(multi ? selected.includes(o.value) : value === o.value) ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground'}`}
        >
          {multi && (
            <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center
              ${selected.includes(o.value) ? 'bg-accent-500 border-accent-500' : 'border-border-secondary'}`}>
              {selected.includes(o.value) && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          )}
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Collapsible section
function FilterSection({ title, activeCount, children }: { title: string; activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const isOpen = open || activeCount > 0
  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-secondary hover:bg-surface-secondary/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{title}</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent-500 text-white rounded-full leading-none">{activeCount}</span>
          )}
        </div>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />}
      </button>
      {isOpen && <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">{children}</div>}
    </div>
  )
}

export default function AdvancedFilterPanel({ fields, paramNames }: AdvancedFilterPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState(false)
  const [local, setLocal] = useState<Record<string, string>>({})
  const [popup, setPopup] = useState<string | null>(null)

  // Sync local state from URL
  useEffect(() => {
    const state: Record<string, string> = {}
    fields.forEach(f => {
      fieldParamNames(f).forEach(n => {
        const v = searchParams.get(n)
        if (v) state[n] = v
      })
    })
    setLocal(state)
  }, [searchParams])

  const activeFields = fields.filter(f => fieldIsActive(f, searchParams))
  const activeCount = activeFields.length
  const allParams = paramNames || fields.flatMap(fieldParamNames)
  const sections = Array.from(new Set(fields.map(f => f.section || 'General')))

  function setLocalVal(name: string, value: string) {
    setLocal(prev => value ? { ...prev, [name]: value } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name)))
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    Object.entries(local).forEach(([k, v]) => { if (v) params.set(k, v) })
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    params.delete('page')
    setLocal({})
    router.push(`?${params.toString()}`)
  }

  function removeChip(f: AdvancedFilterField) {
    const params = new URLSearchParams(searchParams.toString())
    fieldParamNames(f).forEach(n => params.delete(n))
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  const inputCls = 'w-full px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors placeholder:text-foreground-muted'

  function renderField(f: AdvancedFilterField) {
    const name = Array.isArray(f.name) ? f.name[0] : f.name

    if (f.type === 'boolean') {
      const isOn = local[name] === 'true'
      return (
        <button
          type="button"
          onClick={() => setLocalVal(name, isOn ? '' : 'true')}
          className="flex items-center gap-2 mt-0.5"
          title={isOn ? 'Click to disable filter' : 'Click to filter for Yes only'}
        >
          <span className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors duration-200
            ${isOn ? 'bg-accent-500 border-accent-500' : 'bg-border-secondary border-border-secondary'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200
              ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
          </span>
          <span className={`text-xs ${isOn ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground-muted'}`}>
            {isOn ? 'Yes only' : 'Any'}
          </span>
        </button>
      )
    }

    if (f.type === 'toggle') {
      const opts = f.options || [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      return (
        <div className="flex gap-1 flex-wrap">
          <button type="button" onClick={() => setLocalVal(name, '')}
            className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${!local[name] ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>
            Any
          </button>
          {opts.map(o => (
            <button key={o.value} type="button" onClick={() => setLocalVal(name, o.value)}
              className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${local[name] === o.value ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )
    }

    if (f.type === 'select' || f.type === 'multi-select') {
      const selected = local[name] ? local[name].split(',').filter(Boolean) : []
      const selectedLabels = selected.map(v => f.options?.find(o => o.value === v)?.label || v)
      return (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPopup(popup === name ? null : name)}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg bg-surface transition-colors text-left
              ${selected.length > 0 ? 'border-accent-400 text-accent-700 dark:text-accent-300' : 'border-border-secondary text-foreground-muted hover:border-border-default'}`}
          >
            <span className="truncate">{selected.length > 0 ? selectedLabels.join(', ') : 'Any'}</span>
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 ml-1 text-foreground-muted" />
          </button>
          {popup === name && (
            <OptionsPopup
              options={f.options || []}
              value={local[name] || ''}
              multi={f.type === 'multi-select'}
              onChange={v => setLocalVal(name, v)}
              onClose={() => setPopup(null)}
            />
          )}
        </div>
      )
    }

    if (f.type === 'range') {
      const [minName, maxName] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
      const u = f.unit || ''
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input type="number" min={0} placeholder="Min" className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[minName] || ''} onChange={e => setLocalVal(minName, e.target.value)} />
          </div>
          <span className="text-foreground-muted text-sm flex-shrink-0">–</span>
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input type="number" min={0} placeholder="Max" className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[maxName] || ''} onChange={e => setLocalVal(maxName, e.target.value)} />
          </div>
        </div>
      )
    }

    if (f.type === 'date-range') {
      const [fromName, toName] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="flex-1">
            <DatePicker value={local[fromName] || ''} onChange={v => setLocalVal(fromName, v)} placeholder="From date" />
          </div>
          <span className="text-foreground-muted text-sm flex-shrink-0">–</span>
          <div className="flex-1">
            <DatePicker value={local[toName] || ''} onChange={v => setLocalVal(toName, v)} placeholder="To date" />
          </div>
        </div>
      )
    }

    if (f.type === 'text') {
      return (
        <input type="text" className={inputCls} placeholder={f.placeholder || `Filter by ${f.label}`}
          value={local[name] || ''} onChange={e => setLocalVal(name, e.target.value)} />
      )
    }

    if (f.type === 'value-help') {
      return (
        <FilterValueHelp
          field={name}
          label={f.label}
          value={local[name] || ''}
          onChange={v => setLocalVal(name, v)}
          placeholder={f.placeholder}
          multi
        />
      )
    }
    return null
  }

  return (
    <div className="w-full">
      {/* Trigger row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className={`flex items-center gap-1 p-1.5 rounded transition-colors
            ${activeCount > 0
              ? 'text-accent-600 dark:text-accent-400'
              : 'text-foreground-muted hover:text-foreground'}`}
          title="Advanced Filters"
        >
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent-500 text-white rounded-full leading-none">{activeCount}</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {activeCount > 0 && (
          <button type="button" onClick={reset} className="text-xs text-foreground-muted hover:text-foreground underline">
            Clear all
          </button>
        )}
      </div>

      {/* Active chips */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {activeFields.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded-full">
              {chipLabel(f, searchParams)}
              <button type="button" onClick={() => removeChip(f)} className="hover:text-accent-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible filter panel */}
      {expanded && (
        <div className="mt-3 space-y-2">
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

          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={reset}
              className="px-3 py-1.5 text-xs font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors">
              Reset All
            </button>
            <button type="button" onClick={() => { apply(); setExpanded(false) }}
              className="px-5 py-1.5 text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors">
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
