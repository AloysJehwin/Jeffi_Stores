'use client'

import { useState, useEffect } from 'react'
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

interface Props {
  fields: AdvancedFilterField[]
  paramNames?: string[]
}

function fieldParamNames(f: AdvancedFilterField): string[] {
  return Array.isArray(f.name) ? f.name : [f.name]
}

function chipLabel(f: AdvancedFilterField, params: URLSearchParams): string {
  const name = Array.isArray(f.name) ? f.name[0] : f.name
  if (f.type === 'range') {
    const [min, max] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
    const mn = params.get(min); const mx = params.get(max); const u = f.unit || ''
    if (mn && mx) return `${f.label}: ${u}${mn}–${u}${mx}`
    if (mn) return `${f.label}: ≥${u}${mn}`
    if (mx) return `${f.label}: ≤${u}${mx}`
  }
  if (f.type === 'date-range') {
    const [from, to] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
    const df = params.get(from); const dt = params.get(to)
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
    const vals = params.get(name)?.split(',').filter(Boolean) || []
    return `${f.label}: ${vals.join(', ')}`
  }
  return `${f.label}: ${params.get(name)}`
}

function fieldIsActive(f: AdvancedFilterField, params: URLSearchParams): boolean {
  return fieldParamNames(f).some(n => !!params.get(n))
}

