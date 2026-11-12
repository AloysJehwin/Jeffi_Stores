'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import {
  EXTRA_FIELDS,
  EXTRA_GROUP_LABEL,
  extraFieldInput,
  type ExtraField,
  type ExtraGroup,
} from '@/lib/catalog/product-extra-fields'

const inputCls =
  'field-normal w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const labelCls = 'mb-1.5 block text-xs font-medium text-foreground-secondary'

function FieldInput({ f, value }: { f: ExtraField; value: unknown }) {
  const v = extraFieldInput(f.key, value)
  const common = { id: `pf_${f.key}`, name: f.key, defaultValue: v, placeholder: f.placeholder }
  switch (f.type) {
    case 'textarea':
      return <textarea {...common} rows={3} maxLength={f.max} className={`${inputCls} resize-y`} />
    case 'int':
      return <input {...common} type="number" min={0} step={1} className={inputCls} />
    case 'numeric':
      return <input {...common} type="number" min={0} step="any" className={inputCls} />
    case 'month':
      return <input {...common} type="month" className={inputCls} />
    case 'url':
      return <input {...common} type="url" className={inputCls} />
    case 'bool':
      return (
        <select {...common} className={inputCls}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      )
    case 'select':
      return (
        <select {...common} className={inputCls}>
          <option value="">—</option>
          {f.options?.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {v && !f.options?.some(o => o.value === v) && <option value={v}>{v}</option>}
        </select>
      )
    default:
      return <input {...common} type="text" maxLength={f.max} className={inputCls} />
  }
}

/** Uncontrolled inputs named after their column: autosave and save read them from the form. */
export function ExtraFieldsGroup({
  group,
  product,
  note,
  omit = [],
}: {
  group: ExtraGroup
  product: Record<string, any> | null | undefined
  note?: string
  omit?: string[]
}) {
  const fields = EXTRA_FIELDS.filter(f => f.group === group && !omit.includes(f.key))
  if (fields.length === 0) return null
  return (
    <div>
      <div className="flex items-center px-4 h-10 bg-surface-secondary/30 text-sm font-medium text-foreground">
        <span>{EXTRA_GROUP_LABEL[group]}</span>
      </div>
      <div className="p-4 space-y-3">
        {note && <p className="text-xs text-foreground-muted">{note}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={`pf_${f.key}`} className={labelCls}>
                {f.label}
              </label>
              <FieldInput f={f} value={product?.[f.key]} />
              {f.hint && <p className="text-xs text-foreground-muted mt-1">{f.hint}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const AI_ROWS: [string, string][] = [
  ['ai_product_type', 'Product type'],
  ['ai_description', 'Description'],
  ['ai_who_uses_it', 'Who uses it'],
  ['ai_application', 'Application'],
  ['ai_use_cases', 'Use cases'],
  ['ai_features', 'Features'],
  ['ai_keywords', 'Keywords'],
  ['ai_search_tags', 'Search tags'],
]

/** Read-only view of the AI enrichment columns (written by the enrichment job, not the form). */
export function AiInsightsPanel({ product }: { product: Record<string, any> | null | undefined }) {
  const rows = AI_ROWS.filter(([k]) => {
    const v = product?.[k]
    return Array.isArray(v) ? v.length > 0 : !!v
  })
  return (
    <div className="border border-border-default rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 h-11 bg-surface-secondary/50 text-sm font-semibold text-foreground">
        <span>AI insights</span>
        <span className="text-xs font-normal text-foreground-muted">
          {product?.ai_enriched_at ? `Enriched ${new Date(product.ai_enriched_at).toLocaleDateString('en-IN')}` : 'Not enriched yet'}
        </span>
      </div>
      <div className="border-t border-border-default p-4">
        {rows.length === 0 ? (
          <p className="text-xs text-foreground-muted">AI enrichment runs after publish and fills these for search.</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, label]) => {
              const v = product?.[k]
              return (
                <div key={k} className="contents">
                  <dt className="text-xs font-medium text-foreground-muted pt-0.5">{label}</dt>
                  <dd className="text-foreground">
                    {Array.isArray(v) ? (
                      <span className="flex flex-wrap gap-1">
                        {v.map((t: string) => (
                          <span key={t} className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-xs">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : (
                      String(v)
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </div>
    </div>
  )
}

export interface FaqRow {
  id?: string
  question: string
  answer: string
  published?: boolean
}

/** Product FAQs, staged in the draft as `_faqs` (posted as JSON in a hidden input). */
export function FaqEditor({
  initial,
  onChange,
  disabled,
}: {
  initial: FaqRow[]
  onChange: () => void
  disabled?: boolean
}) {
  const [rows, setRows] = useState<FaqRow[]>(initial)
  const [touched, setTouched] = useState(false)
  const update = (fn: (r: FaqRow[]) => FaqRow[]) => {
    setRows(fn)
    setTouched(true)
    setTimeout(onChange, 0)
  }
  const move = (i: number, d: number) =>
    update(r => {
      const j = i + d
      if (j < 0 || j >= r.length) return r
      const n = [...r]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  return (
    <div className="border border-border-default rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 h-11 bg-surface-secondary/50 text-sm font-semibold text-foreground">
        <span>FAQs</span>
        <span className="text-xs font-normal text-foreground-muted">{rows.length} question{rows.length === 1 ? '' : 's'}</span>
      </div>
      {/* Only posted once edited: an untouched editor leaves the live FAQs alone. */}
      {touched && <input type="hidden" name="_faqs" value={JSON.stringify(rows)} readOnly />}
      <div className="border-t border-border-default p-4 space-y-3">
        {rows.length === 0 && <p className="text-xs text-foreground-muted">No FAQs. Shown on the product page under the description.</p>}
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="rounded-lg border border-border-default p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                type="text"
                value={r.question}
                disabled={disabled}
                maxLength={300}
                onChange={e => update(rs => rs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                placeholder="Question"
                className={inputCls}
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <button type="button" title="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="p-1.5 text-foreground-muted hover:text-foreground disabled:opacity-30">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={disabled || i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  className="p-1.5 text-foreground-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" title="Remove" disabled={disabled} onClick={() => update(rs => rs.filter((_, j) => j !== i))} className="p-1.5 text-foreground-muted hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <textarea
              value={r.answer}
              disabled={disabled}
              rows={2}
              maxLength={2000}
              onChange={e => update(rs => rs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
              placeholder="Answer"
              className={`${inputCls} resize-y`}
            />
            <label className="flex items-center gap-2 text-xs text-foreground-secondary">
              <input
                type="checkbox"
                checked={r.published !== false}
                disabled={disabled}
                onChange={e => update(rs => rs.map((x, j) => (j === i ? { ...x, published: e.target.checked } : x)))}
              />
              Show on the product page
            </label>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => update(rs => [...rs, { question: '', answer: '', published: true }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700"
        >
          <Plus className="h-3.5 w-3.5" /> Add question
        </button>
      </div>
    </div>
  )
}
