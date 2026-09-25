'use client'

import { useEffect, useState } from 'react'
import { Package, X } from 'lucide-react'
import AdminImage from '@/components/admin/AdminImage'
import type { PickerProduct } from '@/app/api/admin/homepage/products/route'
import { INPUT_CLASS, LABEL_CLASS } from './fields'

interface ProductPickerFieldProps {
  label: string
  hint?: string
  ids: string[]
  multiple?: boolean
  max?: number
  disabled: boolean
  onCommit: (ids: string[]) => void
}

async function fetchProducts(params: Record<string, string>): Promise<PickerProduct[]> {
  const res = await fetch(`/api/admin/homepage/products?${new URLSearchParams(params).toString()}`, { credentials: 'include' })
  if (!res.ok) return []
  return ((await res.json()).products ?? []) as PickerProduct[]
}

function Thumb({ product }: { product: PickerProduct }) {
  return (
    <span className="w-8 h-8 shrink-0 overflow-hidden rounded bg-surface-secondary">
      <AdminImage
        src={product.image_url}
        alt=""
        className="w-full h-full object-cover"
        fallback={<Package className="w-4 h-4 text-foreground-muted" aria-hidden="true" />}
      />
    </span>
  )
}

export default function ProductPickerField({ label, hint, ids, multiple = false, max = 12, disabled, onCommit }: ProductPickerFieldProps) {
  const [selected, setSelected] = useState<PickerProduct[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerProduct[]>([])
  const idsKey = ids.join(',')

  useEffect(() => {
    let cancelled = false
    if (!idsKey) { setSelected([]); return }
    fetchProducts({ ids: idsKey }).then(rows => { if (!cancelled) setSelected(rows) })
    return () => { cancelled = true }
  }, [idsKey])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      fetchProducts({ q }).then(rows => { if (!cancelled) setResults(rows) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  const full = multiple && ids.length >= max

  function pick(product: PickerProduct) {
    setQuery('')
    setResults([])
    if (!multiple) { onCommit([product.id]); return }
    if (!ids.includes(product.id) && !full) onCommit([...ids, product.id])
  }

  return (
    <div className="sm:col-span-2">
      <label className={LABEL_CLASS}>{label}</label>

      {selected.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {selected.map(p => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-2 py-1.5">
              <Thumb product={p} />
              <span className="flex-1 min-w-0 text-sm text-foreground truncate" title={p.name}>{p.name}</span>
              {p.sku && <span className="text-[11px] text-foreground-muted shrink-0">{p.sku}</span>}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onCommit(ids.filter(id => id !== p.id))}
                aria-label={`Remove ${p.name}`}
                className="p-1 rounded text-foreground-muted hover:text-red-600 disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(multiple ? !full : true) && (
        <div className="relative">
          <input
            type="text"
            value={query}
            disabled={disabled}
            placeholder={multiple || selected.length === 0 ? 'Search products by name or SKU' : 'Search to replace this product'}
            onChange={e => setQuery(e.target.value)}
            className={INPUT_CLASS}
          />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border-default bg-surface-elevated shadow-lg">
              {results.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    disabled={ids.includes(p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-secondary disabled:opacity-50"
                  >
                    <Thumb product={p} />
                    <span className="flex-1 min-w-0 text-sm text-foreground truncate">{p.name}</span>
                    {p.is_bundle && <span className="text-[10px] uppercase tracking-wide text-accent-600">Bundle</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {hint && <p className="text-[11px] text-foreground-muted mt-1">{hint}</p>}
    </div>
  )
}