function FilterSection({ title, activeCount, children }: { title: string; activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const isOpen = open || activeCount > 0
  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-secondary hover:bg-surface-secondary/80 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{title}</span>
          {activeCount > 0 && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent-500 text-white rounded-full leading-none">{activeCount}</span>}
        </div>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />}
      </button>
      {isOpen && <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">{children}</div>}
    </div>
  )
}

// Exported trigger-only button for inline placement in filter bar
export function AdvancedFilterTrigger({ activeCount, expanded, onToggle }: { activeCount: number; expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors
        ${activeCount > 0
          ? 'bg-accent-50 dark:bg-accent-900/20 border-accent-400 text-accent-700 dark:text-accent-300'
          : 'border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary hover:border-border-default'}`}>
      {activeCount > 0
        ? <><span className="font-semibold">{activeCount} filter{activeCount > 1 ? 's' : ''}</span>{expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</>
        : <>{expanded ? <><ChevronUp className="w-3 h-3" /> Hide filters</> : <><ChevronDown className="w-3 h-3" /> More filters</>}</>}
    </button>
  )
}

export default function AdvancedFilterPanel({ fields, paramNames }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState(false)
  const [local, setLocal] = useState<Record<string, string>>({})
  const [popup, setPopup] = useState<string | null>(null)

  useEffect(() => {
    const state: Record<string, string> = {}
    fields.forEach(f => fieldParamNames(f).forEach(n => { const v = searchParams.get(n); if (v) state[n] = v }))
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
    setExpanded(false)
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    params.delete('page')
    setLocal({})
    router.push(`?${params.toString()}`)
    setExpanded(false)
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
        <button type="button" onClick={() => setLocalVal(name, isOn ? '' : 'true')} className="flex items-center gap-2 mt-0.5">
          <span className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors ${isOn ? 'bg-accent-500 border-accent-500' : 'bg-border-secondary border-border-secondary'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
          </span>
          <span className={`text-xs ${isOn ? 'text-accent-600 dark:text-accent-400 font-medium' : 'text-foreground-muted'}`}>{isOn ? 'Yes only' : 'Any'}</span>
        </button>
      )
    }
    if (f.type === 'toggle') {
      const opts = f.options || [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      return (
        <div className="flex gap-1 flex-wrap">
          <button type="button" onClick={() => setLocalVal(name, '')} className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${!local[name] ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>Any</button>
          {opts.map(o => <button key={o.value} type="button" onClick={() => setLocalVal(name, o.value)} className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${local[name] === o.value ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>{o.label}</button>)}
        </div>
      )
    }
    if (f.type === 'select' || f.type === 'multi-select') {
      const selected = local[name] ? local[name].split(',').filter(Boolean) : []
      const selectedLabels = selected.map(v => f.options?.find(o => o.value === v)?.label || v)
      return (
        <div className="relative">
          <button type="button" onClick={() => setPopup(popup === name ? null : name)}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded-lg bg-surface text-left transition-colors ${selected.length > 0 ? 'border-accent-400 text-accent-700' : 'border-border-secondary text-foreground-muted hover:border-border-default'}`}>
            <span className="truncate">{selected.length > 0 ? selectedLabels.join(', ') : 'Any'}</span>
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 ml-1 text-foreground-muted" />
          </button>
          {popup === name && (
            <div className="absolute z-[600] top-full left-0 mt-1 bg-surface-elevated border border-border-default rounded-xl shadow-xl min-w-[160px] py-1">
              {f.options?.map(o => {
                const isSel = selected.includes(o.value)
                return (
                  <button key={o.value} type="button"
                    onClick={() => { if (f.type !== 'multi-select') { setLocalVal(name, isSel ? '' : o.value); setPopup(null) } else { const next = isSel ? selected.filter(s => s !== o.value) : [...selected, o.value]; setLocalVal(name, next.join(',')) } }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-secondary transition-colors ${isSel ? 'text-accent-600 font-medium' : 'text-foreground'}`}>
                    {f.type === 'multi-select' && <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${isSel ? 'bg-accent-500 border-accent-500' : 'border-border-secondary'}`}>{isSel && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}</span>}
                    {o.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    }
    if (f.type === 'range') {
      const [minName, maxName] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
      const u = f.unit || ''
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="relative flex-1">{u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}<input type="number" min={0} placeholder="Min" className={`${inputCls} ${u ? 'pl-6' : ''}`} value={local[minName] || ''} onChange={e => setLocalVal(minName, e.target.value)} /></div>
          <span className="text-foreground-muted flex-shrink-0">–</span>
          <div className="relative flex-1">{u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}<input type="number" min={0} placeholder="Max" className={`${inputCls} ${u ? 'pl-6' : ''}`} value={local[maxName] || ''} onChange={e => setLocalVal(maxName, e.target.value)} /></div>
        </div>
      )
    }
    if (f.type === 'date-range') {
      const [fromName, toName] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
      return (
        <div className="col-span-2 flex items-center gap-2">
          <div className="flex-1"><DatePicker value={local[fromName] || ''} onChange={v => setLocalVal(fromName, v)} placeholder="From" /></div>
          <span className="text-foreground-muted flex-shrink-0">–</span>
          <div className="flex-1"><DatePicker value={local[toName] || ''} onChange={v => setLocalVal(toName, v)} placeholder="To" /></div>
        </div>
      )
    }
    if (f.type === 'text') return <input type="text" className={inputCls} placeholder={f.placeholder || `Filter by ${f.label}`} value={local[name] || ''} onChange={e => setLocalVal(name, e.target.value)} />
    if (f.type === 'value-help') return <FilterValueHelp field={name} label={f.label} value={local[name] || ''} onChange={v => setLocalVal(name, v)} placeholder={f.placeholder} multi />
    return null
  }

  // Single component — AdminFilters renders this via advancedPanel prop
  // The trigger is inline, the expanded panel is a sibling div inside the card
  // AdminFilters must use overflow-visible and render advancedPanel in a w-full slot
  return (
    <div className="w-full">
      {/* Row: trigger button (AdminFilters renders this div inline) */}
      <div className="flex justify-end">
        <AdvancedFilterTrigger activeCount={activeCount} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
      </div>

      {/* Expanded panel — renders below, full width inside the card */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border-default space-y-2">
          {activeCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border-default">
              {activeFields.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700 rounded-full">
                  {chipLabel(f, searchParams)}
                  <button type="button" onClick={() => removeChip(f)}><X className="w-3 h-3" /></button>
                </span>
              ))}
              <button type="button" onClick={reset} className="text-xs text-foreground-muted hover:text-foreground underline">Clear all</button>
            </div>
          )}
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
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={reset} className="px-3 py-1.5 text-xs font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors">Reset All</button>
            <button type="button" onClick={apply} className="px-5 py-1.5 text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors">Apply Filters</button>
          </div>
        </div>
      )}
    </div>
  )
}
