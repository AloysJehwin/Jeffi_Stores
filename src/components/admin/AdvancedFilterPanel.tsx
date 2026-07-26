'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import AdminSelect from './AdminSelect'
import DatePicker from '@/components/ui/DatePicker'

export type AdvancedFilterFieldType = 'select' | 'range' | 'date-range' | 'toggle' | 'text'

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
  if (f.type === 'text') {
    const name = Array.isArray(f.name) ? f.name[0] : f.name
    return `${f.label}: ${params.get(name)}`
  }
  return f.label
}

function fieldIsActive(f: AdvancedFilterField, params: URLSearchParams): boolean {
  return fieldParamNames(f).some(n => !!params.get(n))
}

export default function AdvancedFilterPanel({ fields, paramNames }: AdvancedFilterPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<Record<string, string>>({})

  // Sync local state from URL on open
  useEffect(() => {
    if (!open) return
    const state: Record<string, string> = {}
    fields.forEach(f => {
      fieldParamNames(f).forEach(n => {
        const v = searchParams.get(n)
        if (v) state[n] = v
      })
    })
    setLocal(state)
  }, [open, searchParams])

  const activeFields = fields.filter(f => fieldIsActive(f, searchParams))
  const activeCount = activeFields.length

  // All managed param names
  const allParams = paramNames || fields.flatMap(fieldParamNames)

  function setLocalVal(name: string, value: string) {
    setLocal(prev => value ? { ...prev, [name]: value } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name)))
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    // Clear all managed params first
    allParams.forEach(n => params.delete(n))
    // Set new values
    Object.entries(local).forEach(([k, v]) => { if (v) params.set(k, v) })
    params.delete('page')
    router.push(`?${params.toString()}`)
    setOpen(false)
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString())
    allParams.forEach(n => params.delete(n))
    params.delete('page')
    router.push(`?${params.toString()}`)
    setOpen(false)
  }

  function removeChip(f: AdvancedFilterField) {
    const params = new URLSearchParams(searchParams.toString())
    fieldParamNames(f).forEach(n => params.delete(n))
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  // Group fields by section
  const sections = Array.from(new Set(fields.map(f => f.section || 'General')))

  const inputCls = 'w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

  function renderField(f: AdvancedFilterField) {
    if (f.type === 'select') {
      const name = Array.isArray(f.name) ? f.name[0] : f.name
      return (
        <select className={inputCls} value={local[name] || ''} onChange={e => setLocalVal(name, e.target.value)}>
          <option value="">Any</option>
          {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    if (f.type === 'toggle') {
      const name = Array.isArray(f.name) ? f.name[0] : f.name
      const opts = f.options || [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
      return (
        <div className="flex gap-2">
          <button type="button" onClick={() => setLocalVal(name, '')}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${!local[name] ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>
            Any
          </button>
          {opts.map(o => (
            <button key={o.value} type="button" onClick={() => setLocalVal(name, o.value)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${local[name] === o.value ? 'bg-accent-500 text-white border-accent-500' : 'border-border-secondary text-foreground hover:bg-surface-secondary'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )
    }
    if (f.type === 'range') {
      const [minName, maxName] = Array.isArray(f.name) ? f.name : [`${f.name}_min`, `${f.name}_max`]
      const u = f.unit || ''
      return (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input type="number" min={0} placeholder="Min"
              className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[minName] || ''} onChange={e => setLocalVal(minName, e.target.value)} />
          </div>
          <span className="text-foreground-muted text-sm">–</span>
          <div className="relative flex-1">
            {u && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">{u}</span>}
            <input type="number" min={0} placeholder="Max"
              className={`${inputCls} ${u ? 'pl-6' : ''}`}
              value={local[maxName] || ''} onChange={e => setLocalVal(maxName, e.target.value)} />
          </div>
        </div>
      )
    }
    if (f.type === 'date-range') {
      const [fromName, toName] = Array.isArray(f.name) ? f.name : [`${f.name}_from`, `${f.name}_to`]
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <DatePicker value={local[fromName] || ''} onChange={v => setLocalVal(fromName, v)} placeholder="From date" />
          </div>
          <span className="text-foreground-muted text-sm">–</span>
          <div className="flex-1">
            <DatePicker value={local[toName] || ''} onChange={v => setLocalVal(toName, v)} placeholder="To date" />
          </div>
        </div>
      )
    }
    if (f.type === 'text') {
      const name = Array.isArray(f.name) ? f.name[0] : f.name
      return (
        <input type="text" className={inputCls} placeholder={f.placeholder || `Filter by ${f.label}`}
          value={local[name] || ''} onChange={e => setLocalVal(name, e.target.value)} />
      )
    }
    return null
  }

  return (
    <>
      {/* Trigger button */}
      <button type="button" onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors
          ${activeCount > 0
            ? 'bg-accent-50 dark:bg-accent-900/20 border-accent-400 text-accent-700 dark:text-accent-300'
            : 'border-border-secondary bg-surface text-foreground hover:bg-surface-secondary'}`}>
        <SlidersHorizontal className="w-4 h-4" />
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-accent-500 text-white rounded-full leading-none">{activeCount}</span>
        )}
      </button>

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
          <button type="button" onClick={reset}
            className="text-xs text-foreground-muted hover:text-foreground underline">
            Clear all
          </button>
        </div>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-surface-elevated rounded-xl border border-border-default shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-foreground-secondary" />
                <h2 className="text-base font-semibold text-foreground">Advanced Filters</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-foreground-muted hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {sections.map(section => {
                const sectionFields = fields.filter(f => (f.section || 'General') === section)
                return (
                  <div key={section}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-3">{section}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {sectionFields.map((f, i) => (
                        <div key={i} className={f.type === 'range' || f.type === 'date-range' ? 'sm:col-span-2' : ''}>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1.5">{f.label}</label>
                          {renderField(f)}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border-default bg-surface-secondary rounded-b-xl">
              <button type="button" onClick={reset}
                className="px-4 py-2 text-sm font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface transition-colors">
                Reset All
              </button>
              <button type="button" onClick={apply}
                className="px-6 py-2 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors">
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
